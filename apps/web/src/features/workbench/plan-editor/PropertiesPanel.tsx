import type { Dispatch } from 'react'
import { itemElevation, itemMount, mmToM, mToMm } from '@store/shared'
import type { Asset, LayoutItem } from '@store/shared'
import { TrashIcon } from '../../../components/icons.tsx'
import type { EditorAction } from '../editor-state.ts'
import { ArcArrow } from './ArcArrow.tsx'

interface PropertiesPanelProps {
  selected: LayoutItem | null
  assetMap: Map<string, Asset>
  dispatch: Dispatch<EditorAction>
  onRotate: (by: 90 | -90) => void
}

/** The selected prop: size, position and rotation, or how to edit when nothing is selected. */
export function PropertiesPanel({ selected, assetMap, dispatch, onRotate }: PropertiesPanelProps) {
  return (
    <div className="wb-card properties" aria-label="选中道具">
      {selected ? (
        <>
          <div className="properties-head">
            <h3>{assetMap.get(selected.assetId ?? '')?.name ?? selected.name}</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="删除道具"
              title="删除（Delete）"
              onClick={() => dispatch({ type: 'remove', id: selected.id })}
            >
              <TrashIcon />
            </button>
          </div>
          <div className="field-row">
            道具尺寸
            <output>
              {mToMm(selected.w)} × {mToMm(selected.d)} × {mToMm(selected.h)} mm
              {selected.placeholder ? '（占位）' : ''}
            </output>
          </div>
          {itemMount(selected) !== 'floor' && (
            <label className="field-row">
              {itemMount(selected) === 'wall' ? '离地高度（墙面）' : '离地高度（吊挂）'}
              <input
                type="number"
                step={10}
                min={0}
                value={mToMm(itemElevation(selected))}
                onChange={(e) =>
                  dispatch({
                    type: 'elevate',
                    id: selected.id,
                    elevation: mmToM(Number(e.target.value)),
                  })
                }
              />
            </label>
          )}
          <label className="field-row">
            水平位置
            <input
              type="number"
              step={10}
              value={mToMm(selected.cx)}
              onChange={(e) =>
                dispatch({
                  type: 'move',
                  id: selected.id,
                  cx: mmToM(Number(e.target.value)),
                  cz: selected.cz,
                })
              }
            />
          </label>
          <label className="field-row">
            垂直位置
            <input
              type="number"
              step={10}
              value={mToMm(selected.cz)}
              onChange={(e) =>
                dispatch({
                  type: 'move',
                  id: selected.id,
                  cx: selected.cx,
                  cz: mmToM(Number(e.target.value)),
                })
              }
            />
          </label>
          <div className="field-row">
            旋转角度
            <output>{selected.rotation}°</output>
            <span className="history-buttons">
              <button
                type="button"
                className="icon-button"
                aria-label="逆时针旋转 90°"
                onClick={() => onRotate(-90)}
              >
                <ArcArrow direction="left" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="顺时针旋转 90°"
                onClick={() => onRotate(90)}
              >
                <ArcArrow direction="right" />
              </button>
            </span>
          </div>
        </>
      ) : (
        <>
          <h3>选中道具</h3>
          <p className="hint">
            点击道具选中；拖动移动（靠近墙或道具会吸附，按住 Alt 关闭），方向键微调 10 mm（Shift 100
            mm），R 旋转，Delete 删除。墙面 LOGO、画面拖到墙边会自动贴墙并朝向店内。
          </p>
        </>
      )}
    </div>
  )
}
