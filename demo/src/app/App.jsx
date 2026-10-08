import React, { useState, useEffect, useRef } from "react";
import { dimensions, generatePlans, issues } from "../layout";
import { realSample } from "../sample";
import { parseProject, mergeProject, MAX_IMPORT_BYTES } from "../project-import.js";
import { PROJECT_KEY } from "../ProjectRecovery.jsx";
import { captureProject } from "../project-draft.js";
import { ProjectTools } from "./components/ProjectTools.jsx";
import { createProjectPersistence } from "../project-persistence.js";
import { FuzzyAdvice } from "../FuzzyLayout.jsx";
import { SetupStage } from "./stages/SetupStage.jsx";
import { GalleryStage } from "./stages/GalleryStage.jsx";
import { EditorStage } from "./stages/EditorStage.jsx";
import { WhiteStage } from "./stages/WhiteStage.jsx";
import { RenderStage } from "./stages/RenderStage.jsx";
import { HistoryTree } from "./components/HistoryTree.jsx";
import { ExportToolbar } from "./components/ExportToolbar.jsx";
import { realAssets } from "../real-assets.js";
import { createAssetItem } from "../asset-contract.js";
import { loadRenderImages, saveRenderImages } from "../project-db.js";
const clone = (v) => structuredClone(v), uid = () => crypto.randomUUID(), KEY = PROJECT_KEY;
export default function App({ initialProject, initialToken }) {
  const [requestedAsset, setRequestedAsset] = useState(() => realAssets.find(a => a.id === new URLSearchParams(location.search).get('asset')) || null);
  const [persistence] = useState(() => createProjectPersistence(KEY, initialToken)), [saveError, setSaveError] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [project, setProject] = useState(() => {
    const { editorDraft, ...saved } = initialProject;
    return saved;
  }), [active, setActive] = useState(initialProject.editorDraft?.parent || null), [stage, setStage] = useState(initialProject.editorDraft ? "editor" : project.nodes.length ? "gallery" : "setup");
  const [mode, setMode] = useState("dimensions"), [width, setWidth] = useState(8), [depth, setDepth] = useState(6), [area, setArea] = useState(48), [ratio, setRatio] = useState(1), [height, setHeight] = useState(3.2);
  const [learned, setLearned] = useState(false), [shopType, setShopType] = useState("边厅店");
  const [draft, setDraft] = useState(initialProject.editorDraft?.layout || null), [selected, setSelected] = useState(null), [style, setStyle] = useState("SI1.0"), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [lightbox, setLightbox] = useState(null), [images, setImages] = useState({});
  useEffect(() => {
    persistence.save(captureProject(project, active, draft, stage)).then(() => setSaveError("")).catch((e) => setSaveError("自动保存失败：" + e.message + "。当前内容仍可导出，请勿直接关闭。"));
  }, [project, active, draft, stage, persistence]);
  useEffect(() => {
    const warn = (e) => {
      if (!saveError && !persistence.pending) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveError, persistence]);
  const node = project.nodes.find((n) => n.id === active), layout = draft || node?.layout, warnings = layout ? issues(layout) : [];
  useEffect(() => {
    if (stage !== "render" || !node || images[active]) return;
    let cancelled = false;
    loadRenderImages(node).then(saved => {
      if (saved && !cancelled) setImages(previous => ({...previous, [node.id]: saved}));
    }).catch(error => {if (!cancelled) setNotice("本机图片读取失败，可重新渲染：" + error.message)});
    return () => {cancelled = true};
  }, [stage, node, active, images]);
  async function persistImages() {
    if (busy || !node || !images[active]) return;
    setBusy(true);
    try {
      await saveRenderImages(node, images[active]);
      setNotice("八视角已保存到本机数据库，刷新后打开此分支即可恢复；跨电脑交付请下载 ZIP。");
    } catch (error) {setNotice("图片保存失败，当前图片仍可下载：" + error.message)}
    finally {setBusy(false)}
  }
  const slots = 500 - project.nodes.length, dirty = stage === "editor" && draft && node && JSON.stringify(draft) !== JSON.stringify(node.layout);
  const importContext = useRef();
  importContext.current = { project, draft, stage, node, active };
  const [deletedItems, setDeletedItems] = useState([]);
  useEffect(() => setDeletedItems([]), [active, stage]);
  const [importing, setImporting] = useState(false), importLock = useRef(false);
  const blockImportEvent = (e) => {
    if (importLock.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  async function importBackup(file) {
    if (importLock.current || busy) return;
    importLock.current = true;
    setImporting(true);
    setBusy(true);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw Error("项目文件大小不能超过 50 MB");
      const incoming = parseProject(await file.text()), current = importContext.current;
      let base = current.project;
      if (current.stage === "editor" && current.draft && current.node && JSON.stringify(current.draft) !== JSON.stringify(current.node.layout)) base = { ...base, nodes: [...base.nodes, { id: uid(), parent: current.active, kind: "edit", name: "导入前保留的调整", layout: clone(current.draft) }] };
      const merged = mergeProject(base, incoming);
      await persistence.save(merged);
      setProject(merged);
      setActive(merged.nodes.filter((n) => n.kind === "root").at(-1)?.id);
      setDraft(null);
      setSelected(null);
      setStage("gallery");
      setNotice(`已导入 ${incoming.nodes.length} 个节点，作为独立分支保留；原项目未覆盖。真实模型需本机 GLB，效果图可重新渲染。`);
    } catch (e) {
      setNotice("导入失败，当前项目保持不变：" + e.message);
    } finally {
      importLock.current = false;
      setImporting(false);
      setBusy(false);
    }
  }
  function exportBackup() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(captureProject(project, active, draft, stage))], { type: "application/json" }));
    a.download = "store-project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }
  function append(nodes) {
    setProject((p) => ({ ...p, nodes: [...p.nodes, ...nodes] }));
  }
  function resumeLayout() {
    if (importLock.current || busy || slots < 1 || !node || !["white", "render"].includes(node.kind)) return;
    const n = { id: uid(), parent: node.id, kind: "edit", name: "继续编辑 · " + node.name.slice(0, 180), layout: clone(node.layout) };
    append([n]);
    open(n, false);
    setNotice("已复制当前布局为可编辑分支；原白模和效果快照保持不变。");
  }
  function loadSample() {
    if (slots < 2) return;
    const root2 = { id: uid(), kind: "root", name: "真实样本 · 上海星光", room: clone(realSample.room) };
    const n = { id: uid(), parent: root2.id, kind: "plan", name: realSample.name, layout: clone(realSample) };
    append([root2, n]);
    open(n);
  }
  function generateFuzzy(room) {
    if (slots < 5) return;
    const root2 = { id: uid(), kind: "root", name: `比例估算 · ${room.shopType} · ${(room.w / 1.8).toFixed(1)}×${(room.d / 1.8).toFixed(1)}桌长`, room };
    append([root2, ...generatePlans(room, { fuzzy: true }).map((p) => ({ id: uid(), parent: root2.id, kind: "plan", name: p.name, layout: p }))]);
    setActive(root2.id);
    setDraft(null);
    setStage("gallery");
    setNotice("案例比例候选已生成；请比较实际放置数、参考证据和待核条件。");
  }
  function generate(e) {
    e.preventDefault();
    if (slots < 5) return;
    try {
      const room = { ...dimensions(mode, width, depth, area, ratio, height), shopType };
      const root2 = { id: uid(), kind: "root", name: `${shopType} ${room.w.toFixed(1)} × ${room.d.toFixed(1)} m`, room };
      append([root2, ...generatePlans(room, { learned }).map((p) => ({ id: uid(), parent: root2.id, kind: "plan", name: p.name, layout: p }))]);
      setActive(root2.id);
      setDraft(null);
      setStage("gallery");
      setNotice(learned ? "四套方案已生成：实验模型建议体验桌数量，位置由规则安排；超出训练面积时回退。" : "四套面积自适应方案已生成，已预留入口和主通道。");
    } catch (e2) {
      setNotice(e2.message);
    }
  }
  function open(n, preserve = true) {
    if (busy) return;
    if (preserve && dirty && slots < 1) {
      setNotice("节点已满，请先导出当前备份，再整理项目；未丢弃当前草稿。");
      return;
    }
    setDeletedItems([]);
    setHistoryOpen(false);
    if (preserve && stage === "editor" && draft && node && JSON.stringify(draft) !== JSON.stringify(node.layout)) append([{ id: uid(), parent: active, kind: "edit", name: "自动保存的调整", layout: clone(draft) }]);
    setActive(n.id);
    setSelected(null);
    setDraft(n.layout ? clone(n.layout) : null);
    setStage(n.kind === "root" ? "gallery" : ["plan", "edit"].includes(n.kind) ? "editor" : n.kind === "white" ? "white" : "render");
    setNotice("");
    setStyle(n.style || "SI1.0");
  }
  function save() {
    if (slots < 1) return;
    const n = { id: uid(), parent: active, kind: "edit", name: "平面快照 " + (/* @__PURE__ */ new Date()).toLocaleTimeString(), layout: clone(layout) };
    append([n]);
    open(n, false);
    setNotice("快照已保存，可从历史节点创建独立分支。");
  }
  function white() {
    if (warnings.length || slots < 2) return;
    const snapshot = { id: uid(), parent: active, kind: "edit", name: "已确认平面", layout: clone(layout) }, n = { id: uid(), parent: snapshot.id, kind: "white", name: "三维白膜", layout: clone(layout) };
    append([snapshot, n]);
    open(n, false);
  }
  async function render() {
    if (node.kind !== "render" && slots < (style === "both" ? 2 : 1)) return;
    setBusy(true);
    const styles = style === "both" ? ["SI1.0", "SI2.0"] : [style];
    let last;
    try {
      const { createScene } = await import("../scene.js");
      for (const s of styles) {
        const n = node.kind === "render" ? node : { id: uid(), parent: active, kind: "render", name: `${s} · 8 视角`, style: s, layout: clone(layout) };
        let scene;
        const results = [];
        try {
          scene = createScene(document.createElement("canvas"), n.layout, s);
          await scene.ready;
          for (let i = 0; i < 8; i++) {
            scene.view(i);
            results.push(scene.image());
            setNotice(`${s}：${i + 1}/8`);
            await new Promise((r) => setTimeout(r, 40));
          }
        } finally {
          scene?.dispose();
        }
        setImages((prev) => ({ ...prev, [n.id]: results }));
        if (node.kind !== "render") append([n]);
        last = n;
      }
      if (last) {
        setActive(last.id);
        setDraft(clone(last.layout));
        setStyle(last.style);
        setStage("render");
      }
      setNotice("八视角预览已生成，可点击放大并下载。");
    } catch (e) {
      setNotice("渲染失败，可重试：" + e.message);
    } finally {
      setBusy(false);
    }
  }
  const change = (items) => setDraft({ ...layout, items }), selectedItem = layout?.items.find((i) => i.id === selected);
  function placeAsset(asset) {
    if (importLock.current || busy || stage !== "editor" || !layout || layout.items.length >= 200) return;
    const item = createAssetItem(asset, uid(), (layout.room.w - asset.dimensions.w) / 2, (layout.room.d - asset.dimensions.d) / 2);
    change([...layout.items, item]);
    setSelected(item.id);
    setRequestedAsset(null);
    setNotice("已加入 " + asset.name + "；请核对位置、朝向和通道。");
  }
  function updatePosition(axis, value) {
    if (importLock.current || busy || !selectedItem || !Number.isFinite(value)) return;
    if (Math.abs(value) > 1e3) {
      setNotice("位置必须在 -1000 至 1000 米之间；已保留原坐标，未修改草稿。");
      return;
    }
    change(layout.items.map((i) => i.id === selected ? { ...i, [axis]: value } : i));
    setNotice("");
  }
  function deleteSelected() {
    if (importLock.current || busy || !selectedItem) return;
    const index = layout.items.findIndex((i) => i.id === selected);
    setDeletedItems((previous) => [...previous.slice(-19), { item: clone(selectedItem), index }]);
    change(layout.items.filter((i) => i.id !== selected));
    setSelected(null);
  }
  function undoDelete() {
    if (importLock.current || busy || !deletedItems.length || layout.items.length >= 200) return;
    const { item, index } = deletedItems.at(-1);
    if (layout.items.some((i) => i.id === item.id)) return;
    const items = [...layout.items];
    items.splice(Math.min(index, items.length), 0, clone(item));
    change(items);
    setSelected(item.id);
    setDeletedItems((previous) => previous.slice(0, -1));
  }
  let root = node;
  while (root?.parent) root = project.nodes.find((n) => n.id === root.parent);
  const rootId = root?.id || project.nodes.filter((n) => n.kind === "root").at(-1)?.id, candidates = project.nodes.filter((n) => n.kind === "plan" && n.parent === rootId);
  return <>{importing && <p role="status" className="notice">正在导入并等待安全保存，暂时锁定编辑；请勿关闭页面。</p>}<div inert={importing ? true : void 0} onClickCapture={blockImportEvent} onChangeCapture={blockImportEvent} onInputCapture={blockImportEvent} onSubmitCapture={blockImportEvent} onPointerDownCapture={blockImportEvent} onPointerMoveCapture={blockImportEvent} onPointerUpCapture={blockImportEvent} onKeyDownCapture={blockImportEvent}><header><div><b className="brand">Insta360 <span>SPACE STUDIO</span></b><p>门店空间设计工作台</p></div><span className="badge">DEMO / 规则布局 · 概念渲染</span><a href="/model-library/" target="_blank" rel="noreferrer" className="library-link">SI 模型库 ↗</a><button disabled={busy || dirty && slots < 1} onClick={() => {
    const saved = captureProject(project, active, draft, stage);
    if (saved.editorDraft) append([{ id: uid(), parent: active, kind: "edit", name: "新建前保留的调整", layout: clone(draft) }]);
    setDraft(null);
    setSelected(null);
    setStage("setup");
    setNotice("");
  }}>＋ 新建尺寸方案</button></header><div className="steps">{["01 空间输入", "02 四方案比较", "03 平面细化", "04 白膜确认", "05 风格渲染"].map((s, i) => <span key={s} className={["setup", "gallery", "editor", "white", "render"][i] === stage ? "current" : ""}>{s}</span>)}</div>
 <button className="history-toggle" aria-expanded={historyOpen} aria-controls="project-history" onClick={() => setHistoryOpen((v) => !v)}>历史与备份</button><div className="workspace"><HistoryTree isOpen={historyOpen} project={project} active={active} busy={busy} open={open} exportBackup={exportBackup} />
 <main><div className="heading"><div><div className="eyebrow">DESIGN YOUR NEXT SPACE</div><h1>{{ setup: "从空间开始", gallery: "四种布局，一起比较", editor: node?.name, white: "检查你的三维白膜", render: node?.name }[stage]}</h1></div>{stage === "editor" && <button disabled={slots < 1} onClick={() => {
    save();
    setStage("gallery");
  }}>保存并返回四方案</button>}{["white", "render"].includes(stage) && <button disabled={busy || slots < 1} onClick={resumeLayout}>复制当前布局继续编辑</button>}</div>
 {slots < 5 && <p className="warning">剩余 {slots} 个节点（上限 500）。四方案生成需 5 个，白模确认需 2 个，快照需 1 个；请先导出备份并分项目管理。</p>}
 {requestedAsset && <section className="notice" aria-label="模型库选定模型"><p>已从模型库选择：{requestedAsset.name}。打开或生成一个平面后即可加入。</p><button disabled={busy || stage !== "editor" || !layout || layout.items.length >= 200} onClick={() => placeAsset(requestedAsset)}>将选定模型加入当前平面</button></section>}
 {stage === "gallery" && <FuzzyAdvice layout={candidates[0]?.layout} />}
 {["editor", "white", "render"].includes(stage) && <FuzzyAdvice layout={layout} />}
 {stage === "setup" && <SetupStage mode={mode} setMode={setMode} generateFuzzy={generateFuzzy} slots={slots} generate={generate} width={width} setWidth={setWidth} depth={depth} setDepth={setDepth} area={area} setArea={setArea} ratio={ratio} setRatio={setRatio} shopType={shopType} setShopType={setShopType} height={height} setHeight={setHeight} learned={learned} setLearned={setLearned} loadSample={loadSample} />}
 {stage === "gallery" && <GalleryStage candidates={candidates} open={open} />}
 {stage === "editor" && layout && <EditorStage layout={layout} change={change} selected={selected} setSelected={setSelected} selectedItem={selectedItem} updatePosition={updatePosition} deleteSelected={deleteSelected} warnings={warnings} busy={busy} deletedItems={deletedItems} undoDelete={undoDelete} slots={slots} save={save} white={white} />}
 {stage === "white" && layout && <WhiteStage layout={layout} setModelReady={setModelReady} style={style} setStyle={setStyle} busy={busy} modelReady={modelReady} slots={slots} render={render} />}
 {stage === "render" && layout && <RenderStage node={node} images={images} active={active} setLightbox={setLightbox} busy={busy} render={render} persistImages={persistImages} />}
 <ExportToolbar stage={stage} images={images} active={active} busy={busy} setBusy={setBusy} node={node} setNotice={setNotice} layout={layout} />
 <ProjectTools busy={busy} onImport={importBackup} onExport={exportBackup} onError={setNotice} onPlace={stage === "editor" && layout && !busy && layout.items.length < 200 ? placeAsset : null} />
 {saveError && <div className="notice warning" role="alert">{saveError}</div>}
 {notice && !importing && <div className="notice" role="status">{notice}</div>}</main></div>
 {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}><div onClick={(e) => e.stopPropagation()}><img src={lightbox.src} alt="效果预览大图" /><div className="actions"><a download={`store-view-${lightbox.i + 1}.png`} href={lightbox.src}>下载 PNG</a><button onClick={() => setLightbox(null)}>关闭</button></div></div></div>}</div></>;
}
