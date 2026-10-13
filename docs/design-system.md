# 网页视觉规范

更新：2026-10-13。起点是瑞士风格的黑白界面，2026-10-10 按用户要求改为柔和配色与圆角（更浅的灰、低饱和的石板蓝强调色）。

## 视觉规则

- 浅底深字，灰色用于次级文字、边框和辅助区域；页面结构通过网格、留白和字体层级表达。
- 无衬线字体；标题、表单和卡片左对齐。
- 按钮、输入框、卡片使用小圆角和细边框；主要操作用强调色 `--accent`。
- 错误同时提供文字和语义提示，不只依赖颜色；保持可见的键盘焦点，窄屏重新排布，避免横向溢出。
- 模型照片、原始图纸和三维材质保留真实颜色。SI 标准与网页主题是两个独立层面：主题改动不改变模型材质、尺寸或 SI 判断。

## 维护入口

| 内容 | 位置 |
|---|---|
| 主题变量（颜色、圆角、阴影、字体、间距） | `apps/web/src/styles/tokens.css` |
| 全局与页面框架 | `apps/web/src/styles/app.css` |
| 工作台布局 | `apps/web/src/styles/workbench.css` |
| 历史树样式 | `apps/web/src/features/workbench/tree-layout.ts` 的 `TREE_STYLE` |
| 三维渲染外观（按 SI 手册） | `apps/web/src/features/viewer3d/render-look.ts` 的 `RENDER_LOOK` |
| 导出的平面 SVG／PNG（内嵌印刷色，离开网页也能正确显示） | `apps/web/src/features/workbench/plan-export.ts` |

不要在组件里另写一套主题颜色；新增颜色先加到 `tokens.css`。
