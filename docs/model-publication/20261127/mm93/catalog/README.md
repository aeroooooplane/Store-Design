# MM93 赛车正式目录发布

用户要求将已完成性能验证的赛车加入主工作台「模型 → 其他」。本批资源版本 `models-20261127-mm93`，编号 `asset-90000607`，名称「MM93 × Insta360 赛车」，非标陈列、落地、两套 SI 与国内/海外通用。

## 尺寸与原件

全长按默认展示尺寸 2100 mm 等比设置，原件数值全长为 1，尚未实测。仅追加父节点：统一米制、底部中心、绕 Y 轴 +90°，将原件 −X 车头转为 +Z。宽 797.6257、深 2100、高 1119.2780 mm；目录按毫米显示为 **798 × 2100 × 1119 mm**。

原始 Tripo GLB SHA256：`46ed38fb4e5a774e91e10264b20874a4c0a8584e655b5c680792c9b9e8700fef`。归档原件与运行源分开保存。原 BIN、POSITION/NORMAL/UV 浮点数组、索引、三张 4096 px 原图及原 PBR 参数逐项核对相同。材质版 501846 面、约 13.34 MB，无损 Meshopt；白模 39962 面、约 0.14 MB，边界偏差 1.8 mm。沿用 [#317 的按需加载与分帧预热](../runtime-performance.md)。

## 发布内容

13 个新增资源文件、2 份元数据，新增资源 59,351,100 字节。增量包括归一化 `model.glb`、独立 `white.glb` / `finish.glb`、三个记录、白底预览、真实顶视投影轮廓 SVG/PNG、原始 Tripo GLB、五向复核图、透明缩略图及资源校验记录。代码另提供 17,230 字节透明 WebP。

`manifest.json` 103 → 104 条，旧 103 条记录逐对象相同；新增朝向为 +Z、安装为 floor。资源锁保留旧必需文件与非模型版本，只更新模型版本、两份元数据哈希并追加新文件。发布负责人在真实冷备与基线核对后统一写入共享目录和执行正式导入。

大模型及原件位于 OneDrive 资源库，遵守现行资源/LFS 约定；Git 仅提交工具、资源锁、审核文档和小型 WebP。

## 可复现流程

在独立工作树安装仓库与 `tools/su-convert` 锁定依赖，接入只读共享资源后：

```powershell
node tools/su-convert/scripts/package-mm93-catalog.mjs <Tripo原件> <新的外置包目录> 2100
# 将新条目复制为独立 RESOURCE_ROOT，DATABASE_URL / STORAGE_ROOT / ARCHIVE_ROOT 也显式指向独立目录。
pnpm catalog:white asset-90000607
pnpm catalog:finish asset-90000607
pnpm db:migrate
pnpm catalog:import
$env:SU_REVIEW_PORT = '5269'
node tools/su-convert/scripts/render-glb-review.mjs <外置五向目录> asset-90000607
node tools/su-convert/scripts/verify-mm93-catalog.mjs <包目录> isolated
node tools/su-convert/scripts/plan-mm93-publication.mjs <包目录>
```

打包脚本拒绝覆盖已有输出，不写共享目录。计划脚本要求四组隔离浏览器成功，核对共享元数据和资源锁基线、保留旧目录记录，再生成只读可核验的发布计划及锁候选。正式发布由指定负责人执行；完成资源和目录导入、代码合并与本机同步后，运行 `verify-mm93-catalog.mjs <包目录> formal`，仅 GET/HEAD 访问主工作台，使用临时内存场景复核四组列表、原材质、白模与材质 PNG、多个实例资源复用。

## 本地验收

两套 SI × 国内/海外共四组，通过真实工作台添加至其他、透明缩略图、90° 再回 0°、自动保存、完整材质/白模切换、原 4K/PBR、包围盒尺寸及导出复核。浏览器不请求 22 MB 完整源模型，只各请求一次材质版及白模；页面错误为零。五向人工看图确认 +Z 车头、底部落地与完整原外观。28 项模型列表专项、静态、类型、格式及 CI 同配置的全仓 1081 项通过（shared 314、web 525、database 7、api 235）。正式只读流程先以 `rehearsal` 在独立服务演练：四组列表、8 张三维导出与四辆共用一份几何/三张原图全部通过，零业务写入。最终 CI 与正式发布证据记录在 PR 与协作看板。

## 已知限制

2100 mm 是默认展示全长，实际尺寸未认证。原件的 AI 几何、小字和左侧图案误差继续保留。三张原始 4K 纹理的完整 RGBA8 mipmap 估算约 256 MiB 显存；无损压缩减少传输，分帧上传仍可能有短任务，性能以实测硬件和实例数量为准。OneDrive 云端同步与另一台电脑未验证，不记作跨机发布成功。

本批只读演练改为完整 2.1 m 展示尺寸、8×6 m 房间和四辆同时在画面内的视角，Intel 硬件 Edge 约 44–55 fps；每辆仍保留完整网格。四辆共用一份材质几何、三张原图，GPU 纹理数保持 10，避免重复资源占用；这组条件与前一轮原始数值尺寸的近景测试不同。
