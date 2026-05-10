import { Link } from '@tanstack/react-router'

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2 className="sidebar-title">Timeline</h2>
      </div>
      <nav className="sidebar-nav">
        <Link to="/" className="sidebar-link" activeProps={{ className: 'sidebar-link active' }}>
          Sessions
        </Link>
      </nav>
    </aside>
  )
}