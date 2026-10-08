# 文件整理记录 · 2026-09-26

## 盘点

开始整理前（不含 .git）：原始 SU 1 文件约 1.08 GiB；图纸目录 361 文件约 5.91 GiB；素材库 12,740 文件约 4.39 GiB；tools 27,905 文件约 4.73 GiB（包含运行环境）；output 29,897 文件约 12.60 GiB。文件数是磁盘盘点，不代表全部为可读有效样本。

output/pdf/cleaned-v2 为 29,502 文件约 12.50 GiB；旧 cleaned-v1 为 381 文件约 0.09 GiB。v2 拆分产物被正式案例使用，不能按临时输出删除。

## 本轮调整

1. 根 README 合并多轮滚动进展，突出当前产品范围、可信成果和三个使用入口，移除已过时的“当前第一步”和 SI 等于单一配色的表述。
2. docs/README.md 统一文件位置、用途及保留规则；历史实验按组索引，避免每份文档都承担项目入口。
3. docs/github-research.md → docs/archive/research/github-research.md；docs/llm-rendering-decision.md → docs/archive/research/llm-rendering-decision.md。保留正文，增加历史状态提示。
4. 原始资产、PDF 拆分、清洗标签、训练权重、运行环境、SU 临时复现脚本不移动、不删除。

## 删除与恢复

本批没有永久删除数据；删减的是首页重复及过时叙述，历史研究文件通过改名归档保留。旧内容可从 Git 历史恢复。后续可再生缓存清理必须逐项核实，不把“未入 Git”当作无意义。

## Git 边界

原工作区存在 188 份已暂存 PDF 变更及大量其他修改。本批提交只含明确的文档路径，不能使用 git add . 或提交整个 index。远端 origin 为用户给出的 aeroooooplane/Store-Design。
