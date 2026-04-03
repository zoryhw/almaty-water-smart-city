import { formatNumber } from '../utils/analysis'

export function SystemSummary({ districts, activeDistrict, getDistrictSnapshot }) {
  const totalIncidents = districts.reduce(
    (sum, district) => sum + getDistrictSnapshot(district).overview.incidents,
    0,
  )
  const avgPressure =
    districts.reduce((sum, district) => sum + getDistrictSnapshot(district).overview.pressure, 0) /
    districts.length
  const avgWater =
    districts.reduce((sum, district) => sum + getDistrictSnapshot(district).overview.waterLevel, 0) /
    districts.length

  return (
    <section className="summary-strip">
      <div className="summary-item">
        <span>Среднее давление по городу</span>
        <strong>{avgPressure.toFixed(1)} bar</strong>
      </div>
      <div className="summary-item">
        <span>Средний запас воды</span>
        <strong>{avgWater.toFixed(0)}%</strong>
      </div>
      <div className="summary-item">
        <span>Всего активных аварий</span>
        <strong>{formatNumber(totalIncidents)} шт</strong>
      </div>
      <div className="summary-item">
        <span>Фокус диспетчера</span>
        <strong>{activeDistrict}</strong>
      </div>
    </section>
  )
}
