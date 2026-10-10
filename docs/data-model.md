# 数据模型

更新：2026-10-09。PostgreSQL 16 及以上（开发与测试使用 PGlite / PostgreSQL 17），由 `database/schema/` 中的 Drizzle 定义与 `database/migrations/` 中的 SQL 迁移管理。

**实现状态**：第 1–5 节中的 `projects`、`design_nodes`、`project_drafts`、`node_cameras`、`renders`、`deliveries`、`stored_files`、`jobs`、`app_settings`、`ai_usage`、`audit_events` 已建表（迁移 `0000_init`）；目录域的 `assets` 已建表（迁移 `0001_catalog`，用途枚举 `item_function`，正面方向与安装方式来自 `网页模型/facing.json`，资产图片与模型通过 `stored_files` 挂接）；白模轻量版 `assets.white_glb_file_id`（迁移 `0003_white_models`）；分类 `assets.category`、效果图 `product_image_file_id` / `product_image_match`、平面图 `plan_symbol_file_id`（迁移 `0004_asset_categories`）；门店资料、识别、Agent 各表在对应阶段加入。

约定：
- 主键为 `uuid`（`gen_random_uuid()`）；目录类数据沿用业务编号（如 `asset-408124`、`PDF-001`）。
- 尺寸单位为米，`numeric(9,3)`；JSONB 内为数字（米）。界面换算为毫米。
- 平面坐标 x 向右、z 向下，y 向上。
- 时间为 `timestamptz`。
- 不建用户表。标注 **【用户隔离】** 的表在加入用户系统后需要按用户归属或授权。

## 1. 枚举

| 枚举 | 取值 |
|---|---|
| `shop_type` | `side_hall` 边厅店、`island` 中岛店、`zone` 专区 |
| `market` | `domestic` 国内、`overseas` 海外 |
| `si_style` | `SI1.0`、`SI2.0` |
| `node_kind` | `space` 空间、`plan` 生成方案、`edit` 编辑、`white` 白模确认、`render` 渲染 |
| `node_origin` | `user`、`generator`、`agent`、`import`、`recognition` |
| `plan_strategy` | `max` 尽量多放、`area` 按面积推荐、`min` 尽量少放、`case` 参照案例 |
| `render_mode` | `white`、`material` |
| `render_engine` | `three`、`blender` |
| `job_type` | `delivery`、`recognition`、`render_blender`、`ai_enhance` |
| `job_status` | `queued`、`running`、`succeeded`、`failed`、`canceled` |
| `item_function` | `island_table`、`unboxing_table`、`cashier`、`accessory_cabinet`、`side_cabinet`、`display_stand`、`screen`、`signage`、`seating`、`storage`、`other` |

## 2. JSONB 结构（由 `packages/shared` 的 zod 定义并校验）

**Space**（空间）
```json
{
  "schemaVersion": 1,
  "boundary": [[0,0],[6.4,0],[6.4,5.2],[0,5.2]],
  "height": 3.2,
  "entrances": [{"a":[2.0,5.2],"b":[4.0,5.2],"kind":"main"}],
  "openEdges": [{"a":[0,0],"b":[0,5.2]}],
  "obstacles": [{"kind":"column","polygon":[[3,2],[3.4,2],[3.4,2.4],[3,2.4]],"height":3.2}],
  "calibration": {"method":"manual|dimension|item_label|area","reference":"...","verified":true}
}
```
边界顺时针、闭合、不自交；障碍物必须在边界内。

**Layout**（布局）
```json
{
  "schemaVersion": 3,
  "items": [{
    "id": "i-1", "assetId": "asset-408124", "function": "island_table", "name": "1800mm普通中岛桌",
    "cx": 2.3, "cz": 1.8, "rotation": 90,
    "w": 1.0, "d": 1.8, "h": 1.327,
    "placeholder": false, "locked": false
  }],
  "planning": {
    "strategy": "area", "requested": 3, "placed": 3,
    "relaxations": [{"rule":"main_aisle","target":1.2,"actual":1.0}],
    "issues": []
  }
}
```
道具以占地中心 `cx, cz` 定位，`rotation` 取 0/90/180/270；`w/d/h` 必须等于资产旋转后的真实尺寸（禁止拉伸）。旧版 v2（左上角定位）导入时转换。

