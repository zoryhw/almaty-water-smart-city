export function DistrictMap({ districts, activeDistrict, onSelectDistrict, getDistrictTone }) {
  return (
    <section className="panel district-panel">
      <div className="panel-header">
        <h3>Районы Алматы</h3>
        <p>Выбор района обновляет KPI, графики и AI-анализ</p>
      </div>

      <div className="district-grid">
        {districts.map((district) => {
          const tone = getDistrictTone(district)
          const isActive = activeDistrict === district

          return (
            <button
              key={district}
              className={`district-card tone-${tone} ${isActive ? 'active' : ''}`}
              onClick={() => onSelectDistrict(district)}
              type="button"
            >
              <span>{district}</span>
              <small>{tone === 'critical' ? 'Высокий риск' : tone === 'warning' ? 'Нужен контроль' : 'Стабильно'}</small>
            </button>
          )
        })}
      </div>
    </section>
  )
}
