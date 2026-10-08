import React from "react";
import { downloadPlan } from "../../plan-export.js";
const clone = (value) => structuredClone(value);
export function ExportToolbar({ stage, images, active, busy, setBusy, node, setNotice, layout }) {
  return <> {stage === "render" && images[active] && <button disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      const { downloadRenderBundle } = await import("../../render-export.js");
      await downloadRenderBundle(node, images[active]);
      setNotice("八视角、布局、平面 SVG 和机位清单已打包。");
    } catch (e) {
      setNotice("打包失败：" + e.message);
    } finally {
      setBusy(false);
    }
  }}>下载八视角完整包 ZIP</button>}
 {stage === "editor" && layout && <><button onClick={() => {
    try {
      downloadPlan(layout);
      setNotice("平面 SVG 已导出，含尺寸与资产编号；非施工图。");
    } catch (e) {
      setNotice(e.message);
    }
  }}>导出平面 SVG</button><button disabled={busy} onClick={async () => {
    if (busy) return;
    setBusy(true);
    const current = clone(layout);
    try {
      const { downloadPlanPng } = await import("../../plan-raster.js");
      const size = await downloadPlanPng(current);
      setNotice(`平面 PNG 已导出：${size.width}×${size.height} 像素；不保证打印比例，精确打印请使用 SVG。`);
    } catch (e) {
      setNotice("PNG 导出失败：" + e.message);
    } finally {
      setBusy(false);
    }
  }}>导出平面 PNG</button><p className="hint">PNG 用于分享预览，最长边 4096 像素、最多 800 万像素；长图可能缩小文字，精确查看与打印请保留 SVG。</p></>}</>;
}
