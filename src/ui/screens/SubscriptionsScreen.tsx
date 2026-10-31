import { db } from '../../db/db'
import { detectSubscriptions } from '../../engine/subscriptions'
import MoneyText from '../components/MoneyText'
import { useAll } from '../hooks'

export default function SubscriptionsScreen() {
  const { txs, months, settings, ready } = useAll()
  if (!ready || !txs || !settings) return null
  const subs = detectSubscriptions(txs, months, settings.dismissedSubscriptions)
  const total = subs.reduce((s, x) => s + x.yearly, 0)

  async function dismiss(payee: string) {
    const current = (await db.settings.get('settings'))?.dismissedSubscriptions ?? []
    if (!current.includes(payee)) await db.settings.update('settings', { dismissedSubscriptions: [...current, payee] })
  }

  return (
    <>
      <h1>Subscriptions</h1>
      {subs.length === 0
        ? <p className="muted">No recurring payments detected yet.</p>
        : (
          <>
            <p data-testid="yearly-total">Total per year: <strong><MoneyText cents={total} /></strong></p>
            <ul className="group-list">
              {subs.map(s => (
                <li key={s.payee} className="group-row">
                  <span className="group-name">{s.payee}<br /><small className="muted">{s.months} months, last {s.lastDate}</small></span>
                  <span><MoneyText cents={s.monthly} /> / month</span>
                  <span className="muted"><MoneyText cents={s.yearly} /> / year</span>
                  <button type="button" onClick={() => void dismiss(s.payee)}>Not a subscription</button>
                </li>
              ))}
            </ul>
          </>
        )}
    </>
  )
}
