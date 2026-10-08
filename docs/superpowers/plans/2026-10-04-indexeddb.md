# IndexedDB 迁移实施与验收

基线 `91adc2a`，在 delivery/20261004 当前检出继续。此次只改变保存介质和版本边界，不改变节点上限、原资产尺寸或几何。

- [ ] 建立 `project-db.js`：数据库版本 2；projects / backups / renders 三个 store。项目记录包含 schemaVersion、revision、raw。原子 compare-and-swap 与 Web Locks 共同保护多窗口和同窗口排队写入。
- [ ] `project-import.js` 将 JSON 上限提高至 50 MiB，仍限制 500 节点、每布局 200 件；无 schemaVersion 的旧数据按 v1 迁移，返回 v2；拒绝未来版本。
- [ ] `ProjectRecovery.jsx` 异步验证后才挂载 App；仅在无新库记录时导入 localStorage，保留原始字符串。错误记录必须先成功隔离备份才允许新建。升级失败不能退回空项目自动保存。
- [ ] `project-persistence.js` 写入成功后才推进修订号；失败不覆盖上一版本，导入仍以事务成功为门槛。
- [ ] 八视角 PNG 单独按需保存、恢复；绑定节点的布局与风格签名，不能把另一版图当成当前效果图。JSON 导出不夹带图片；完整图片仍可 ZIP 导出。
- [ ] 更新旧测试的存储观察边界到 IndexedDB，保留独立旧 localStorage 迁移测试。验证超 5 MiB、旧库 v1→v2、未来版本拒绝、损坏隔离、配额失败回滚、刷新草稿及图片、多窗口并发。
- [ ] 完整默认回归、build、迁移/恢复说明、本地提交。

决策：50 MiB 是应用导入保护上限，不承诺浏览器配额无限。模型文件不进入 IndexedDB。继续保留相同 64071 地址，以访问用户原有浏览器存储。
