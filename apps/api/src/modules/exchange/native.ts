import { EXPORT_FORMAT, LayoutSchema, ProjectExportSchema } from '@store/shared'
import type { AssetFit, ProjectExport } from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import { parentsFirst, parseImported, reconcileAssets } from './plan.ts'
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
        ? parseImported(
            LayoutSchema,
            {
              ...node.layout,
              items: reconcileAssets(node.layout.items, assets, `节点“${node.name}”`, warnings),
            },
            `节点“${node.name}”的布局`,
          )
        : null,
      strategy: node.strategy,
      siStyle: node.siStyle,
      origin: node.origin,
      importedFrom: node.importedFrom ?? node.id,
      hidden: node.hidden,
    })),
  )
  const seen = new Set<string>()
  const drafts = (file.drafts ?? (file.draft ? [file.draft] : [])).flatMap((entry) => {
    const baseRef = entry.baseNodeId
    if (seen.has(baseRef)) throw new AppError('VALIDATION_FAILED', '同一节点不能包含多份草稿')
    seen.add(baseRef)
    const base = nodes.find((n) => n.ref === baseRef)
    if (!base || base.kind === 'render') {
      warnings.push('草稿所基于的可编辑节点不存在，已略去')
      return []
    }
    return [
      {
        baseRef,
        layout: parseImported(
          LayoutSchema,
          {
            ...entry.layout,
            items: reconcileAssets(entry.layout.items, assets, '草稿', warnings),
          },
          '草稿的布局',
        ),
      },
    ]
  })
  const [draft = null, ...additionalDrafts] = drafts
  return {
    ...file.project,
    name: name ?? file.project.name,
    nodes,
    draft,
    additionalDrafts,
    warnings,
  }
}
