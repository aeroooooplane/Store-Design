import { describe, expect, it } from 'vitest'
import {
  canSelectCatalogAsset,
  catalogReviewAction,
  isCatalogAssetRetired,
} from './availability.ts'

describe('用户审核后的模型选用状态', () => {
  it.each(['asset-11525629', 'asset-11511980', 'asset-2463847'])(
    '%s LED保留全局模型，只退出新建选项',
    (id) => {
      const led = { id, retired: false }
      expect(canSelectCatalogAsset(led)).toBe(false)
      expect(isCatalogAssetRetired(led)).toBe(false)
      expect(catalogReviewAction(id)).toBe('hide-led')
    },
  )

  it('只按审核编号停用，不扩大到同名或相近编号，也不恢复已有停用项', () => {
    expect(isCatalogAssetRetired({ id: 'asset-958185', retired: false })).toBe(true)
    expect(canSelectCatalogAsset({ id: 'asset-2587726', retired: false })).toBe(true)
    expect(canSelectCatalogAsset({ id: 'asset-115256290', retired: false })).toBe(true)
    expect(canSelectCatalogAsset({ id: 'asset-90000002', retired: false })).toBe(true)
    expect(canSelectCatalogAsset({ id: 'asset-90000002', retired: true })).toBe(false)
  })

  it('需转换广告机仍可选，不因缺网页模型而被当作删除', () => {
    expect(catalogReviewAction('asset-11479197')).toBe('convert')
    expect(canSelectCatalogAsset({ id: 'asset-11479197', retired: false })).toBe(true)
  })
})
