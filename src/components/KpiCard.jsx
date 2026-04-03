export function KpiCard({ title, value, unit, status, helper }) {
  return (
    <article className={`kpi-card tone-${status.tone}`}>
      <div className="kpi-head">
        <span>{title}</span>
        <span className={`status-pill tone-${status.tone}`}>{status.label}</span>
      </div>
      <div className="kpi-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      <p>{helper}</p>
    </article>
  )
}
