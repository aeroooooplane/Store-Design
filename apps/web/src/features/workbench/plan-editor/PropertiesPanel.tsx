import type { Dispatch } from 'react'
import { itemElevation, itemMount, mmToM, mToMm } from '@store/shared'
import type { Asset, Fixture, Installation, LayoutItem, Space } from '@store/shared'
import { TrashIcon } from '../../../components/icons.tsx'
import type { EditorAction } from '../editor-state.ts'
import { ArcArrow } from './ArcArrow.tsx'

interface PropertiesPanelProps {
  selected: LayoutItem | null
  /** The selected 空心隔板, when a partition rather than a prop is selected. */
  fixture?: Fixture | null | undefined
  assetMap: Map<string, Asset>
  /** The space, to put a piece switched between 贴墙 and 内嵌 onto or into its wall. */
  space: Space
  dispatch: Dispatch<EditorAction>
  onRotate: (by: 90 | -90) => void
}

const ELEVATION_LABELS: Record<Installation, string> = {
  floor: '离地高度',
  wall: '离地高度（墙面）',
  ceiling: '离地高度（吊挂）',
  embedded: '离地高度（内嵌）',
}

/** A 空心隔板: its size, height and position, each typed in millimetres. */
function FixtureFields({
  fixture,
  dispatch,
}: {
  fixture: Fixture
  dispatch: Dispatch<EditorAction>
}) {
  const field = (label: string, key: 'w' | 'd' | 'h' | 'cx' | 'cz') => (
    <label className="field-row" key={key}>
      {label}
      <input
        type="number"
        step={10}
        value={mToMm(fixture[key])}
        onChange={(e) =>
          dispatch({
            type: 'updateFixture',
            id: fixture.id,
            patch: { [key]: mmToM(Number(e.target.value)) },
          })
        }
      />
    </label>
  )
  return (
    <>
      <div className="properties-head">
        <h3>空心隔板</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="删除空心隔板"
          title="删除（Delete）"
          onClick={() => dispatch({ type: 'remove', id: fixture.id })}
        >
          <TrashIcon />
        </button>
      </div>
      {field('长（左右）', 'w')}
      {field('宽（前后）', 'd')}
      {field('高度', 'h')}
      {field('水平位置', 'cx')}
      {field('垂直位置', 'cz')}
      <p className="hint">临时补丁：配件柜可以嵌在隔板里；拖动时边缘吸附墙体和配件柜。</p>
    </>
  )
}

/** The selected prop: size, position and rotation, or how to edit when nothing is selected. */
export function PropertiesPanel({
  selected,
  fixture,
  assetMap,
  space,
  dispatch,
  onRotate,
}: PropertiesPanelProps) {
  const asset = selected?.assetId ? assetMap.get(selected.assetId) : undefined
  // Screens and light boxes may hang on the wall or be built into it (N1, 10-15).
  const switchable = asset?.installation === 'wall' || asset?.installation === 'embedded'
  if (!selected && fixture)
    return (
      <div className="wb-card properties" aria-label="选中道具">
        <FixtureFields fixture={fixture} dispatch={dispatch} />
      </div>
    )
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
          {switchable && (
            <div className="field-row">
              安装方式
              <span className="tabs" role="group" aria-label="安装方式">
                {(['wall', 'embedded'] as const).map((mount) => (
                  <button
                    key={mount}
                    type="button"
                    aria-pressed={itemMount(selected) === mount}
                    onClick={() =>
                      dispatch({
                        type: 'setMount',
                        id: selected.id,
                        mount,
                        space,
                        front: asset?.front ?? null,
                      })
                    }
                  >
                    {mount === 'wall' ? '贴墙' : '内嵌'}
                  </button>
                ))}
              </span>
            </div>
          )}
          {itemMount(selected) !== 'floor' && (
            <label className="field-row">
              {ELEVATION_LABELS[itemMount(selected)]}
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
