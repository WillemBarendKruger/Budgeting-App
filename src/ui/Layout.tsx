import { NavLink, Outlet } from 'react-router-dom'

const LINKS: [string, string][] = [
  ['/', 'Overview'],
  ['/import', 'Import'],
  ['/transactions', 'Transactions'],
  ['/sort', 'Sort'],
  ['/budgets', 'Budgets'],
  ['/subscriptions', 'Subscriptions'],
  ['/rules', 'Rules'],
  ['/settings', 'Settings'],
]

export default function Layout() {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        {LINKS.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>
        ))}
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  )
}
