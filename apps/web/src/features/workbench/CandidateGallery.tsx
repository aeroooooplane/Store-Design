import { useState } from 'react'
import { PLAN_STRATEGY_LABELS, freshName } from '@store/shared'
import type {
  Asset,
  Demand,
  DesignNode,
  LayoutCandidate,
  LayoutCandidates,
  ShopType,
  SiStyle,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useCreateNode, useGenerateLayouts } from './api.ts'
import { DemandEditor } from './DemandEditor.tsx'
import { PlanView } from './PlanView.tsx'

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
  const [dirtySpace, setDirtySpace] = useState<string | null>(null)
  const [generatedFor, setGeneratedFor] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const dirty = dirtySpace === spaceNode.id
  async function saveDemand(demand: Demand) {
    const created = await create.mutateAsync({
      parentId: spaceNode.parentId,
      kind: 'space',
      name: `${spaceNode.name.slice(0, 80)} · 清单修订`,
      space: { ...spaceNode.space, demand },
    })
    setDirtySpace(null)
    return created.node.id
  }

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
    } catch (error) {
      setSaveError(error instanceof Error ? error : new Error('保存方案失败'))
    } finally {
      setSaved(ids)
      setSaving(false)
    }
  }

  return {
    spaceId: spaceNode.id,
    demand: spaceNode.space.demand,
    saveDemand,
    setDirty: (value: boolean) => {
      setDirtySpace(value ? spaceNode.id : null)
      setSaveError(null)
    },
    run: () => {
      if (dirty) {
        setSaveError(new Error('请先保存清单或取消修改，再重新生成。'))
        return
      }
      if (generate.isPending || saving || create.isPending) return
      setGeneratedFor(spaceNode.id)
      setSaveError(null)
      setSaved({})
      generate.mutate(
        { space: spaceNode.space, shopType, siStyle },
        { onSuccess: (result) => void keepAll(result) },
      )
    },
    busy: generate.isPending || saving || create.isPending,
    savingDemand: create.isPending || generate.isPending,
    saving,
    saved,
    result: generatedFor === spaceNode.id ? generate.data : undefined,
    error: saveError ?? generate.error ?? create.error,
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
      <DemandEditor
        key={generation.spaceId}
        demand={generation.demand}
        busy={generation.savingDemand || saving}
        onDirty={generation.setDirty}
        onSave={async (demand) => onChosen(await generation.saveDemand(demand))}
      />
      {!result && (
        <p className="hint">
          点击右侧“{generation.label}”：三个方案都会保存到历史的方案层；按 {siStyle} 选用模型。
          {generation.demand
            ? '按已保存清单排布，缺项会列明；占位不算真实模型。'
            : '通道与间距为设计指导值，放不下时逐级让步并在方案中说明。'}
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
                {candidate.layout.planning?.demand ? (
                  <details>
                    <summary>
                      逐项数量 · {candidate.layout.items.length}/
                      {candidate.layout.planning.requested}件
                    </summary>
                    <table>
                      <thead>
                        <tr>
                          <th>道具</th>
                          <th>需要</th>
                          <th>已放</th>
                          <th>其中占位</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidate.layout.planning.demand.map((row) => (
                          <tr key={row.id}>
                            <td>{row.label}</td>
                            <td>{row.required}</td>
                            <td>{row.placed}</td>
                            <td>{row.placeholders}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : (
                  <p>
                    中岛桌 {count(candidate, 'island_table')} · 收银 {count(candidate, 'cashier')} ·
                    配件柜 {count(candidate, 'accessory_cabinet')}
                  </p>
                )}
                {result.space.demand && <p className="hint">{candidate.layout.planning?.note}</p>}
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
