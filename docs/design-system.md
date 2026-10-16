# 网页视觉规范

更新：2026-10-16。采用“影石品牌”方向（用户选定方案 B）：墨黑 + 品牌黄 `#FFD200`（取自 insta360.com/cn 样式表中出现最多的亮黄），暖灰白底，字体 Inter（数字/英文，`@fontsource-variable/inter` 自托管）+ 系统中文字体，图标用 lucide-react。更早的柔和石板蓝主题已被取代。

## 视觉规则

- 暖灰白底、白色卡片、墨黑文字；品牌黄只作填充与指示（选中底色、Logo、按钮上的文字色），不作白底上的文字色。主按钮为黑底黄字。
- 顶栏（`components/AppNav.tsx`）为所有页面共用：品牌标识 + 项目/展陈方案/设置。
- 无衬线字体；标题、表单和卡片左对齐。
- 按钮、输入框 8 px 圆角，卡片 14 px；主要操作用 `--accent`（墨黑）；状态色成对（`--ok`/`--ok-soft`、`--warn`/`--warn-soft`、`--danger`/`--danger-soft`）。间距取 4 的倍数，字号阶梯 12/13/14/16/22。
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
