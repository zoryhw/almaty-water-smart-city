export function AiInsights({ insight, emergencyActive }) {
  return (
    <section className={`panel ai-panel ${emergencyActive ? 'is-emergency' : ''}`}>
      <div className="panel-header">
        <h3>AI Анализ</h3>
        <span className="ai-badge">{emergencyActive ? 'Emergency Mode' : 'Live Insight'}</span>
      </div>

      <div className="ai-summary">{insight.summary}</div>

      <div className="ai-points">
        <article>
          <span>1. Что происходит</span>
          <p>{insight.situation}</p>
        </article>
        <article>
          <span>2. Насколько критично</span>
          <p>{insight.criticality}</p>
        </article>
        <article>
          <span>3. Что делать</span>
          <p>{insight.action}</p>
        </article>
      </div>
    </section>
  )
}
