const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const shiftSeries = (series, delta, min, max, decimals = 0) =>
  series.map((item, index) => {
    const nextValue = item.value + delta * (0.45 + index * 0.08)
    return {
      ...item,
      value:
        decimals > 0
          ? Number(clamp(nextValue, min, max).toFixed(decimals))
          : Math.round(clamp(nextValue, min, max)),
    }
  })

export const operationCatalog = {
  dispatchCrew: {
    label: 'Доп. бригада',
    badge: 'ETA',
    description: 'Ускоряет реакцию на месте и снижает число необработанных обращений.',
    effect: '-6 мин ETA, +1 бригада',
  },
  reserveBypass: {
    label: 'Резервный контур',
    badge: 'Pressure',
    description: 'Переключает район на обходной маршрут и поднимает давление на слабых ветках.',
    effect: '+0.4 bar, +2% coverage',
  },
  flushLine: {
    label: 'Промывка сети',
    badge: 'Quality',
    description: 'Запускает ускоренную санитарную промывку и усиливает лабораторный цикл.',
    effect: '+8 quality, -1.2 NTU',
  },
  notifyResidents: {
    label: 'Коммуникация',
    badge: 'CX',
    description: 'Отправляет уведомления жителям и снижает нагрузку на диспетчерскую линию.',
    effect: '-3 жалобы, +2 sample reach',
  },
}

export function applyOperationalActions(snapshot, actions = {}) {
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

  if (actions.dispatchCrew) {
    next.overview.fieldTeams = clamp(next.overview.fieldTeams + 1, 1, 7)
    next.overview.responseEta = clamp(next.overview.responseEta - 6, 8, 60)
    next.overview.complaints = clamp(next.overview.complaints - 4, 0, 90)
    next.overview.incidents = clamp(next.overview.incidents - 1, 0, 12)
    next.trends.incidents = shiftSeries(next.trends.incidents, -1, 0, 12)
  }

  if (actions.reserveBypass) {
    next.overview.pressure = Number(clamp(next.overview.pressure + 0.4, 1.1, 4.4).toFixed(1))
    next.overview.coverage = clamp(next.overview.coverage + 2, 68, 100)
    next.overview.pumpLoad = clamp(next.overview.pumpLoad - 6, 24, 98)
    next.overview.waterLevel = clamp(next.overview.waterLevel - 3, 12, 100)
    next.topology = next.topology.map((item) => ({
      ...item,
      load: clamp(item.load - 5, 30, 100),
    }))
    next.trends.pressure = shiftSeries(next.trends.pressure, 0.3, 1.1, 4.4, 1)
  }

  if (actions.flushLine) {
    next.overview.quality = clamp(next.overview.quality + 8, 25, 100)
    next.overview.turbidity = Number(clamp(next.overview.turbidity - 1.2, 1.2, 12).toFixed(1))
    next.overview.chlorine = Number(clamp(next.overview.chlorine + 0.09, 0.2, 1.1).toFixed(2))
    next.overview.sampleRate = clamp(next.overview.sampleRate + 7, 60, 100)
    next.overview.coverage = clamp(next.overview.coverage - 1, 68, 100)
    next.trends.quality = shiftSeries(next.trends.quality, 5, 22, 100)
  }

  if (actions.notifyResidents) {
    next.overview.complaints = clamp(next.overview.complaints - 3, 0, 90)
    next.overview.responseEta = clamp(next.overview.responseEta - 1, 8, 60)
    next.overview.sampleRate = clamp(next.overview.sampleRate + 2, 60, 100)
  }

  return next
}

export function getSuggestedOperations(analysis) {
  const next = new Set()

  if (analysis.statuses.pressure.tone !== 'normal' || analysis.statuses.coverage.tone !== 'normal') {
    next.add('reserveBypass')
    next.add('dispatchCrew')
  }

  if (analysis.statuses.quality.tone !== 'normal') {
    next.add('flushLine')
  }

  if (analysis.statuses.complaints.tone !== 'normal' || analysis.tone === 'critical') {
    next.add('notifyResidents')
  }

  if (next.size === 0) {
    next.add('notifyResidents')
  }

  return [...next]
}

export function makeOperationLogEntry(district, actionId, enabled) {
  return {
    id: `${district}-${actionId}-${enabled ? 'on' : 'off'}-${Date.now()}`,
    district,
    actionId,
    enabled,
    timestamp: new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date()),
  }
}
