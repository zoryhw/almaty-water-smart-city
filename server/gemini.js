import { getPublicIntel } from './publicIntel.js'

const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeModelName(model = DEFAULT_GEMINI_MODEL) {
  return String(model).replace(/^models\//, '').trim() || DEFAULT_GEMINI_MODEL
}

function buildGeminiUrl(model, apiKey) {
  const url = new URL(`${DEFAULT_GEMINI_ENDPOINT}/models/${normalizeModelName(model)}:generateContent`)
  url.searchParams.set('key', apiKey)
  return url.toString()
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts

  if (!Array.isArray(parts)) {
    return ''
  }

  return parts
    .map((part) => trimText(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim()
}

function getGeminiErrorMessage(data, fallback = '') {
  const apiMessage = trimText(data?.error?.message)
  if (apiMessage) {
    return apiMessage
  }

  const blockReason = trimText(data?.promptFeedback?.blockReason)
  if (blockReason) {
    return `Запрос заблокирован: ${blockReason}.`
  }

  return trimText(fallback) || 'unknown error'
}

function normalizeHistory(history = []) {
  return history
    .filter((item) => trimText(item?.content))
    .slice(-6)
    .map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: trimText(item.content) }],
    }))
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function buildChatSystemInstruction() {
  return [
    'You are AquaMind AI Center for an Almaty smart water operations dashboard.',
    'Answer in Russian.',
    'Blend three sources of truth when relevant: local dashboard telemetry, public weather context, and public web data from Google Search grounding.',
    'Prioritize operationally relevant public factors only: weather, public works, outages, safety alerts, and major events that can affect water operations.',
    'Ignore broad history, culture, generic economics, and background facts unless they directly affect today or the next few days.',
    'Clearly distinguish between local dashboard data and public external context when that distinction matters.',
    'Do not invent incidents, regulations, outages, or sensor values.',
    'Keep the answer concise, product-grade, and operational.',
    'Use at most one short paragraph and at most three bullet points.',
    'When public web data was used, include practical implications and rely only on grounded findings.',
  ].join(' ')
}

function buildChatContextPrompt(context, alerts, knowledgeBase, publicIntel) {
  const alertText =
    alerts?.length
      ? alerts
          .slice(0, 5)
          .map((alert) => `- [${alert.severity}] ${alert.title}: ${alert.description} Действие: ${alert.action}`)
          .join('\n')
      : '- Активных нарушений по локальной телеметрии не обнаружено.'

  const knowledgeText =
    knowledgeBase?.length
      ? knowledgeBase
          .slice(0, 10)
          .map((item) => `- ${item.title}: ${item.content}`)
          .join('\n')
      : '- Локальный индекс пуст.'

  const publicSignals = publicIntel?.signals?.length
    ? publicIntel.signals.map((item) => `- ${item.label}: ${item.description}`).join('\n')
    : '- Публичные сигналы недоступны.'

  return [
    `Дата и время: ${new Date().toLocaleString('ru-RU')}`,
    '',
    'Локальный контекст дашборда:',
    `- Район: ${context.district}`,
    `- Сценарий: ${context.snapshot.scenarioLabel}`,
    `- Статус района: ${context.analysis.tone}`,
    `- Давление: ${context.snapshot.overview.pressure} bar`,
    `- Качество: ${context.snapshot.overview.quality}`,
    `- Покрытие: ${context.snapshot.overview.coverage}%`,
    `- Жалобы: ${context.snapshot.overview.complaints}`,
    `- ETA реакции: ${context.snapshot.overview.responseEta} мин`,
    '',
    'Активные локальные алерты:',
    alertText,
    '',
    'Локальный индекс и briefing:',
    knowledgeText,
    '',
    'Публичный внешний контекст:',
    publicIntel
      ? `- ${publicIntel.summary}`
      : '- Публичный внешний контекст временно недоступен.',
    publicIntel
      ? `- Пиковое внешнее окно: ${publicIntel.peakHour.label}, стресс ${publicIntel.peakHour.stressIndex}, ветер ${publicIntel.peakHour.windSpeed} км/ч, вероятность осадков ${publicIntel.peakHour.precipitationProbability}%.`
      : '',
    'Публичные сигналы:',
    publicSignals,
  ]
    .filter(Boolean)
    .join('\n')
}

