import { almatyMapConfig } from '../src/data/mockData.js'

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const CACHE_TTL_MS = 10 * 60 * 1000
const publicIntelCache = new Map()

const weatherCodeLabels = {
  0: 'Ясно',
  1: 'Преимущественно ясно',
  2: 'Переменная облачность',
  3: 'Пасмурно',
  45: 'Туман',
  48: 'Инейный туман',
  51: 'Слабая морось',
  53: 'Морось',
  55: 'Сильная морось',
  56: 'Ледяная морось',
  57: 'Сильная ледяная морось',
  61: 'Слабый дождь',
  63: 'Дождь',
  65: 'Сильный дождь',
  66: 'Ледяной дождь',
  67: 'Сильный ледяной дождь',
  71: 'Слабый снег',
  73: 'Снег',
  75: 'Сильный снег',
  77: 'Снежные зёрна',
  80: 'Ливень',
  81: 'Сильный ливень',
  82: 'Очень сильный ливень',
  85: 'Снежный заряд',
  86: 'Сильный снежный заряд',
  95: 'Гроза',
  96: 'Гроза с градом',
  99: 'Сильная гроза с градом',
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getDistrictCoordinates(district) {
  const districtPoint = almatyMapConfig.districts?.[district]?.position
  const [latitude, longitude] = districtPoint || almatyMapConfig.center

  return {
    latitude,
    longitude,
  }
}

function formatHourLabel(isoString) {
  if (!isoString) {
    return '--:--'
  }

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return String(isoString).slice(11, 16)
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getWeatherLabel(code) {
  return weatherCodeLabels[code] || 'Смешанные погодные условия'
}

function buildExternalStress({ temperature, precipitationProbability, windSpeed, scenario }) {
  const temperatureRisk = temperature >= 28 ? (temperature - 27) * 4.5 : temperature <= 2 ? (4 - temperature) * 4 : 10
  const precipitationRisk = precipitationProbability * 0.42
  const windRisk = Math.max(0, windSpeed - 18) * 1.45

  const scenarioBoost =
    scenario === 'storm'
      ? 16
      : scenario === 'quality'
        ? 10
        : scenario === 'morning'
          ? 7
          : scenario === 'repair'
            ? 5
            : 0

  return clamp(Math.round(temperatureRisk + precipitationRisk + windRisk + scenarioBoost), 8, 97)
}

function getStressTone(stressIndex) {
  if (stressIndex >= 72) {
    return 'critical'
  }

  if (stressIndex >= 45) {
    return 'warning'
  }

  return 'normal'
}

function buildPublicSignals(current, peakHour, scenario) {
  const signals = []

  if (current.precipitationProbability >= 55 || peakHour.precipitationProbability >= 60) {
    signals.push({
      label: 'Осадки и ливневой риск',
      description: 'Осадки повышают риск локальных загрязнений, обходов и жалоб на качество воды.',
    })
  }

  if (current.temperature >= 27 || peakHour.temperature >= 29) {
    signals.push({
      label: 'Температурный пик',
      description: 'Жара обычно повышает бытовое потребление и ускоряет выход района в пик нагрузки.',
    })
  }

  if (current.windSpeed >= 28 || peakHour.windSpeed >= 32) {
    signals.push({
      label: 'Сложность выезда',
      description: 'Сильный ветер повышает вероятность задержек выездных бригад и вторичных инцидентов.',
    })
  }

  if (scenario === 'quality') {
    signals.push({
      label: 'Санитарный режим',
      description: 'При санитарном сценарии внешние осадки и ветер требуют более частого отбора проб.',
    })
  }

  if (!signals.length) {
    signals.push({
      label: 'Внешний фон ровный',
      description: 'Снаружи нет выраженного погодного триггера, основной фокус остаётся на локальной телеметрии.',
    })
  }

  return signals.slice(0, 3)
}

function buildOperationsAdvisories(current, peakHour, scenario) {
  const advisories = []

  if (current.precipitationProbability >= 45 || peakHour.precipitationProbability >= 60) {
    advisories.push('Подготовить бригады к работе на участках с риском подтоплений и промывов.')
  }

  if (current.temperature >= 27 || peakHour.temperature >= 29) {
    advisories.push('Заранее заложить резерв по давлению на фоне возможного роста бытового потребления.')
  }

  if (current.windSpeed >= 28 || peakHour.windSpeed >= 32) {
    advisories.push('Проверить доступность выездов, логистику аварийных экипажей и устойчивость временных схем.')
  }

  if (scenario === 'repair') {
    advisories.push('Согласовать плановые работы с погодным окном, чтобы не совмещать ремонт и внешний стресс.')
  }

  if (!advisories.length) {
    advisories.push('Внешняя среда нейтральна, можно удерживать обычный операционный резерв.')
  }

  return advisories.slice(0, 4)
}

function normalizePublicIntel(raw, district, scenario) {
  const current = raw?.current || {}
  const hourly = raw?.hourly || {}
  const currentTime = current.time || hourly.time?.[0]
  const startIndex = Math.max(hourly.time?.findIndex((item) => item >= currentTime) ?? 0, 0)

  const forecast = (hourly.time || [])
    .slice(startIndex, startIndex + 10)
    .map((time, index) => {
      const offset = startIndex + index
      const temperature = Math.round(hourly.temperature_2m?.[offset] ?? current.temperature_2m ?? 0)
      const precipitationProbability = Math.round(hourly.precipitation_probability?.[offset] ?? 0)
      const windSpeed = Math.round(hourly.wind_speed_10m?.[offset] ?? current.wind_speed_10m ?? 0)
      const weatherCode = hourly.weather_code?.[offset] ?? current.weather_code ?? 0
      const stressIndex = buildExternalStress({
        temperature,
        precipitationProbability,
        windSpeed,
        scenario,
      })

      return {
        time,
        label: formatHourLabel(time),
        temperature,
        precipitationProbability,
        windSpeed,
        weatherCode,
        weatherLabel: getWeatherLabel(weatherCode),
        stressIndex,
      }
    })

  const peakHour = forecast.reduce(
    (maxItem, item) => (item.stressIndex > maxItem.stressIndex ? item : maxItem),
    forecast[0] || {
      label: '--:--',
      temperature: Math.round(current.temperature_2m ?? 0),
      precipitationProbability: Math.round(current.precipitation ?? 0),
      windSpeed: Math.round(current.wind_speed_10m ?? 0),
      stressIndex: 0,
    },
  )

  const currentSnapshot = {
    temperature: Math.round(current.temperature_2m ?? peakHour.temperature ?? 0),
    apparentTemperature: Math.round(current.apparent_temperature ?? current.temperature_2m ?? peakHour.temperature ?? 0),
    precipitation: Number(current.precipitation ?? 0),
    precipitationProbability: forecast[0]?.precipitationProbability ?? Math.round(current.precipitation ?? 0),
    windSpeed: Math.round(current.wind_speed_10m ?? peakHour.windSpeed ?? 0),
    weatherCode: current.weather_code ?? forecast[0]?.weatherCode ?? 0,
    weatherLabel: getWeatherLabel(current.weather_code ?? forecast[0]?.weatherCode ?? 0),
    stressIndex: forecast[0]?.stressIndex ?? peakHour.stressIndex,
  }

  const tone = getStressTone(peakHour.stressIndex)
  const signals = buildPublicSignals(currentSnapshot, peakHour, scenario)
  const operations = buildOperationsAdvisories(currentSnapshot, peakHour, scenario)
  const summary = `По открытому погодному фону в районе ${district}: сейчас ${currentSnapshot.weatherLabel.toLowerCase()}, ${currentSnapshot.temperature}°C, ветер ${currentSnapshot.windSpeed} км/ч. Самое напряжённое внешнее окно ожидается около ${peakHour.label} со стресс-индексом ${peakHour.stressIndex}.`

  return {
    district,
    fetchedAt: raw?.current?.time || new Date().toISOString(),
    source: 'Open-Meteo',
    tone,
    summary,
    current: currentSnapshot,
    peakHour,
    signals,
    operations,
    hourly: forecast,
    metrics: {
      peakStress: peakHour.stressIndex,
      peakStressTime: peakHour.label,
      peakWind: peakHour.windSpeed,
      peakPrecipitationProbability: peakHour.precipitationProbability,
      temperatureSwing:
        forecast.length > 1
          ? Math.max(...forecast.map((item) => item.temperature)) - Math.min(...forecast.map((item) => item.temperature))
          : 0,
    },
  }
}

export async function getPublicIntel({ district = 'Алматы', scenario = 'baseline' } = {}) {
  const cacheKey = `${district}::${scenario}`
  const cached = publicIntelCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const coordinates = getDistrictCoordinates(district)
  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set('latitude', String(coordinates.latitude))
  url.searchParams.set('longitude', String(coordinates.longitude))
  url.searchParams.set(
    'current',
    ['temperature_2m', 'apparent_temperature', 'precipitation', 'weather_code', 'wind_speed_10m'].join(','),
  )
  url.searchParams.set(
    'hourly',
    ['temperature_2m', 'precipitation_probability', 'wind_speed_10m', 'weather_code'].join(','),
  )
  url.searchParams.set('forecast_days', '2')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('wind_speed_unit', 'kmh')

  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
  })

  if (!response.ok) {
    throw new Error(`Public weather API error ${response.status}`)
  }

  const raw = await response.json()
  const data = normalizePublicIntel(raw, district, scenario)

  publicIntelCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return data
}
