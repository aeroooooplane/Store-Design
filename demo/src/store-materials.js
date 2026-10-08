import * as THREE from 'three'
export function floorTexture(w,d){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256
  const ctx=canvas.getContext('2d');ctx.fillStyle='#d4d0c8';ctx.fillRect(0,0,256,256)
  let seed=713
  for(let i=0;i<16000;i++){
    seed=(seed*1664525+1013904223)>>>0;const x=seed%256
    seed=(seed*1664525+1013904223)>>>0;const y=seed%256
    ctx.fillStyle=i%2?'rgba(255,255,255,.09)':'rgba(70,65,55,.055)';ctx.fillRect(x,y,1,1)
  }
  ctx.strokeStyle='#aaa69e';ctx.lineWidth=1.5;ctx.strokeRect(0,0,256,256)
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace
  map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(w/.8,d/.8);map.anisotropy=4
  return map
}
export function surfaceMaterial(role,{white,dark,map}={}){
  if(white)return new THREE.MeshStandardMaterial({color:'#f7f7f5',roughness:.8})
  const presets={floor:{color:'#ffffff',map,roughness:.58,metalness:.02},
    metal:{color:dark?'#45484a':'#c8cbca',metalness:.72,roughness:.3},
    top:{color:'#f3f0e7',roughness:.28,metalness:.08},
    fixture:{color:dark?'#242729':'#bfc2c1',metalness:.55,roughness:.35},
    light:{color:'#fff4db',emissive:'#ffe9bd',emissiveIntensity:3,roughness:.2}}
  return new THREE.MeshStandardMaterial(presets[role]||presets.metal)
}