function extractGroundingMetadata(data) {
  const metadata = data?.candidates?.[0]?.groundingMetadata
  const chunks = metadata?.groundingChunks || []
  const supports = metadata?.groundingSupports || []
  const queries = metadata?.webSearchQueries || []

  const webSources = chunks
    .map((chunk, index) => {
      const web = chunk?.web
      if (!web?.uri) {
        return null
      }

      const snippet =
        supports.find((item) => item?.groundingChunkIndices?.includes(index))?.segment?.text ||
        ''

      return {
        title: web.title || new URL(web.uri).hostname,
        url: web.uri,
        snippet: trimText(snippet),
        source: 'Google Search',
      }
    })
    .filter(Boolean)
    .reduce((acc, item) => {
      if (acc.some((existing) => existing.url === item.url)) {
        return acc
      }

      acc.push(item)
      return acc
    }, [])

  return {
    queries,
    webSources,
  }
}

async function fetchGemini({ apiKey, model, body }) {
  const response = await fetch(buildGeminiUrl(model, apiKey), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  })

  const rawText = await response.text()
  let data = null

  if (rawText) {
    try {
      data = JSON.parse(rawText)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    throw new Error(`Google AI Studio API error ${response.status}: ${getGeminiErrorMessage(data, rawText)}`)
  }

  return data
}

async function fetchFallbackChatText({ apiKey, model, prompt }) {
  const data = await fetchGemini({
    apiKey,
    model,
    body: {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 320,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    },
  })

  return extractGeminiText(data)
}

export async function createGroundedChatReply({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  context,
  alerts = [],
  knowledgeBase = [],
  history = [],
  message,
}) {
  const publicIntel = await getPublicIntel({
    district: context?.district,
    scenario: context?.activeScenario,
  })

  const data = await fetchGemini({
    apiKey,
    model,
    body: {
      systemInstruction: {
        parts: [{ text: buildChatSystemInstruction() }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildChatContextPrompt(context, alerts, knowledgeBase, publicIntel) }],
        },
        ...normalizeHistory(history),
        {
          role: 'user',
          parts: [{ text: trimText(message) }],
        },
      ],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 420,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    },
  })

  let text = extractGeminiText(data)

  if (!text) {
    text = await fetchFallbackChatText({
      apiKey,
      model,
      prompt: [
        'Ответь кратко и по делу на русском языке.',
        'Используй локальный контекст дашборда и публичный погодный фон ниже.',
        buildChatContextPrompt(context, alerts, knowledgeBase, publicIntel),
        '',
        `Вопрос пользователя: ${trimText(message)}`,
      ].join('\n'),
    })
  }

  if (!text) {
    throw new Error(getGeminiErrorMessage(data, 'Google AI Studio вернул пустой ответ.'))
  }

  const finishReason = data?.candidates?.[0]?.finishReason
  if (finishReason === 'MAX_TOKENS' || text.length > 900) {
    const compressed = await fetchFallbackChatText({
      apiKey,
      model,
      prompt: [
        'Сожми ответ до одного короткого абзаца и трёх коротких пунктов максимум.',
        'Сохрани только то, что реально важно для оперативного решения по водоснабжению.',
        '',
        text,
      ].join('\n'),
    })

    if (compressed) {
      text = compressed
    }
  }

  const grounding = extractGroundingMetadata(data)
  const webCards = grounding.webSources.slice(0, 4).map((item) => ({
    title: item.title,
    snippet: item.snippet || item.url,
    source: item.source,
    url: item.url,
  }))

  return {
    tone: alerts[0]?.severity || context.analysis?.tone || publicIntel.tone || 'normal',
    headline: grounding.webSources.length ? 'Google AI Studio + общедоступные данные' : 'Google AI Studio ответ',
    content: text,
    highlights: dedupeStrings([
      `Локальный район: ${context.district}.`,
      `Публичный фон: ${publicIntel.current.weatherLabel}, ${publicIntel.current.temperature}°C, ветер ${publicIntel.current.windSpeed} км/ч.`,
      grounding.queries[0] ? `Веб-поиск: ${grounding.queries[0]}.` : 'Google Search подключается по мере необходимости.',
    ]),
    sources: dedupeStrings([
      'Google AI Studio',
      'Google Search',
      publicIntel.source,
      'Локальный контекст AI-центра',
    ]),
    searchResults: webCards,
    webSources: grounding.webSources.slice(0, 6),
    publicIntel,
  }
}

