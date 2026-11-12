import type { ReactNode, SVGProps } from 'react'
import type { ItemFunction } from '@store/shared'
import { Shapes } from 'lucide-react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

/**
 * Store-specific line icons that lucide does not have, drawn on lucide's grid (24 units, stroke 2,
 * round caps and joins) so they sit next to lucide icons without looking different. Design sheet:
 * docs/design-system.md「页面图标」(user, 2026-11-12).
 */
function Base({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Stage 空间: three walls seen from above, the gap at the bottom is the entrance (the brand mark). */
export function SpaceIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 20H4V4h16v16h-5" />
    </Base>
  )
}

/** Stage 方案: the same shop with two tables in it. */
export function PlanIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 20H4V4h16v16h-5" />
      <rect x="7.5" y="7.5" width="3" height="6.5" rx="0.5" />
      <rect x="13.5" y="7.5" width="3" height="6.5" rx="0.5" />
    </Base>
  )
}

/** Stage 三维效果: the inside corner of a room (two walls and the floor). */
export function WhiteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 16.5v-9L12 3l9 4.5v9L12 21z" />
      <path d="M12 3v9M3 16.5 12 12l9 4.5" />
    </Base>
  )
}

/** Stage 渲染: a viewfinder with the lens in the middle. */
export function RenderIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
      <circle cx="12" cy="12" r="4" />
    </Base>
  )
}

/** 展陈: a table top seen from above with its tray slots. */
export function DisplayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M9 6v12M15 6v12M3 12h18" />
    </Base>
  )
}

/** View 平面: a plan with a dimension line above it. */
export function PlanViewIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="8" width="16" height="12" rx="1" />
      <path d="M4 4h16M4 3v2M20 3v2" />
    </Base>
  )
}

/** 外观 材质: a sphere with its shaded side. */
export function MaterialIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18 12 12 0 0 0 0-18z" />
      <path d="M7.5 8a5.5 5.5 0 0 1 3-2.2" />
    </Base>
  )
}

/** 显示间距: two walls and the clear distance between them. */
export function SpacingIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 5v14M20 5v14" />
      <path d="M7.5 12h9M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" />
    </Base>
  )
}

/** 画空心隔板: a hollow partition, drawn as a long box with its hollow core dotted. */
export function PartitionIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="9" width="18" height="6" rx="1" />
      <path d="M7 12h10" strokeDasharray="0.5 3.5" />
    </Base>
  )
}

/* ---- Prop categories of the catalog (12 display categories, 2026-11-12). ---- */

/** 中岛桌: a table with the trays on top. */
export function IslandTableIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="10" width="18" height="2.5" rx="0.5" />
      <path d="M5 12.5V20M19 12.5V20" />
      <rect x="6.5" y="5.5" width="3.5" height="4.5" rx="0.5" />
      <rect x="14" y="6.5" width="3.5" height="3.5" rx="0.5" />
    </Base>
  )
}

/** 开箱桌: a table with a shelf below and a box on top. */
export function UnboxingTableIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="9.5" width="18" height="2.5" rx="0.5" />
      <path d="M5 12v8M19 12v8M5 16.5h14" />
      <path d="M9 9.5v-3h6v3" />
    </Base>
  )
}

/** 收银: a counter with a screen on it. */
export function CashierIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="12" width="18" height="8" rx="1" />
      <path d="M14.5 12V9.5M6 15.5h5" />
      <rect x="11" y="4" width="7" height="5.5" rx="1" />
    </Base>
  )
}

/** 配件柜: a tall cabinet with shelves. */
export function AccessoryCabinetIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M5 9h14M5 15h14" />
      <path d="M9 5.5V7M15 5.5V7M9 11.5V13M15 11.5V13M9 17.5V19M15 17.5V19" />
    </Base>
  )
}

/** 配件边柜: a low cabinet. */
export function SideCabinetIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 10.5V6h14v4.5" />
      <rect x="3" y="10.5" width="18" height="2.5" rx="0.5" />
      <path d="M4.5 13v7h15v-7M12 13v7" />
    </Base>
  )
}

/** 展示台: a small stand with a product on it. */
export function DisplayStandIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6" y="12" width="12" height="2.5" rx="0.5" />
      <path d="M7 14.5V21h10v-6.5M12 10v2" />
      <rect x="9.5" y="4.5" width="5" height="5.5" rx="1" />
    </Base>
  )
}

/** 屏幕: a display on a stand. */
export function ScreenIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6.5" y="2.5" width="11" height="15" rx="1.5" />
      <path d="M12 17.5V21M8.5 21h7" />
    </Base>
  )
}

/** 灯箱: a lit picture box. */
export function LightboxIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="7" width="16" height="10" rx="1" />
      <rect x="8" y="10.5" width="8" height="3" rx="0.5" />
      <path d="M2 4l2 1.5M22 4l-2 1.5M2 20l2-1.5M22 20l-2-1.5" />
    </Base>
  )
}

/** 标识: a wall plate with a logo and text. */
export function SignageIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
      <path d="M7.5 9.5h4.5M7.5 12h4.5M7.5 14.5h2.5" />
      <path d="M13.5 10.5 16.5 12l-3 1.5" />
    </Base>
  )
}

/** 坐凳: a bench. */
export function SeatingIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="9" width="16" height="4" rx="1" />
      <path d="M6 13v7M18 13v7" />
    </Base>
  )
}

/** 储物柜: a locker with doors. */
export function StorageIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M5 9h14M5 15h14M11 6h2M11 12h2M11 18h2" />
    </Base>
  )
}

const CATEGORY_ICONS: Record<ItemFunction, (props: IconProps) => ReactNode> = {
  island_table: IslandTableIcon,
  unboxing_table: UnboxingTableIcon,
  cashier: CashierIcon,
  accessory_cabinet: AccessoryCabinetIcon,
  side_cabinet: SideCabinetIcon,
  display_stand: DisplayStandIcon,
  screen: ScreenIcon,
  signage: SignageIcon,
  seating: SeatingIcon,
  storage: StorageIcon,
  other: (props: IconProps) => <Shapes {...props} />,
}

/**
 * The icon for one catalog item. Function 'signage' is shown in the UI as two categories:
 * 灯箱 (the name says so) and 标识 (everything else, mostly LOGO plates).
 */
export function ItemFunctionIcon({
  fn,
  name,
  size = 16,
  ...rest
}: { fn: ItemFunction; name?: string } & IconProps) {
  const Icon =
    fn === 'signage' && name?.includes('灯箱') ? LightboxIcon : (CATEGORY_ICONS[fn] ?? Shapes)
  return <Icon size={size} {...rest} />
}
