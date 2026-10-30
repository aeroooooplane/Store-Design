# OneDrive 资源库接入

代码仍由 Git 同步；原始图纸、SketchUp 源模型、网页模型及展陈素材由 OneDrive 同步。每台 Windows 开发电脑都使用自己的 OneDrive 本机路径，不在 Git 中提交绝对路径或个人账号信息。

## 首次接入

1. 在 OneDrive 中同步 `门店生成工作台/资源库`，确认 `04_模型库/manifest.json`、`10_产品与陈列/展陈规则.xlsx` 和 `01_各门店原图纸` 存在。开发要用到的原始图纸和模型文件选择“始终保留在此设备上”。
2. 从 GitHub 克隆代码仓库。仓库内不应已有 `资源库` 文件夹。
3. 在仓库根目录运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File tools/connect-onedrive-resources.ps1
   ```

   如果 OneDrive 没有提供 `$env:OneDrive`，显式传入路径：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File tools/connect-onedrive-resources.ps1 -OneDriveRoot 'D:\OneDrive'
   ```

4. 每个独立 worktree 都运行一次接入脚本。脚本创建本机目录连接 `资源库`，保留现有代码和工具使用的相对路径；它不会覆盖或删除已有资源目录。
   脚本会核对 `resources.lock.json` 中的模型清单、展陈规则哈希和原图纸数量；不匹配时先检查 OneDrive 同步状态，不要强行跳过。
5. 执行 `pnpm install`、`pnpm db:migrate`、`pnpm catalog:import`、`pnpm test`，再用一个模型和一份原图纸验证网页显示及识别读取。

## 工作约定

- Git 提交代码、文档、清单和小型测试样本；原始资源文件在 OneDrive 中同步。模型变更仍要同步修改 OneDrive 中的模型文件与 `manifest.json`，并在 PR 中说明资源版本和校验值。
- 在另一台电脑检出代码后，先等 OneDrive 同步完成，再运行入库和识别。仅看到文件名或云朵占位符，不代表大文件内容已经落地。
- 新版资源与代码应成对发布；如果某次代码修改依赖尚未同步的资源，先让其他电脑完成资源同步，再合并对应 PR。
- 资源变更 PR 要同步更新 `resources.lock.json` 中对应的哈希和数量，另一台电脑才能核对是否拿到了同一版资源。
- 现有 GitHub LFS 历史对象不会因为迁移和删除当前版本而自动释放额度。

## 单机发布顺序

目前先在一台电脑开发。OneDrive 显示“同步完成”后，仍须核对本机文件内容、`resources.lock.json` 和资源清单；另一台电脑的接入验证延期，不能把本机成功记为跨机验收。

本轮展陈资源版本为 `display-20261030-rev4095`；用户已确认云端上传完成，本机的展陈规则文件哈希已写入 `resources.lock.json`。云端确认来自用户，第二台电脑尚未验证。

1. 指定一位资源发布负责人，记录本次资源版本、文件清单、大小和 SHA256。开发窗口只向隔离目录交付增量文件及清单，不直接写共享 `资源库`。
2. 停止正在读写资源库的导入或转换任务。为当前 `资源库` 和原数据库制作可恢复备份，并记录备份路径、时间和校验结果。不要用未验证的 OneDrive 历史版本作为唯一备份。
3. 发布负责人将已核对的增量一次写入 OneDrive 资源库，更新 `resources.lock.json`；等待同步完成，在本机重新计算哈希并核对清单。
4. 用对应代码版本运行 `tools/connect-onedrive-resources.ps1`、`pnpm db:migrate` 和 `pnpm catalog:import`，再检查模型缩略图、三维显示、展陈图片和原图纸读取。资源与代码都通过验收后才合并依赖该资源的 PR。
5. 记录 Git 提交、资源版本、数据库备份和验收结果。第二台电脑接入时，先核对同一版本与全部必需文件，再运行导入和一份完整的端到端样例。

## 共享目录与隔离输出

`资源库` 是指向同一个 OneDrive 文件夹的本机目录连接。不同 worktree 的连接并不提供写入隔离：任何一个窗口修改资源，其他窗口会立即看到。因此普通开发、测试和识别应把生成的 DAE、GLB、PDF、缓存、截图及临时清单写到各自 worktree 外的独立输出目录；不得把共享目录当作转换临时目录。需要修改资源时，将变更和哈希清单交给资源发布负责人统一发布。

使用 `tools/store-archive` 时，显式指定当前代码仓库 `--repo`（或 `STORE_ARCHIVE_REPO`）及独立的 `--out`；不要依赖其 `D:/text demo` 默认路径，也不要把输出设为共享 `资源库`。读取 OneDrive 中的原始 PDF、SKP、展陈规则与模型清单可以通过目录连接完成。

## 回退与恢复

发布前保留旧版资源和数据库备份，直到新版本在本机及计划中的第二台电脑都验收通过。若资源校验或导入失败，先停止相关写入进程，记录失败文件与当前版本；从已验证备份恢复旧版资源及数据库，并切回与旧版资源配套的代码提交，然后重新运行哈希和最小样例检查。不要仅回退 Git 提交：OneDrive 资源和数据库不会随 Git 自动回退。恢复完成后再开放开发窗口继续读取。
