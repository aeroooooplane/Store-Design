import { useMemo } from 'react'
import { rectangleSpace } from '@store/shared'
import type { Asset, Layout, Project } from '@store/shared'
import { Viewer3D } from '../viewer3d/Viewer3D.tsx'
import { catalogItem } from '../workbench/editor-state.ts'

export function PilotAssetPreview({ asset, project }: { asset: Asset; project: Project }) {
  const { space, layout, assets } = useMemo(() => {
    const width = Math.max(4, asset.footprint.w * 2.2)
    const depth = Math.max(4, asset.footprint.d * 2.2)
    const height = Math.min(20, Math.max(3.2, asset.footprint.h + 0.8))
    const space = rectangleSpace(width, depth, height)
    const empty: Layout = { schemaVersion: 3, items: [], planning: null }
    const item = catalogItem(empty, asset, width / 2, depth / 2)
    return {
      space,
      layout: { ...empty, items: [item] },
      assets: new Map([[asset.id, asset]]),
    }
  }, [asset])

  return (
    <Viewer3D
      title={asset.name + ' 三维预览'}
      space={space}
      shopType="island"
      layout={layout}
      assets={assets}
      look="material"
      market={project.market}
      siStyle={project.siStyle}
      selectedId={null}
      flaggedIds={new Set()}
      onSelect={() => undefined}
    />
  )
}
