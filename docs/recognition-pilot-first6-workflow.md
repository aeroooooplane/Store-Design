# 首批6家：输入检查、校正质检与对照出图

本工具承接 [交接契约 v1](recognition-pilot-contract-v1.md) 的 B/C 步骤。2026-11-03 用户已将本试点全部交给 Codex：资料执行者制作 A/B，校正执行者独立复核来源并制作 C，用户处理集中歧义和抽审。旧契约中的 Claude 角色名称不再表示必须等 Claude 交付；数据字段与 45/48 隔离要求继续有效。

当前实现是可运行的离线审核工具，不是自动识别引擎，也不是编辑器完整验收。它接收已制作的 `plan.json` / `bom.json`，检查输入与几何/计数，生成原图、生成平面和叠图。真实资料未接收前，只运行合成演示，不能报告真实6家完成。

## 运行

Node 24、仓库现有依赖，无新增依赖、数据库或网络调用。在独立 worktree 执行：

```powershell
node tools/recognition/pilot-first6.mjs --manifest <输入>/pilot-manifest.json --acceptance-index <输入>/acceptance-index.json --development-index <输入>/development-index.json --repo <worktree> --resources <只读资源根> --body-footprint-sha256 <冻结时桌体文件的SHA256> --bundle <B包根> --corrections <C校正根> --out <全新输出目录>
```

`--out` 的父目录须存在；输出不能在任一 Git worktree、共享资源、B/C 输入或名单目录内，也不能覆盖已有输出。资源锁已包含 `04_模型库/body-footprint.json` 时可省去 `--body-footprint-sha256`；否则必须使用资料冻结时记录的字节指纹，不在运行时临时取当前哈希冒充冻结依据。

固定首版仍为24家、首批恰好6家。A项失败立即拒绝并记录 `blocked.json`。B/C逐店失败保留6家分母及原因，不替换难例。6家自动检查全通过才退出0，其余退出1；即使退出0，完整验收和训练准入仍为0/false。

## B包补充说明

每店在 `<B包根>/<store_id>/` 放 `handoff.json`。字段按契约 v1；源文件仅放 `source/`、`evidence/` 或顶层 `store.json`，不得混入派生 `plan.json` / `qa.json`。`evidence/index.json` 的具体形状为：

```json
{
  "store_id": "原门店编号",
  "observations": [
    {
      "id": "boundary-source",
      "kind": "drawing",
      "path": "source/preview.png",
      "note": "说明原墙、租赁线和尺寸依据；不能仅写已确认"
    }
  ]
}
```

索引ID唯一，`path` 必须存在并列在 handoff 的文件哈希中。各证据可引用同一原图，但说明应能定位原图依据；索引完整不等于证明内容正确。

检查重新渲染名单指定的原PDF页和提取页，核对页数、尺寸、裁切、旋转、预览及变换矩阵。图像差异只作提错页/方向错误的粗筛（归一化灰度均差阈值：原页对提页0.02、预览0.03），不是原图内容一致性的充分证明。`visualReviewRequired` 始终为 true，仍须独立人工对图。PDF统一使用原生旋转前、左上原点的页坐标。

量尺至少需要一条 `calibration` 和一条不同端点的 `independent-check`；两者必须来自不同的原图尺寸标注。独立尺寸误差超过1%或缺证据时阻塞，不能用同一尺寸反复命名充数。代码能拒绝相同/反向端点，不能判断文字证据是否被人为重复利用，需交叉核对。

## C校正包

每店在 `<C校正根>/<store_id>/` 放 `plan.json` 和 `bom.json`。不能直接把旧档案中的 layout 复制为工作台格式；未知字段须显式映射。原JSON完整保留；若工作台schema会剥离字段，质检报 `unmapped_field`，不宣称无损转换。

`plan.json` 必需字段：

