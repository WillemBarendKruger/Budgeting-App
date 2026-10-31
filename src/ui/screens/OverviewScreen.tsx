import { Link } from 'react-router-dom'
import { formatRand } from '../../domain/money'
import { groupChange, monthSummary } from '../../engine/reports'
import BudgetBar from '../components/BudgetBar'
import Donut from '../components/Donut'
import MoneyText from '../components/MoneyText'
import { useAll, useSelectedMonth } from '../hooks'

const TOP_N = 6
const OTHER_COLOUR = '#9aa6b5'

function Tile({ id, label, cents, neg }: { id: string; label: string; cents: number; neg?: boolean }) {
  return (
    <div className="tile" data-testid={`tile-${id}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{neg ? <span className="money neg">{formatRand(cents)}</span> : <MoneyText cents={cents} />}</div>
    </div>
  )
}

function ChangeBadge({ pct, grew }: { pct: number | null; grew: boolean }) {
  if (pct === null) return null
  const n = Math.round(Math.abs(pct))
  const arrow = pct >= 0 ? '▲' : '▼'
  return grew
    ? <span className="badge badge-warn">{`${arrow} ${n}% vs last month`}</span>
    : <span className="badge muted">{`${arrow} ${n}%`}</span>
}

export default function OverviewScreen() {
  const { txs, accounts, groups, months, ready } = useAll()
  const [month, setMonth] = useSelectedMonth(months)
  if (!ready || !txs || !accounts || !groups) return null
  if (txs.length === 0 || !month) {
    return (
      <>
        <h1>Overview</h1>
        <p><Link className="cta" to="/import">Import your first statement</Link></p>
      </>
    )
  }

  const idx = months.findIndex(m => m.start === month.start)
  const older = months[idx + 1]
  const newer = months[idx - 1]
  const curr = monthSummary(txs, accounts, month)
  const prev = older ? monthSummary(txs, accounts, older) : undefined
  const byId = new Map(groups.map(g => [g.id, g]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  const colourOf = (id: string) => byId.get(id)?.colour ?? OTHER_COLOUR

  const positive = curr.byGroup.filter(g => g.amount > 0)
  const top = positive.slice(0, TOP_N).map(g => ({ id: g.groupId, name: nameOf(g.groupId), value: g.amount, colour: colourOf(g.groupId) }))
  const rest = positive.slice(TOP_N).reduce((s, g) => s + g.amount, 0)
  const slices = rest > 0 ? [...top, { id: '__rest', name: 'Rest', value: rest, colour: OTHER_COLOUR }] : top

  return (
    <>
      <h1>Overview</h1>
      <div className="month-nav">
        <button type="button" aria-label="Previous month" disabled={!older} onClick={() => older && setMonth(older.start)}>{'‹'}</button>
        <strong>{month.label}</strong>
        <button type="button" aria-label="Next month" disabled={!newer} onClick={() => newer && setMonth(newer.start)}>{'›'}</button>
      </div>

      {curr.uncategorisedCount > 0 && (
        <p className="banner">
          <Link to="/sort">
            {curr.uncategorisedCount} {curr.uncategorisedCount === 1 ? 'transaction needs' : 'transactions need'} a group
          </Link>
        </p>
      )}

      <div className="tiles">
        <Tile id="in" label="In" cents={curr.in} />
        <Tile id="out" label="Out" cents={curr.out} />
        <Tile id="saved" label="Saved" cents={curr.saved} neg={curr.saved < 0} />
        <Tile id="unplanned" label="Unplanned" cents={curr.unplanned} />
        <Tile id="moved" label="Moved to savings" cents={curr.movedToSavings} />
      </div>

      {slices.length > 0 && (
        <div className="card donut-card">
          <Donut slices={slices} label="Spending by group, see the ranked list below" />
          <ul className="legend">
            {slices.map(s => (
              <li key={s.id}><span className="swatch" style={{ background: s.colour }} />{s.name}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="group-list">
        {curr.byGroup.map(g => {
          const budget = byId.get(g.groupId)?.budget
          const ch = groupChange(curr, prev, g.groupId)
          return (
            <li key={g.groupId}>
              <Link className="group-row" to={`/transactions?group=${encodeURIComponent(g.groupId)}&month=${month.start}`}>
                <span className="swatch" style={{ background: colourOf(g.groupId) }} />
                <span className="group-name">{nameOf(g.groupId)}</span>
                <MoneyText cents={g.amount} />
                <ChangeBadge pct={ch.pct} grew={ch.grew} />
                {budget !== undefined && g.amount >= 0 && <BudgetBar spent={g.amount} budget={budget} />}
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
