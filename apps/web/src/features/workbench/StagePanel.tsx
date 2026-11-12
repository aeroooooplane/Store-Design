import type { ComponentType, ReactNode } from 'react'
import {
  Copy,
  ImageDown,
  LayoutGrid,
  Move,
  PencilRuler,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react'
import { PlanIcon, RenderIcon, SpaceIcon, WhiteIcon } from '../../components/StoreIcons.tsx'

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>

/** The stage icons, by the start of the title (it may go on, e.g. 空间阶段 · 手动排布). */
const STAGE_ICONS: [string, Icon][] = [
  ['空间阶段', SpaceIcon],
  ['方案阶段', PlanIcon],
  ['三维效果阶段', WhiteIcon],
  ['渲染阶段', RenderIcon],
]

/** One icon per stage action, kept in one place for the whole workbench (2026-11-12). */
const ACTION_ICONS: Record<string, Icon> = {
  修改空间: PencilRuler,
  手动排布: Move,
  生成三个方案: LayoutGrid,
  再生成一组方案: LayoutGrid,
  '正在生成…': LayoutGrid,
  保存为方案: Save,
  新建副本: Copy,
  丢弃草稿: RotateCcw,
  修改墙体: PencilRuler,
  进入三维效果: WhiteIcon,
  开始渲染: RenderIcon,
  重新渲染: RefreshCw,
  下载图片: ImageDown,
}

export interface StageAction {
  label: string
  onClick: () => void
  disabled?: boolean | undefined
  primary?: boolean | undefined
  title?: string | undefined
}

interface StagePanelProps {
  title: string
  /** Two actions side by side, then (optionally) one across the full width. */
  first: readonly [StageAction, StageAction]
  /** Another plain action across the full width, between the two rows. */
  extra?: StageAction | undefined
  second?: StageAction | undefined
  status?: ReactNode
  hint?: ReactNode
}

function ActionButton({ action }: { action: StageAction }) {
  const Icon = ACTION_ICONS[action.label]
  return (
    <button
      type="button"
      className={
        [action.primary ? 'primary' : '', Icon ? 'with-icon' : ''].join(' ').trim() || undefined
      }
      disabled={action.disabled}
      title={action.title}
      onClick={action.onClick}
    >
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {action.label}
    </button>
  )
}

/** The current stage and what can be done in it (copy, discard, go to the next stage). */
export function StagePanel({ title, first, extra, second, status, hint }: StagePanelProps) {
  const StageIcon = STAGE_ICONS.find(([start]) => title.startsWith(start))?.[1]
  return (
    <section className="stage-panel" aria-label={title}>
      <div className="stage-head">
        <h3>
          {StageIcon ? <StageIcon size={18} aria-hidden="true" /> : null}
          {title}
        </h3>
        {status}
      </div>
      <div className="stage-row">
        <ActionButton action={first[0]} />
        <ActionButton action={first[1]} />
      </div>
      {extra && (
        <div className="stage-row single">
          <ActionButton action={extra} />
        </div>
      )}
      {second && (
        <div className="stage-row single">
          <ActionButton action={second} />
        </div>
      )}
      {hint ? <p className="hint">{hint}</p> : null}
    </section>
  )
}
