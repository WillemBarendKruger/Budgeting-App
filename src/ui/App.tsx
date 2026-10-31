import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import ImportScreen from './screens/ImportScreen'
import Overview from './screens/OverviewScreen'
import SortScreen from './screens/SortScreen'
import TransactionsScreen from './screens/TransactionsScreen'

const Stub = ({ title }: { title: string }) => <h1>{title}</h1>

const STUBS: [string, string][] = [
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
          <Route path="transactions" element={<TransactionsScreen />} />
          <Route path="sort" element={<SortScreen />} />
          {STUBS.map(([path, title]) => (
            <Route key={path} path={path} element={<Stub title={title} />} />
          ))}
        </Route>
      </Routes>
    </HashRouter>
  )
}
