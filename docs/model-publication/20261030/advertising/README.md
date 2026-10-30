# 6款广告屏发布记录

版本`models-20261030-12`。主开发协调窗口已确认本机12件资源首次发布完成且96文件逐哈希通过；12份conversion发布状态补丁已追加，196文件最终锁已生成并通过正式接入脚本校验。新增OneDrive云端同步和跨机使用尚未验证。

本PR仅包含发布记录，不将资源目录或模型大文件纳入Git，不上传新LFS对象。应用运行时代码无变化。

- `files.json`：本功能完整增量目标相对路径、SHA256、字节数、所属asset和运行/审核角色。conversion列发布状态补丁后的最终SHA，并保留首次发布候选SHA。
- `asset-patches.json`：逐asset的manifest/facing before/after，用于字段级合并和冲突判断，不覆盖其他模型。
- `sources.json`：对应原始SKP及S2原组合GLB的相对路径和源SHA。
- `validation.json`：本地验收范围、发布口径与剩余门槛。

独立staging位于`C:/Users/insta360/Documents/Codex/model-publication-staging-20261030`。原`publication-plan.json`保持不可变，SHA256为`aa32432983496fcb6a916973984f9e3c0d4d767bd6ca7d2b5df87a63b6b0c022`。首次包90增量文件加6个合并元数据；共享资源只由主开发协调窗口写入。`publish.py`默认只读check，状态补丁位于`publication-status-followup`；均不写资源锁。

已完成源SHA、标准压缩、五向复核、manifest/facing、white/finish/import、网页缩略图/三维/毫米尺寸/朝向/保存重载/导出核对；pageerror为0。控制台已知空草稿和favicon 404单独记录，不宣称原始控制台完全零日志。发布脚本另在隔离sandbox验证首次写入、重复幂等、96文件目标SHA，未重跑未变化的模型转换。

已知限制：保留源尺寸、原生画面和原有安装默认值；网页实际材质以贴墙方式复核。75寸横屏补齐原生图像3材质及UV。

记录/工具CI与主服务资源导入验收分开核对；协调窗口已授权最终CI通过后按中文说明合并；不再保留冻结或待资源发布门槛。
