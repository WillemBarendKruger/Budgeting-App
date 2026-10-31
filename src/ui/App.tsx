import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import ImportScreen from './screens/ImportScreen'
import Overview from './screens/Overview'

const Stub = ({ title }: { title: string }) => <h1>{title}</h1>

const STUBS: [string, string][] = [
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
          <Route path="import" element={<ImportScreen />} />
          {STUBS.map(([path, title]) => (
            <Route key={path} path={path} element={<Stub title={title} />} />
          ))}
        </Route>
      </Routes>
    </HashRouter>
  )
}
