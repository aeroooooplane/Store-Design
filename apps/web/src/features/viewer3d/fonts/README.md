# 自定义 LOGO 离线字形

源字体为仓库 `apps/api/assets/fonts/NotoSansSC-Bold.ttf`，沿用 SI 手册指定的思源黑体风格，授权见本目录 OFL.txt。

`node tools/build-custom-logo-font.cjs` 同时生成压缩的 Three 字形、共享尺寸数据和白底 LOGO 缩略图，再格式化 `packages/shared/src/catalog/logo-metrics.json`。使用 PDFKit 已安装的 fontkit，不下载字体，不增加依赖。字形按需加载，可离线使用。

固定粗体、白色立体字，默认字高 300 mm、厚 30 mm。最多 40 字，支持源字体覆盖的常用中英文及符号；未收录字符会提示。此功能不复刻任何品牌专用字形，也不提供字体上传。
