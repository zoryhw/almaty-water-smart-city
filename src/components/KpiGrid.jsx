import { KpiCard } from './KpiCard'
import { formatNumber } from '../utils/analysis'

export function KpiGrid({ overview, statuses }) {
  const cards = [
    {
      title: 'Уровень воды',
      value: overview.waterLevel,
      unit: '%',
      status: statuses.waterLevel,
      helper: 'Запас в распределительной системе',
    },
    {
      title: 'Давление',
      value: overview.pressure,
      unit: 'bar',
      status: statuses.pressure,
      helper: 'Среднее давление по району',
    },
    {
      title: 'Аварии',
      value: overview.incidents,
      unit: 'шт',
      status: statuses.incidents,
      helper: 'Количество активных инцидентов',
    },
    {
      title: 'Потребление воды',
      value: formatNumber(overview.consumption),
      unit: 'м³',
      status: statuses.consumption,
      helper: 'Текущее суммарное потребление',
    },
    {
      title: 'Качество воды',
      value: overview.quality,
      unit: 'инд.',
      status: statuses.quality,
      helper: 'Интегральный индекс качества',
    },
  ]

  return (
    <section className="kpi-grid">
      {cards.map((card) => (
        <KpiCard key={card.title} {...card} />
      ))}
    </section>
  )
}
