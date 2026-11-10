# 渲染背景编辑协作契约

## 已确认体验

2026-11-10用户批准本方案。渲染步骤提供“添加背景图片”，支持拖入或文件选择。每个视角一张背景，可替换。图片支持移动、等比缩放、旋转和精确数值输入。点击进入空背景编辑时立即隐藏灰色半透明墙，取消选图或退出空编辑后恢复原显示。成功添加图片后默认隐藏，当前视角可手动显示并保存，已有背景尊重保存值。多点闭合遮罩恢复原照片对应区域，形成照片前景遮住三维模型的效果，支持改顶点和删除。辅助线退出绘制模式后保留，可显示、隐藏和删除。图片编辑、遮罩编辑、辅助线编辑和显隐均支持Ctrl+Z，连续拖动算一步。编辑保存在当前渲染视角，重载恢复。最终图包含背景和遮罩，辅助线用于编辑。

## 分工与串行边界

| 窗口 | 分支 | 文件与职责 | 隔离端口 |
| --- | --- | --- | --- |
| 主开发 | codex/render-background-core-20261110 | shared背景/Camera schema、API cameras及renders、app注册、生成接口、保存和上传校验、渲染过期与交付一致性 | 3070/5250 |
| UI | codex/render-background-ui-20261110 | RenderStage.tsx、workbench/api.ts、背景编辑组件、状态与撤销、独立样式 | 3071/5251 |
| 模型 | codex/render-background-composite-20261110 | Viewer3D.tsx、white-scene.ts、独立背景合成与截图模块 | 3072/5252 |
| 展陈验收 | codex/render-background-qa-20261110 | 独立浏览器验收与交叉审查、验收记录 | 3073/5253 |

共用schema及生成文件仅主开发修改。UI与模型先实现独立模块，再按冻结接口接线。看板由主开发汇总本轮登记和实绩，各窗口把增补登记交主开发。识别继续现有任务。各功能独立worktree和PR，依赖PR先合并，最终集成及验收通过后才更新用户主工作区。

## 数据约定 v1

类型由主开发在packages/shared导出。Camera新增可选background字段，null表示移除背景，旧Camera没有该字段时保持原渲染逻辑。沿用camera JSON存储，预计无需数据库迁移。

```ts
type BackgroundPoint = [number, number] // 图片归一化坐标u/v，左上[0,0]，右下[1,1]
type BackgroundImage = {
  fileId: string
  url: string // 服务端生成的本机文件URL
  width: number
  height: number
  name: string
}
type RenderBackground = {
  image: BackgroundImage
  transform: {
    x: number // 背景中心相对画布宽度，默认0.5
    y: number // 背景中心相对画布高度，默认0.5
    width: number // 图片绘制宽度/画布宽度，默认contain适配，锁定原图比例
    rotationDeg: number // 顺时针角度，绕图片中心旋转
  }
  masks: { id: string; points: BackgroundPoint[] }[]
  guides: { id: string; points: [BackgroundPoint, BackgroundPoint] }[]
  guidesVisible: boolean
  showTransparentWalls: boolean
}
```

画布与正式渲染均采用现有1800×1200的3比2坐标框，预览保持相同比例。图片高度由原图宽高比计算。初始contain宽度取min(1,imageAspect/1.5)。变换x/y范围-10到10，width范围0.01到20，rotationDeg范围-360到360。遮罩最多32面、每面3到100点且禁止自交，辅助线最多100条。遮罩和辅助线的点归一化到原图，各点跟随同一图片变换。多遮罩取并集，遮罩区域采用对应原照片像素覆盖模型。图片旋转后画布边界进行裁切，图片外沿用场景底色。替换图片时清空原遮罩和辅助线，整个替换作为一步可撤销操作。移除图片也可撤销。

背景编辑中的撤销栈按cameraId隔离。输入框内使用原生文字撤销，画布操作使用编辑撤销。未闭合绘制过程允许逐点撤销，闭合面后作为一个完整对象撤销。切换视角时保存队列按cameraId串行，上传/保存失败保留本地编辑并显示重试，过期响应不能覆盖其他视角。

Camera另有backgroundRevision可选整数，历史缺省0。PATCH /api/v1/cameras/:cameraId以{background,expectedBackgroundRevision}保存，服务端在同一事务锁定视角、校验版本并递增。冲突返回409，客户端保留草稿重试。渲染上传PUT原路径携带?backgroundRevision=本次快照版本，服务端保存前再次校验，拒绝过期上传。前端通过PATCH的background保存完整当前编辑状态。上传通过POST /api/v1/cameras/:cameraId/background-image发送image/png或image/jpeg二进制，返回BackgroundImage，上传仅存储文件，应用到视角由PATCH执行以支持撤销。上限16MiB，服务端解码验证、规范化像素方向和输出PNG。确切schema以主开发提交为准，字段改动须同步本契约。

模型窗口提供独立合成函数供预览与导出复用，接收RenderBackground和透明场景帧。Viewer新增background与hideBoundaryWalls属性，用于背景显示和空编辑临时隐藏半透明墙，普通视角沿用原行为。Viewer3DHandle.renderViews沿用原4参数，增加可选第5参数逐视角background数组，UI始终传入本次视角已保存的背景快照。图片解码失败必须报错并保留原有效图。辅助线由UI编辑层显示，截图只包含合成结果。

背景图、变换、遮罩及透明墙显隐参与渲染过期判定。辅助线及其显隐不参与。渲染开始前保存编辑并等待完成，再生成和上传同一快照，交付入口要求所有渲染为最新。旧图片下载与历史交付仍可追溯。

## 验收

- 文件选择和拖放均可添加，非法图片/超限/解码失败有反馈，当前视角状态可恢复。
- 移动、等比缩放、旋转后遮罩与照片内容保持对齐，1800×1200输出与预览一致。
- 多点闭合、顶点编辑、删除、多遮罩和辅助线显隐/删除均支持撤销，拖动一步撤销，输入框及视角间撤销互不串用。
- 添加背景后灰色透明墙默认隐藏，可恢复，墙面物料与其他三维构件语义单独检查。
- 刷新、视角切换、保存失败重试及图片替换/移除后重载均正确，旧无背景视角可继续渲染。
- 最终渲染图、渲染归档及交付PDF/ZIP中图像一致，编辑辅助线和控制点不进入最终图片。
- 各PR本地pnpm check、format检查和最终CI通过，浏览器使用隔离数据库验收。主库升级若需停服务须另行按看板规则执行。
