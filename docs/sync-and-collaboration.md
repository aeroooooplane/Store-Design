# 多电脑同步与协作

## 本轮合并后，另一台电脑如何更新

先检查 `git status`。有尚未提交的个人工作时，先留在自己的分支提交保存；不要用强制重置清理。

工作区干净后，在项目根目录执行：

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git status
```

接着按 [OneDrive 资源库接入](onedrive-resources.md) 同步资源并运行连接脚本。代码由 Git 同步，资源由 OneDrive 同步；浏览器项目另行导出/导入 JSON 备份。

如果 `pull --ff-only` 提示分叉，先检查本地独有提交，另开分支合并处理；不要强推覆盖远端main。

## 日常开发

每次开工先同步main，再为当前任务建立独立分支，例如：

```powershell
git switch -c work/model-review-20261009
```

完成后审查 `git diff`、新增文件及相关验证结果，将本任务文件提交并推送该分支，通过Pull Request合入main。多人不要同时在同一个snapshot分支提交。

PDF、PPTX、SKP 等二进制资源由一人负责同一文件的一轮编辑，避免两台电脑同时修改同一个文件。相关代码 PR 记录资源版本及校验值，资源同步完成后再合并。另一台电脑拉取代码后先运行接入脚本核对 `resources.lock.json`。

## 资源提交检查

- 新文件放入 OneDrive 的正式资源目录，核对同步状态、文件数量及校验值。
- 资源变更与代码 PR 一起更新 `resources.lock.json`；不要将绝对路径提交进 Git。
- 换电脑下载后校验模型哈希、预览显示、PDF页数及相关工作台功能。
- 网页模型放在 OneDrive 的 `资源库/04_模型库/<大类>/…/<模型目录>/网页模型/model.glb`；`white.glb` 随资源同步，材质轻量版 `finish.glb` 可由 `pnpm catalog:finish` 在每台机器生成。
