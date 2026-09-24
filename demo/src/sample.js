// Coordinates in metres. Dimension-chain reconstruction, not a CAD import.
export const realSample = {
 name:'上海星光摄影城 · 图纸复现草案',
 source:{file:'上海星光摄影城照材专卖店.pdf',page:1,drawing:'PL-03',date:'2025.06',style:'灰白表现，SI版本待品牌确认',statedArea:23.7,notes:'图纸边界尺寸4.8×5.15m，包络面积24.72㎡与标注23.7㎡不同，不等同净面积。层高3.2m为演示假设；中岛深度1m、边柜深度0.5m待道具模型核对。体验桌底座参考效果图可见形态；开箱桌四腿、配件柜层板和板厚均为演示假设。结构占位为图纸重建，尚未接入真实SKP。'},
 room:{w:4.8,d:5.15,h:3.2,shopType:'边厅店'},
 items:[
 {id:'s03-accessory-1',name:'1.8米边桌配件柜',type:'display',x:.95,z:.1,w:1.8,d:.5,h:.9},
 {id:'s03-accessory-2',name:'1.8米边桌配件柜',type:'display',x:2.75,z:.1,w:1.8,d:.5,h:.9},
 {id:'s03-cashier',name:'1.8米边收银台',type:'counter',x:.13,z:.8,w:.5,d:1.8,h:.9},
 {id:'s03-unbox',name:'1.8米开箱桌',type:'table',x:.13,z:2.6,w:.5,d:1.8,h:.9},
 {id:'s03-go',name:'1.8米go系列中岛桌',type:'table',profile:'pedestal-table',x:1.77,z:1.61,w:1.8,d:1,h:.9},
 {id:'s03-x',name:'1.8米X系列中岛桌',type:'table',profile:'pedestal-table',x:1.77,z:3.56,w:1.8,d:1,h:.9},
 {id:'s03-block-back',name:'后侧结构占位',type:'structure',x:0,z:0,w:.9,d:.39,h:3.2},
 {id:'s03-block-front',name:'入口结构占位',type:'structure',x:0,z:4.47,w:1,d:.68,h:3.2},
 ]
}
