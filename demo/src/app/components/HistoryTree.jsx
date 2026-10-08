import React from "react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import { useState } from "react";
export function HistoryTree({ isOpen, project, active, busy, open, exportBackup }) {
  const [historyQuery, setHistoryQuery] = useState("");
  const filteredHistory = project.nodes.filter((n) => n.name.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  const levels = {}, counts = {}, flowNodes = project.nodes.map((n) => {
    const level = n.parent ? (levels[n.parent] || 0) + 1 : 0;
    levels[n.id] = level;
    const row = counts[level] || 0;
    counts[level] = row + 1;
    return { id: n.id, position: { x: level * 185, y: row * 90 }, data: { label: n.name }, style: { borderColor: active === n.id ? "var(--ink)" : "var(--line-strong)" } };
  });
  return <aside id="project-history" className={isOpen ? "history-open" : ""}><h3>设计分支 <small>{project.nodes.length}</small></h3><p>点击历史节点继续设计</p><div className="tree"><ReactFlow key={project.nodes.length} nodes={flowNodes} edges={project.nodes.filter((n) => n.parent).map((n) => ({ id: n.id, source: n.parent, target: n.id }))} nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null} fitView minZoom={0.1} onNodeClick={(_, n) => open(project.nodes.find((x) => x.id === n.id))}><Background /><Controls showInteractive={false} /></ReactFlow></div><label className="history-search">搜索历史名称<input type="search" value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="输入方案或门店名称" /></label><button disabled={!historyQuery} onClick={() => setHistoryQuery("")}>清空历史搜索</button><small>列表 {filteredHistory.length} / {project.nodes.length} · 关系图保留全部</small><nav className="branch-list" aria-label="历史搜索结果">{!filteredHistory.length && <p>没有匹配的历史节点，请清空或更换关键词。</p>}{filteredHistory.map((n) => <button key={n.id} disabled={busy} className={active === n.id ? "active" : ""} onClick={() => open(n)}>{n.kind === "root" ? "▣ " : "↳ "}{n.name}</button>)}</nav><button onClick={exportBackup}>导出项目快照</button><small>方案与草稿自动保存到本机数据库；八视角可单独保存供刷新恢复。</small></aside>;
}
