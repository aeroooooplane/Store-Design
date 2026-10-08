import manifest from './data/placement-manifest.json' with {type:'json'}
import {validateAsset} from './asset-contract.js'

if(manifest.schemaVersion!==1 || !Array.isArray(manifest.assets)) throw Error('不支持的资产清单版本')
export const realAssets=manifest.assets.map(validateAsset)
const byId=new Map(realAssets.map(asset=>[asset.id,asset]))
if(byId.size!==realAssets.length) throw Error('资产清单编号重复')
export function findRealAsset(id){const asset=byId.get(id);if(!asset)throw Error('未找到真实资产：'+id);return asset}
