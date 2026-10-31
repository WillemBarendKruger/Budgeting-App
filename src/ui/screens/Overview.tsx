import { Link } from 'react-router-dom'
import { useAll } from '../hooks'

export default function Overview() {
  const { txs, ready } = useAll()
  if (!ready || !txs) return null
  return (
    <>
      <h1>Overview</h1>
      {txs.length === 0 && (
        <p><Link className="cta" to="/import">Import your first statement</Link></p>
      )}
    </>
  )
}
