# 技术架构建议

## 前端

- 项目创建表单
- 平面编辑器和软装素材库
- 节点树和版本浏览器
- 风格选择卡片
- 白膜和效果图查看器
- PDF 导出和下载页面

平面编辑器需要同时展示元素位置、尺寸、碰撞和通道提示。三维预览可在后续阶段接入，第一版先保证二维编辑闭环。

## 后端服务

1. 项目服务：管理项目信息和权限。
2. 布局服务：根据空间参数生成候选平面并执行几何规则校验。
3. 资产服务：管理软装模型、缩略图、尺寸、编号、材质和版本。
4. 分支服务：保存节点快照、父子关系、状态和生成任务。
5. 渲染服务：生成白膜和风格效果图。
6. 文档服务：生成物料清单和 PDF。

## 数据模型草案

### Project

`id`、`name`、`store_type`、`width`、`length`、`height`、`constraints`、`created_at`

### Node

`id`、`project_id`、`parent_id`、`node_type`、`status`、`input_snapshot`、`layout_snapshot`、`style`、`asset_versions`、`outputs`

### Asset

`id`、`name`、`category`、`model_file`、`thumbnail`、`width`、`depth`、`height`、`material_variants`、`version`

### RenderJob

`id`、`node_id`、`style`、`camera_set`、`status`、`progress`、`result_files`、`error`

## 关键工程判断

精确尺寸、碰撞、动线和标准图纸应由参数化规则处理；AI 更适合用于候选方案组合、风格描述、软装推荐和视觉表现。这样可以同时兼顾设计效率和施工可用性。
