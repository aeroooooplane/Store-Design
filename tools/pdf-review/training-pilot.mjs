import fs from 'node:fs/promises';import path from 'node:path';import {createCanvas,loadImage} from '@napi-rs/canvas';
const root=path.resolve('../..'),dir=path.join(root,'资源库/99_历史归档/训练候选/S03');await fs.mkdir(dir,{recursive:true});
const img=await loadImage(path.join(root,'资源库/90_处理过程与审核/页面预览/S03/plan-detail.png'));
// Manually checked crop: preserve plan dimensions, omit right-side title block.
const box=[.16,.02,.78,.92],x=Math.round(box[0]*img.width),y=Math.round(box[1]*img.height),w=Math.round((box[2]-box[0])*img.width),h=Math.round((box[3]-box[1])*img.height);const canvas=createCanvas(w,h);canvas.getContext('2d').drawImage(img,x,y,w,h,0,0,w,h);await fs.writeFile(path.join(dir,'plan-crop.png'),canvas.toBuffer('image/png'));
const rows=[{asset:'plan-crop.png',sourcePage:1,kind:'平面图',cropNormalized:box,review:'裁切已视觉检查；图纸尺寸仍需结构化标注'}];
for(let p=2;p<=5;p++){const name=`effect-page-${p}.png`;await fs.copyFile(path.join(root,`资源库/90_处理过程与审核/页面预览/S03/page-${p}.png`),path.join(dir,name));rows.push({asset:name,sourcePage:p,kind:'效果图',cropNormalized:[0,0,1,1],review:'整页参考，500px预览，不作为最终训练分辨率'})}
await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({storeId:'S03',source:'资源库/01_各门店原图纸/上海星光摄影城照材专卖店.pdf',si:null,shopType:null,splitGroup:'上海星光摄影城',usage:'裁切流程试验，非正式训练集',trainingEligible:false,reasons:['SI与铺型等待总表核对','道具/轮廓/入口标注未完成','同门店所有页面必须归同一数据划分'],assets:rows},null,2));
