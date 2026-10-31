import { Cell, Pie, PieChart } from 'recharts'

export interface DonutSlice { id: string; name: string; value: number; colour: string }

const SIZE = 180

/** Fixed-size donut (ResponsiveContainer measures 0 in jsdom). The ranked list beside it is the text alternative. */
export default function Donut({ slices, label }: { slices: DonutSlice[]; label: string }) {
  return (
    <div className="donut" role="img" aria-label={label}>
      <PieChart width={SIZE} height={SIZE}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={85}
          stroke="none"
          isAnimationActive={false}
        >
          {slices.map(s => <Cell key={s.id} fill={s.colour} />)}
        </Pie>
      </PieChart>
    </div>
  )
}
