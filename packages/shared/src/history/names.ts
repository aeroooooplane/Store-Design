const LETTER_PREFIX = { space: '空间', plan: '方案' } as const

/** Independent spaces and plans get the next letter in their scope, including hidden versions. */
export function nextHistoryName(
  kind: keyof typeof LETTER_PREFIX,
  taken: readonly string[],
  detail?: string,
): string {
  const prefix = LETTER_PREFIX[kind]
  const pattern = new RegExp(`^${prefix} ([A-Z]{1,3})(?=$|[ （])`)
  let next = 1
  for (const name of taken) {
    const letters = name.match(pattern)?.[1]
    if (!letters) continue
    let index = 0
    for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
    next = Math.max(next, index + 1)
  }
  let letters = ''
  for (let index = next; index > 0; index = Math.floor((index - 1) / 26)) {
    letters = String.fromCharCode(65 + ((index - 1) % 26)) + letters
  }
  return detail ? `${prefix} ${letters} · ${detail}` : `${prefix} ${letters}`
}

function spaceVersion(name: string) {
  const current = name.match(/ · v([1-9]\d{0,8})$/)
  let base = current ? name.slice(0, current.index) : name
  let revision = current ? Number(current[1]) : 1
  // Old editors appended these markers to their own output on every edit.
  const previous = /(?:（修改）| · (?:改墙|清单修订|Agent))(?:（([1-9]\d{0,8})）)?$/
  for (let match = base.match(previous); match; match = base.match(previous)) {
    if (!current) revision += Number(match[1] ?? 1)
    base = base.slice(0, match.index)
  }
  return { base: base.trim().slice(0, 86).trimEnd() || '空间', revision }
}

export function nextSpaceRevisionName(name: string, taken: readonly string[]): string {
  const source = spaceVersion(name)
  let revision = source.revision
  for (const other of taken) {
    const candidate = spaceVersion(other)
    if (candidate.base === source.base) revision = Math.max(revision, candidate.revision)
  }
  return `${source.base} · v${revision + 1}`
}

export function nextRenderName(taken: readonly string[]): string {
  let next = 1
  for (const name of taken) {
    const match = name.match(/^渲染(?: ([1-9]\d{0,8})|（([1-9]\d{0,8})）)?$/)
    if (match) next = Math.max(next, Number(match[1] ?? match[2] ?? 1) + 1)
  }
  return next === 1 ? '渲染' : `渲染 ${next}`
}
