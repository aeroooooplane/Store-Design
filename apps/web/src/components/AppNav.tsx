import { Boxes, FolderKanban, Settings } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'

const LINKS = [
  { to: '/', label: '项目', icon: FolderKanban, end: true, also: '/projects/' },
  { to: '/display', label: '展陈方案', icon: Boxes, end: false, also: '' },
  { to: '/settings', label: '设置', icon: Settings, end: false, also: '' },
]

/** Top bar shared by every page: brand mark and the three top-level sections. */
export function AppLayout() {
  const { pathname } = useLocation()
  return (
    <>
      <nav className="app-nav" aria-label="主导航">
        <NavLink to="/" className="app-brand" end>
          <span className="app-logo" aria-hidden="true">
            门
          </span>
          <span>门店空间设计工作台</span>
        </NavLink>
        <span className="app-nav-links">
          {LINKS.map(({ to, label, icon: Icon, end, also }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive || (also !== '' && pathname.startsWith(also))
                  ? 'app-nav-link active'
                  : 'app-nav-link'
              }
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </span>
      </nav>
      <Outlet />
    </>
  )
}
