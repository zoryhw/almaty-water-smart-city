import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function ChartCard({ title, children }) {
  return (
    <article className="panel chart-card">
      <div className="panel-header">
        <h3>{title}</h3>
      </div>
      <div className="chart-wrap">{children}</div>
    </article>
  )
}

export function ChartsPanel({ trends }) {
  return (
    <section className="charts-grid">
      <ChartCard title="Потребление воды">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trends.consumption}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d9eaf7" />
            <XAxis dataKey="time" stroke="#6f8da6" />
            <YAxis stroke="#6f8da6" />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#1f8ef1" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Давление">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trends.pressure}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d9eaf7" />
            <XAxis dataKey="time" stroke="#6f8da6" />
            <YAxis stroke="#6f8da6" />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#46b8c8" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Аварии">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trends.incidents}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d9eaf7" />
            <XAxis dataKey="time" stroke="#6f8da6" />
            <YAxis stroke="#6f8da6" />
            <Tooltip />
            <Bar dataKey="value" fill="#ff7b7b" radius={[10, 10, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  )
}
