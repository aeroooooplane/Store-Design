# 品牌标识源文件

用户 2026-10-15 提供，供品牌 LOGO 网页模型（官方矢量自建）使用。哈希见 `SHA256SUMS.txt`。

| 文件 | 内容 | 用途 |
|---|---|---|
| 影翎.svg | “ANTIGRAVITY”与“影翎”两组矢量字形 | 墙面 LOGO：ANTIGRAVITY、影翎ANTIGRAVITY |
| 门店-徕卡联名-中文新-转曲文件.ai | 影石Insta360 \| 徕卡圆标 / 专业影像合作伙伴（转曲） | 徕卡联名墙面 LOGO 国内版 |
| 门店-徕卡联名.ai | 第 1 页英文：Insta360 + 徕卡圆标 / Strategic Imaging Partnership；第 2 页中文 | 徕卡联名墙面 LOGO 海外版（第 1 页） |
| 门头小字使用要求-2026-8.ai | 门头红框与“影石Insta360…体验专区”示意 | 使用规范，参考 |
| 参考图-徕卡联名墙实拍.png | 徕卡联名墙实拍：白色立体字、红色徕卡圆标 | 颜色与排布参考 |

另有 8 份 2026-02 官方原稿（中英文字标 .ai：影石Insta360.ai 第 4 页为中文横排、Insta360.ai 第 4 页为英文横排、第 9 页为英文加 Think bold.；口号 PDF：CN-logo-black-on- transparent-rgb5.pdf 为中文加始于敢想）。它们与 08-skill 效果图工具里的原件逐字节相同，但那份不在 Git 里，所以也一并入库。

未入库：徕卡LOGO-大样图.dwg（AutoCAD 2018 格式，本机无法读取；徕卡圆标矢量已包含在联名 .ai 中，用不到）。

生成脚本：`apps/web/src/scripts/build-logo-models.ts`（在 apps/web 目录运行 `node src/scripts/build-logo-models.ts`）。
