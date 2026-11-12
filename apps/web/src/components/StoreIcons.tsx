import type { ReactNode, SVGProps } from 'react'

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
