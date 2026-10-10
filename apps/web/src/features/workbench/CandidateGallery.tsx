import { PLAN_STRATEGY_LABELS } from '@store/shared'
import type { Asset, DesignNode, LayoutCandidate, ShopType, SiStyle } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useCreateNode, useGenerateLayouts } from './api.ts'
import { PlanView } from './PlanView.tsx'

const RULE_LABELS: Record<string, string> = {
  clearance: '道具间距',
  aisle: '主通道',
  entranceBuffer: '入口缓冲',
}

function count(candidate: LayoutCandidate, fn: string): number {
  return candidate.layout.items.filter((i) => i.function === fn).length
}

interface CandidateGalleryProps {
  projectId: string
  spaceNode: DesignNode & { space: NonNullable<DesignNode['space']> }
  shopType: ShopType
  siStyle: SiStyle
  assets: ReadonlyMap<string, Asset>
  onChosen: (nodeId: string) => void
}

/** Generates the three strategies for a space and saves the chosen one as a plan node. */
export function CandidateGallery({
  projectId,
  spaceNode,
  shopType,
  siStyle,
  assets,
  onChosen,
}: CandidateGalleryProps) {
  const generate = useGenerateLayouts()
  const create = useCreateNode(projectId)

  return (
    <section className="candidates" aria-label="自动排布">
      <div className="toolbar">
        <button
          type="button"
          className="primary"
          disabled={generate.isPending}
          onClick={() => generate.mutate({ space: spaceNode.space, shopType, siStyle })}
        >
          {generate.data ? '重新生成方案' : '生成三种方案'}
        </button>
        <span className="hint">
          按 {siStyle} 选用模型；通道与间距为设计指导值，放不下时会逐级让步并在方案中说明。
        </span>
      </div>
      <ErrorMessage error={generate.error ?? create.error} />
      {generate.data && (
        <div className="candidate-grid">
          {generate.data.candidates.map((candidate) => {
            const label = PLAN_STRATEGY_LABELS[candidate.strategy]
            const errors = candidate.issues.filter((i) => i.severity === 'error')
            const relaxations = candidate.layout.planning?.relaxations ?? []
            return (
              <article key={candidate.strategy} className="candidate">
                <h3>{label}</h3>
                <PlanView
                  space={generate.data.space}
                  shopType={shopType}
                  layout={candidate.layout}
                  issues={candidate.issues}
                  assets={assets}
                  compact
                  title={`${label}方案平面`}
                />
                <p>
                  中岛桌 {count(candidate, 'island_table')} · 收银 {count(candidate, 'cashier')} ·
                  配件柜 {count(candidate, 'accessory_cabinet')}
                </p>
                {relaxations.length > 0 && (
                  <p className="hint">
                    已让步：
                    {relaxations
                      .map((r) => `${RULE_LABELS[r.rule] ?? r.rule} ${r.target}→${r.actual} m`)
                      .join('，')}
                  </p>
                )}
                {candidate.notes.map((note) => (
                  <p key={note} className="hint">
                    {note}
                  </p>
                ))}
                {errors.length > 0 && <p className="error">{errors.length} 个问题需要人工处理</p>}
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={() =>
                    create.mutate(
                      {
                        parentId: spaceNode.id,
                        kind: 'plan',
                        name: `方案 · ${label}`,
                        strategy: candidate.strategy,
                        siStyle,
                        layout: candidate.layout,
                      },
                      { onSuccess: (created) => onChosen(created.node.id) },
                    )
                  }
                >
                  选用此方案
                </button>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
