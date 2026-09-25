// Local conversion metadata only. GLB files remain local and are not committed.
const entries=[
  ['asset-408124','真实体验桌','table',1.0000000076293938,1.8000000137329106,1.3268852203432526],
  ['asset-323015','真实配件柜','display',1.6000001091003426,.4500001052852054,2.400000018310547],
  ['asset-752992','真实柜台','counter',.5000003542794186,1.7999991887793838,1.213667602872054],
  ['asset-666964','真实桌椅组合','table',1.0688766972601784,1.7999991887261455,.9019999780231263],
]
export const realAssets=entries.map(([id,name,category,w,d,h])=>({id,name,category,dimensions:{w,d,h},
  url:`/assets/su/${id}/model.glb`,unit:'m',upAxis:'Y',origin:'bottom-center',siVersion:null,facing:null,
  status:'尺寸已核对；材质与正面待验收'}))
export function findRealAsset(id){const asset=realAssets.find(a=>a.id===id);if(!asset)throw Error('未找到真实资产：'+id);return asset}
