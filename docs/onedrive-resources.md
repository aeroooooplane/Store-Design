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
