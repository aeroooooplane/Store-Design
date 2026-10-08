import React from "react";
import { Model } from "../../components/Model.jsx";
export function WhiteStage({ layout, setModelReady, style, setStyle, busy, modelReady, slots, render }) {
  return <><Model layout={layout} onReady={setModelReady} /><div className="render-options"><div><h3>选择参考环境</h3><p>使用原道具材质、地面纹理、环境反射与店内灯光；八个机位共用同一场景。</p></div><select aria-label="渲染风格" value={style} onChange={(e) => setStyle(e.target.value)} disabled={busy}><option value="SI1.0">SI1.0 参考环境（未验收）</option><option value="SI2.0">SI2.0 参考环境（未验收）</option><option value="both">对比两种参考环境</option></select><button className="primary" disabled={busy || !modelReady || slots < (style === "both" ? 2 : 1)} onClick={render}>{busy ? "渲染中…" : "确认白膜，渲染八视角 →"}</button></div><p className="hint">绑定资产编号的道具使用真实 SU 转换网格，其他道具仍为参数化示意。真实资产保留原材质；环境方案供比较，品牌材质与门店版本仍需核对。</p></>;
}
