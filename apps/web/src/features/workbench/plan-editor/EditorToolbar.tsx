import type { Dispatch } from 'react'
import type { Look } from '../../viewer3d/white-scene.ts'
import type { EditorAction } from '../editor-state.ts'
import { ArcArrow } from './ArcArrow.tsx'
import type { SaveState } from './useDraftAutosave.ts'

const SAVE_LABELS = {
  idle: '未修改',
  saving: '正在保存草稿…',
  saved: '草稿已保存',
  conflict: '草稿已被其他窗口修改',
  error: '草稿保存失败',
}

interface EditorToolbarProps {
  view: 'plan' | '3d'
  onSwitchView: (next: 'plan' | '3d') => void
  /** The material / white model choice is only offered in the 3D effect stage. */
  isWhite: boolean
  look: Look
  onSwitchLook: (next: Look) => void
  canUndo: boolean
  canRedo: boolean
  dispatch: Dispatch<EditorAction>
  saveState: SaveState
  /** 显示间距: clear distances around the 软装 props on the plan. */
  spacing: boolean
  onToggleSpacing: () => void
  /** 画空心隔板: the next drag on the plan draws a partition. */
  drawingFixture: boolean
  onToggleDrawFixture: () => void
}

/** View and look tabs, undo / redo and the draft's save state. */
export function EditorToolbar({
  view,
  onSwitchView,
  isWhite,
  look,
  onSwitchLook,
  canUndo,
  canRedo,
  dispatch,
  saveState,
  spacing,
  onToggleSpacing,
  drawingFixture,
  onToggleDrawFixture,
}: EditorToolbarProps) {
  return (
    <div className="toolbar">
      <div className="tabs" role="group" aria-label="视图">
        <button type="button" aria-pressed={view === 'plan'} onClick={() => onSwitchView('plan')}>
          平面
        </button>
        <button type="button" aria-pressed={view === '3d'} onClick={() => onSwitchView('3d')}>
          三维
        </button>
      </div>
      {isWhite && (
        <div className="tabs" role="group" aria-label="外观">
          <button
            type="button"
            aria-pressed={look === 'material'}
            onClick={() => onSwitchLook('material')}
          >
            材质
          </button>
          <button
            type="button"
            aria-pressed={look === 'white'}
            onClick={() => onSwitchLook('white')}
          >
            白模
          </button>
        </div>
      )}
      {view === 'plan' && (
        <button
          type="button"
          aria-pressed={spacing}
          title="在平面上标出每件软装到最近软装或墙体的距离（100 mm–3 m）"
          onClick={onToggleSpacing}
        >
          显示间距
        </button>
      )}
      {view === 'plan' && (
        <button
          type="button"
          aria-pressed={drawingFixture}
          title="在平面上拖出一个矩形，边缘吸附墙体和配件柜（按住 Alt 不吸附，Esc 取消）"
          onClick={onToggleDrawFixture}
        >
          画空心隔板
        </button>
      )}
      <span className="history-buttons">
        <button
          type="button"
          className="icon-button"
          aria-label="撤回"
          title="撤回（Ctrl+Z）"
          disabled={!canUndo}
          onClick={() => dispatch({ type: 'undo' })}
        >
          <ArcArrow direction="left" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="重做"
          title="重做（Ctrl+Y）"
          disabled={!canRedo}
          onClick={() => dispatch({ type: 'redo' })}
        >
          <ArcArrow direction="right" />
        </button>
      </span>
      <span className={`save-state ${saveState}`} role="status">
        {SAVE_LABELS[saveState]}
      </span>
    </div>
  )
}
