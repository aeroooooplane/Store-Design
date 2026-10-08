import React, { useRef } from "react";
export function Plan({ layout, onChange, selected, onSelect }) {
  const svg = useRef(), drag = useRef();
  const { room, items } = layout;
  const point = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current.getScreenCTM().inverse());
  return <svg ref={svg} className="plan" viewBox={`-.6 -.85 ${room.w + 1.2} ${room.d + 1.7}`} onPointerMove={(e) => {
    if (!drag.current) return;
    const p = point(e);
    onChange(items.map((i) => i.id === drag.current.id ? { ...i, x: Math.max(0, Math.min(room.w - i.w, Math.round((p.x - drag.current.x) * 20) / 20)), z: Math.max(0, Math.min(room.d - i.d, Math.round((p.y - drag.current.z) * 20) / 20)) } : i));
  }} onPointerUp={() => drag.current = null} onPointerCancel={() => drag.current = null}>
 <rect width={room.w} height={room.d} fill="var(--plan-paper)" stroke="var(--ink)" strokeWidth=".06" strokeDasharray={room.shopType === "中岛店" ? ".12 .1" : void 0} />
 {Array.from({ length: Math.ceil(room.w * 2) }, (_, i) => <path key={"x" + i} d={`M ${i / 2} 0 V ${room.d}`} stroke="var(--line-soft)" strokeWidth=".008" />)}
 {Array.from({ length: Math.ceil(room.d * 2) }, (_, i) => <path key={"z" + i} d={`M 0 ${i / 2} H ${room.w}`} stroke="var(--line-soft)" strokeWidth=".008" />)}
 <text x={room.w / 2} y="-.15" textAnchor="middle" fontSize=".17" fill="var(--muted)">{room.w.toFixed(2)} m</text><text x={room.w / 2} y={room.d + 0.26} textAnchor="middle" fontSize=".17" fill="var(--muted)">{room.shopType === "中岛店" ? "四周开放" : "入口"} · {room.d.toFixed(2)} m 深</text>
 <text x={room.w / 2} y="-.55" textAnchor="middle" fontSize=".22" fill="var(--ink)">{(room.w * room.d).toFixed(0)}㎡ · 体验桌 {items.filter((i) => i.type === "table").length} 张 · 展柜 {items.filter((i) => i.type === "display").length} 组</text>
 {(layout.planning?.zones || []).map((zone, n) => <React.Fragment key={n}><rect x={zone.x} y={zone.z} width={zone.w} height={zone.d} fill="var(--surface)" fillOpacity=".65" stroke="var(--line-strong)" strokeWidth=".015" strokeDasharray=".08 .06" pointerEvents="none" /><text x={zone.x + zone.w / 2} y={zone.z + zone.d / 2} textAnchor="middle" fontSize=".13" fill="var(--muted)" pointerEvents="none" transform={n === 1 ? `rotate(-90 ${zone.x + zone.w / 2} ${zone.z + zone.d / 2})` : void 0}>{zone.name}</text></React.Fragment>)}
 {items.map((i, n) => <g key={i.id} onPointerDown={(e) => {
    if (!onChange) return;
    e.stopPropagation();
    onSelect(i.id);
    const p = point(e);
    drag.current = { id: i.id, x: p.x - i.x, z: p.y - i.z };
    svg.current.setPointerCapture(e.pointerId);
  }} style={{ cursor: onChange ? "grab" : "inherit" }}><rect x={i.x} y={i.z} width={i.w} height={i.d} rx=".03" fill={i.type === "table" ? "var(--paper)" : i.type === "counter" ? "var(--fill-strong)" : "var(--surface)"} stroke={selected === i.id ? "var(--ink)" : "var(--ink)"} strokeWidth={selected === i.id ? ".06" : ".025"} /><rect x={i.x + 0.06} y={i.z + 0.06} width={Math.max(0.01, i.w - 0.12)} height={Math.max(0.01, i.d - 0.12)} rx=".02" fill="none" stroke="var(--line-strong)" strokeWidth=".01" pointerEvents="none" /><text x={i.x + i.w / 2} y={i.z + i.d / 2 - 0.02} fontSize=".12" textAnchor="middle" fill="var(--ink)" pointerEvents="none">{n + 1} · {i.name.replace("真实", "")}</text><text x={i.x + i.w / 2} y={i.z + i.d / 2 + 0.15} fontSize=".1" textAnchor="middle" fill="var(--muted)" pointerEvents="none">{i.w.toFixed(2)} × {i.d.toFixed(2)} m</text></g>)}
 {layout.planning && <text x={room.w / 2} y={room.d + 0.6} fontSize=".15" textAnchor="middle" fill="var(--muted)">{layout.fuzzyAdvice ? "比例估算 · 桌柜原尺寸 · 动线待核" : "主通道 1.20m · 道具间距目标 0.90m"}{layout.planning.placed < layout.planning.requested ? " · 空间容量限制已减量" : ""}</text>}
 </svg>;
}
