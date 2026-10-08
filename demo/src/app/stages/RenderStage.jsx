import React from "react";

export function RenderStage({ node, images, active, setLightbox, busy, render, persistImages }) {
  return <><p className="hint">{node.style} · 材质与灯光效果 · 8 个固定相对机位，点击查看大图。</p>{images[active] ? <div className="renders">{images[active].map((src, i) => <button key={i} onClick={() => setLightbox({ src, i })}><img src={src} alt={`视角 ${i + 1}`} /><span>{["正面鸟瞰", "左前方", "右前方", "右后方", "左后方", "背面鸟瞰", "顶部俯视", "入口方向"][i]}</span></button>)}</div> : <div className="empty"><p>布局已保存，点击重新渲染恢复八视角图片。</p><button className="primary" disabled={busy} onClick={render}>重新渲染</button></div>}{images[active] && <button disabled={busy} onClick={persistImages}>保存八视角供刷新恢复</button>}</>;
}
