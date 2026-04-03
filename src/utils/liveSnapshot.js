const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const scenarioMultipliers = {
  baseline: 1,
  morning: 1.35,
  repair: 1.2,
  quality: 1.18,
  storm: 1.55,
}

function hashString(input = '') {
  let hash = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function wave(seed, cycle, amplitude = 1, phase = 0) {
  const main = Math.sin((cycle + (seed % 17)) * 0.55 + phase)
  const secondary = Math.cos((cycle + (seed % 11)) * 0.28 + phase)
  return (main * 0.72 + secondary * 0.28) * amplitude
}

function shiftSeries(series, seed, cycle, amplitude, min, max, decimals = 0) {
  return series.map((item, index) => {
    const delta = wave(seed + index * 13, cycle, amplitude * (0.56 + index * 0.08), index * 0.16)
    const nextValue = item.value + delta

    return {
      ...item,
      value:
        decimals > 0
          ? Number(clamp(nextValue, min, max).toFixed(decimals))
          : Math.round(clamp(nextValue, min, max)),
    }
  })
}

export function applyLiveSnapshotDrift(snapshot, district, cycle, scenarioKey = 'baseline') {
  const intensity = scenarioMultipliers[scenarioKey] || 1
  const seed = hashString(`${district}:${scenarioKey}`)

  const waterDelta = wave(seed + 11, cycle, 1.4 * intensity)
  const pressureDelta = wave(seed + 17, cycle, 0.12 * intensity)
  const incidentDelta = wave(seed + 23, cycle, 0.9 * intensity)
  const consumptionDelta = wave(seed + 31, cycle, 165 * intensity)
  const qualityDelta = wave(seed + 37, cycle, 1.8 * intensity)
  const coverageDelta = wave(seed + 41, cycle, 1.2 * intensity)
  const complaintsDelta = wave(seed + 47, cycle, 1.6 * intensity)
  const responseDelta = wave(seed + 53, cycle, 1.2 * intensity)
  const pumpDelta = wave(seed + 59, cycle, 3.2 * intensity)
  const energyDelta = wave(seed + 61, cycle, 2.7 * intensity)
  const chlorineDelta = wave(seed + 67, cycle, 0.03 * intensity)
  const turbidityDelta = wave(seed + 71, cycle, 0.34 * intensity)
  const sampleDelta = wave(seed + 73, cycle, 1.8 * intensity)

  return {
    ...snapshot,
    overview: {
      ...snapshot.overview,
      waterLevel: clamp(Math.round(snapshot.overview.waterLevel + waterDelta), 12, 100),
      pressure: Number(clamp(snapshot.overview.pressure + pressureDelta, 1.1, 4.4).toFixed(1)),
      incidents: clamp(Math.round(snapshot.overview.incidents + incidentDelta), 0, 12),
      consumption: Math.round(clamp(snapshot.overview.consumption + consumptionDelta, 4800, 26000)),
      quality: clamp(Math.round(snapshot.overview.quality + qualityDelta), 25, 100),
      coverage: clamp(Math.round(snapshot.overview.coverage + coverageDelta), 68, 100),
      complaints: clamp(Math.round(snapshot.overview.complaints + complaintsDelta), 0, 90),
      responseEta: clamp(Math.round(snapshot.overview.responseEta + responseDelta), 8, 60),
      pumpLoad: clamp(Math.round(snapshot.overview.pumpLoad + pumpDelta), 24, 98),
      energyUse: clamp(Math.round(snapshot.overview.energyUse + energyDelta), 24, 95),
      chlorine: Number(clamp(snapshot.overview.chlorine + chlorineDelta, 0.2, 1.1).toFixed(2)),
      turbidity: Number(clamp(snapshot.overview.turbidity + turbidityDelta, 1, 12).toFixed(1)),
      sampleRate: clamp(Math.round(snapshot.overview.sampleRate + sampleDelta), 60, 100),
      fieldTeams: snapshot.overview.fieldTeams,
    },
    topology: snapshot.topology.map((zone, index) => ({
      ...zone,
      load: clamp(Math.round(zone.load + wave(seed + 101 + index * 9, cycle, 3.8 * intensity, index * 0.2)), 30, 100),
    })),
    trends: {
      consumption: shiftSeries(snapshot.trends.consumption, seed + 211, cycle, 110 * intensity, 4800, 26000),
      pressure: shiftSeries(snapshot.trends.pressure, seed + 223, cycle, 0.09 * intensity, 1.1, 4.4, 1),
      incidents: shiftSeries(snapshot.trends.incidents, seed + 227, cycle, 0.6 * intensity, 0, 12),
      quality: shiftSeries(snapshot.trends.quality, seed + 229, cycle, 1.3 * intensity, 22, 100),
    },
  }
}
