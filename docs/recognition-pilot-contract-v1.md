# 完整图纸试点：A/B 交接契约 v1

依据 `docs/collab-board.md` 第 7、9 节。此版本只建立 24 家试点的数据交接约定及 A 项检查工具，**没有选出或完成任何真实样本**。Claude 负责选样、原页、来源与 BOM；Codex 负责独立复核输入、校正与质检。现有 45 家验收、48 家开发集与旧 17 项歧义保持独立。契约代码不依赖未合并的 PR #156。

## 1. 交付顺序及双方责任

1. Claude 在看板登记后，依据原资料一次选定 24 家，并指定首批 6 家。先冻结完整名单，再批量提取或运行识别，不能先挑识别成功的 6 家。
2. Claude 交付 `pilot-manifest.json`、两个只含身份/来源的排重索引及证据出处。Codex 使用本工具复核身份、分层及源文件指纹；双方对同店关系及缺层交叉检查后，在看板记录 A 项状态。
3. Claude 按下述 B 项字段交付前 6 家资料包。Codex 对原 PDF 页码、方向、裁切和量尺依据逐店查看；文件哈希通过不代替内容复核。
4. C 项再生成固定版本草稿与校正结果，Claude 交叉检查；D 项用户裁决歧义并抽审 2 家后，再推广剩余 18 家。此 PR 不包含 C–F 的完整几何/BOM/编辑器/出图验收实现。

不得因当前源码缺少旧档案字段就清理或覆盖原 `store.json`、原 BOM。旧 `build_gold.py` 的 `layout.items` 含 `ref`、类别、安装及来源等档案字段，不能直接冒充工作台 `LayoutSchema`。转换时须逐项映射并记录差异，原证据另存。

## 2. A 项冻结名单：pilot-manifest.json

所有文件 UTF-8 JSON，键名区分大小写。`schemaVersion: 1`、`contract: "store-pilot/1"`。字段定义如下，均必需。

