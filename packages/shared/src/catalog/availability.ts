/** 用户2026-10-30审核意见；只调整选用状态，保留源文件与旧项目引用。
 * 原件哈希及逐行意见见 docs/reviews/model-review-20261030.json。
 * 迁移发布前以代码侧覆盖生效，避免写共享资源；后续恢复须显式修改此记录。
 */
export const CATALOG_REVIEW = {
  'asset-11525629': { action: 'hide-led', note: '停用，但保留模型文件' },
  'asset-958185': { action: 'retire', note: '已重复，停用并删除' },
  'asset-2597250': { action: 'convert', note: '需转换' },
  'asset-3021147': { action: 'convert', note: '需转换' },
  'asset-11479197': { action: 'convert', note: '需转换' },
  'asset-11479198': { action: 'retire', note: '已重复，停用并删除' },
  'asset-2245165': { action: 'retire', note: '已重复，停用并删除' },
  'asset-28115483': { action: 'retire', note: '已重复，停用并删除' },
  'asset-316267': { action: 'retire', note: '已重复，停用并删除' },
  'asset-37758059': { action: 'retire', note: '已重复，停用并删除' },
  'asset-957634': { action: 'retire', note: '已重复，停用并删除' },
  'asset-2595839': { action: 'convert', note: '需转换' },
  'asset-11525433': { action: 'convert', note: '需转换' },
  'asset-2932497': { action: 'retire', note: '已重复，停用并删除' },
  'asset-2500908': { action: 'convert', note: '需转换' },
  'asset-28104668': { action: 'retire', note: '停用并删除' },
  'asset-11511980': { action: 'hide-led', note: '停用，但保留模型文件' },
  'asset-11478950': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-11525436': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-2463847': { action: 'hide-led', note: '停用，但保留模型文件' },
  'asset-754006': { action: 'retire', note: '停用并删除' },
  'asset-569211': { action: 'retire', note: '停用并删除' },
  'asset-2587203': { action: 'retire', note: '停用并删除' },
  'asset-1156409': { action: 'retire', note: '停用并删除' },
  'asset-33937175': { action: 'retire', note: '停用并删除' },
  'asset-40896298': { action: 'retire', note: '停用并删除' },
  'asset-6952129': { action: 'retire', note: '停用并删除' },
  'asset-568756': { action: 'retire', note: '停用并删除' },
  'asset-1688590': { action: 'retire', note: '停用并删除' },
  'asset-3356988': { action: 'retire', note: '停用并删除' },
  'asset-754909': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-2908609': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-2932358': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-33908345': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-775543': { action: 'retire', note: '停用，但保留模型文件' },
  'asset-24488049': { action: 'retire', note: '停用，但保留模型文件' },
} as const

export function catalogReviewAction(id: string): 'hide-led' | 'retire' | 'convert' | undefined {
  return (CATALOG_REVIEW as Record<string, { action: 'hide-led' | 'retire' | 'convert' }>)[id]
    ?.action
}

export function isCatalogAssetRetired(asset: { id: string; retired: boolean }): boolean {
  return asset.retired || catalogReviewAction(asset.id) === 'retire'
}

/** LED属于后续硬装，不作为新道具提供；这里使用审核过的精确编号，避免名称误伤。 */
export function canSelectCatalogAsset(asset: { id: string; retired: boolean }): boolean {
  return !isCatalogAssetRetired(asset) && catalogReviewAction(asset.id) !== 'hide-led'
}
