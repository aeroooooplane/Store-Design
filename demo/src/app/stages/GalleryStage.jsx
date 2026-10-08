import React from "react";
import { Plan } from "../../components/Plan.jsx";
import { issues } from "../../layout.js";
export function GalleryStage({ candidates, open }) {
  return <><p className="hint">点击任一方案放大细化。数量随面积、长宽比和可用空间变化；浅灰区域为预留通道，桌柜标注真实尺寸。</p><div className="gallery">{candidates.map((n) => <button className="plan-card" key={n.id} disabled={!!n.layout.fuzzyAdvice && issues(n.layout).length > 0} title={issues(n.layout).join("；")} onClick={() => open(n)}><Plan layout={n.layout} /><div><strong>{n.name}</strong><span>{n.layout.room.shopType} · {(n.layout.room.w * n.layout.room.d).toFixed(1)} ㎡ · {n.layout.fuzzyAdvice && issues(n.layout).length ? "当前条件不适用" : "点击细化 ↗"}</span></div></button>)}</div></>;
}
