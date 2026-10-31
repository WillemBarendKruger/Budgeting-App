import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import Overview from './screens/Overview'

const Stub = ({ title }: { title: string }) => <h1>{title}</h1>

const STUBS: [string, string][] = [
  ['import', 'Import'],
  ['transactions', 'Transactions'],
  ['sort', 'Sort'],
  ['budgets', 'Budgets'],
  ['subscriptions', 'Subscriptions'],
  ['rules', 'Rules'],
  ['settings', 'Settings'],
]

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          {STUBS.map(([path, title]) => (
            <Route key={path} path={path} element={<Stub title={title} />} />
          ))}
        </Route>
      </Routes>
    </HashRouter>
  )
}