**Camera**（相机）
```json
{"name":"前", "position":[3.2,1.6,7.5], "target":[3.2,1.2,2.6], "fovDeg":50, "source":"auto|user"}
```

## 3. 设计项目域 【用户隔离】

### projects
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| name | text not null | 店名，用于交付文件命名 |
| shop_type | shop_type not null | |
| market | market not null default `domestic` | |
| si_style | si_style not null default `SI1.0` | 默认风格，节点可覆盖 |
| revision | int not null default 1 | 乐观锁 |
| created_at / updated_at | timestamptz | |
| deleted_at | timestamptz null | 软删除，非空即在回收站 |

### design_nodes
历史树节点，创建后除 `name`、`hidden_at` 外不可修改。

- `space` 节点保存空间，可以是根节点，也可以挂在其他节点下（修改空间时生成新的 `space` 节点，可附带沿用的布局，随后重新校验）。
- 其他节点必须有父节点和布局，不保存空间；其空间取最近的 `space` 祖先。
- 一个项目可以有多个根节点（例如导入的旧项目）。

已由数据库约束保证：节点类型与内容匹配（`design_nodes_payload_matches_kind`）、只有 `plan` 节点有排布策略、父节点必须属于同一项目（复合外键）。

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| project_id | uuid FK → projects | |
| parent_id | uuid FK → design_nodes null | 仅 `space` 节点可为空 |
| space | jsonb null | `space` 节点必填，其他节点为空 |
| kind | node_kind | |
| name | text | |
| layout | jsonb null | 非 `space` 节点必填；`space` 节点可选（沿用的布局） |
| strategy | plan_strategy null | `plan` 节点 |
| si_style | si_style null | 为空时继承项目 |
| origin | node_origin not null | 由谁创建 |
| origin_ref | uuid null | 例如 agent_actions.id、recognition_runs.id |
| imported_from | text null | 旧项目节点编号 |
| hidden_at | timestamptz null | 在树图中隐藏，可恢复 |
| seq | bigint identity | 插入顺序（同一事务内创建时间相同，树按此排序；导入时父节点先插入） |
| created_at | timestamptz | |

索引：`(project_id, created_at)`、`(parent_id)`。约束：父节点必须属于同一项目。

### project_drafts
| 列 | 类型 | 说明 |
|---|---|---|
| project_id | uuid PK FK | 每个项目一份共享草稿 |
| base_node_id | uuid FK → design_nodes | 草稿基于的节点 |
| layout | jsonb | |
| revision | int | 乐观锁 |
| updated_at | timestamptz | |

### node_cameras
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| node_id | uuid FK → design_nodes | `white` 或 `render` 节点 |
| sort | int | |
| camera | jsonb | Camera 结构 |
| deleted_at | timestamptz null | 删除的视角可恢复 |

### renders
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| node_id | uuid FK | |
| camera_id | uuid FK → node_cameras | |
| mode | render_mode | 白模 / 材质 |
| engine | render_engine | |
| si_style / market | | 渲染时的风格与市场 |
| layout_signature / camera_signature | text | 内容哈希；变化即过期 |
| file_id | uuid FK → stored_files | |
| width / height | int | |
| created_at | timestamptz | |

### deliveries
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| project_id / node_id | uuid FK | 冻结的节点 |
| folder_name | text | `门店名称_门店类型_面积_日期[_修订NN]` |
| full_pdf_file_id / show_pdf_file_id / zip_file_id | uuid FK null | |
| archive_path | text null | 写入归档目录后的实际路径 |
| manifest | jsonb | 页序、视角映射、哈希 |
| job_id | uuid FK → jobs | |
| created_at | timestamptz | |

## 4. 文件与任务

### stored_files
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| storage_key | text unique | 相对 `STORAGE_ROOT` 或 `RESOURCE_ROOT` 的路径 |
| root | text | `storage` / `resource` |
| kind | text | `render`、`upload`、`pdf`、`zip`、`glb`、`preview`、`artwork`… |
| content_type / bytes / sha256 | | |
| original_name | text null | |
| created_at | timestamptz | |

