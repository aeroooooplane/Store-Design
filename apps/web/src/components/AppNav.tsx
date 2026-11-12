import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Boxes, ChevronDown, FolderKanban, Settings } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'

const LINKS = [
  { to: '/display', label: '展陈方案', icon: Boxes },
  { to: '/settings', label: '设置', icon: Settings },
]

const ProjectNavContext = createContext<{
  actions: HTMLDivElement | null
  info: HTMLDivElement | null
} | null>(null)

export function ProjectNavSlot({
  slot,
  children,
}: {
  slot: 'actions' | 'info'
  children: ReactNode
}) {
  const nav = useContext(ProjectNavContext)
  if (!nav) return slot === 'info' ? children : null
  const host = nav[slot]
  return host ? createPortal(children, host) : null
}

/** Top bar shared by every page: brand mark and the three top-level sections. */
export function AppLayout() {
  const project = useMatch('/projects/:projectId')
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const [info, setInfo] = useState<HTMLDivElement | null>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    // Export is portaled from the project page. Native listeners include its DOM events.
    function closeOutside(event: PointerEvent) {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target))
        menu.current.open = false
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !menu.current?.open) return
      menu.current.open = false
      menu.current.querySelector('summary')?.focus()
    }
    function closeOnLink(event: MouseEvent) {
      if (event.target instanceof Element && menu.current?.contains(event.target.closest('a')))
        menu.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('click', closeOnLink)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('click', closeOnLink)
    }
  }, [])
  return (
    <ProjectNavContext.Provider value={{ actions, info }}>
      <nav className={project ? 'app-nav app-nav-project' : 'app-nav'} aria-label="主导航">
        {/* The name stays readable when narrow screens hide the text next to the logo. */}
        <NavLink to="/" className="app-brand" end aria-label="门店空间设计工作台">
          <img
            className="app-logo"
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={28}
            height={28}
          />
          <span className="app-brand-name">门店空间设计工作台</span>
        </NavLink>
        <div className="app-nav-links">
          {project ? (
            <details
              ref={menu}
              className="app-project-menu"
              key={project.params.projectId}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.open = false
              }}
            >
              <summary className="app-nav-link active" aria-label="项目">
                <FolderKanban size={15} aria-hidden="true" />
                <span className="app-nav-label">项目</span>
                <ChevronDown size={12} aria-hidden="true" />
              </summary>
              <div className="app-project-menu-content">
                <Link to="/">项目列表</Link>
                <div ref={setActions} />
              </div>
            </details>
          ) : (
            <NavLink to="/" end className="app-nav-link" aria-label="项目">
              <FolderKanban size={15} aria-hidden="true" />
              <span className="app-nav-label">项目</span>
            </NavLink>
          )}
          {LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} aria-label={label} className="app-nav-link">
              <Icon size={15} aria-hidden="true" />
              <span className="app-nav-label">{label}</span>
            </NavLink>
          ))}
        </div>
        {project && <div className="app-project-info" ref={setInfo} />}
      </nav>
      <Outlet />
    </ProjectNavContext.Provider>
  )
}
