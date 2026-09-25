import {assetPose} from './asset-contract.js'
import {findRealAsset} from './real-assets.js'
import {profiles} from './furniture.js'

export const MAX_IMPORT_BYTES=5*1024*1024
function text(value,label,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(label+'无效')}
function room(value){
  if(!value||!['w','d','h'].every(k=>Number.isFinite(value[k])&&value[k]>0&&value[k]<=(k==='h'?20:100)))throw Error('空间尺寸无效（长宽≤100 m，层高≤20 m）')
  const shopType=value.shopType??'边厅店'
  if(!['边厅店','中岛店'].includes(shopType))throw Error('铺型无效')
  return {...value,shopType}
}
function layout(value){
  if(!value||!Array.isArray(value.items)||value.items.length>200)throw Error('每个方案最多 200 件道具')
  if(value.name!==undefined)text(value.name,'方案名称')
  if(value.source!=null){
    if(typeof value.source!=='object'||Array.isArray(value.source))throw Error('来源记录无效')
    for(const key of ['file','page','drawing','date','notes','style'])if(value.source[key]!=null&&!['string','number'].includes(typeof value.source[key]))throw Error('来源字段必须是文本或数字')
  }
  if(value.modelAdvice!=null){
    if(typeof value.modelAdvice!=='object'||Array.isArray(value.modelAdvice))throw Error('实验模型记录无效')
    for(const key of ['trainingStores','placed'])if(!Number.isFinite(value.modelAdvice[key])||value.modelAdvice[key]<0)throw Error('实验模型数量无效')
  }
  const ids=new Set()
  for(const item of value.items){
    text(item?.id,'道具编号',128);text(item.name,'道具名称')
    if(ids.has(item.id))throw Error('方案内道具编号重复');ids.add(item.id)
    if(!['table','counter','display','structure'].includes(item.type))throw Error('道具类型无效')
    if(!['x','z','w','d','h'].every(k=>Number.isFinite(item[k])&&Math.abs(item[k])<=1000)||!['w','d','h'].every(k=>item[k]>0))throw Error('道具坐标或尺寸无效')
    if(item.profile!==undefined&&!Object.hasOwn(profiles,item.profile))throw Error('道具结构无效')
    if(item.rotation!==undefined&&(!Number.isFinite(item.rotation)||item.rotation%90!==0))throw Error('道具旋转无效')
    if(item.assetId)assetPose(item,findRealAsset(item.assetId))
  }
  return {...value,room:room(value.room)}
}

export function parseProject(raw){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_IMPORT_BYTES)throw Error('项目文件大小不能超过 5 MB')
  let parsed
  try{parsed=JSON.parse(raw,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('保留字段');return value})}catch{throw Error('项目 JSON 格式无效或包含保留字段')}
  if(!parsed||!Array.isArray(parsed.nodes)||!parsed.nodes.length||parsed.nodes.length>500)throw Error('项目需包含 1–500 个节点')
  const byId=new Map()
  for(const node of parsed.nodes){
    text(node?.id,'节点编号',128);text(node.name,'节点名称')
    if(byId.has(node.id))throw Error('节点编号重复')
    if(!['root','plan','edit','white','render'].includes(node.kind))throw Error('节点类型无效')
    if(node.style!==undefined&&!['SI1.0','SI2.0','both'].includes(node.style))throw Error('节点风格无效')
    if(node.kind==='root'){
      if(node.parent!=null)throw Error('项目根节点不能有父节点')
      node.room=room(node.room)
    }else{
      text(node.parent,'父节点编号',128);node.layout=layout(node.layout)
      if(node.kind==='render'&&!['SI1.0','SI2.0'].includes(node.style))throw Error('渲染风格无效')
    }
    byId.set(node.id,node)
  }
  const visiting=new Set(),done=new Set(),sorted=[]
  function visit(node){
    if(done.has(node.id))return
    if(visiting.has(node.id))throw Error('节点引用存在循环')
    visiting.add(node.id)
    if(node.parent!=null){const parent=byId.get(node.parent);if(!parent)throw Error('父节点缺失');visit(parent)}
    visiting.delete(node.id);done.add(node.id);sorted.push(node)
  }
  for(const node of parsed.nodes)visit(node)
  return {nodes:sorted}
}

export function mergeProject(existing,incoming,makeId=()=>crypto.randomUUID()){
  // Validate again at the public merge boundary; never modify either argument.
  const validated=parseProject(JSON.stringify(incoming)),used=new Set(existing.nodes.map(n=>n.id)),mapping=new Map()
  if(existing.nodes.length+validated.nodes.length>500)throw Error('合并后超过 500 个节点，请先导出备份并分项目管理')
  for(const node of validated.nodes){
    let id,attempt=0
    do{if(++attempt>20)throw Error('无法分配独立节点编号');id=makeId();text(id,'新节点编号',128)}while(used.has(id))
    used.add(id);mapping.set(node.id,id)
  }
  const imported=validated.nodes.map(n=>({...n,id:mapping.get(n.id),...(n.parent!=null?{parent:mapping.get(n.parent)}:{}),importedFrom:n.id}))
  const result={...existing,nodes:[...existing.nodes,...imported]}
  if(new TextEncoder().encode(JSON.stringify(result)).length>MAX_IMPORT_BYTES)throw Error('合并后项目大小超过 5 MB')
  return result
}
