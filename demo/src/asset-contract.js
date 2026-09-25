// Layout uses the top-left corner of the footprint; models use bottom-center.
// No non-uniform scaling: physical asset dimensions are authoritative.
export function validateAsset(asset) {
  if(!asset || typeof asset.id!=='string' || !asset.id || !asset.name)throw Error('资产标识缺失')
  if(asset.unit!=='m'||asset.upAxis!=='Y'||asset.origin!=='bottom-center')throw Error('资产坐标系必须为米制、Y 向上、底部中心')
  if(!['w','d','h'].every(k=>Number.isFinite(asset.dimensions?.[k])&&asset.dimensions[k]>0))throw Error('资产尺寸无效')
  if(typeof asset.url!=='string'||!/^\/(?!\/)[^\\?#]+\.glb$/.test(asset.url)||asset.url.includes('..'))throw Error('资产必须使用本站 GLB 路径')
  return asset
}

function coordinates(x,z){
  if(!Number.isFinite(x)||!Number.isFinite(z))throw Error('道具坐标无效')
}

function quarterTurn(rotation=0){
  if(!Number.isFinite(rotation)||rotation%90!==0)throw Error('资产旋转必须为 90° 的整数倍')
  return ((rotation%360)+360)%360
}

export function createAssetItem(asset,id,x,z) {
  validateAsset(asset);coordinates(x,z)
  return {id,assetId:asset.id,type:asset.category,name:asset.name,...asset.dimensions,x,z,rotation:0,siVersion:asset.siVersion??null}
}

export function rotateItem(item) {
  if(!item.assetId)return {...item,w:item.d,d:item.w}
  coordinates(item.x,item.z)
  return {...item,w:item.d,d:item.w,x:item.x+(item.w-item.d)/2,z:item.z+(item.d-item.w)/2,rotation:quarterTurn((item.rotation??0)+90)}
}

export function assetPose(item,asset) {
  validateAsset(asset);coordinates(item.x,item.z)
  if(item.assetId!==asset.id)throw Error('道具和资产编号不匹配')
  const rotation=quarterTurn(item.rotation), swapped=rotation%180!==0
  const expected={w:swapped?asset.dimensions.d:asset.dimensions.w,d:swapped?asset.dimensions.w:asset.dimensions.d,h:asset.dimensions.h}
  if(!['w','d','h'].every(k=>Number.isFinite(item[k])&&Math.abs(item[k]-expected[k])<=.001))throw Error('道具尺寸与真实资产不符，请更换规格，不可拉伸模型')
  return {position:[item.x+item.w/2,0,item.z+item.d/2],rotationY:rotation===0?0:-rotation*Math.PI/180}
}
