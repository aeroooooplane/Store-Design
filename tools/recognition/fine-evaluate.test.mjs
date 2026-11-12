import {test} from 'node:test'
import assert from 'node:assert/strict'
import {evaluateFine} from './fine-evaluate.mjs'
const raw={inputSha256:'a',elapsedSeconds:1,candidates:[{id:'R1',kind:'unknown',geometry:{points:[[1,1],[5,1],[5,5],[1,5]]}},{id:'R2',kind:'furniture',geometry:{points:[[8,8],[9,8],[9,9],[8,9]]}}]}
const review={sourceSha256:'a',storeId:'test',objects:[{id:'F1',candidateId:'R1',kind:'furniture',geometryOrigin:'automatic-retained',semanticOrigin:'agent-corrected',points:raw.candidates[0].geometry.points}]}
test('候选几何不冒充类别正确且保留误检',()=>{const m=evaluateFine(raw,review);assert.equal(m.geometryRetained,1);assert.equal(m.categoryAndGeometryRetained,0);assert.deepEqual(m.falsePositives,['R2'])})
test('不允许更改坐标后算自动保留',()=>{const changed=structuredClone(review);changed.objects[0].points[0][0]=2;assert.throws(()=>evaluateFine(raw,changed))})
test('原图不一致与重复对应均拒绝',()=>{assert.throws(()=>evaluateFine(raw,{...review,sourceSha256:'b'}));assert.throws(()=>evaluateFine(raw,{...review,objects:[...review.objects,...review.objects]}))})
