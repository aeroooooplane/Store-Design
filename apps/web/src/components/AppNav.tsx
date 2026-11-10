import { createContext, useContext, useState } from 'react'
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
  return (
    <ProjectNavContext.Provider value={{ actions, info }}>
      <nav className={project ? 'app-nav app-nav-project' : 'app-nav'} aria-label="主导航">
        <NavLink to="/" className="app-brand" end>
          <span className="app-logo" aria-hidden="true">
            门
          </span>
          <span className="app-brand-name">门店空间设计工作台</span>
        </NavLink>
        <div className="app-nav-links">
          {project ? (
            <details
              className="app-project-menu"
              key={project.params.projectId}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.open = false
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && event.currentTarget.open) {
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary')?.focus()
                }
              }}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('a'))
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
