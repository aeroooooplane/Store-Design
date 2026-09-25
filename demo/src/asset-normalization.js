import {Box3,Group,Vector3} from 'three'

export function meshBounds(scene){
  scene.updateMatrixWorld(true)
  const bounds=new Box3(),vertex=new Vector3()
  scene.traverseVisible(object=>{
    if(!object.isMesh)return
    const geometry=object.geometry,position=geometry.attributes.position,index=geometry.index
    if(!position)return
    const total=index?index.count:position.count
    const start=geometry.drawRange.start,end=Math.min(total,start+geometry.drawRange.count)
    for(let i=start;i<end;i++){
      vertex.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(object.matrixWorld)
      if(!vertex.toArray().every(Number.isFinite))throw Error('网格含无效坐标')
      bounds.expandByPoint(vertex)
    }
  })
  return bounds
}

export function normalizeAssetScene(source,expected){
  if(source.parent)throw Error('转换需要独立根场景')
  const bounds=meshBounds(source)
  if(bounds.isEmpty())throw Error('资产没有可见网格')
  const size=bounds.getSize(new Vector3()),dimensions={w:size.x,h:size.y,d:size.z}
  if(!['w','h','d'].every(k=>Number.isFinite(expected?.[k])&&expected[k]>0&&Math.abs(dimensions[k]-expected[k])<=.001))throw Error('转换尺寸与源模型不符：'+JSON.stringify({dimensions,expected}))
  const center=bounds.getCenter(new Vector3()),scene=new Group()
  scene.add(source)
  scene.position.set(-center.x,-bounds.min.y,-center.z)
  scene.updateMatrixWorld(true)
  return {scene,dimensions}
}
