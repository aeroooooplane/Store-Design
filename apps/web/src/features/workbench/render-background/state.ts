import type { BackgroundImage, RenderBackground } from '@store/shared'

export type BackgroundValue = RenderBackground | null
export interface SavedBackground {
  background: BackgroundValue
  revision: number
}
export interface BackgroundDraft extends SavedBackground {
  saved: BackgroundValue
  past: BackgroundValue[]
  future: BackgroundValue[]
  gesture: { before: BackgroundValue } | null
  saving: boolean
  error: unknown
}
const equal = (a: BackgroundValue, b: BackgroundValue) => JSON.stringify(a) === JSON.stringify(b)
const copy = (value: BackgroundValue): BackgroundValue => (value ? structuredClone(value) : null)

export function newBackground(image: BackgroundImage): RenderBackground {
  return {
    image,
    transform: {
      x: 0.5,
      y: 0.5,
      width: Math.min(1, image.width / image.height / 1.5),
      rotationDeg: 0,
    },
    masks: [],
    guides: [],
    guidesVisible: true,
    showTransparentWalls: false,
  }
}

/** Per-view history and a serial save queue. A response only acknowledges its own snapshot. */
export class BackgroundDrafts {
  private entries = new Map<string, BackgroundDraft>()
  private pending = new Map<string, Promise<void>>()
  private listeners = new Set<() => void>()
  private version = 0
  private save: (id: string, value: BackgroundValue, revision: number) => Promise<SavedBackground>
  constructor(
    save: (id: string, value: BackgroundValue, revision: number) => Promise<SavedBackground>,
  ) {
    this.save = save
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.version
  private notify() {
    this.version++
    this.listeners.forEach((listener) => listener())
  }
  get(id: string) {
    return this.entries.get(id)
  }
  receive(id: string, value: BackgroundValue, revision: number) {
    const current = this.entries.get(id)
    if (
      current &&
      (current.saving ||
        current.gesture ||
        !equal(current.background, current.saved) ||
        revision <= current.revision)
    )
      return
    this.entries.set(id, {
      background: copy(value),
      saved: copy(value),
      revision,
      past: [],
      future: [],
      gesture: null,
      saving: false,
      error: null,
    })
    this.notify()
  }
  dirty(id: string) {
    const e = this.get(id)
    return !!e && (!equal(e.background, e.saved) || !!e.gesture)
  }
  private record(e: BackgroundDraft, before: BackgroundValue) {
    e.past = [...e.past.slice(-99), copy(before)]
    e.future = []
  }
  commit(id: string, value: BackgroundValue) {
    const e = this.get(id)
    if (!e || equal(e.background, value)) return
    this.record(e, e.background)
    e.background = copy(value)
    this.notify()
    this.schedule(id)
  }
  begin(id: string) {
    const e = this.get(id)
    if (e && !e.gesture) {
      e.gesture = { before: copy(e.background) }
      this.notify()
    }
  }
  preview(id: string, value: BackgroundValue) {
    const e = this.get(id)
    if (e?.gesture) {
      e.background = copy(value)
      this.notify()
    }
  }
  end(id: string, cancel = false) {
    const e = this.get(id)
    if (!e?.gesture) return
    const before = e.gesture.before
    e.gesture = null
    if (cancel) e.background = before
    else if (!equal(before, e.background)) this.record(e, before)
    this.notify()
    this.schedule(id)
  }
  undo(id: string) {
    const e = this.get(id)
    if (!e || !e.past.length || e.gesture) return
    e.future.push(copy(e.background))
    e.background = e.past.pop()!
    this.notify()
    this.schedule(id)
  }
  redo(id: string) {
    const e = this.get(id)
    if (!e || !e.future.length || e.gesture) return
    e.past.push(copy(e.background))
    e.background = e.future.pop()!
    this.notify()
    this.schedule(id)
  }
  private schedule(id: string) {
    void this.flush(id).catch(() => undefined)
  }
  async flush(id: string): Promise<SavedBackground> {
    const ongoing = this.pending.get(id)
    if (ongoing) await ongoing
    const e = this.get(id)
    if (!e) throw new Error('视角背景尚未载入')
    if (e.gesture) throw new Error('请先结束当前拖动')
    if (e.error) throw e.error instanceof Error ? e.error : new Error('背景保存失败，请重试')
    if (!equal(e.background, e.saved)) {
      const run = (async () => {
        e.saving = true
        this.notify()
        try {
          while (!equal(e.background, e.saved) && !e.gesture) {
            const sent = copy(e.background)
            const response = await this.save(id, sent, e.revision)
            e.saved = copy(response.background)
            e.revision = response.revision
            this.notify()
          }
        } catch (error) {
          e.error = error
          throw error
        } finally {
          e.saving = false
          this.notify()
        }
      })()
      this.pending.set(id, run)
      try {
        await run
      } finally {
        if (this.pending.get(id) === run) this.pending.delete(id)
      }
    }
    if (e.gesture || !equal(e.background, e.saved)) return this.flush(id)
    return { background: copy(e.saved), revision: e.revision }
  }
  retry(id: string) {
    const e = this.get(id)
    if (e) {
      e.error = null
      this.notify()
      this.schedule(id)
    }
  }
  /** Explicit discard/reload after a revision conflict; never invoked by a late response. */
  reload(id: string, value: BackgroundValue, revision: number) {
    const e = this.get(id)
    if (e?.saving) return
    this.entries.delete(id)
    this.receive(id, value, revision)
  }
  async flushAll(ids: string[]) {
    return Promise.all(ids.map((id) => this.flush(id)))
  }
}
