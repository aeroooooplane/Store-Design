import React, { useEffect, useRef, useState } from "react";
export function Model({ layout, onReady }) {
  const canvas = useRef(), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    let scene, active = true;
    setError("");
    setLoading(true);
    onReady(false);
    async function start() {
      try {
        const { createScene } = await import("../scene.js");
        if (!active) return;
        scene = createScene(canvas.current, layout, "white", true);
        await scene.ready;
        if (active) {
          setLoading(false);
          onReady(true);
        }
      } catch (e) {
        if (active) {
          setError("无法启动三维：" + e.message);
          setLoading(false);
        }
      }
    }
    start();
    return () => {
      active = false;
      scene?.dispose();
    };
  }, [layout, onReady]);
  return <div className="model">{error && <p role="alert">{error}</p>}{loading && <p role="status">正在载入场景，完成前不可渲染…</p>}<canvas ref={canvas} /><small>拖动旋转 · 滚轮缩放 · 剖切展示</small></div>;
}
