import test from 'node:test';
import assert from 'node:assert/strict';
import {fit,predict,evaluate} from './layout-model.mjs';
test('learns a numerical target and rejects invalid/extrapolated area',()=>{
 const rows=Array.from({length:12},(_,i)=>({id:'s'+i,areaM2:10+i*5,tableCount:1+i*.2}));
 const m=fit(rows,{lambda:0});assert(Math.abs(predict(m,35)-2)<.05);
 assert.throws(()=>predict(m,NaN));assert.throws(()=>predict(m,200));
});
test('leave one store out never sees its held-out record',()=>{
 const rows=[10,20,30,40,50].map((a,i)=>({id:'s'+i,areaM2:a,tableCount:i+1}));const r=evaluate(rows);
 assert.equal(r.folds.length,5);for(const f of r.folds){assert(!f.trainIds.includes(f.testId));assert.equal(f.trainIds.length,4)}
 assert(Number.isFinite(r.mae));assert(Number.isFinite(r.meanBaselineMAE));
 assert.throws(()=>evaluate([...rows,rows[0]]));
});
