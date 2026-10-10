# 交付 PDF 字体

`NotoSansSC-Regular.ttf`、`NotoSansSC-Bold.ttf`：思源黑体（Noto Sans SC，Google Fonts v41 静态 TrueType）的子集，授权为 SIL Open Font License 1.1（见 `OFL.txt`，允许随软件分发与嵌入 PDF）。店铺形象设计标准手册（SI1.0 p.13）规定中文用思源黑体 / Noto Sans。

子集只含 GB2312 全部汉字与符号、ASCII 与 Latin-1、常用标点（× ㎡ ° · — “” 等）以及模型库 `manifest.json` 中出现的所有字符，每个约 2.3 MB，作为普通文件提交（CI 不拉取 Git LFS）。子集用 harfbuzz（npm `subset-font`，输出 TrueType 保留 cmap）生成；店名等文字若用到子集外的生僻字，PDF 中会显示为空白，届时用同样方法加入该字重新生成。