### jobs
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| type / status | job_type / job_status | |
| project_id | uuid FK null | |
| payload / result | jsonb | |
| error | text null | |
| attempts | int | |
| created_at / started_at / finished_at / heartbeat_at | timestamptz | |

## 5. AI 域

### app_settings
`key text PK, value jsonb, updated_at`。当前存放 `ai.agent.model`、`ai.recognition.model`、`ai.recognition.fallback` 等全站设置。加入用户系统后新增 `user_settings` 覆盖全站默认值。

### ai_usage
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| day | date | 北京时间日期，用于每日预算 |
| purpose | text | `agent` / `recognition` |
| provider / model | text | |
| tokens_in / tokens_out | int | |
| cost_cny | numeric(10,4) | |
| ref_type / ref_id | text / uuid | 关联的识别任务或 Agent 消息 |
| created_at | timestamptz | |

索引：`(day)`。

### plan_uploads 【用户隔离】（第二期）
`id, project_id, file_id, page, crop jsonb, created_at`

### recognition_runs 【用户隔离】（第二期）
`id, upload_id, method(local|llm), provider, model, status, draft jsonb（空间与道具，含置信度和来源分类：现状/新增/区域外）, scale jsonb, confidence numeric, error, confirmed_node_id, created_at, finished_at`

### agent_sessions / agent_messages / agent_actions 【用户隔离】（第三期）
- `agent_sessions`：`id, project_id, title, created_at`
- `agent_messages`：`id, session_id, role(user|assistant|tool), content jsonb, image_file_id, provider, model, tokens_in, tokens_out, cost_cny, created_at`
- `agent_actions`：`id, message_id, tool_name, input jsonb, result jsonb, status, resulting_node_id, undone_at, created_at`

## 6. 目录域（只读，命令行导入）

### assets
| 列 | 说明 |
|---|---|
| id `asset-xxxxxx` PK | |
| standard_name / variant | 模型库命名 |
| material_category | 软装物料 / 信息化物料 / 展陈物料 |
| si_family | SI1.0 / SI2.0 / 通用 / 非标 |
| function | item_function |
| nominal_w / nominal_d / nominal_h | 名义尺寸，用于匹配 |
| bounds_w / bounds_d / bounds_h | 可见包围盒（含产品、凳子） |
| front_axis | 原生正面方向，未校准为 null |
| placeable | 是否已有通过校验的 GLB |
| status / judgment | 校验与判断说明 |

### asset_files
`asset_id, role(skp|glb|preview|view|legend|legend_context), file_id, sha256`

### artworks
灯箱与广告画面：`id, file_id, orientation(landscape|portrait), width, height, source_url, license_status, note, created_at`

### layout_rules
排布规则表，由清洗数据统计后导入，可调整：`id, key, shop_type null, area_min, area_max, hardness(soft|hard), weight, params jsonb, source, version, enabled`

### 门店与资料
- `stores`：`id store-xxxx, name, city, mall, shop_type`
- `store_versions`：`id, store_id, version_id, is_primary, date_evidence`
- `source_documents`：`id PDF-xxx, file_name, sha256, bytes, page_count, si_index_label, location`
- `source_pages`：`source_id, page, type, confidence, title`
- `extracted_layouts`：`store_version_id, space jsonb, layout jsonb, auto_status, review jsonb`（来自数据清洗，供“参照案例”策略与规则统计使用）
- `si_standards`：`version, pdf_file_id, page_count`
- `si_pages`：`version, page, text, preview_file_id`

## 7. 审计

### audit_events
`id, entity, entity_id, action（create|hide|restore|delete|restore_deleted|setting_change…）, actor_kind（visitor|agent|system）, request_id, detail jsonb, created_at`。当前无用户身份，加入用户系统后增加操作人字段。

## 8. 与旧数据的对应

| 旧版 | 新版 |
|---|---|
| `root` 节点 + 矩形 `room{w,d,h,shopType}` | `space` 节点 + 矩形多边形；`shopType` 边厅店/中岛店写入项目 |
| `plan/edit/white/render` 节点 | 同名 kind |
| 道具左上角 `x,z` + `w,d` | 中心 `cx = x + w/2`、`cz = z + d/2` |
| `editorDraft` | `project_drafts` |
| `style: both` | 拆为 SI1.0 与 SI2.0 两个渲染节点 |