| 字段                                    | 内容                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`, `contract`, `store_id` | `1`、`store-pilot/1`、冻结门店编号                                                                               |
| `manifestSha256`, `handoffSha256`       | 名单规范JSON哈希；handoff原字节哈希                                                                              |
| `si`                                    | 与名单一致且为SI1.0或SI2.0；unknown不能通过                                                                      |
| `versions`                              | `{modelsVersion,resourceLockSha256}`，与名单一致                                                                 |
| `transform`                             | `{originPx:[u,v],mmPerPixel,calibrationId}`；米制X向右、Z向下                                                    |
| `space`, `layout`                       | 现有 SpaceSchema(1) / LayoutSchema(3)，含原有/后加障碍区分、入口、实例位置/尺寸/朝向/安装                        |
| `evidence`                              | `{boundary:[证据ID],entrances:[证据ID],obstacles:[证据ID],items:{实例ID:[证据ID]}}`；无障碍也说明已检查的依据    |
| `unresolved`                            | 显式数组；没有已发现歧义时为 `[]`，不代表用户已确认                                                              |
| `review`                                | `{status,userSampled:false,history:[{actor,role:"agent",at,reason}]}`；status仅接受draft/agent_corrected/blocked |

每个 `unresolved` 条目至少有 `id/question/options/recommendation/evidencePath/regionPx`；至少两个明确选项。`regionPx:[left,top,width,height]` 定位 `source/preview.png` 局部时，自动裁出证据图。无有效局部会在审核页提示，不伪造证据。所有未解歧义均阻塞自动通过。

`bom.json` 使用 `{store_id,rows:[...]}`；每行字段为 `id/assetId/label/unit/quantity/itemIds/sourceRefs`。单位只接收“件/组”，组须给正整数 `componentsPerUnit`。实例恰好计数一次，型号一致；每行有原图/BOM证据ID。未识别型号可保留 null 及原文，但不能自动通过；不能为了匹配目录强配型号。

完整可运行样例由 `pilot-first6-fixture.mjs` 生成，包含B/C包和各自指纹。示例名字、身份索引、图纸与尺寸全为合成，不可复制为真实门店证据。

## 质检与产物

- 重新执行A项排重、冻结名单与原PDF指纹检查。45/48只读取身份索引，不读取其标注或分数。
- 验证B文件原字节、原页/预览几何与身份；C使用固定handoff哈希。
- 使用现有Space/Layout校验及 `checkAssetFit`，检查自交、越界、碰撞、入口、资产尺寸、BOM计数、未知/停用型号与缺项。保留错误原状，不自动移动道具掩盖碰撞。
- 资产尺寸与工作台一致优先取 `conversion.json`，再应用桌体尺寸/偏移；目录已有锁的转换记录强制核验。其余涉及的转换记录在本次开始使用时冻结到输出，记录实际哈希，不宣称它们已经绑定资源发布锁。
- 不加载GLB，不判断材质/模型朝向正面或安装语义正确性。蓝短线仅表示模型+Z轴；安装、实际正面及与原图的关系仍须交叉核对，编辑器加载另验收。
- SVG和PDF由同一几何场景生成，折线入口沿边界片段绘制。PDF为A3横向审核草稿，含毫米尺寸及BOM；PDF预览供对照，不是可直接施工的审定图纸。SVG是几何平面，BOM另见JSON/PDF。

```text
<输出>/
  a-check/manifest-check.json
  quality-report.json
  conflicts.json
  training-eligibility.csv
  provenance.json
  file-hashes.json
  provenance/             工具原文、冻结索引、模型/桌体/转换记录
  review/index.html       原图、生成平面、叠图、集中歧义
  <store_id>/
    source/、evidence/、store.json、handoff.json
    input-check.json
    plan.json、bom.json、qa.json
    plan.svg、plan.pdf、plan.png
    overlay.svg、overlay.png
    conflict-*.png        仅有有效歧义局部时
    failure.json          仅逐店处理异常时
```

schema/自交等无效几何不生成看似有效的平面；未知型号等问题可保留图供审核，但状态仍blocked。原始C包不被schema默认值覆盖。输出哈希清单覆盖全部已有产物，自身除外；`provenance` 记录代码提交、工具是否含未提交修改、工具精确字节与资源哈希，开发态样例不能冒充已发布版本。

自动检查通过仅标 `needs_cross_check`。源图逐项交叉检查、隔离编辑器保存/重载/导出、用户抽审尚未在本工具执行，`realCompleted` 始终0、`trainingEligible` 始终false。后续逐项验收记录齐全后再扩展最终状态；不能手改统计字段宣布完成。

## 验证

```powershell
node --test tools/recognition/pilot-contract.test.mjs
node tools/recognition/pilot-first6-fixture.mjs --out <worktree外的新合成目录>
pnpm check
pnpm format:check
```

现有CI的契约入口引入首6测试，不修改CI配置。33项测试包括20项A契约和13项B/C回归：完整合成6家、未知型号、坐标变换、独立量尺、BOM/真实尺寸、旧字段丢失、转换记录、曲折入口、篡改原图、中文PDF、审核链接/逐文件哈希、缺校正保留分母及禁止覆盖。合成结果预期：生成6、自动检查通过5、未知型号阻塞1、真实完成0。真实校正另按同一流程运行和对图，不用这组计数代替。

2026-11-03 本地结果：33项工具测试、`pnpm check`（761项：shared 255、database 7、web 302、api 197）及 `pnpm format:check` 通过。合成PDF最新渲染已检查中文、尺寸避让及图例；全部审核页文件链接和输出哈希通过自动校验。浏览器安全策略拒绝 `file://` 导航，本轮没有浏览器交互冒烟结果，不把文件完整性测试说成浏览器验收。真实B/C尚未接收或执行，不能据这些测试报告首6完成。
