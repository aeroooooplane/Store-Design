// Single HTML, including the checked GLB and its runtime; no CDN or local server is required.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {createHash} from 'node:crypto'

const [inputArg,outArg,mode='--original']=process.argv.slice(2)
if(!inputArg||!outArg||!['--original','--legacy-repaired'].includes(mode))throw Error('Usage: node build-mm93-viewer.mjs original.glb viewer.html [--original|--legacy-repaired]')
const input=path.resolve(inputArg),out=path.resolve(outArg)
if(input===out)throw Error('Cannot overwrite the input')
const bytes=await readFile(input)
if(bytes.toString('ascii',0,4)!=='glTF')throw Error('Expected a GLB')
const sha256=createHash('sha256').update(bytes).digest('hex'),original=mode==='--original'
if(original&&sha256!=='46ed38fb4e5a774e91e10264b20874a4c0a8584e655b5c680792c9b9e8700fef')throw Error('原版预览只接受用户提供的原始Tripo GLB，不能把修整版标为原版')
const title=original?'MM93 × Insta360 赛车 · Tripo 原版':'MM93 外观实验 · 已撤回'
const note=original?'原始 GLB 逐字节内嵌：保留原 UV、三张 4K 贴图、PBR 参数和全部网格。没有叠加贴花、重绘、降纹理或减面；尺寸未重新标定。预览光照会影响明暗。':'历史外观实验，已因偏离用户原版撤回。请使用原始 Tripo GLB 预览。'
const tool=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const source=`
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;document.querySelector('main').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(${original?'0x383b3d':'0xf5f5f2'});const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
const camera=new THREE.PerspectiveCamera(35,1,.001,100),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.2;controls.maxDistance=12;
${original?'':'const grid=new THREE.GridHelper(6,30,0xc7c9c9,0xe1e2e2);grid.position.y=-.001;scene.add(grid);'}
const model=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('data:model/gltf-binary;base64,${bytes.toString('base64')}')).scene;scene.add(model);
const box=new THREE.Box3().setFromObject(model,true),center=box.getCenter(new THREE.Vector3()),dimensions=box.getSize(new THREE.Vector3());controls.target.copy(center);const distance=dimensions.length()/2/Math.sin(THREE.MathUtils.degToRad(17.5))*1.08;
const directions=${original?'{hero:[-1,.65,1],front:[-1,.15,0],side:[0,.15,1],rear:[1,.15,0]}':'{hero:[1,.65,1],front:[0,.15,1],side:[1,.15,0],rear:[0,.15,-1]}'};function view(name){camera.position.copy(center).addScaledVector(new THREE.Vector3(...directions[name]).normalize(),distance);camera.lookAt(center);controls.update()};view('hero');
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
function resize(){const main=document.querySelector('main'),w=main.clientWidth,h=main.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
document.querySelector('#loading').remove();window.__mm93={model,renderer,camera,sourceSha256:${JSON.stringify(sha256)},original:${original},dimensions:dimensions.toArray(),bounds:{min:box.min.toArray(),max:box.max.toArray()}};
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});
`
// Top-level await is retained in a single bundled ES module, with all imports resolved locally.
const bundle=await build({stdin:{contents:source,resolveDir:tool,sourcefile:'mm93-viewer.js'},bundle:true,format:'esm',target:'es2022',minify:true,write:false,legalComments:'inline'})
const js=bundle.outputFiles[0].text.replaceAll('</script','<\\/script')
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}html,body{height:100%;margin:0;font:14px/1.5 Arial,"Microsoft YaHei",sans-serif;color:#222}body{display:flex;flex-direction:column}header{padding:14px 20px;background:white;border-bottom:1px solid #ddd}h1{margin:0 0 6px;font-size:19px}button{padding:6px 14px;background:white;border:1px solid #ccc;border-radius:6px;cursor:pointer}button:hover{background:#ffedb2}.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.note{color:#666;font-size:12px;margin-top:8px}main{position:relative;flex:1;min-height:240px}canvas{display:block}#loading{position:absolute;top:50%;width:100%;text-align:center}</style><header><h1>${title}</h1><div class="bar"><button data-view="hero">整体</button><button data-view="front">车头</button><button data-view="side">侧面</button><button data-view="rear">车尾</button></div><div class="note">${note}</div></header><main><div id="loading">正在加载模型…</div></main><script type="module">${js}</script></html>`
await mkdir(path.dirname(out),{recursive:true})
await writeFile(out,html,{flag:'wx'})
console.log('Built offline viewer:',out,Buffer.byteLength(html),'bytes')
