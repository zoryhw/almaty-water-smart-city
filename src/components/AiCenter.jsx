import { useEffect, useMemo, useState } from 'react'
import {
  GEMINI_CHAT_DEFAULTS,
  buildAiKnowledgeBase,
  buildQuickPrompts,
  buildSensorAlerts,
  buildWelcomeMessage,
  generateLocalAiReply,
  requestGeminiReply,
} from '../utils/aiCenter'
import { formatNumber, getToneLabel } from '../utils/analysis'
import { getSuggestedOperations, operationCatalog } from '../utils/operations'

const STORAGE_KEY = 'aicenter-gemini-config-v1'

function mergeConfig(saved = {}) {
  return {
    ...GEMINI_CHAT_DEFAULTS,
    ...saved,
  }
}

function loadConfig() {
  if (typeof window === 'undefined') {
    return GEMINI_CHAT_DEFAULTS
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      return GEMINI_CHAT_DEFAULTS
    }

    return mergeConfig(JSON.parse(saved))
  } catch {
    return GEMINI_CHAT_DEFAULTS
  }
}

function createAssistantMessage(payload) {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role: 'assistant',
    ...payload,
  }
}

function createUserMessage(content) {
  return {
    id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role: 'user',
    content,
  }
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user'

  return (
    <article className={`ai-message ${isUser ? 'is-user' : `tone-${message.tone || 'normal'}`}`}>
      <div className="ai-message-avatar">{isUser ? 'Вы' : 'Помощник'}</div>
      <div className="ai-message-body">
        {!isUser && message.headline ? <strong>{message.headline}</strong> : null}
        <p>{message.content}</p>

        {!isUser && message.highlights?.length ? (
          <ul className="ai-message-list">
            {message.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {!isUser && message.searchResults?.length ? (
          <div className="ai-search-results">
            {message.searchResults.map((item) => (
              <article key={`${item.title}-${item.source}-${item.url || ''}`} className="ai-search-result-card">
                <span>{item.source}</span>
                <strong>{item.title}</strong>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="ai-source-link">
                    {item.url}
                  </a>
                ) : null}
                <p>{item.snippet}</p>
              </article>
            ))}
          </div>
        ) : null}

        {!isUser && message.sources?.length ? (
          <div className="ai-source-row">
            {message.sources.map((item) => (
              <span key={item} className="ai-source-pill">
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function AlertCard({ alert }) {
  return (
    <article className={`ai-alert-card tone-${alert.severity}`}>
      <div className="ai-alert-head">
        <strong>{alert.title}</strong>
        <span className={`mini-tone tone-${alert.severity}`}>{getToneLabel(alert.severity)}</span>
      </div>
      <p>{alert.description}</p>
      <div className="ai-alert-meta">
        <span>{alert.metric}</span>
        <span>{alert.source}</span>
      </div>
      <small>{alert.action}</small>
    </article>
  )
}

export function AiCenter({
  context,
  districtSnapshots,
  operationsLog,
  onRunAiPlan,
  publicIntel,
  publicIntelLoading,
  publicIntelError,
  canRunAiPlan,
}) {
  const [mode, setMode] = useState('local')
  const [config, setConfig] = useState(loadConfig)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const alerts = useMemo(
    () => buildSensorAlerts(context, districtSnapshots, operationsLog),
    [context, districtSnapshots, operationsLog],
  )

  const knowledgeBase = useMemo(
    () => buildAiKnowledgeBase(context, districtSnapshots, operationsLog),
    [context, districtSnapshots, operationsLog],
  )

  const quickPrompts = useMemo(() => buildQuickPrompts(context, alerts), [context, alerts])
  const recommendedActions = useMemo(
    () =>
      getSuggestedOperations(context.analysis)
        .map((actionId) => operationCatalog[actionId])
        .filter(Boolean),
    [context.analysis],
  )

  const welcomeMessage = useMemo(
    () => createAssistantMessage(buildWelcomeMessage(context, alerts)),
    [context, alerts],
  )

  const sessionKey = useMemo(
    () =>
      [
        context.district,
        context.snapshot.scenarioLabel,
        context.analysis.tone,
        alerts.map((alert) => `${alert.id}-${alert.metric}`).join('|'),
      ].join('::'),
    [context, alerts],
  )

  useEffect(() => {
    setMessages([welcomeMessage])
    setError('')
  }, [sessionKey, welcomeMessage])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    }
  }, [config])

  const handleField = (field) => (event) => {
    setConfig((current) => ({
      ...current,
      [field]: event.target.value,
    }))
  }

  const handleSubmit = async (event, overrideText) => {
    event?.preventDefault()

    const prompt = (overrideText ?? draft).trim()
    if (!prompt || loading) {
      return
    }

    const userMessage = createUserMessage(prompt)
    const history = messages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({
        role: item.role,
        content:
          item.role === 'assistant' && item.headline
            ? `${item.headline}\n${item.content}`
            : item.content,
      }))

    setMessages((current) => [...current, userMessage])
    setDraft('')
    setLoading(true)
    setError('')

    try {
      const payload =
        mode === 'gemini'
          ? await requestGeminiReply({
              context,
              config,
              message: prompt,
              history,
              alerts,
              knowledgeBase,
            })
          : generateLocalAiReply({
              message: prompt,
              context,
              knowledgeBase,
              alerts,
              districtSnapshots,
            })

      setMessages((current) => [...current, createAssistantMessage(payload)])
    } catch (requestError) {
      const fallback = generateLocalAiReply({
        message: prompt,
        context,
        knowledgeBase,
        alerts,
        districtSnapshots,
      })

      setMessages((current) => [
        ...current,
        createAssistantMessage({
          ...fallback,
          headline:
            mode === 'gemini' ? 'Google AI Studio недоступен, включен локальный ответ' : fallback.headline,
        }),
      ])
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="ai-center-shell">
      <div className="ai-chat-panel panel-surface">
        <div className="ai-center-topbar">
          <div>
            <p className="eyebrow">Рабочий помощник</p>
            <h3>Помощник для поиска по данным, вопросов и контроля датчиков</h3>
            <p className="body-text">
              Локальный режим работает прямо внутри приложения. Режим Google AI Studio использует тот же контекст
              района, событий и телеметрии, а также подключает общедоступные внешние данные и поисковое обоснование.
            </p>
          </div>

          <div className="ai-model-switch">
            <button
              type="button"
              className={mode === 'local' ? 'active' : ''}
              onClick={() => setMode('local')}
            >
              Локальный режим
            </button>
            <button
              type="button"
              className={mode === 'gemini' ? 'active' : ''}
              onClick={() => setMode('gemini')}
            >
              Google AI Studio
            </button>
          </div>
        </div>

        <div className="ai-context-strip">
          <article>
            <span>Район</span>
            <strong>{context.district}</strong>
          </article>
          <article>
            <span>Статус</span>
            <strong>{getToneLabel(context.analysis.tone)}</strong>
          </article>
          <article>
            <span>Сигналы</span>
            <strong>{alerts.length}</strong>
          </article>
          <article>
            <span>Поисковый индекс</span>
            <strong>{formatNumber(knowledgeBase.length)}</strong>
          </article>
        </div>

        <div className="ai-chip-row">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" className="ai-chip" onClick={(event) => handleSubmit(event, prompt)}>
              {prompt}
            </button>
          ))}
        </div>

        {mode === 'gemini' ? (
          <div className="ai-config-card">
            <div className="ai-config-grid">
              <label className="studio-field">
                <span>Model</span>
                <input value={config.model} onChange={handleField('model')} />
              </label>
              <article className="ai-config-inline-card">
                <span>Внешние данные</span>
                <strong>Google Search + Open-Meteo</strong>
              </article>
              <article className="ai-config-inline-card">
                <span>Безопасность</span>
                <strong>Ключ хранится на сервере</strong>
              </article>
            </div>
            <p className="studio-note">
              Внешний режим идёт через server proxy: Gemini получает локальный контекст, публичную погоду и при
              необходимости подтягивает общедоступные веб-источники.
            </p>
          </div>
        ) : (
          <div className="ai-config-card is-local">
            <div className="ai-stat-grid">
              <article>
                <span>Внутренний поиск</span>
                <strong>По районам и телеметрии</strong>
              </article>
              <article>
                <span>Мониторинг</span>
                <strong>Alerts по датчикам и системе</strong>
              </article>
              <article>
                <span>Ответы</span>
                <strong>Сводка, поиск, рекомендации</strong>
              </article>
              <article>
                <span>Публичный фон</span>
                <strong>Погода и внешний риск</strong>
              </article>
            </div>
          </div>
        )}

        <div className="ai-chat-window">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {loading ? (
            <article className="ai-message tone-warning">
              <div className="ai-message-avatar">AI</div>
              <div className="ai-message-body">
                <strong>{mode === 'gemini' ? 'Google AI Studio обрабатывает запрос' : 'AI обрабатывает запрос'}</strong>
                <p>Собираю локальный контекст, публичную погоду и при необходимости подключаю веб-grounding.</p>
              </div>
            </article>
          ) : null}
        </div>

        <form className="ai-input-form" onSubmit={handleSubmit}>
          <textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Например: найди все нарушения по качеству воды, сравни район с городом или предложи план на 2 часа."
          />

          <div className="ai-input-actions">
            <button type="button" className="secondary-ghost-button" onClick={onRunAiPlan} disabled={!canRunAiPlan}>
              Запустить AI-план
            </button>
            <button type="submit" className="primary-run-button" disabled={loading}>
              {loading ? 'Обработка...' : mode === 'gemini' ? 'Спросить Gemini' : 'Спросить AI'}
            </button>
          </div>
        </form>

        {!canRunAiPlan ? <div className="studio-note">Для текущего профиля запуск AI-плана отключён в привилегиях.</div> : null}
        {error ? <div className="studio-error">{error}</div> : null}
      </div>

      <aside className="ai-side-panel">
        <article className="content-card panel-surface">
          <p className="eyebrow">Public context</p>
          <h3>Внешний контекст района</h3>
          {publicIntelLoading ? (
            <div className="sidebar-hero-card">
              <strong>Загружаю внешний контекст</strong>
              <p>Подтягиваю открытый погодный фон и внешний стресс для района.</p>
            </div>
          ) : publicIntelError ? (
            <div className="sidebar-hero-card">
              <strong>Внешний контекст временно недоступен</strong>
              <p>{publicIntelError}</p>
            </div>
          ) : publicIntel ? (
            <>
              <div className="ai-stat-grid">
                <article>
                  <span>Сейчас</span>
                  <strong>{publicIntel.current.temperature}°C</strong>
                </article>
                <article>
                  <span>Ветер</span>
                  <strong>{publicIntel.current.windSpeed} км/ч</strong>
                </article>
                <article>
                  <span>Пик риска</span>
                  <strong>{publicIntel.peakHour.stressIndex}</strong>
                </article>
              </div>
              <p className="body-text">{publicIntel.summary}</p>
              <ul className="simple-list">
                {publicIntel.signals.map((item) => (
                  <li key={item.label}>
                    {item.label}: {item.description}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="sidebar-hero-card">
              <strong>Публичный контекст пока пуст</strong>
              <p>Переключение района или сценария подтянет внешнюю аналитику.</p>
            </div>
          )}
        </article>

        <article className="content-card panel-surface">
          <p className="eyebrow">Live alerts</p>
          <h3>Нарушения датчиков и системы</h3>
          <div className="ai-alert-list">
            {alerts.length ? (
              alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)
            ) : (
              <div className="sidebar-hero-card">
                <strong>Критичных нарушений нет</strong>
                <p>AI-центр продолжает отслеживать телеметрию района и городскую устойчивость.</p>
              </div>
            )}
          </div>
        </article>

        {context.telemetry ? (
          <article className="content-card panel-surface">
            <p className="eyebrow">Hub chain</p>
            <h3>Кто сейчас держит район под контролем</h3>
            <div className="ai-stat-grid">
              <article>
                <span>Датчики</span>
                <strong>{context.telemetry.totalSensors}</strong>
              </article>
              <article>
                <span>Предупреждения</span>
                <strong>{context.telemetry.warningCount}</strong>
              </article>
              <article>
                <span>Критичные</span>
                <strong>{context.telemetry.criticalCount}</strong>
              </article>
            </div>
            <div className="fact-stack">
              <div className="fact-row">
                <span>Маршрут</span>
                <p>{context.telemetry.observationChain.join(' → ')}</p>
              </div>
              <div className="fact-row">
                <span>Наблюдение</span>
                <p>{context.automation?.monitoredFrom || context.telemetry.monitoredFrom}</p>
              </div>
              <div className="fact-row">
                <span>AI</span>
                <p>
                  {context.telemetry.autoDispatch
                    ? 'AI уже подключил бригаду и сопровождает район в автоматическом режиме.'
                    : 'AI пока работает в режиме превентивного наблюдения.'}
                </p>
              </div>
            </div>
          </article>
        ) : null}

        <article className="content-card panel-surface">
          <p className="eyebrow">AI actions</p>
          <h3>Что AI предлагает включить</h3>
          <div className="fact-stack">
            {recommendedActions.map((item) => (
              <div key={item.label} className="fact-row">
                <span>{item.label}</span>
                <p>
                  {item.description} Эффект: {item.effect}.
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card panel-surface">
          <p className="eyebrow">Search sources</p>
          <h3>Откуда AI берёт ответы</h3>
          <div className="ai-stat-grid">
            <article>
              <span>Текущие записи</span>
              <strong>{formatNumber(knowledgeBase.length)}</strong>
            </article>
            <article>
              <span>Активные жалобы</span>
              <strong>{context.snapshot.overview.complaints}</strong>
            </article>
            <article>
              <span>Response ETA</span>
              <strong>{context.snapshot.overview.responseEta} мин</strong>
            </article>
          </div>

          <ul className="simple-list">
            <li>Телеметрия района и тренды давления, качества, аварий и потребления.</li>
            <li>Городская сводка и сравнение всех районов Алматы.</li>
            <li>Watchlist, briefing, журнал событий и операционный лог.</li>
            <li>Google Search grounding и открытый погодный фон Open-Meteo.</li>
          </ul>
        </article>
      </aside>
    </section>
  )
}
