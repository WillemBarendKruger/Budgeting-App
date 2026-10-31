import { formatRand } from '../../domain/money'

export default function MoneyText({ cents, colourBySign }: { cents: number; colourBySign?: boolean }) {
  const cls = colourBySign ? (cents < 0 ? 'money neg' : cents > 0 ? 'money pos' : 'money') : 'money'
  return <span className={cls}>{formatRand(cents)}</span>
}