| 字段                                               | 类型与口径                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pilotId`                                          | 本批固定标识，例如 `pilot24-20261103`                                                                                                 |
| `status`、`frozenAt`、`selectedBy`                 | `frozen`；带时区 ISO 时间；选样者。冻结只表示名单不变，不表示样本完成                                                                 |
| `selectionBasis`                                   | 固定 `source-stratified-before-recognition`                                                                                           |
| `coverageGaps`                                     | 字符串数组，说明缺层和实际盘点原因；无缺层也须给 `[]`                                                                                 |
| `resourceLockSha256`、`modelsVersion`              | `resources.lock.json` 的规范 JSON 哈希及 `releaseVersions.models`。先运行资源连接脚本校验共享资源；本检查额外核对实际模型目录文件哈希 |
| `exclusions.acceptanceSha256`、`developmentSha256` | 两个排重索引的规范 JSON 哈希                                                                                                          |
| `samples`                                          | 固定 24 条；同一原门店 ID，6 条 `batch:1`、18 条 `batch:2`；不得静默换店                                                              |

每条 sample：

| 字段                                     | 类型与口径                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `store_id`、`name`                       | 保留原档案编号与店名，不生成新门店编号                                                                                                      |
| `aliases`                                | 已知规范别名，含同店旧名称；未知关系不得假装核验过                                                                                          |
| `sameStoreKeys`                          | 非空数组，同店多版本/跨来源连通分组的稳定键，**不是商场键**；生产者根据身份资料补全关系，不能每个版本随意另造一键                           |
| `sourceSha256s`                          | 非空数组，该门店全部已知原始 PDF 的原始字节 SHA256（小写64位），包含本次选择的来源；勿只列预览图哈希                                        |
| `mallGroupKey`、`nearDuplicateGroupKeys` | 商场分组字符串、近重复分组数组，供后续训练划分。相同商场本身不自动判为同店                                                                  |
| `batch`、`selectionReason`               | `1/2` 与基于来源的选择理由                                                                                                                  |
| `si`                                     | `SI1.0 / SI2.0 / unknown`                                                                                                                   |
| `shopType`                               | `边厅 / 中岛 / 专区 / unknown`                                                                                                              |
| `pageType`                               | `vector-text / vector-outline / raster / unknown`                                                                                           |
| `geometry`                               | `regular / irregular / unknown`，初筛不能冒充最终形态审核                                                                                   |
| `source`                                 | `{path, sha256, page, pageCount}`；path 从资源库根起的 POSIX 相对路径；page 为 **1 基原 PDF 页号**，不是书面图号；pageCount 来自 PDF 元数据 |
| `missing`                                | 缺项及证据不足的字符串列表，空列表表示生产者当前未发现缺项，不能代表全流程通过                                                              |

`source.path` 只接受 `01_各门店原图纸/` 下的 `.pdf`，不能把档案标注或派生出图作为源输入。

两个排重索引采用同一形状：`{schemaVersion:1,kind,revision,sourceManifestSha256,stores:[...]}`。`kind` 分别为 `acceptance`（45 条）、`development`（48 条）；每条包括上表的 `store_id/name/aliases/sameStoreKeys/sourceSha256s`。`revision` 标记来源版本，`sourceManifestSha256` 为原身份名单文件的字节哈希。只提取身份及来源信息，不读取 45 家的 `plan.json`、坐标或分数。原 48 家清单可从 PR #156 固定版本的名单元数据提取，不能把代理参照一并导入本批。

检查按原 ID、规范名称/别名、同店分组、任一已知 PDF 哈希拒绝跨集合重复及本批重复。名称做 NFKC、大小写、标点/空白归一化；这不是模糊实体识别。未知同店关系仍需要双方独立复核，不能把“已知键未重叠”报告成绝对无泄漏。多店共用同一个 PDF 时先保留冲突，不自行放宽整份 PDF 隔离规则，提交看板裁决。

规范 JSON 哈希算法：递归按对象键排序，数组保持原顺序，使用无空白 `JSON.stringify` 的 UTF-8 字节计算 SHA256，函数见 `jsonSha256`。因此换行和缩进不会改变名单版本；数组顺序和实际内容会。PDF、PNG、SVG 等文件仍按原字节哈希。不得往 manifest 自己放自身哈希；检查报告和下游 handoff 引用它。

v1 准入工具只接受首版 24 家。若出现缺源等需补样，依据看板允许范围另提清单修订，保留旧版本/失败、变更理由和总分母；先扩展并审查契约再接收 20–30 家的修订名单，不通过改计数或替换文件绕过冻结。

## 3. B 项每店输入包

原资料只读，交付放独立根目录 `<pilotId>/<store_id>/`：

```text
handoff.json
source/plan.pdf          原PDF选定页，完整保留原页内容
source/preview.png       原页预览；若裁切，须保留变换和完整原页PDF
store.json              原档案完整快照，不覆盖未知字段
evidence/index.json     图签、SI、选页、量尺、型号和数量证据索引
evidence/source-bom.json 原BOM可读时提供，保留原单位/组合口径
evidence/...            必要局部、文字证据；逐项列入文件哈希清单
```

`handoff.json` 字段：

- `schemaVersion:1`、`contract:"store-pilot/1"`、`store_id`、`manifestSha256`（规范 JSON 哈希）。
- `producer:{name,tool,codeRevision,createdAt}`：完整40位提交及带时区时间；临时未提交脚本不能作为隐式生产版本。
- `sourceSha256`、`sourcePage`：与冻结名单相同；提页结果另列 `files`，不把提页哈希替换原 PDF 哈希。
- `render:{pageSizePt:[w,h],cropBoxPt:[x,y,w,h],rotationCW,widthPx,heightPx,pageToPreview:[a,b,c,d,e,f],renderer,rendererVersion}`。原页空间统一采用应用 PDF 原生页旋转前、左上原点、右/下为正的点坐标（1 pt = 1/72 inch）；若渲染器使用底左原点或自动应用原生旋转，生产者须显式转换。`rotationCW` 含原生页旋转与额外旋转的总顺时针角（0/90/180/270）。`u=a*x+c*y+e; v=b*x+d*y+f`；裁切四角按旋转顺序映到 `[0,0] [width,0] [width,height] [0,height]`，容差1像素。禁止拉伸改变横纵比例。
- `dimensions:[{id,role,pointsPx:[[u1,v1],[u2,v2]],lengthMm,label,evidencePath}]`：role 为 `calibration` 或 `independent-check`；原图文字/尺寸端点定位，毫米值必须来自原图，不从面积/资产倒推。没有读到就留空并写缺项，不能伪填。独立尺寸必须是不同原图标注，不能把同一根尺寸换 ID 计两次。
- `bom:{status,path?,reason?}`：status 为 `present/missing/unreadable`；缺失要理由，不能以空数组冒充零件数为零。
- `files:[{path,sha256}]`：以上每个文件的店目录相对路径和原字节哈希；handoff 自身不自引用。路径不含绝对盘符、上溯或跨根目录链接。
- `status:"draft"|"blocked"`、`missing:[]`。输入齐全并不授予 `agent_corrected` 等状态。Codex 保留输入包原样，另写接收检查记录，绝不覆盖 Claude 的输入证据。

这部分是双方制作资料包的约定；本次 CLI **未实现 B 项内容/渲染/尺寸/BOM 验收**。接收前6家时须先补 B 项验证及对图记录，再进入 C 项。

## 4. 后续校正和质检约定（C–F 准备）

`plan.json` 为试点封装：`schemaVersion/contract/store_id/manifestSha256/versions/transform/space/layout/evidence/review`。`space` 使用现有 `SpaceSchema`（1），`layout` 使用现有 `LayoutSchema`（3）。不得为适配档案擅改共用 schema；旧字段原样留在 evidence 或显式 unresolved 列表，不交给 Zod 默认剥离后声称无损。

预览像素到空间米制：`x=(u-originPx[0])*mmPerPixel/1000; z=(v-originPx[1])*mmPerPixel/1000`，X向右、Z向下、Y向上。定标只用可信原尺寸，`mmPerPixel=lengthMm/两端像素距离`；旋转/裁切已在原页到预览变换内处理。留存正逆变换、原点和量尺证据。尽可能用未参与定标的另一尺寸检查误差≤1%；无足够依据或超限须 blocked，不因 schema 合法而放行。

道具使用现有坐标与朝向约定：`cx/cz` 为中心、`rotation` 为 `[0,360)` 度，three.js 对应 `rotation.y=-rotation`；`w/d` 是最接近90度旋转后的占地尺寸，不能对任意角度重复交换。保留真实资产 ID、型号尺寸、安装方式、底高、来源证据；未知资产用 null 并列歧义，不强配。模型尺寸版本、facing/body-footprint 等用到的目录文件均记录原字节哈希。

柱/管井按原结构扣面积；橱窗地台、空心包板等后加构件 `addedLater:true`，计面积但避让。曲线使用可复现折线及最大近似误差；斜墙保留实际角度。后场规则沿用交接决定。原图有碰撞或通道问题时忠实保留、单列训练排除理由，不自动移动道具美化结果。

归一化 `bom.json` 每行至少包括 `id/assetId/label/unit/quantity/itemIds/sourceRefs`。每个实例恰好被计数一次，单件以 itemIds 数核对；组合明确每组组件数及对应关系，不能同时把整组与单件重复计数。不能只核总数量忽略型号分组。硬装、非道具物料另列，不塞入 layout 道具数。缺尺寸/型号且影响布局时不得记完整通过。

`review` 保留有序历史事件 `{status,actor,role,at,evidenceRefs,reason}` 与独立 `userSampled` 事实：draft → agent_corrected → cross_checked；用户实际抽审的店才记 user_sampled。任一步可 blocked。几何/物料或源文件改变后，当前审核状态退回 draft，并记录已失效的旧审核，不能继承用户签核。自动脚本不能自行生成用户角色事件。

`qa.json` 分别记录 schema、几何、比例、实例/BOM、资产尺寸/朝向、源图一致性、编辑保存重载、SVG/PDF一致性及问题级别，每项带代码/资源/输入哈希。`training-eligibility.csv` 另列是否准入及原因；通过输入校验、代理校正或部分用户抽审均不能自动设为可训练。最终通过门槛以看板9.6为准。

## 5. 已实现的 A 项检查命令与限制

Node 24，无新增依赖；在试点 worktree 运行资源接入脚本后：

```powershell
node tools/recognition/pilot-check.mjs --manifest <独立输入目录>/pilot-manifest.json --acceptance-index <独立输入目录>/acceptance-index.json --development-index <独立输入目录>/development-index.json --repo <当前worktree> --resources <只读资源根> --out <worktree外的新输出目录>
node --test tools/recognition/pilot-contract.test.mjs
```

`--out` 的父目录须已存在；输出目录必须新建、不得处于任何 Git worktree、资源根或输入目录内。检查真实路径，拒绝经 Junction 越界、覆盖旧报告。工具只读取指定索引、名单、资源锁、模型目录和选中的原 PDF，不读取金标准 plan 或原库。不会启动服务器、创建项目、写 OneDrive、外发文件或运行识别。

合法名单的每家都保留在 `manifest-check.json` 中，原 PDF 缺失或指纹错误逐店记录并退出1，不静默丢店；名单结构、隔离冲突或版本错误则在生成报告前拒绝。成功退出0只表示 A 项字段及源哈希通过。pageCount/页码是生产者声明，尚未解析原 PDF 验证内容；B 项仍要独立查看。真实名单尚未交付，所以本次只跑合成测试，不汇报24家通过、识别分数或试点完成。

20 项合成检查覆盖冻结/分批、元数据哈希、身份/别名/同店异版/原PDF隔离、路径及 Junction、禁止覆盖、逐店源文件损坏保留。CI 新增独立步骤运行相同 Node 测试，不使用真实资源或 LFS；项目 `pnpm check` 与 `pnpm format:check` 仍须照常运行。
