# 标签库

- `index.html`：双击即可打开的本地检索表；原PDF链接仍指向原文件，不复制8GB素材。
- `stores.json`：标签主记录。`si` / `shopType` 为确认字段，`siCandidate` / `filenameTypeHint` 为候选，不能混作训练真值。
- `summary.json`：文件、页数、扫描异常与候选统计。
- `page-index/*.json`：逐页文字与候选类型，可按来源复查。

`siCandidate` 来自PDF明确SI文字，不是配色猜测；物料表可能含数量为零的道具，故仍需确认。`filenameTypeHint` 仅来自门店文件名里的边厅/中岛，店内“中岛桌”不参与铺型判定。

总表已完整读取925条，417/418份PDF匹配成功。`master.ndjson`及manifest保留最小字段快照，`match-summary.json`保留匹配统计，`review-required.json`列出冲突/未匹配/解析失败记录，`training-shortlist.json`为12家候选。

处理脚本在 `tools/pdf-review`。运行顺序：`node classify.mjs` → `node enrich.mjs` → `node match-master.mjs` → `node publish-labels.mjs`。`build-catalog.mjs`是接通总表前的旧版展示，不再作为最终输出。扫描会复用缓存；原文件有变化时，应移除对应生成缓存再跑。勿在匹配后单独执行enrich覆盖总表标签。
