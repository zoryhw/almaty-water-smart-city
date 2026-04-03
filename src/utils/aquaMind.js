import { getToneLabel } from './analysis'
import { resolveApiUrl } from './api'

export const GEMINI_REPORT_DEFAULTS = {
  model: 'gemini-2.5-flash',
  mission: 'Сформируй управленческое решение для штаба, техплан для инженеров и короткое сообщение для жителей.',
}

function inferAudience(mission) {
  const text = mission.toLowerCase()

  if (text.includes('жител') || text.includes('населен')) {
    return 'citizens'
  }

  if (text.includes('инжен') || text.includes('тех')) {
    return 'engineering'
  }

  return 'executive'
}

function buildLocalConfidence(context) {
  const base = 78
  const pressurePenalty = context.analysis.statuses.pressure.tone === 'critical' ? 16 : 6
  const qualityPenalty = context.analysis.statuses.quality.tone === 'critical' ? 14 : 4
  const scenarioPenalty = context.activeScenario === 'crisis' ? 12 : context.activeScenario === 'peak' ? 6 : 0

  return Math.max(42, base - pressurePenalty - qualityPenalty - scenarioPenalty)
}

export function createAquaMindReport(context, mission) {
  const { district, snapshot, analysis, city, activeScenario, viewMode } = context
  const audience = inferAudience(mission)

  const scenarioText =
    activeScenario === 'crisis'
      ? 'кризисный режим с немедленной потребностью в координации'
      : activeScenario === 'peak'
        ? 'режим пиковой нагрузки с риском просадки давления'
        : activeScenario === 'quality'
          ? 'режим санитарного внимания с акцентом на качество воды'
          : 'штатный режим с плановым мониторингом'

  const focusText =
    viewMode === 'response'
      ? 'Приоритет смещён на скорость реагирования и маршрутизацию бригад.'
      : viewMode === 'quality'
        ? 'Приоритет смещён на лабораторный контроль и санитарную устойчивость.'
        : 'Приоритет смещён на гидравлику сети и равномерность подачи.'

  const pressureRisk =
    analysis.statuses.pressure.tone === 'critical'
      ? 'Давление ниже безопасного порога и способно вызвать каскадные ограничения.'
      : analysis.statuses.pressure.tone === 'warning'
        ? 'Давление проседает и требует перераспределения нагрузки.'
        : 'Давление удерживается в рабочем диапазоне.'

  const qualityRisk =
    analysis.statuses.quality.tone === 'critical'
      ? 'Качество воды требует усиленного контроля и подтверждения пробоотбором.'
      : analysis.statuses.quality.tone === 'warning'
        ? 'Качество воды находится на пограничном уровне.'
        : 'Качество воды соответствует рабочим параметрам.'

  const executive =
    analysis.tone === 'critical'
      ? `Район ${district} необходимо перевести в усиленный режим управления. Состояние оценивается как ${getToneLabel(analysis.tone).toLowerCase()}, потому что одновременно проседают ключевые параметры сети.`
      : analysis.tone === 'warning'
        ? `Район ${district} находится под наблюдением. Нужна управляемая коррекция режима, чтобы не допустить перехода в кризис.`
        : `Район ${district} работает устойчиво. Достаточно сохранить текущий режим и подтвердить резерв устойчивости следующими замерами.`

  const engineering =
    analysis.tone === 'critical'
      ? 'Инженерам нужно немедленно проверить насосные узлы, магистральное давление, резервные ветки подачи и выполнить ускоренный обход чувствительных участков.'
      : analysis.tone === 'warning'
        ? 'Инженерам нужно локально перераспределить поток, перепроверить узкие места сети и подтвердить стабильность контрольных точек.'
        : 'Инженерной группе достаточно продолжить профилактический контроль и подтвердить норму по графику.'

  const citizen =
    analysis.tone === 'critical'
      ? `Для жителей: в ${district} районе возможны локальные ограничения подачи воды. Городские службы уже работают над стабилизацией системы.`
      : analysis.tone === 'warning'
        ? `Для жителей: в ${district} районе наблюдаются краткосрочные колебания параметров сети, ситуация находится под контролем.`
        : `Для жителей: водоснабжение в ${district} районе работает в штатном режиме.`

  const recommendations =
    analysis.tone === 'critical'
      ? [
          'Запустить аварийный контур управления давлением и ограничить неключевые ветки.',
          'Подтвердить качество воды ускоренным циклом пробоотбора.',
          'Поднять районный штаб и синхронизировать аварийные бригады.',
        ]
      : analysis.tone === 'warning'
        ? [
            'Сбалансировать поток между насосными станциями района.',
            'Усилить контроль жалоб и сверку телеметрии в ближайшие 2 часа.',
            'Подготовить резервный сценарий без публичной эскалации.',
          ]
        : [
            'Сохранить текущий режим подачи.',
            'Подтвердить показатели на следующем временном окне.',
            'Продолжить штатный мониторинг без аварийных мер.',
          ]

  const confidence = buildLocalConfidence(context)

  const summary = `AquaMind определяет район ${district} как ${getToneLabel(analysis.tone).toLowerCase()}. Сейчас действует ${scenarioText}. ${focusText}`
  const audienceNote =
    audience === 'citizens'
      ? 'Вывод адаптирован под внешнюю коммуникацию.'
      : audience === 'engineering'
        ? 'Вывод адаптирован под инженерную команду.'
        : 'Вывод адаптирован под руководителя.'

  return {
    tone: analysis.tone,
    source: 'aquamind',
    confidence,
    headline: `${district}: ${getToneLabel(analysis.tone)} по версии AquaMind`,
    summary: `${summary} Покрытие ${snapshot.overview.coverage}%, давление ${snapshot.overview.pressure} bar, качество ${snapshot.overview.quality}. ${audienceNote}`,
    executive,
    engineering,
    citizen,
    diagnosis: `${pressureRisk} ${qualityRisk} Покрытие сервиса сейчас ${snapshot.overview.coverage}%, среднее покрытие по городу ${city.averageCoverage}%, среднее качество по городу ${city.averageQuality}.`,
    recommendations,
  }
}

export async function requestGeminiReport(context, config) {
  const response = await fetch(resolveApiUrl('/api/ai/report'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      context,
      mission: config.mission || GEMINI_REPORT_DEFAULTS.mission,
      model: config.model || GEMINI_REPORT_DEFAULTS.model,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `AI report API error ${response.status}`)
  }

  return response.json()
}
