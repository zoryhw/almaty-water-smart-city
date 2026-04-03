import { almatyMapConfig, districtOrder } from '../data/mockData.js'
import { analyzeSnapshot } from './analysis.js'

export const TELEMETRY_REFRESH_MS = 3 * 60 * 1000

const severityRank = {
  critical: 3,
  warning: 2,
  normal: 1,
}

const controlNodes = {
  mainCenter: {
    id: 'main-control-center',
    title: 'Главный центр',
    position: [43.2447, 76.9154],
  },
  akimat: {
    id: 'city-akimat',
    title: 'Акимат',
    position: [43.2395, 76.9452],
  },
}

const sensorTypeCatalog = {
  pipeline_pressure: {
    label: 'Давление магистрали',
    unit: 'bar',
    format: (value) => `${value} bar`,
    read: (snapshot, noise) => Number((snapshot.overview.pressure + noise * 0.22).toFixed(1)),
    tone: (value) => {
      if (value < 2.2 || value > 4.2) return 'critical'
      if (value < 2.8 || value > 3.7) return 'warning'
      return 'normal'
    },
  },
  pipeline_flow: {
    label: 'Нагрузка магистрали',
    unit: '%',
    format: (value) => `${value}%`,
    read: (snapshot, noise) => clamp(Math.round(snapshot.overview.pumpLoad + noise * 9), 24, 100),
    tone: (value) => {
      if (value > 92) return 'critical'
      if (value > 82) return 'warning'
      return 'normal'
    },
  },
  pipeline_leak: {
    label: 'Риск утечки',
    unit: '%',
    format: (value) => `${value}%`,
    read: (snapshot, noise) =>
      clamp(Math.round(snapshot.overview.incidents * 14 + snapshot.overview.complaints * 0.55 + noise * 8), 3, 100),
    tone: (value) => {
      if (value > 72) return 'critical'
      if (value > 46) return 'warning'
      return 'normal'
    },
  },
  hub_quality: {
    label: 'Индекс качества',
    unit: '',
    format: (value) => `${value}`,
    read: (snapshot, noise) => clamp(Math.round(snapshot.overview.quality + noise * 3), 20, 100),
    tone: (value) => {
      if (value < 72) return 'critical'
      if (value < 86) return 'warning'
      return 'normal'
    },
  },
  hub_balance: {
    label: 'Баланс контура',
    unit: '%',
    format: (value) => `${value}%`,
    read: (snapshot, noise) =>
      clamp(Math.round(snapshot.overview.coverage + snapshot.overview.waterLevel * 0.16 + noise * 6), 30, 100),
    tone: (value) => {
      if (value < 76) return 'critical'
      if (value < 88) return 'warning'
      return 'normal'
    },
  },
  micro_pressure: {
    label: 'Давление микрорайона',
    unit: 'bar',
    format: (value) => `${value} bar`,
    read: (snapshot, noise, load) =>
      Number((snapshot.overview.pressure - load / 260 + noise * 0.18).toFixed(1)),
    tone: (value) => {
      if (value < 2.1) return 'critical'
      if (value < 2.7) return 'warning'
      return 'normal'
    },
  },
  micro_quality: {
    label: 'Санитарный контроль',
    unit: '',
    format: (value) => `${value}`,
    read: (snapshot, noise, load) => clamp(Math.round(snapshot.overview.quality - load / 18 + noise * 3), 18, 100),
    tone: (value) => {
      if (value < 70) return 'critical'
      if (value < 84) return 'warning'
      return 'normal'
    },
  },
  micro_load: {
    label: 'Загрузка хаба',
    unit: '%',
    format: (value) => `${value}%`,
    read: (snapshot, noise, load) => clamp(Math.round(load + noise * 5), 20, 100),
    tone: (value) => {
      if (value > 90) return 'critical'
      if (value > 80) return 'warning'
      return 'normal'
    },
  },
  building_pressure: {
    label: 'Давление в ЖК',
    unit: 'bar',
    format: (value) => `${value} bar`,
    read: (snapshot, noise, load) =>
      Number((snapshot.overview.pressure - load / 300 + noise * 0.16).toFixed(1)),
    tone: (value) => {
      if (value < 2.0) return 'critical'
      if (value < 2.6) return 'warning'
      return 'normal'
    },
  },
  building_quality: {
    label: 'Качество в доме',
    unit: '',
    format: (value) => `${value}`,
    read: (snapshot, noise, load) => clamp(Math.round(snapshot.overview.quality - load / 22 + noise * 3), 18, 100),
    tone: (value) => {
      if (value < 69) return 'critical'
      if (value < 83) return 'warning'
      return 'normal'
    },
  },
  building_turbidity: {
    label: 'Мутность',
    unit: 'NTU',
    format: (value) => `${value} NTU`,
    read: (snapshot, noise) => Number(clamp(snapshot.overview.turbidity + noise * 0.7, 1, 14).toFixed(1)),
    tone: (value) => {
      if (value > 6.4) return 'critical'
      if (value > 4.2) return 'warning'
      return 'normal'
    },
  },
  building_service: {
    label: 'Уровень сервиса',
    unit: '%',
    format: (value) => `${value}%`,
    read: (snapshot, noise, load) => clamp(Math.round(snapshot.overview.coverage - load / 24 + noise * 4), 40, 100),
    tone: (value) => {
      if (value < 86) return 'critical'
      if (value < 93) return 'warning'
      return 'normal'
    },
  },
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function hashValue(input) {
  let hash = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function signedNoise(seed) {
  return (hashValue(seed) % 2000) / 1000 - 1
}

function mixPosition(start, end, ratio) {
  return [
    Number((start[0] + (end[0] - start[0]) * ratio).toFixed(4)),
    Number((start[1] + (end[1] - start[1]) * ratio).toFixed(4)),
  ]
}

function offsetPosition(base, angle, latRadius, lngRadius) {
  return [
    Number((base[0] + Math.sin(angle) * latRadius).toFixed(4)),
    Number((base[1] + Math.cos(angle) * lngRadius).toFixed(4)),
  ]
}

function buildSensor({ id, type, title, scope, parentId, district, locationLabel, position, snapshot, load, bucket }) {
  const definition = sensorTypeCatalog[type]
  const noise = signedNoise(`${id}:${bucket}`)
  const value = definition.read(snapshot, noise, load)
  const tone = definition.tone(value)

  return {
    id,
    type,
    title,
    scope,
    parentId,
    district,
    locationLabel,
    position,
    load,
    tone,
    value,
    label: definition.label,
    formattedValue: definition.format(value),
  }
}

function sortBySeverity(items) {
  return [...items].sort((left, right) => severityRank[right.tone] - severityRank[left.tone])
}

function buildDistrictTelemetry(district, snapshot, bucket, automationStatus) {
  const districtMap = almatyMapConfig.districts[district]
  const sourceNode = almatyMapConfig.nodes.find((item) => item.id === districtMap.source) || almatyMapConfig.nodes[0]
  const districtAnalysis = analyzeSnapshot(snapshot)
  const districtHub = {
    id: `district-hub-${district}`,
    title: `${district} хаб`,
    district,
    tone: districtAnalysis.tone,
    position: districtMap.position,
    sourceId: sourceNode.id,
  }

  const microHubs = snapshot.topology.map((zone, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(snapshot.topology.length, 1) + signedNoise(`${district}:${index}`) * 0.45
    return {
      id: `micro-hub-${district}-${index}`,
      title: zone.label,
      district,
      load: zone.load,
      position: offsetPosition(districtMap.position, angle, 0.014, 0.016),
      tone: zone.load > 90 ? 'critical' : zone.load > 80 ? 'warning' : 'normal',
    }
  })

  const pipelineSensors = [
    buildSensor({
      id: `pipe-pressure-${district}`,
      type: 'pipeline_pressure',
      title: 'Магистральный участок A',
      scope: 'pipeline',
      parentId: districtHub.id,
      district,
      locationLabel: 'Магистраль',
      position: mixPosition(sourceNode.position, districtMap.position, 0.35),
      snapshot,
      load: snapshot.overview.pumpLoad,
      bucket,
    }),
    buildSensor({
      id: `pipe-flow-${district}`,
      type: 'pipeline_flow',
      title: 'Магистральный участок B',
      scope: 'pipeline',
      parentId: districtHub.id,
      district,
      locationLabel: 'Магистраль',
      position: mixPosition(sourceNode.position, districtMap.position, 0.58),
      snapshot,
      load: snapshot.overview.pumpLoad,
      bucket,
    }),
    buildSensor({
      id: `pipe-leak-${district}`,
      type: 'pipeline_leak',
      title: 'Контроль утечек',
      scope: 'pipeline',
      parentId: districtHub.id,
      district,
      locationLabel: 'Магистраль',
      position: mixPosition(sourceNode.position, districtMap.position, 0.8),
      snapshot,
      load: snapshot.overview.pumpLoad,
      bucket,
    }),
  ]

  const districtHubSensors = [
    buildSensor({
      id: `hub-quality-${district}`,
      type: 'hub_quality',
      title: 'Контроль качества на хабе',
      scope: 'district-hub',
      parentId: districtHub.id,
      district,
      locationLabel: districtHub.title,
      position: offsetPosition(districtMap.position, Math.PI / 4, 0.005, 0.006),
      snapshot,
      load: snapshot.overview.sampleRate,
      bucket,
    }),
    buildSensor({
      id: `hub-balance-${district}`,
      type: 'hub_balance',
      title: 'Баланс подачи на хабе',
      scope: 'district-hub',
      parentId: districtHub.id,
      district,
      locationLabel: districtHub.title,
      position: offsetPosition(districtMap.position, Math.PI * 1.1, 0.005, 0.006),
      snapshot,
      load: snapshot.overview.coverage,
      bucket,
    }),
  ]

  const microHubSensors = microHubs.flatMap((hub, index) => {
    const metricType = index % 3 === 0 ? 'micro_load' : index % 2 === 0 ? 'micro_quality' : 'micro_pressure'
    const secondMetricType = metricType === 'micro_pressure' ? 'micro_quality' : 'micro_pressure'

    return [
      buildSensor({
        id: `micro-primary-${district}-${index}`,
        type: metricType,
        title: `${hub.title}: первичный контур`,
        scope: 'micro-hub',
        parentId: hub.id,
        district,
        locationLabel: hub.title,
        position: offsetPosition(hub.position, Math.PI / 5, 0.0035, 0.0045),
        snapshot,
        load: hub.load,
        bucket,
      }),
      buildSensor({
        id: `micro-secondary-${district}-${index}`,
        type: secondMetricType,
        title: `${hub.title}: вторичный контур`,
        scope: 'micro-hub',
        parentId: hub.id,
        district,
        locationLabel: hub.title,
        position: offsetPosition(hub.position, Math.PI * 1.2, 0.0038, 0.0042),
        snapshot,
        load: hub.load,
        bucket,
      }),
    ]
  })

  const buildingSensors = snapshot.meta.keySites.flatMap((site, index) => {
    const anchorHub = microHubs[index % microHubs.length] || districtHub
    const angle = ((index + 1) * Math.PI) / 3
    const anchor = offsetPosition(anchorHub.position, angle, 0.006 + index * 0.001, 0.008 + index * 0.001)

    return [
      buildSensor({
        id: `building-pressure-${district}-${index}`,
        type: 'building_pressure',
        title: `${site}: стояк`,
        scope: 'building',
        parentId: anchorHub.id,
        district,
        locationLabel: site,
        position: anchor,
        snapshot,
        load: anchorHub.load || snapshot.overview.pumpLoad,
        bucket,
      }),
      buildSensor({
        id: `building-service-${district}-${index}`,
        type: index % 2 === 0 ? 'building_quality' : 'building_turbidity',
        title: `${site}: контроль воды`,
        scope: 'building',
        parentId: anchorHub.id,
        district,
        locationLabel: site,
        position: offsetPosition(anchor, Math.PI * 0.7, 0.0025, 0.003),
        snapshot,
        load: anchorHub.load || snapshot.overview.coverage,
        bucket,
      }),
    ]
  })

  const serviceSensors = snapshot.meta.keySites.map((site, index) =>
    buildSensor({
      id: `building-service-level-${district}-${index}`,
      type: 'building_service',
      title: `${site}: сервис ЖК`,
      scope: 'building',
      parentId: microHubs[index % microHubs.length]?.id || districtHub.id,
      district,
      locationLabel: site,
      position: offsetPosition(districtMap.position, Math.PI * 1.45 + index * 0.55, 0.01, 0.012),
      snapshot,
      load: microHubs[index % microHubs.length]?.load || snapshot.overview.coverage,
      bucket,
    }),
  )

  const sensors = [
    ...pipelineSensors,
    ...districtHubSensors,
    ...microHubSensors,
    ...buildingSensors,
    ...serviceSensors,
  ]

  const previousSensors = [
    ...pipelineSensors.map((sensor) => buildSensor({ ...sensor, snapshot, bucket: bucket - 1 })),
    ...districtHubSensors.map((sensor) => buildSensor({ ...sensor, snapshot, bucket: bucket - 1 })),
    ...microHubSensors.map((sensor) => buildSensor({ ...sensor, snapshot, bucket: bucket - 1 })),
    ...buildingSensors.map((sensor) => buildSensor({ ...sensor, snapshot, bucket: bucket - 1 })),
    ...serviceSensors.map((sensor) => buildSensor({ ...sensor, snapshot, bucket: bucket - 1 })),
  ]

  const activeSensors = sensors.filter((sensor) => sensor.tone !== 'normal')
  const previousActiveCount = previousSensors.filter((sensor) => sensor.tone !== 'normal').length
  const warningCount = activeSensors.filter((sensor) => sensor.tone === 'warning').length
  const criticalCount = activeSensors.filter((sensor) => sensor.tone === 'critical').length
  const rising = activeSensors.length > previousActiveCount
  const qualityAlerts = activeSensors.filter((sensor) => sensor.type.includes('quality') || sensor.type.includes('turbidity')).length
  const hydraulicAlerts = activeSensors.filter((sensor) => sensor.type.includes('pressure') || sensor.type.includes('flow')).length
  const serviceAlerts = activeSensors.filter((sensor) => sensor.type.includes('service') || sensor.type.includes('leak')).length

  const autoDispatch = criticalCount > 0 || (activeSensors.length >= 4 && rising)
  const escalateToCenter = autoDispatch || activeSensors.length >= 6 || districtAnalysis.tone === 'critical'
  const escalateToAkimat = criticalCount >= 3 || (districtAnalysis.tone === 'critical' && activeSensors.length >= 7)
  const monitoredFrom = escalateToAkimat || criticalCount >= 2 ? controlNodes.mainCenter.title : districtHub.title
  const topSensors = sortBySeverity(activeSensors).slice(0, 4)
  const tone = escalateToAkimat ? 'critical' : activeSensors.length ? 'warning' : districtAnalysis.tone

  const eventFeed = [
    {
      id: `telemetry-${district}-${bucket}`,
      time: 'сейчас',
      tone,
      title: `Пересчитан пакет датчиков ${district}`,
      description: `Сеть обновила ${sensors.length} сенсоров. Активных сигналов: ${activeSensors.length}, критичных: ${criticalCount}.`,
    },
    autoDispatch
      ? {
          id: `dispatch-${district}-${bucket}`,
          time: 'авто',
          tone: criticalCount > 0 ? 'critical' : 'warning',
          title: 'AI подключил бригаду',
          description: `AI направил выездную бригаду и включил удалённое наблюдение из ${monitoredFrom}.`,
        }
      : null,
    escalateToCenter
      ? {
          id: `center-${district}-${bucket}`,
          time: 'центр',
          tone: escalateToAkimat ? 'critical' : 'warning',
          title: 'Эскалация в главный центр',
          description: `Районный хаб поднял сигнал в ${controlNodes.mainCenter.title} для координации смены и контроля экипажа.`,
        }
      : null,
    escalateToAkimat
      ? {
          id: `akimat-${district}-${bucket}`,
          time: 'акимат',
          tone: 'critical',
          title: 'Уведомление в акимат',
          description: 'AI направил срочное уведомление о риске для города и запросил контроль через городской контур.',
        }
      : null,
  ].filter(Boolean)

  const effectiveAutomation = automationStatus || {
    activeActionIds: [],
    monitoredFrom,
    escalateToCenter,
    escalateToAkimat,
  }

  return {
    district,
    tone,
    sourceNode,
    districtHub,
    microHubs,
    sensors,
    topSensors,
    warningCount,
    criticalCount,
    activeSensorCount: activeSensors.length,
    totalSensors: sensors.length,
    autoDispatch,
    escalateToCenter,
    escalateToAkimat,
    monitoredFrom,
    qualityAlerts,
    hydraulicAlerts,
    serviceAlerts,
    observationChain: [districtHub.title, controlNodes.mainCenter.title, controlNodes.akimat.title],
    eventFeed,
    automation: effectiveAutomation,
  }
}

export function deriveAutomationPlan(telemetryNetwork) {
  return districtOrder.reduce((acc, district) => {
    const summary = telemetryNetwork.districts[district]
    if (!summary) {
      return acc
    }

    const activeActionIds = []

    if (summary.autoDispatch) {
      activeActionIds.push('dispatchCrew')
    }
    if (summary.hydraulicAlerts >= 2) {
      activeActionIds.push('reserveBypass')
    }
    if (summary.qualityAlerts >= 2 || summary.criticalCount > 0) {
      activeActionIds.push('flushLine')
    }
    if (summary.serviceAlerts >= 2 || summary.warningCount >= 3) {
      activeActionIds.push('notifyResidents')
    }

    acc[district] = {
      district,
      activeActionIds,
      dispatchCrew: activeActionIds.includes('dispatchCrew'),
      reserveBypass: activeActionIds.includes('reserveBypass'),
      flushLine: activeActionIds.includes('flushLine'),
      notifyResidents: activeActionIds.includes('notifyResidents'),
      monitoredFrom: summary.monitoredFrom,
      escalateToCenter: summary.escalateToCenter,
      escalateToAkimat: summary.escalateToAkimat,
      reason: summary.autoDispatch
        ? 'Рост сигналов активировал автоматическое реагирование AI.'
        : 'Система продолжает удалённый мониторинг без выезда.',
    }

    return acc
  }, {})
}

export function applyAutomationResponses(snapshot, automation = {}) {
  if (!automation.activeActionIds?.length) {
    return snapshot
  }

  const next = {
    ...snapshot,
    overview: { ...snapshot.overview },
    topology: snapshot.topology.map((item) => ({ ...item })),
    trends: {
      consumption: snapshot.trends.consumption.map((item) => ({ ...item })),
      pressure: snapshot.trends.pressure.map((item) => ({ ...item })),
      incidents: snapshot.trends.incidents.map((item) => ({ ...item })),
      quality: snapshot.trends.quality.map((item) => ({ ...item })),
    },
  }

  if (automation.dispatchCrew) {
    next.overview.fieldTeams = clamp(next.overview.fieldTeams + 1, 1, 8)
    next.overview.responseEta = clamp(next.overview.responseEta - 4, 8, 60)
    next.overview.complaints = clamp(next.overview.complaints - 2, 0, 90)
    next.overview.incidents = clamp(next.overview.incidents - 1, 0, 12)
  }

  if (automation.reserveBypass) {
    next.overview.pressure = Number(clamp(next.overview.pressure + 0.3, 1.1, 4.4).toFixed(1))
    next.overview.coverage = clamp(next.overview.coverage + 1, 68, 100)
    next.overview.pumpLoad = clamp(next.overview.pumpLoad - 4, 24, 98)
  }

  if (automation.flushLine) {
    next.overview.quality = clamp(next.overview.quality + 5, 25, 100)
    next.overview.turbidity = Number(clamp(next.overview.turbidity - 0.8, 1, 12).toFixed(1))
    next.overview.sampleRate = clamp(next.overview.sampleRate + 4, 60, 100)
  }

  if (automation.notifyResidents) {
    next.overview.complaints = clamp(next.overview.complaints - 2, 0, 90)
  }

  return next
}

export function buildTelemetryNetwork({ districtSnapshots, refreshBucket, automationByDistrict = {} }) {
  const districts = districtOrder.reduce((acc, district) => {
    acc[district] = buildDistrictTelemetry(district, districtSnapshots[district], refreshBucket, automationByDistrict[district])
    return acc
  }, {})

  const districtEntries = Object.values(districts)
  const totalSensors = districtEntries.reduce((sum, item) => sum + item.totalSensors, 0)
  const activeWarnings = districtEntries.reduce((sum, item) => sum + item.warningCount, 0)
  const activeCritical = districtEntries.reduce((sum, item) => sum + item.criticalCount, 0)
  const autoDispatches = districtEntries.filter((item) => item.autoDispatch).length
  const centerEscalations = districtEntries.filter((item) => item.escalateToCenter).length
  const akimatEscalations = districtEntries.filter((item) => item.escalateToAkimat).length
  const mainCenterTone = akimatEscalations > 0 ? 'critical' : centerEscalations > 2 ? 'warning' : 'normal'
  const akimatTone = akimatEscalations > 0 ? 'critical' : 'normal'
  const eventFeed = districtEntries
    .flatMap((item) => item.eventFeed.map((event) => ({ ...event, district: item.district })))
    .sort((left, right) => severityRank[right.tone] - severityRank[left.tone])
    .slice(0, 12)

  return {
    refreshBucket,
    districts,
    city: {
      totalSensors,
      activeWarnings,
      activeCritical,
      autoDispatches,
      centerEscalations,
      akimatEscalations,
      mainCenter: { ...controlNodes.mainCenter, tone: mainCenterTone },
      akimat: { ...controlNodes.akimat, tone: akimatTone },
      eventFeed,
    },
  }
}
