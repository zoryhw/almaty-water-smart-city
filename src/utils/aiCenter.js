import { analyzeSnapshot, formatNumber, getToneLabel } from './analysis'
import { resolveApiUrl } from './api'
import { getSuggestedOperations, operationCatalog } from './operations'

const severityRank = {
  critical: 3,
  warning: 2,
  normal: 1,
}

const stopWords = new Set([
  'и',
  'в',
  'во',
  'на',
  'по',
  'о',
  'об',
  'про',
  'для',
  'как',
  'что',
  'это',
  'есть',
  'ли',
  'а',
  'но',
  'или',
  'с',
  'со',
  'к',
  'ко',
  'у',
  'от',
  'до',
  'над',
  'под',
  'из',
  'за',
  'не',
  'нужно',
  'мне',
  'текущее',
  'текущий',
  'покажи',
])

export const GEMINI_CHAT_DEFAULTS = {
  model: 'gemini-2.5-flash',
  grounding: 'google-search',
  publicFeed: 'open-meteo',
}

function tokenize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-zа-я0-9\s-]/gi, ' ')
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token))
}

function scoreAgainstQuery(queryTokens, text, tags = []) {
  const haystack = `${text} ${tags.join(' ')}`.toLowerCase()

  return queryTokens.reduce((score, token) => {
    if (haystack.includes(token)) {
      return score + (token.length > 5 ? 3 : 2)
    }

    return score
  }, 0)
}

function createKnowledgeItem({ id, title, content, tags = [], source, tone = 'normal' }) {
  return {
    id,
    title,
    content,
    tags,
    source,
    tone,
  }
}

function buildTrendNote(series, positiveLabel, negativeLabel, unit = '') {
  const first = series[0]?.value ?? 0
  const last = series[series.length - 1]?.value ?? 0
  const delta = Number((last - first).toFixed(1))

  if (delta > 0) {
    return `${positiveLabel} на ${delta}${unit}.`
  }

  if (delta < 0) {
    return `${negativeLabel} на ${Math.abs(delta)}${unit}.`
  }

  return 'Динамика без выраженного отклонения.'
}

function trimContent(text, max = 170) {
  if (text.length <= max) {
    return text
  }

  return `${text.slice(0, max - 1).trim()}…`
}

function includesAny(text, values) {
  return values.some((value) => text.includes(value))
}

function buildDistrictRanking(districtSnapshots) {
  return Object.entries(districtSnapshots)
    .map(([district, snapshot]) => ({
      district,
      snapshot,
      analysis: analyzeSnapshot(snapshot),
    }))
    .sort((left, right) => right.analysis.riskScore - left.analysis.riskScore)
}

function buildOperationsSummary(analysis) {
  return getSuggestedOperations(analysis)
    .map((actionId) => operationCatalog[actionId])
    .filter(Boolean)
}

