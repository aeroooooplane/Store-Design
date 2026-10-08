export function pngBytes(uri){
  if(typeof uri!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri))throw Error('图片必须为 PNG')
  const bytes=Uint8Array.from(atob(uri.split(',')[1]),c=>c.charCodeAt(0))
  const magic=[137,80,78,71,13,10,26,10]
  if(bytes.length<33||!magic.every((b,i)=>bytes[i]===b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw Error('PNG 文件头无效')
  const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20)
  if(!width||!height||width>16384||height>16384)throw Error('PNG 尺寸无效')
  return {bytes,width,height}
}
