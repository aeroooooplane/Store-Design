import { useMemo, useState } from 'react'
import {
  PLAN_STRATEGY_LABELS,
  SHOP_TYPE_LABELS,
  applyDisplayEdits,
  emptyDisplayEdits,
  entranceFrame,
  planDisplay,
  safeFileName,
  storeTitle,
} from '@store/shared'
import type {
  Asset,
  DisplayTableInput,
  GeneratedStrategy,
  Layout,
  Project,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { SlotTable } from '../display/SlotTable.tsx'
import { useDisplayRules } from '../display/queries.ts'

export interface DisplayPlan {
  image: { data: string; width: number; height: number }
  box: { x: number; y: number; width: number; height: number }
}

interface PilotDisplayProps {
  project: Project
  space: Space
  layout: Layout
  catalog: ReadonlyMap<string, Asset>
  strategy: GeneratedStrategy
  plan: () => Promise<DisplayPlan>
  download: (file: Blob, name: string) => void
}

export function PilotDisplay({
  project,
  space,
  layout,
  catalog,
  strategy,
  plan,
  download,
}: PilotDisplayProps) {
  const rules = useDisplayRules()
  const [edits, setEdits] = useState(() => emptyDisplayEdits(project.siStyle))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const tables = useMemo(() => {
    if (!rules.data) return []
    const inputs = layout.items.flatMap((item): DisplayTableInput[] => {
      const model = item.assetId ? catalog.get(item.assetId) : undefined
      const kind =
        item.function === 'island_table'
          ? 'island'
          : model?.function === 'side_cabinet' &&
              /托盘/.test(model.standardName + model.variant + model.name)
            ? 'side'
            : null
      return kind
        ? [
            {
              id: item.id,
              kind,
              cx: item.cx,
              cz: item.cz,
              w: item.w,
              d: item.d,
              assetId: item.assetId ?? null,
            },
          ]
        : []
    })
    return applyDisplayEdits(
      planDisplay(rules.data.rules, {
        tables: inputs,
        entrance: entranceFrame(space),
        market: project.market,
        siStyle: project.siStyle,
        moduleScheme: edits.moduleScheme,
        landscapeEnd: edits.landscapeEnd,
        orientation: edits.orientation,
      }),
      edits,
    )
  }, [rules.data, layout, catalog, space, project.market, project.siStyle, edits])

  async function exportSlides() {
    if (!rules.data) return
    setBusy(true)
    setError(null)
    try {
      const [drawing, { exportDisplaySlides }] = await Promise.all([
        plan(),
        import('./pilot-display-slides.ts'),
      ])
      const title = storeTitle(project.name)
      const data = await exportDisplaySlides({
        title,
        subtitle: project.siStyle + ' · ' + SHOP_TYPE_LABELS[project.shopType],
        strategy: PLAN_STRATEGY_LABELS[strategy],
        market: project.market,
        si: project.siStyle,
        rules: rules.data,
        drawing,
        tables,
        end: edits.landscapeEnd,
        moduleScheme: edits.moduleScheme,
      })
      download(data, safeFileName(title) + '展陈方案.pptx')
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wb-card" aria-label="展陈方案">
      <h2>展陈方案</h2>
      {rules.data && (
        <p className="hint">
          规则版本 {rules.data.version}。当前布局的槽位可调整，完成后下载 PPTX。
        </p>
      )}
      {rules.isPending && <p role="status">正在加载展陈规则…</p>}
      <ErrorMessage error={rules.error ?? error} />
      {rules.data &&
        (tables.length ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void exportSlides()}
            >
              {busy ? '正在生成 PPTX…' : '下载展陈 PPTX'}
            </button>
            <SlotTable
              rules={rules.data.rules}
              photos={rules.data.photos}
              si={project.siStyle}
              tables={tables}
              edits={edits}
              onChange={setEdits}
              disabled={busy}
            />
          </>
        ) : (
          <p className="notice">当前方案没有可展陈的桌位。</p>
        ))}
    </section>
  )
}
