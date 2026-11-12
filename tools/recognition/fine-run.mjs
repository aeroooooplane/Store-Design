import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { extractFineGeometry } from '../../apps/api/src/modules/recognition/fine-geometry.ts'
import { readPageTexts,readDimensionChains } from '../../apps/api/src/modules/recognition/ocr.ts'
import { chainScale } from '../../apps/api/src/modules/recognition/local/dimension-chain.ts'
const [image,out]=process.argv.slice(2)
if(!image||!out)throw Error('用法：node fine-run.mjs 输入图片 新输出目录')
await fs.mkdir(out,{recursive:false})
const started=performance.now(),at=new Date().toISOString(),bytes=await fs.readFile(image),hash=crypto.createHash('sha256').update(bytes).digest('hex')
const {data,info}=await sharp(bytes).flatten({background:'#fff'}).greyscale().raw().toBuffer({resolveWithObject:true})
const coarse=extractFineGeometry(data,info.width,info.height)
const normalized=await sharp(data,{raw:{width:info.width,height:info.height,channels:1}}).negate(coarse.inverted).png().toBuffer()
const vector={width:info.width,height:info.height,texts:[],rects:[],lines:coarse.lines.map(l=>({x1:l.a[0],y1:l.a[1],x2:l.b[0],y2:l.b[1],w:l.width}))}
const ocrStart=performance.now(),texts=await readPageTexts(normalized,vector),chains=await readDimensionChains(normalized,vector),ocrSeconds=(performance.now()-ocrStart)/1000
const result=extractFineGeometry(data,info.width,info.height,texts),scale=chainScale(chains)
const record={...result,inputSha256:hash,startedAt:at,finishedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-started)/1000,ocrSeconds,scaleCandidate:scale&&scale.used.length>=2?{mmPerPixel:scale.mmPerPixel,readings:scale.used,verified:false}:null,chains,labelsRead:false,cloudRequests:0}
await fs.writeFile(path.join(out,'automatic.json'),JSON.stringify(record,null,2),{flag:'wx'})
await fs.writeFile(path.join(out,'input.png'),await sharp(bytes).flatten({background:'#fff'}).png().toBuffer(),{flag:'wx'})
console.log(JSON.stringify({image:path.basename(image),candidates:record.candidates.length,lines:record.lines.length,texts:texts.length,seconds:record.elapsedSeconds}))
