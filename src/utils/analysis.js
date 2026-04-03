const statusMeta = {
  normal: { label: 'Норма', tone: 'normal' },
  warning: { label: 'Внимание', tone: 'warning' },
  critical: { label: 'Критично', tone: 'critical' },
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

export function formatNumber(value) {
  return new Intl.NumberFormat('ru-RU').format(value)
}

export function getToneLabel(tone) {
  if (tone === 'critical') return 'Критично'
  if (tone === 'warning') return 'Под риском'
  return 'Стабильно'
}

function getWaterStatus(value) {
  if (value < 30) return statusMeta.critical
  if (value < 45) return statusMeta.warning
  return statusMeta.normal
}

function getPressureStatus(value) {
  if (value < 2) return statusMeta.critical
  if (value < 2.6) return statusMeta.warning
  return statusMeta.normal
}

function getIncidentStatus(value) {
  if (value > 5) return statusMeta.critical
  if (value >= 4) return statusMeta.warning
  return statusMeta.normal
}

function getQualityStatus(value) {
  if (value < 60) return statusMeta.critical
  if (value < 78) return statusMeta.warning
  return statusMeta.normal
}

function getCoverageStatus(value) {
  if (value < 85) return statusMeta.critical
  if (value < 93) return statusMeta.warning
  return statusMeta.normal
}

function getComplaintStatus(value) {
  if (value > 30) return statusMeta.critical
  if (value >= 18) return statusMeta.warning
  return statusMeta.normal
}

function getPumpStatus(value) {
  if (value > 85) return statusMeta.critical
  if (value >= 72) return statusMeta.warning
  return statusMeta.normal
}

function applyTrend(series, delta, min, max, factor = 0.08, decimals = 0) {
  return series.map((item, index) => {
    const value = item.value + delta * (0.35 + index * factor)
    return {
      ...item,
      value:
        decimals > 0
          ? Number(clamp(value, min, max).toFixed(decimals))
          : Math.round(clamp(value, min, max)),
    }
  })
}

function applyInverseTrend(series, delta, min, max, factor = 0.07, decimals = 0) {
  return series.map((item, index) => {
    const value = item.value + delta * (1 - index * factor)
    return {
      ...item,
      value:
        decimals > 0
          ? Number(clamp(value, min, max).toFixed(decimals))
          : Math.round(clamp(value, min, max)),
    }
  })
}

export function getDistrictScenarioSnapshot(district, scenario) {
  const overview = district.overview

  return {
    ...district,
    overview: {
      waterLevel: clamp(overview.waterLevel + scenario.waterDelta, 12, 100),
      pressure: Number(clamp(overview.pressure + scenario.pressureDelta, 1.1, 4.4).toFixed(1)),
      incidents: clamp(overview.incidents + scenario.incidentsDelta, 0, 12),
      consumption: Math.round(overview.consumption + scenario.consumptionDelta),
      quality: clamp(overview.quality + scenario.qualityDelta, 25, 100),
      coverage: clamp(overview.coverage + scenario.coverageDelta, 68, 100),
      complaints: clamp(overview.complaints + scenario.complaintsDelta, 0, 80),
      responseEta: clamp(overview.responseEta + scenario.responseEtaDelta, 10, 54),
      pumpLoad: clamp(overview.pumpLoad + scenario.pumpLoadDelta, 28, 98),
      energyUse: clamp(overview.energyUse + scenario.energyUseDelta, 24, 95),
      chlorine: Number(clamp(overview.chlorine + scenario.chlorineDelta, 0.2, 1.1).toFixed(2)),
      turbidity: Number(clamp(overview.turbidity + scenario.turbidityDelta, 1.8, 12).toFixed(1)),
      sampleRate: clamp(overview.sampleRate + scenario.sampleRateDelta, 64, 100),
      fieldTeams: clamp(overview.fieldTeams + scenario.fieldTeamsDelta, 1, 6),
    },
    topology: district.topology.map((zone, index) => ({
      ...zone,
      load: clamp(zone.load + scenario.riskBoost - index * 3, 34, 100),
    })),
    trends: {
      consumption: applyTrend(district.trends.consumption, scenario.consumptionDelta, 4800, 24000),
      pressure: applyInverseTrend(district.trends.pressure, scenario.pressureDelta, 1.1, 4.4, 0.06, 1),
      incidents: applyTrend(district.trends.incidents, scenario.incidentsDelta, 0, 12),
      quality: applyInverseTrend(district.trends.quality, scenario.qualityDelta, 22, 100),
    },
    scenarioLabel: scenario.label,
  }
}

export function analyzeSnapshot(snapshot) {
  const statuses = {
    waterLevel: getWaterStatus(snapshot.overview.waterLevel),
    pressure: getPressureStatus(snapshot.overview.pressure),
    incidents: getIncidentStatus(snapshot.overview.incidents),
    quality: getQualityStatus(snapshot.overview.quality),
    coverage: getCoverageStatus(snapshot.overview.coverage),
    complaints: getComplaintStatus(snapshot.overview.complaints),
    pumpLoad: getPumpStatus(snapshot.overview.pumpLoad),
  }

  const weightedRisk =
    (100 - snapshot.overview.waterLevel) * 0.16 +
    Math.max(0, 3.6 - snapshot.overview.pressure) * 24 * 0.22 +
    snapshot.overview.incidents * 7.8 * 0.16 +
    (100 - snapshot.overview.quality) * 0.16 +
    (100 - snapshot.overview.coverage) * 0.12 +
    snapshot.overview.complaints * 0.38 +
    Math.max(0, snapshot.overview.pumpLoad - 60) * 0.35

  const riskScore = Math.round(clamp(weightedRisk, 9, 97))
  const resilience = 100 - riskScore
  const responseReadiness = clamp(
    Math.round(
      96 -
        riskScore * 0.48 -
        snapshot.overview.responseEta * 0.44 +
        snapshot.overview.fieldTeams * 4.5,
    ),
    28,
    97,
  )

  const chlorineBalance = Math.max(0, 1 - Math.abs(0.68 - snapshot.overview.chlorine) * 2.3)
  const turbidityBalance = Math.max(0, 1 - snapshot.overview.turbidity / 12)

  const qualityConfidence = clamp(
    Math.round(
      snapshot.overview.quality * 0.56 +
        snapshot.overview.sampleRate * 0.24 +
        chlorineBalance * 14 +
        turbidityBalance * 14,
    ),
    34,
    98,
  )

  const serviceBalance = clamp(
    Math.round(
      snapshot.overview.coverage * 0.4 +
        snapshot.overview.waterLevel * 0.26 +
        snapshot.overview.pressure * 15 -
        snapshot.overview.incidents * 4.5,
    ),
    26,
    98,
  )

  let tone = 'normal'
  if (
    statuses.pressure.tone === 'critical' ||
    statuses.incidents.tone === 'critical' ||
    statuses.quality.tone === 'critical' ||
    statuses.complaints.tone === 'critical'
  ) {
    tone = 'critical'
  } else if (Object.values(statuses).some((status) => status.tone === 'warning')) {
    tone = 'warning'
  }

  return {
    statuses,
    riskScore,
    resilience,
    tone,
    responseReadiness,
    qualityConfidence,
    serviceBalance,
  }
}

export function getCitySnapshot(districtSnapshots) {
  const values = Object.values(districtSnapshots)
  const analyzed = values.map((item) => ({ snapshot: item, analysis: analyzeSnapshot(item) }))

  const averageCoverage = Math.round(
    analyzed.reduce((sum, item) => sum + item.snapshot.overview.coverage, 0) / analyzed.length,
  )
  const averagePressure = Number(
    (
      analyzed.reduce((sum, item) => sum + item.snapshot.overview.pressure, 0) / analyzed.length
    ).toFixed(1),
  )
  const averageQuality = Math.round(
    analyzed.reduce((sum, item) => sum + item.snapshot.overview.quality, 0) / analyzed.length,
  )
  const waterReserve = Math.round(
    analyzed.reduce((sum, item) => sum + item.snapshot.overview.waterLevel, 0) / analyzed.length,
  )
  const demandLoad = Math.round(
    analyzed.reduce((sum, item) => sum + item.snapshot.overview.pumpLoad, 0) / analyzed.length,
  )
  const totalIncidents = analyzed.reduce((sum, item) => sum + item.snapshot.overview.incidents, 0)
  const totalComplaints = analyzed.reduce((sum, item) => sum + item.snapshot.overview.complaints, 0)
  const unstableDistricts = analyzed.filter((item) => item.analysis.tone !== 'normal').length
  const cityResilience = Math.round(
    analyzed.reduce((sum, item) => sum + item.analysis.resilience, 0) / analyzed.length,
  )

  return {
    averageCoverage,
    averagePressure,
    averageQuality,
    waterReserve,
    demandLoad,
    totalIncidents,
    totalComplaints,
    unstableDistricts,
    cityResilience,
  }
}

export function buildAiBriefing(district, snapshot, analysis, viewMode, scenarioKey) {
  const modeFocus = {
    network: 'Фокус смены на гидравлическом балансе и устойчивости контура подачи.',
    response: 'Фокус смены на скорости реагирования, приоритизации экипажей и эскалации событий.',
    quality: 'Фокус смены на санитарном контроле, лабораторных пробах и качестве воды.',
    ai: 'Фокус смены на AI-аналитике и подготовке управленческих решений.',
  }

  const scenarioText =
    scenarioKey === 'storm'
      ? 'город работает в кризисном режиме'
      : scenarioKey === 'quality'
        ? 'смена переведена в режим контроля качества'
        : scenarioKey === 'repair'
          ? 'включено окно планового ремонта'
          : scenarioKey === 'morning'
            ? 'система переживает утренний пик нагрузки'
            : 'город находится в штатном режиме'

  const pressureText =
    analysis.statuses.pressure.tone === 'critical'
      ? 'давление опустилось ниже безопасного порога'
      : analysis.statuses.pressure.tone === 'warning'
        ? 'давление проседает и требует балансировки'
        : 'давление держится в рабочем диапазоне'

  const qualityText =
    analysis.statuses.quality.tone === 'critical'
      ? 'качество воды требует немедленного подтверждения лабораторией'
      : analysis.statuses.quality.tone === 'warning'
        ? 'качество воды находится на пограничном уровне'
        : 'качество воды стабильно'

  const headline =
    analysis.tone === 'critical'
      ? `${district}: нужен усиленный режим управления`
      : analysis.tone === 'warning'
        ? `${district}: район перешёл в режим повышенного внимания`
        : `${district}: район удерживает устойчивую подачу`

  const summary = `${scenarioText}, ${pressureText}, ${qualityText}. ${modeFocus[viewMode]}`

  const risk =
    analysis.tone === 'critical'
      ? 'Высокий риск каскадного ухудшения сервиса в ближайшие часы.'
      : analysis.tone === 'warning'
        ? 'Средний риск перехода в кризисный сценарий при росте нагрузки.'
        : 'Низкий риск, система сохраняет операционный резерв.'

  const directive =
    analysis.tone === 'critical'
      ? 'Перевести район в режим ручного контроля, активировать аварийные маршруты и синхронизировать лабораторию с диспетчером.'
      : analysis.tone === 'warning'
        ? 'Снизить давление на слабые ветки, подтянуть контроль телеметрии и подготовить резервную схему подачи.'
        : 'Поддерживать текущую конфигурацию и использовать район как референс для остальных контуров.'

  const recommendations =
    analysis.tone === 'critical'
      ? [
          'Поднять аварийные бригады и закрепить узлы маршрутизации по приоритету.',
          'Сверить давление на магистрали и переключить часть потока на резервный контур.',
          'Запустить ускоренный цикл пробоотбора по чувствительным точкам района.',
        ]
      : analysis.tone === 'warning'
        ? [
            'Перераспределить поток между насосными узлами района.',
            'Усилить мониторинг жалоб и контроль response ETA на ближайшие 2 часа.',
            'Проверить качество воды на периферийных ветках до конца смены.',
          ]
        : [
            'Сохранить текущий режим подачи и подтвердить стабильность контрольным окном.',
            'Поддерживать плановый обход без аварийной эскалации.',
            'Использовать свободный ресурс для профилактических проверок.',
          ]

  const watchlist = [
    `Жалобы жителей: ${snapshot.overview.complaints} обращений за смену.`,
    `Нагрузка насосов: ${snapshot.overview.pumpLoad}%.`,
    `Покрытие сервиса: ${snapshot.overview.coverage}%.`,
    `Скорость реагирования: ${snapshot.overview.responseEta} мин.`,
  ]

  const events = [
    {
      time: '20:05',
      title: 'Обновлён районный срез',
      description: `AI пересчитал модель по району ${district} и зафиксировал статус ${getToneLabel(analysis.tone).toLowerCase()}.`,
      tone: analysis.tone,
    },
    {
      time: '19:40',
      title: 'Гидравлический контур',
      description: pressureText,
      tone: analysis.statuses.pressure.tone,
    },
    {
      time: '19:12',
      title: 'Лабораторный цикл',
      description: qualityText,
      tone: analysis.statuses.quality.tone,
    },
    {
      time: '18:50',
      title: 'Покрытие сервиса',
      description: `Текущая доступность для жителей оценивается в ${snapshot.overview.coverage}%.`,
      tone: analysis.statuses.coverage.tone,
    },
  ]

  return {
    headline,
    summary,
    risk,
    directive,
    recommendations,
    watchlist,
    events,
    citizenMessage:
      analysis.tone === 'critical'
        ? `В ${district} районе возможны локальные ограничения подачи. Городские службы уже работают на стабилизацию.`
        : analysis.tone === 'warning'
          ? `В ${district} районе зафиксированы колебания параметров сети, ситуация под контролем служб.`
          : `Водоснабжение в ${district} районе работает стабильно.`,
  }
}
