import React,{useState} from 'react'
import {tableRelativeRoom,patternNames} from './fuzzy-layout.js'

export function FuzzySetup({active,onMode,onGenerate,disabled}){
  const [w,setW]=useState('3'),[d,setD]=useState('5'),[type,setType]=useState('边厅店'),[block,setBlock]=useState('none'),[error,setError]=useState('')
  return <section className="fuzzy-panel"><button type="button" onClick={()=>onMode(!active)}>{active?'返回米制输入':'按桌长估比例'}</button>{active&&<form onSubmit={e=>{e.preventDefault();try{onGenerate(tableRelativeRoom(w,d,3.2,type,block));setError('')}catch(e){setError(e.message)}}}>
    <h2>把长中岛桌当尺子</h2><p>不必量每一条边。宽和深都用“一张桌的长边”作单位，不是桌子的短边。先按1.8m桌长折算矩形包络，生成后再核对；层高暂按3.2m。</p>
    <div className="fields"><label>宽约几张桌长<input aria-label="宽约几张桌长" type="number" min="1.34" max="16.66" step=".01" required value={w} onChange={e=>setW(e.target.value)}/></label><label>深约几张桌长<input aria-label="深约几张桌长" type="number" min="1.34" max="16.66" step=".01" required value={d} onChange={e=>setD(e.target.value)}/></label>
    <label>比例方案铺型<select value={type} onChange={e=>setType(e.target.value)}><option>边厅店</option><option>中岛店</option></select></label>
    <label>大致不可用区域<select value={block} onChange={e=>setBlock(e.target.value)}><option value="none">暂不预留（未知柱位仍需核对）</option><option value="left">左后部</option><option value="right">右后部</option><option value="center">中部</option></select></label></div>
    <p className="hint">障碍仅用宽约22%、深约30%的方块留位，代表柱组/缺角的大致影响，不是识别出的真实轮廓。曲线、L形与斜边仍需人工调整。真实SU桌不拉伸，当前可用桌为1.8×1.0m。</p>
    <button className="primary" disabled={disabled}>生成四个平面方案 →</button>{error&&<p role="alert">{error}</p>}
  </form>}</section>
}
export function FuzzyAdvice({layout}){
  const a=layout?.fuzzyAdvice;if(!a)return null
  return <section className="fuzzy-panel" data-testid="fuzzy-advice"><h3>案例启发 · 非实测布局</h3><p>建议区间 {a.range[0]}–{a.range[1]} 张长中岛桌 · 当前 {layout.items.filter(i=>i.type==='table').length} 张 · {patternNames[a.pattern]}</p>
    <p>{a.support==='limited-case-support'?'有限样本支持':'相似案例不足，超范围探索'}；{a.uncertainty}</p>
    <details><summary>参考了哪些平面？</summary><ul>{a.references.map(r=><li key={r.id}>{r.name} · PDF第{r.page}页 · {r.count}张 · {patternNames[r.pattern]}<br/>{r.functions}<br/><small>{r.note}（{r.id}）</small></li>)}</ul></details>
    <p className="hint">初始生成时的提示（编辑后不重新评估容量）：{a.warnings.join('；')}</p><p className="hint">同样的空间可能生成相同候选，不代表四种都适用。当前碰撞与缺失功能请看编辑检查；不保证完整动线连通。</p>
  </section>
}
