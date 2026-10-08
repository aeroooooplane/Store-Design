# GitHub 相关项目调研

历史研究归档；不是当前依赖清单。当前入口见 [项目目录指南](../../README.md)。未在本次整理中重新核验外部项目状态。

调研目标是寻找可以复用的编辑器、布局规则、三维资产处理和渲染流程。以下项目是参考或组件候选，不代表可以直接复制到生产系统。正式采用前需要再次确认仓库当前许可证、依赖安全和维护状态。

## 优先参考

### 1. Home_View / Home3D

仓库：https://github.com/lohith9/Home_View

适合参考二维平面与三维场景的同步方式。项目使用 React、Three.js 和 Zustand，包含墙体吸附、门窗附着、家具拖拽、碰撞检测、参数化依赖、二维/三维同步以及跨视图撤销重做。它的设计思想与我们的软装调整器最接近：二维和三维都操作同一个空间数据模型，而不是分别维护两套状态。

建议吸收：空间数据结构、碰撞和吸附逻辑、二维/三维同步、历史快照。

注意：仓库规模较小，不能直接当作生产基础；商业使用前需要确认仓库许可证。

### 2. RoomCraft

仓库：https://github.com/SHAYAN-ABRAR/RoomCraft

该项目采用 MIT 许可证，使用 React、React Three Fiber、Three.js、Zustand 和 Ollama。功能包括毫米级单位、软装拖拽、材质切换、风格预设、碰撞检测、门窗净空检查、动线分析、2D/3D/漫游视图以及 CSV 物料清单导出。

建议吸收：软装资产面板、属性编辑器、真实尺寸单位、风格切换、空间检查和物料清单导出思路。

注意：它面向家居房间，不能直接满足影石门店的区域规则和 SI1.0/SI2.0 资产体系。

### 3. Three.js Sims-like House Builder

仓库：https://github.com/ch-bas/threejs-sims-house-builder

适合参考游戏化的软装编辑交互，包括网格吸附、拖拽放置、锁定、精确位置和尺寸、多选、对齐、分布、分类素材库以及主题预设。它强调轻量化的浏览器端体验。

建议吸收：游戏化编辑器交互、素材分类、锁定和多选操作、二维/三维操作反馈。

注意：仓库页面未明确展示适合商业复用的许可证，采用代码前必须确认许可证。

## 按模块参考

### 分支树和节点画布：React Flow

仓库：https://github.com/xyflow/xyflow

React Flow 是 MIT 许可证的 React 节点编辑库，支持缩放、平移、多选、节点和边、自定义节点、MiniMap 和快捷键。它适合呈现我们的“项目根节点 → 四个平面方案 → 调整版本 → SI1.0/SI2.0 → 白膜 → 效果图”分支树。

建议采用 `@xyflow/react` 做可视化层，节点快照和生成任务仍由我们自己的后端保存。

### 道具模型清理和 Web 导出：Blender Game Asset Pipeline

仓库：https://github.com/ruykin/blender-asset-pipeline

该项目采用 MIT 许可证，提供 Blender 无头处理、PBR 材质烘焙、LOD 链、三角面数控制和 GLB 导出。它适合帮助我们把 1.08GB 的 SketchUp 通用模型拆分为可在网页按需加载的道具资产。

建议吸收：命名规范、GLB 导出、LOD、材质贴图打包、模型质量检查。

注意：它面向游戏资产，仍需要为影石道具补充真实尺寸、道具编号、类别、SI 风格材质变体和物料信息。

### 平面生成优化：floorplan-optimizer

仓库：https://github.com/rainon-feroze/floorplan-optimizer

使用遗传算法、DEAP 和 Shapely，根据采光、动线、区域邻接和疏散等目标优化二维平面。可以参考其“候选布局 + 评分 + 迭代优化”的思路。

建议吸收：布局评分函数和候选方案排序方法。

不建议直接作为第一版核心：它针对住宅平面，影石门店应先建立自己的展示区、体验区、收银区、仓储区和通道约束。

### 从图像恢复平面：Floor-SP

仓库：https://github.com/woodfrog/floor-sp

这是 ICCV 2019 的研究代码，使用房间分割、边缘预测和逐房间最短路径优化，从图像恢复平面结构。

建议用途：未来处理手绘图或扫描图时作为研究参考。

当前不建议接入：依赖较旧的 Python/PyTorch 环境，且我们的主要输入是已有门店图纸和尺寸，不是从室内照片恢复平面。

### 大规模场景生成和阶段缓存：SceneSmith

仓库：https://github.com/nepfaff/scenesmith

它把室内场景生成拆成 floor_plan、furniture、wall_mounted、ceiling_mounted 和小物件等阶段，并支持保存中间状态、从中间状态恢复以及从同一检查点创建多个分支。

建议吸收：阶段化任务、断点恢复、从共享白膜检查点生成 SI1.0/SI2.0 分支的思路。

不建议第一阶段直接部署：依赖 Blender、Docker、GPU 和较复杂的研究环境，系统规模明显大于我们的首个闭环。

## 对我们的技术路线建议

第一版不建议寻找一个“全能项目”直接改造。更稳妥的组合是：

```text
React + React Three Fiber + Zustand
        ├── 2D/3D空间编辑：参考 Home_View、RoomCraft
        ├── 节点分支树：使用 React Flow
        ├── 道具资产转换：Blender + GLB/LOD流程
        ├── 平面方案排序：自建影石门店规则评分
        └── 渲染任务：先用固定机位和缓存，再接入批量渲染
```

优先级建议：先验证 Home_View/RoomCraft 的编辑器结构，再实现 React Flow 节点树，随后处理第一批影石道具；Floor-SP、SceneSmith 和高级自动布局算法放到后续研究阶段。
