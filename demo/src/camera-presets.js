export const viewNames=['正面鸟瞰','左前方','右前方','右后方','左后方','背面鸟瞰','顶部俯视','入口方向']
const relativeViews=[[.5,1.15,1.8],[-.7,1,1.4],[1.7,1,1.4],[1.7,1,-.4],[-.7,1,-.4],[.5,1.3,-.85],[.5,2.4,.501],[.5,.55,1.7]]
export function cameraFor(room,index){
  if(!Number.isInteger(index)||index<0||index>=relativeViews.length)throw Error('机位编号无效')
  if(index===7)return {name:viewNames[index],position:[room.w/2,Math.min(1.65,room.h*.6),room.d+.8],target:[room.w/2,Math.min(1.35,room.h*.45),room.d*.25],up:[0,1,0],fov:72,aspect:1.5,near:.05,far:300}
  const [x,y,z]=relativeViews[index]
  return {name:viewNames[index],position:[room.w*x,Math.max(room.w,room.d)*y,room.d*z],target:[room.w/2,room.h*.25,room.d/2],up:[0,1,0],fov:48,aspect:1.5,near:.05,far:300}
}