export function buildAiKnowledgeBase(context, districtSnapshots, operationsLog = []) {
  const { district, snapshot, analysis, city, briefing, activeScenario, viewMode, telemetry, cityTelemetry, automation } = context
  const ranking = buildDistrictRanking(districtSnapshots)
  const topDistricts = ranking.slice(0, 4)

  const items = [
    createKnowledgeItem({
      id: 'district-overview',
      title: `${district}: текущее состояние`,
      content: `${district} находится в сценарии "${snapshot.scenarioLabel}". Статус ${getToneLabel(
        analysis.tone,
      ).toLowerCase()}, уровень воды ${snapshot.overview.waterLevel}%, давление ${
        snapshot.overview.pressure
      } bar, качество ${snapshot.overview.quality}, покрытие ${snapshot.overview.coverage}%.`,
      tags: [district, 'район', 'статус', 'давление', 'качество', 'покрытие', activeScenario, viewMode],
      source: 'Сводка района',
      tone: analysis.tone,
    }),
    createKnowledgeItem({
      id: 'district-trends',
      title: `${district}: динамика датчиков`,
      content: `${buildTrendNote(
        snapshot.trends.pressure,
        'Давление выросло',
        'Давление снизилось',
        ' bar',
      )} ${buildTrendNote(
        snapshot.trends.quality,
        'Качество выросло',
        'Качество снизилось',
      )} ${buildTrendNote(
        snapshot.trends.consumption,
        'Потребление выросло',
        'Потребление снизилось',
        ' м3',
      )}`,
      tags: [district, 'тренд', 'датчики', 'pressure', 'quality', 'consumption'],
      source: 'История телеметрии',
      tone: analysis.tone,
    }),
    createKnowledgeItem({
      id: 'city-summary',
      title: 'Городская картина',
      content: `Среднее покрытие по городу ${city.averageCoverage}%, среднее давление ${city.averagePressure} bar, среднее качество ${city.averageQuality}. Нестабильных районов: ${city.unstableDistricts}, всего аварий: ${city.totalIncidents}.`,
      tags: ['город', 'алматы', 'сравнение', 'покрытие', 'качество', 'аварии'],
      source: 'City snapshot',
      tone: city.unstableDistricts > 2 ? 'warning' : 'normal',
    }),
    createKnowledgeItem({
      id: 'briefing-summary',
      title: 'AI briefing',
      content: `${briefing.summary} Риск: ${briefing.risk} Директива: ${briefing.directive}`,
      tags: ['briefing', 'ai', 'риск', 'директива', 'что происходит'],
      source: 'AI briefing',
      tone: analysis.tone,
    }),
  ]

  if (telemetry) {
    items.push(
      createKnowledgeItem({
        id: 'telemetry-mesh',
        title: `${district}: сенсорная сеть и хабы`,
        content: `В районе ${district} работают ${telemetry.totalSensors} датчиков по магистралям, микрорайонам, домам и ЖК. Активных предупреждений ${telemetry.warningCount}, критичных ${telemetry.criticalCount}. Маршрут эскалации: ${telemetry.observationChain.join(' → ')}.`,
        tags: [district, 'датчики', 'хабы', 'микрорайон', 'эскалация', 'акимат', 'главный центр'],
        source: 'Telemetry mesh',
        tone: telemetry.tone,
      }),
    )
  }

  if (automation?.activeActionIds?.length) {
    items.push(
      createKnowledgeItem({
        id: 'automation-plan',
        title: `${district}: автоматические меры AI`,
        content: `AI уже включил меры: ${automation.activeActionIds
          .map((actionId) => operationCatalog[actionId]?.label || actionId)
          .join(', ')}. Наблюдение идёт через ${automation.monitoredFrom}.`,
        tags: [district, 'ai', 'бригада', 'автоматизация', 'меры'],
        source: 'AI automation',
        tone: telemetry?.autoDispatch ? 'warning' : 'normal',
      }),
    )
  }

  if (cityTelemetry) {
    items.push(
      createKnowledgeItem({
        id: 'city-telemetry',
        title: 'Городская телеметрическая цепочка',
        content: `По городу задействовано ${cityTelemetry.totalSensors} сенсоров, ${cityTelemetry.centerEscalations} сигналов подняты в главный центр и ${cityTelemetry.akimatEscalations} направлены в акимат.`,
        tags: ['город', 'телеметрия', 'главный центр', 'акимат', 'эскалация'],
        source: 'City telemetry',
        tone: cityTelemetry.akimatEscalations > 0 ? 'critical' : cityTelemetry.centerEscalations > 0 ? 'warning' : 'normal',
      }),
    )
  }

  topDistricts.forEach((item, index) => {
    items.push(
      createKnowledgeItem({
        id: `district-rank-${item.district}`,
        title: `${item.district}: место ${index + 1} по риску`,
        content: `${item.district} имеет риск ${item.analysis.riskScore}, устойчивость ${item.analysis.resilience}, давление ${item.snapshot.overview.pressure} bar и качество ${item.snapshot.overview.quality}.`,
        tags: [item.district, 'риск', 'сравнение', 'районы'],
        source: 'Сравнение районов',
        tone: item.analysis.tone,
      }),
    )
  })

  snapshot.topology.forEach((zone) => {
    items.push(
      createKnowledgeItem({
        id: `topology-${zone.label}`,
        title: `${district}: ${zone.label}`,
        content: `Нагрузка ветки ${zone.label} составляет ${zone.load}%. Это влияет на распределение потока и устойчивость локального контура.`,
        tags: [district, zone.label, 'ветка', 'нагрузка', 'топология', 'сеть'],
        source: 'Топология сети',
        tone: zone.load > 86 ? 'warning' : 'normal',
      }),
    )
  })

  briefing.watchlist.forEach((item, index) => {
    items.push(
      createKnowledgeItem({
        id: `watch-${index}`,
        title: `Контрольный показатель ${index + 1}`,
        content: item,
        tags: ['контроль', 'watchlist', district],
        source: 'Watchlist',
        tone: analysis.tone,
      }),
    )
  })

  briefing.events.forEach((event) => {
    items.push(
      createKnowledgeItem({
        id: `event-${event.time}-${event.title}`,
        title: `${event.time}: ${event.title}`,
        content: event.description,
        tags: [event.title, event.time, district, 'событие', 'журнал'],
        source: 'Журнал событий',
        tone: event.tone,
      }),
    )
  })

  operationsLog.slice(0, 8).forEach((entry) => {
    const action = operationCatalog[entry.actionId]
    if (!action) {
      return
    }

    items.push(
      createKnowledgeItem({
        id: entry.id,
        title: `${entry.timestamp}: ${entry.district}`,
        content: `${entry.enabled ? 'Активирована' : 'Отключена'} мера "${action.label}". Эффект: ${action.effect}.`,
        tags: [entry.district, action.label, 'операции', 'журнал', 'вмешательство'],
        source: 'Операционный лог',
        tone: entry.enabled ? 'warning' : 'normal',
      }),
    )
  })

  return items
}