function buildReportSystemInstruction() {
  return [
    'You are AquaMind, an AI command analyst for an urban water supply dashboard.',
    'Return only valid JSON in Russian.',
    'The JSON keys must be: headline, summary, diagnosis, executive, engineering, citizen, recommendations, tone, confidence.',
    'recommendations must be an array of short strings.',
    'tone must be one of: normal, warning, critical.',
    'confidence must be an integer from 0 to 100.',
    'Use local dashboard context and public weather context when relevant.',
  ].join(' ')
}

function buildReportPrompt(context, mission, publicIntel) {
  return `
Контекст smart city dashboard:
- Район: ${context.district}
- Сценарий: ${context.activeScenario}
- Режим обзора: ${context.viewMode}
- Статус: ${context.analysis.tone}
- Уровень воды: ${context.snapshot.overview.waterLevel}%
- Давление: ${context.snapshot.overview.pressure} bar
- Инциденты: ${context.snapshot.overview.incidents}
- Качество воды: ${context.snapshot.overview.quality}
- Покрытие сервиса: ${context.snapshot.overview.coverage}%
- Среднее покрытие по городу: ${context.city.averageCoverage}%
- Среднее давление по городу: ${context.city.averagePressure} bar
- Всего инцидентов по городу: ${context.city.totalIncidents}

Публичный внешний контекст:
- ${publicIntel.summary}
- Пиковое внешнее окно: ${publicIntel.peakHour.label}
- Пиковый внешний стресс: ${publicIntel.peakHour.stressIndex}
- Вероятность осадков в пик: ${publicIntel.peakHour.precipitationProbability}%
- Ветер в пик: ${publicIntel.peakHour.windSpeed} км/ч

Задача:
${mission}

Сформируй:
1. diagnosis
2. executive
3. engineering
4. citizen
5. recommendations

Тон должен быть кратким, продуктовым и пригодным для реального городского штаба.
  `.trim()
}

const reportSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    diagnosis: { type: 'string' },
    executive: { type: 'string' },
    engineering: { type: 'string' },
    citizen: { type: 'string' },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
    },
    tone: {
      type: 'string',
      enum: ['normal', 'warning', 'critical'],
    },
    confidence: { type: 'integer' },
  },
  required: ['headline', 'summary', 'diagnosis', 'executive', 'engineering', 'citizen', 'recommendations', 'tone', 'confidence'],
}

function parseJsonCandidate(text) {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')

    if (start === -1 || end === -1 || end <= start) {
      return null
    }

    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export async function createStructuredReport({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  context,
  mission,
}) {
  const publicIntel = await getPublicIntel({
    district: context?.district,
    scenario: context?.activeScenario,
  })

  const data = await fetchGemini({
    apiKey,
    model,
    body: {
      systemInstruction: {
        parts: [{ text: buildReportSystemInstruction() }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildReportPrompt(context, mission, publicIntel) }],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 900,
        thinkingConfig: {
          thinkingBudget: 0,
        },
        responseMimeType: 'application/json',
        responseJsonSchema: reportSchema,
      },
    },
  })

  const text = extractGeminiText(data)
  const parsed = parseJsonCandidate(text)

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Google AI Studio вернул невалидный JSON для отчёта.')
  }

  return {
    ...parsed,
    source: 'gemini',
    publicIntel,
  }
}
