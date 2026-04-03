export function Header({ district, emergencyActive, onToggleEmergency }) {
  return (
    <header className="hero-panel">
      <div>
        <span className="eyebrow">Smart City Management Dashboard</span>
        <h1>Мониторинг водоснабжения Алматы</h1>
        <p className="hero-copy">
          MVP-прототип для диспетчерского центра: контроль KPI, проблемных районов,
          аварийных сценариев и рекомендаций для управленцев в одном интерфейсе.
        </p>
      </div>

      <div className="hero-actions">
        <div className="active-district-card">
          <span className="label">Активный район</span>
          <strong>{district}</strong>
        </div>
        <button className="primary-button" onClick={onToggleEmergency} type="button">
          {emergencyActive ? 'Сбросить сценарий' : 'Симулировать аварию'}
        </button>
      </div>
    </header>
  )
}