export function searchKnowledgeBase(query, knowledgeBase, limit = 5) {
  const queryTokens = tokenize(query)

  if (!queryTokens.length) {
    return knowledgeBase.slice(0, limit).map((item) => ({
      ...item,
      score: 1,
    }))
  }

  return knowledgeBase
    .map((item) => ({
      ...item,
      score: scoreAgainstQuery(queryTokens, `${item.title} ${item.content}`, item.tags),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

function createAlert({
  id,
  severity,
  title,
  description,
  metric,
  action,
  source,
}) {
  return {
    id,
    severity,
    title,
    description,
    metric,
    action,
    source,
  }
}

export function buildSensorAlerts(context, districtSnapshots, operationsLog = []) {
  const { district, snapshot, analysis, city, telemetry, cityTelemetry, automation } = context
  const alerts = []

  if (analysis.statuses.pressure.tone !== 'normal') {
    alerts.push(
      createAlert({
        id: 'pressure-sensor',
        severity: analysis.statuses.pressure.tone,
        title:
          analysis.statuses.pressure.tone === 'critical'
            ? 'Критическая просадка давления'
            : 'Давление ниже целевого диапазона',
        description: `Датчики в районе ${district} показывают ${snapshot.overview.pressure} bar. Это уже влияет на сервис и может дать каскад по сети.`,
        metric: `${snapshot.overview.pressure} bar`,
        action: 'Проверить резервный контур и балансировку магистрали.',
        source: 'Датчик давления',
      }),
    )
  }

  if (analysis.statuses.quality.tone !== 'normal') {
    alerts.push(
      createAlert({
        id: 'quality-sensor',
        severity: analysis.statuses.quality.tone,
        title:
          analysis.statuses.quality.tone === 'critical'
            ? 'Качество воды вышло в красную зону'
            : 'Качество воды требует внимания',
        description: `Индекс качества ${snapshot.overview.quality}, мутность ${snapshot.overview.turbidity} NTU, хлор ${snapshot.overview.chlorine} мг/л.`,
        metric: `${snapshot.overview.quality} / ${snapshot.overview.turbidity} NTU`,
        action: 'Запустить санитарную промывку и ускоренный цикл пробоотбора.',
        source: 'Контроль качества',
      }),
    )
  }

  if (analysis.statuses.incidents.tone !== 'normal') {
    alerts.push(
      createAlert({
        id: 'incident-sensor',
        severity: analysis.statuses.incidents.tone,
        title:
          analysis.statuses.incidents.tone === 'critical'
            ? 'Слишком много аварийных событий'
            : 'Аварийная нагрузка растет',
        description: `В районе ${district} зафиксировано ${snapshot.overview.incidents} аварийных событий за текущую смену.`,
        metric: `${snapshot.overview.incidents} инцидентов`,
        action: 'Усилить район бригадами и проверить чувствительные ветки.',
        source: 'Монитор инцидентов',
      }),
    )
  }

  if (analysis.statuses.pumpLoad.tone !== 'normal') {
    alerts.push(
      createAlert({
        id: 'pump-load',
        severity: analysis.statuses.pumpLoad.tone,
        title:
          analysis.statuses.pumpLoad.tone === 'critical'
            ? 'Насосные станции работают на пределе'
            : 'Нагрузка насосов выше комфорта',
        description: `Текущая нагрузка насосов ${snapshot.overview.pumpLoad}%, энергопотребление ${snapshot.overview.energyUse}%.`,
        metric: `${snapshot.overview.pumpLoad}%`,
        action: 'Перераспределить поток и включить резервный маршрут подачи.',
        source: 'Насосный контур',
      }),
    )
  }

  if (analysis.statuses.complaints.tone !== 'normal') {
    alerts.push(
      createAlert({
        id: 'citizen-feedback',
        severity: analysis.statuses.complaints.tone,
        title: 'Растет давление на диспетчерскую линию',
        description: `Жители оставили ${snapshot.overview.complaints} обращений. Это дополнительный сигнал нестабильности сервиса.`,
        metric: `${snapshot.overview.complaints} жалоб`,
        action: 'Включить коммуникацию с жителями и дать прогноз восстановления.',
        source: 'Обращения жителей',
      }),
    )
  }

  const pressureDrop = Number(
    ((snapshot.trends.pressure[0]?.value ?? snapshot.overview.pressure) -
      (snapshot.trends.pressure[snapshot.trends.pressure.length - 1]?.value ?? snapshot.overview.pressure)).toFixed(1),
  )

  if (pressureDrop >= 0.6) {
    alerts.push(
      createAlert({
        id: 'trend-pressure',
        severity: pressureDrop >= 1 ? 'critical' : 'warning',
        title: 'Тренд давления уходит вниз',
        description: `За окно мониторинга давление снизилось на ${pressureDrop} bar. Это уже похоже на системную деградацию, а не на случайный шум датчика.`,
        metric: `-${pressureDrop} bar`,
        action: 'Проверить чувствительные узлы и исключить разрыв контура.',
        source: 'Тренд-монитор',
      }),
    )
  }

  if (snapshot.overview.sampleRate < 88) {
    alerts.push(
      createAlert({
        id: 'sampling-rate',
        severity: snapshot.overview.sampleRate < 78 ? 'critical' : 'warning',
        title: 'Недостаточный охват лабораторных проб',
        description: `Охват пробоотбора ${snapshot.overview.sampleRate}%. Модель видит риск пропуска санитарного отклонения.`,
        metric: `${snapshot.overview.sampleRate}%`,
        action: 'Поднять частоту отбора проб и перепроверить крайние точки района.',
        source: 'Лабораторный охват',
      }),
    )
  }

  const criticalDistricts = Object.entries(districtSnapshots).filter(([, item]) => analyzeSnapshot(item).tone === 'critical')

  if (criticalDistricts.length >= 2 || city.unstableDistricts >= 4) {
    alerts.push(
      createAlert({
        id: 'city-instability',
        severity: criticalDistricts.length >= 3 ? 'critical' : 'warning',
        title: 'Городская сеть входит в нестабильную фазу',
        description: `Критичных районов: ${criticalDistricts.length}, нестабильных районов: ${city.unstableDistricts}. Это уже влияет на общую устойчивость города.`,
        metric: `${city.unstableDistricts} районов`,
        action: 'Перевести городской штаб в координационный режим и расставить приоритеты между районами.',
        source: 'Городская сводка',
      }),
    )
  }

  if (
    analysis.tone === 'critical' &&
    !operationsLog.some((entry) => entry.enabled && entry.district === district) &&
    !(automation?.activeActionIds?.length)
  ) {
    alerts.push(
      createAlert({
        id: 'response-gap',
        severity: 'warning',
        title: 'Нет активных мер по текущему кризису',
        description: `AI не видит включенных операций по району ${district}, хотя район уже в красной зоне.`,
        metric: '0 активных мер',
        action: 'Запустить AI-план или вручную активировать операционные меры.',
        source: 'Контроль реакции',
      }),
    )
  }

  if (telemetry?.autoDispatch) {
    alerts.push(
      createAlert({
        id: 'telemetry-dispatch',
        severity: telemetry.escalateToAkimat ? 'critical' : 'warning',
        title: 'AI автоматически направил бригаду',
        description: `Рост отклонений по датчикам в районе ${district} активировал выездную бригаду. Контроль ведётся через ${telemetry.monitoredFrom}.`,
        metric: `${telemetry.activeSensorCount} активных сигналов`,
        action: 'Подтвердить ход работ с районного хаба и отслеживать следующий живой цикл датчиков.',
        source: 'Сетка датчиков',
      }),
    )
  }

  if (automation?.escalateToAkimat) {
    alerts.push(
      createAlert({
        id: 'akimat-escalation',
        severity: 'critical',
        title: 'Сигнал поднят в акимат',
        description: `AI определил угрозу городского масштаба и отправил сообщение в главный центр и акимат по району ${district}.`,
        metric: `${telemetry?.criticalCount ?? 0} критичных датчиков`,
        action: 'Держать подтверждение статуса от главного центра до стабилизации сети.',
        source: 'Цепочка эскалации',
      }),
    )
  }

  if (cityTelemetry && cityTelemetry.centerEscalations >= 3) {
    alerts.push(
      createAlert({
        id: 'city-telemetry-wave',
        severity: cityTelemetry.akimatEscalations > 0 ? 'critical' : 'warning',
        title: 'Телеметрическая волна охватывает несколько районов',
        description: `Главный центр сейчас ведёт ${cityTelemetry.centerEscalations} активных городских эскалации(й).`,
        metric: `${cityTelemetry.totalSensors} сенсоров`,
        action: 'Сверить приоритеты по районам и перераспределить городской резерв.',
        source: 'Телеметрия города',
      }),
    )
  }

  return alerts
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity])
    .slice(0, 8)
}

export function buildQuickPrompts(context, alerts) {
  const prompts = [
    `Что сейчас происходит в районе ${context.district}?`,
    `Покажи цепочку хабов и датчиков по району ${context.district}.`,
    `Какие внешние факторы сегодня влияют на район ${context.district}?`,
    `Найди ключевые нарушения по датчикам в ${context.district}.`,
    `Сравни ${context.district} с городом и покажи отклонения.`,
    'Что делать в ближайшие 2 часа?',
    'Сделай короткое сообщение для жителей.',
  ]

  if (alerts[0]) {
    prompts.splice(1, 0, `Разбери нарушение: ${alerts[0].title}.`)
  }

  return prompts
}

export function buildWelcomeMessage(context, alerts) {
  const topAlert = alerts[0]
  const intro =
    topAlert
      ? `Я вижу ${alerts.length} активных сигнала(ов) по району ${context.district}. Самый важный: ${topAlert.title.toLowerCase()}.`
      : `Система по району ${context.district} сейчас стабильна, но я продолжаю отслеживать датчики и городскую сеть.`

  return {
    tone: topAlert?.severity || context.analysis.tone,
    headline: `AI-центр: ${context.district}`,
    content: `${intro} Могу отвечать на вопросы, искать по текущим данным, подключать общедоступный внешний контекст и готовить короткие планы действий.`,
    highlights: [
      `Статус района: ${getToneLabel(context.analysis.tone)}.`,
      `Сценарий: ${context.snapshot.scenarioLabel}.`,
      `Критичных сигналов: ${alerts.filter((alert) => alert.severity === 'critical').length}.`,
    ],
    sources: ['Телеметрия', 'AI briefing', 'Городская сводка'],
  }
}

function buildSearchHighlights(results) {
  return results.map((item) => `${item.title}: ${trimContent(item.content, 120)}`)
}

function buildNoResultsReply(context, query) {
  return {
    tone: 'warning',
    headline: 'Совпадений мало',
    content: `По запросу "${query}" в текущем наборе данных нет точного попадания. Я могу искать по районам, датчикам, авариям, качеству, жалобам и операциям.`,
    highlights: [
      `Текущий район: ${context.district}.`,
      'Попробуй упомянуть давление, качество, аварии, жалобы, город или конкретный район.',
    ],
    sources: ['Локальный индекс AI-центра'],
    searchResults: [],
  }
}

function buildSearchReply(context, query, results) {
  if (!results.length) {
    return buildNoResultsReply(context, query)
  }

  return {
    tone: results[0].tone,
    headline: `Поиск по системе: ${query}`,
    content: `Нашёл ${results.length} релевантных фрагмента(ов) в телеметрии, сводках и операционном логе.`,
    highlights: buildSearchHighlights(results.slice(0, 3)),
    sources: results.slice(0, 5).map((item) => item.source),
    searchResults: results.slice(0, 4).map((item) => ({
      title: item.title,
      snippet: trimContent(item.content),
      source: item.source,
    })),
  }
}

function buildActionReply(context, alerts) {
  const operations = buildOperationsSummary(context.analysis)
  const topAlert = alerts[0]

  return {
    tone: topAlert?.severity || context.analysis.tone,
    headline: 'План действий на ближайшие 2 часа',
    content: `Для района ${context.district} я бы начал с ${operations
      .map((item) => item.label.toLowerCase())
      .join(', ')}.`,
    highlights: operations.map((item) => `${item.label}: ${item.description} (${item.effect})`),
    sources: ['AI rules', 'Operation catalog'],
    searchResults: [],
  }
}

function buildComparisonReply(context, districtSnapshots) {
  const ranking = buildDistrictRanking(districtSnapshots)
  const currentRank = ranking.findIndex((item) => item.district === context.district) + 1
  const worstDistrict = ranking[0]

  return {
    tone: context.analysis.tone,
    headline: `${context.district} на фоне города`,
    content: `${context.district} занимает ${currentRank} место по риску из ${ranking.length}. Покрытие района ${context.snapshot.overview.coverage}% против городского среднего ${context.city.averageCoverage}%, давление ${context.snapshot.overview.pressure} bar против ${context.city.averagePressure} bar.`,
    highlights: [
      `Среднее качество по городу: ${context.city.averageQuality}.`,
      `Нестабильных районов: ${context.city.unstableDistricts}.`,
      `Самый напряженный район сейчас: ${worstDistrict.district} с риском ${worstDistrict.analysis.riskScore}.`,
    ],
    sources: ['Сравнение районов', 'City snapshot'],
    searchResults: [],
  }
}

function buildAlertReply(context, alerts) {
  if (!alerts.length) {
    return {
      tone: 'normal',
      headline: 'Критичных нарушений не найдено',
      content: `По району ${context.district} сейчас нет ярко выраженных нарушений по основным датчикам. Система остаётся под мониторингом.`,
      highlights: [
        `Давление: ${context.snapshot.overview.pressure} bar.`,
        `Качество: ${context.snapshot.overview.quality}.`,
        `Покрытие: ${context.snapshot.overview.coverage}%.`,
      ],
      sources: ['Телеметрия района'],
      searchResults: [],
    }
  }

  return {
    tone: alerts[0].severity,
    headline: 'Нарушения по датчикам и системе',
    content: `Сейчас обнаружено ${alerts.length} сигналов, из них ${alerts.filter((item) => item.severity === 'critical').length} критичных.`,
    highlights: alerts.slice(0, 4).map((alert) => `${alert.title}: ${alert.description}`),
    sources: alerts.slice(0, 5).map((alert) => alert.source),
    searchResults: [],
  }
}

function buildCitizenReply(context) {
  return {
    tone: context.analysis.tone,
    headline: 'Сообщение для жителей',
    content:
      context.analysis.tone === 'critical'
        ? `В ${context.district} районе зафиксированы нарушения параметров водоснабжения. Службы уже работают над стабилизацией, возможны локальные колебания подачи воды.`
        : context.analysis.tone === 'warning'
          ? `В ${context.district} районе наблюдаются колебания отдельных параметров сети. Ситуация контролируется городскими службами, ведется дополнительный мониторинг.`
          : `Водоснабжение в ${context.district} районе работает в штатном режиме.`,
    highlights: [
      `Сценарий: ${context.snapshot.scenarioLabel}.`,
      `ETA реакции: ${context.snapshot.overview.responseEta} мин.`,
      'Текст подходит для приложения или диспетчерского уведомления.',
    ],
    sources: ['Citizen response template'],
    searchResults: [],
  }
}

function buildMetricReply(context, metricKey) {
  if (metricKey === 'quality') {
    return {
      tone: context.analysis.statuses.quality.tone,
      headline: 'Разбор качества воды',
      content: `Качество воды сейчас ${context.snapshot.overview.quality}. Мутность ${context.snapshot.overview.turbidity} NTU, хлор ${context.snapshot.overview.chlorine} мг/л, лабораторный охват ${context.snapshot.overview.sampleRate}%.`,
      highlights: [
        `Статус качества: ${getToneLabel(context.analysis.statuses.quality.tone)}.`,
        buildTrendNote(context.snapshot.trends.quality, 'Качество росло', 'Качество снижалось'),
      ],
      sources: ['Quality sensor', 'Sampling monitor'],
      searchResults: [],
    }
  }

  return {
    tone: context.analysis.statuses.pressure.tone,
    headline: 'Разбор давления',
    content: `Текущее давление ${context.snapshot.overview.pressure} bar. Покрытие сервиса ${context.snapshot.overview.coverage}%, нагрузка насосов ${context.snapshot.overview.pumpLoad}%.`,
    highlights: [
      `Статус давления: ${getToneLabel(context.analysis.statuses.pressure.tone)}.`,
      buildTrendNote(context.snapshot.trends.pressure, 'Давление росло', 'Давление снижалось', ' bar'),
    ],
    sources: ['Pressure sensor', 'Trend detector'],
    searchResults: [],
  }
}

function buildGenericReply(context, results, alerts) {
  const operations = buildOperationsSummary(context.analysis)

  return {
    tone: alerts[0]?.severity || context.analysis.tone,
    headline: `${context.district}: оперативная сводка`,
    content: `${context.briefing.summary} Сейчас у AI-центра под рукой ${results.length} релевантных фрагмента(ов) для поиска и ${alerts.length} активных сигналов.`,
    highlights: [
      `Покрытие: ${context.snapshot.overview.coverage}%.`,
      `Давление: ${context.snapshot.overview.pressure} bar.`,
      `Рекомендуемые меры: ${operations.map((item) => item.label).join(', ')}.`,
    ],
    sources: ['AI briefing', 'Search index', 'Alert monitor'],
    searchResults: results.slice(0, 3).map((item) => ({
      title: item.title,
      snippet: trimContent(item.content),
      source: item.source,
    })),
  }
}

export function generateLocalAiReply({
  message,
  context,
  knowledgeBase,
  alerts,
  districtSnapshots,
}) {
  const query = message.trim()
  const normalized = query.toLowerCase()
  const results = searchKnowledgeBase(query, knowledgeBase, 5)

  if (includesAny(normalized, ['поиск', 'найди', 'search', 'где', 'покажи'])) {
    return buildSearchReply(context, query, results)
  }

  if (includesAny(normalized, ['наруш', 'датчик', 'алерт', 'авар', 'сбой', 'проблем'])) {
    return buildAlertReply(context, alerts)
  }

  if (includesAny(normalized, ['сравни', 'город', 'районы', 'сравнение'])) {
    return buildComparisonReply(context, districtSnapshots)
  }

  if (includesAny(normalized, ['что делать', 'план', 'рекоменд', 'действ', 'штаб'])) {
    return buildActionReply(context, alerts)
  }

  if (includesAny(normalized, ['жител', 'пресс', 'сообщен', 'уведом'])) {
    return buildCitizenReply(context)
  }

  if (includesAny(normalized, ['качеств', 'лаборатор', 'хлор', 'мутност'])) {
    return buildMetricReply(context, 'quality')
  }

  if (includesAny(normalized, ['давлен', 'насос', 'магистрал', 'подач'])) {
    return buildMetricReply(context, 'pressure')
  }

  if (includesAny(normalized, ['статус', 'что происходит', 'сводк', 'итог'])) {
    return buildGenericReply(context, results, alerts)
  }

  return buildGenericReply(context, results, alerts)
}

export async function requestGeminiReply({
  context,
  config,
  message,
  history,
  alerts,
  knowledgeBase,
}) {
  const response = await fetch(resolveApiUrl('/api/ai/chat'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model || GEMINI_CHAT_DEFAULTS.model,
      context,
      message,
      history,
      alerts,
      knowledgeBase,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `AI API error ${response.status}`)
  }

  return response.json()
}
