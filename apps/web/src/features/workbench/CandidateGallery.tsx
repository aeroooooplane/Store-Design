import { useState } from 'react'
import { PLAN_STRATEGY_LABELS } from '@store/shared'
import type {
  Asset,
  DesignNode,
  LayoutCandidate,
  LayoutCandidates,
  ShopType,
  SiStyle,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useCreateNode, useGenerateLayouts } from './api.ts'
import { PlanView } from './PlanView.tsx'
import { freshName } from './tree.ts'

const RULE_LABELS: Record<string, string> = {
  clearance: '道具间距',
  aisle: '主通道',
  entranceBuffer: '入口缓冲',
}

function count(candidate: LayoutCandidate, fn: string): number {
  return candidate.layout.items.filter((i) => i.function === fn).length
}

interface PlanGenerationInput {
  projectId: string
  spaceNode: DesignNode & { space: NonNullable<DesignNode['space']> }
  shopType: ShopType
  siStyle: SiStyle
  /** Names already used under this space, so a new set gets numbered names. */
  existingNames: readonly string[]
}

/**
 * Generates the three strategies for a space and keeps all of them as plan nodes (the plan
 * level of the history). Generating again adds another set; earlier plans stay.
 */
export function usePlanGeneration({
  projectId,
  spaceNode,
  shopType,
  siStyle,
  existingNames,
}: PlanGenerationInput) {
  const generate = useGenerateLayouts()
  const create = useCreateNode(projectId)
  const [saved, setSaved] = useState<Partial<Record<string, string>>>({})
  const [saving, setSaving] = useState(false)

  async function keepAll(result: LayoutCandidates) {
    setSaving(true)
    const taken = [...existingNames]
    const ids: Partial<Record<string, string>> = {}
    try {
      for (const candidate of result.candidates) {
        const name = freshName(`方案 · ${PLAN_STRATEGY_LABELS[candidate.strategy]}`, taken)
        taken.push(name)
        const created = await create.mutateAsync({
          parentId: spaceNode.id,
          kind: 'plan',
          name,
          strategy: candidate.strategy,
          siStyle,
          layout: candidate.layout,
        })
        ids[candidate.strategy] = created.node.id
      }
    } finally {
      setSaved(ids)
      setSaving(false)
    }
  }

  return {
    run: () =>
      generate.mutate(
        { space: spaceNode.space, shopType, siStyle },
        { onSuccess: (result) => void keepAll(result) },
      ),
    busy: generate.isPending || saving,
    saving,
    saved,
    result: generate.data,
    error: generate.error ?? create.error,
    label: generate.data || existingNames.length ? '再生成一组方案' : '生成三个方案',
  }
}

export type PlanGeneration = ReturnType<typeof usePlanGeneration>

interface CandidateGalleryProps {
  generation: PlanGeneration
  shopType: ShopType
  siStyle: SiStyle
  assets: ReadonlyMap<string, Asset>
  onChosen: (nodeId: string) => void
}

/** The plans just generated, side by side, each with a button to open it. */
export function CandidateGallery({
  generation,
  shopType,
  siStyle,
  assets,
  onChosen,
}: CandidateGalleryProps) {
  const { result, saved, saving } = generation
  return (
    <section className="candidates" aria-label="自动排布">
      <ErrorMessage error={generation.error} />
      {!result && (
        <p className="hint">
          点击右侧“{generation.label}”：三个方案都会保存到历史的方案层；按 {siStyle}{' '}
          选用模型，通道与间距为设计指导值，放不下时逐级让步并在方案中说明。
        </p>
      )}
      {result && (
        <div className="candidate-grid">
          {result.candidates.map((candidate) => {
            const label = PLAN_STRATEGY_LABELS[candidate.strategy]
            const errors = candidate.issues.filter((i) => i.severity === 'error')
            const relaxations = candidate.layout.planning?.relaxations ?? []
            const id = saved[candidate.strategy]
            return (
              <article key={candidate.strategy} className="candidate">
                <h3>{label}</h3>
                <PlanView
                  space={result.space}
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
                <button type="button" disabled={!id} onClick={() => id && onChosen(id)}>
                  {id ? '打开此方案' : saving ? '正在保存…' : '未保存'}
                </button>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
