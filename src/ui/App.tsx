import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import BudgetsScreen from './screens/BudgetsScreen'
import ImportScreen from './screens/ImportScreen'
import Overview from './screens/OverviewScreen'
import RulesScreen from './screens/RulesScreen'
import SettingsScreen from './screens/SettingsScreen'
import SortScreen from './screens/SortScreen'
import SubscriptionsScreen from './screens/SubscriptionsScreen'
import TransactionsScreen from './screens/TransactionsScreen'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="import" element={<ImportScreen />} />
          <Route path="transactions" element={<TransactionsScreen />} />
          <Route path="sort" element={<SortScreen />} />
          <Route path="budgets" element={<BudgetsScreen />} />
          <Route path="subscriptions" element={<SubscriptionsScreen />} />
          <Route path="rules" element={<RulesScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
