import { EXPORT_FORMAT, LayoutSchema, ProjectExportSchema } from '@store/shared'
import type { AssetFit, ProjectExport } from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import { parentsFirst, reconcileAssets } from './plan.ts'
import type { PlannedProject } from './plan.ts'

export function isNativeExport(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { format?: unknown }).format === EXPORT_FORMAT
  )
}

/** Re-imports a file from GET /projects/:id/export, re-checking models against today's catalogue. */
export function convertNative(
  raw: unknown,
  assets: ReadonlyMap<string, AssetFit>,
  name?: string,
): PlannedProject {
  const parsed = ProjectExportSchema.safeParse(raw)
  if (!parsed.success)
    throw new AppError('VALIDATION_FAILED', '项目文件格式无效', parsed.error.issues)
  const file: ProjectExport = parsed.data
  const warnings: string[] = []
  const nodes = parentsFirst(
    file.nodes.map((node) => ({
      ref: node.id,
      parentRef: node.parentId,
      kind: node.kind,
      name: node.name,
      space: node.space,
      layout: node.layout
        ? LayoutSchema.parse({
            ...node.layout,
            items: reconcileAssets(node.layout.items, assets, `节点“${node.name}”`, warnings),
          })
        : null,
      strategy: node.strategy,
      siStyle: node.siStyle,
      origin: node.origin,
      importedFrom: node.importedFrom ?? node.id,
      hidden: node.hidden,
    })),
  )
  let draft: PlannedProject['draft'] = null
  if (file.draft) {
    const baseRef = file.draft.baseNodeId
    if (!nodes.some((n) => n.ref === baseRef)) warnings.push('草稿所基于的节点不存在，已略去')
    else
      draft = {
        baseRef,
        layout: LayoutSchema.parse({
          ...file.draft.layout,
          items: reconcileAssets(file.draft.layout.items, assets, '草稿', warnings),
        }),
      }
  }
  return { ...file.project, name: name ?? file.project.name, nodes, draft, warnings }
}
