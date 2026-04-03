import { useEffect, useMemo, useState } from 'react'
import { GEMINI_REPORT_DEFAULTS, createAquaMindReport, requestGeminiReport } from '../utils/aquaMind'
import { getToneLabel } from '../utils/analysis'

const STORAGE_KEY = 'aquamind-gemini-config-v1'
const MISSION_PRESETS = [
  'Подготовь краткое решение для штаба на ближайшие 2 часа.',
  'Сформируй инженерный чек-лист по стабилизации давления и качеству воды.',
  'Сделай короткое сообщение для жителей и пресс-службы.',
]

function mergeConfig(saved = {}) {
  return {
    ...GEMINI_REPORT_DEFAULTS,
    ...saved,
  }
}

function loadConfig() {
  if (typeof window === 'undefined') {
    return GEMINI_REPORT_DEFAULTS
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      return GEMINI_REPORT_DEFAULTS
    }

    return mergeConfig(JSON.parse(saved))
  } catch {
    return GEMINI_REPORT_DEFAULTS
  }
}

function ConfidenceBar({ value }) {
  return (
    <div className="confidence-bar">
      <div className="confidence-fill" style={{ width: `${value}%` }} />
    </div>
  )
}

export function AquaMindStudio({ context }) {
  const [mode, setMode] = useState('local')
  const [config, setConfig] = useState(loadConfig)
  const [report, setReport] = useState(() => createAquaMindReport(context, GEMINI_REPORT_DEFAULTS.mission))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sourceLabel, setSourceLabel] = useState('AquaMind Local')

  const updatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date()),
    [report],
  )

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    }
  }, [config])

  useEffect(() => {
    const nextLocal = createAquaMindReport(context, config.mission)
    if (mode === 'local') {
      setReport(nextLocal)
      setSourceLabel('AquaMind Local')
      setError('')
    }
  }, [context, config.mission, mode])

  const handleField = (field) => (event) => {
    setConfig((current) => ({
      ...current,
      [field]: event.target.value,
    }))
  }

  const handleGenerate = async () => {
    if (mode === 'local') {
      setReport(createAquaMindReport(context, config.mission))
      setSourceLabel('AquaMind Local')
      setError('')
      return
    }

    setLoading(true)
    setError('')

    try {
      const next = await requestGeminiReport(context, config)
      setReport(next)
      setSourceLabel('Google AI Studio')
    } catch (requestError) {
      const fallback = createAquaMindReport(context, config.mission)
      setReport({
        ...fallback,
        summary: `Google AI Studio недоступен, показан fallback через AquaMind. ${fallback.summary}`,
      })
      setSourceLabel('AquaMind Fallback')
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={`panel aquamind-panel tone-${report.tone || context.analysis.tone}`}>
      <div className="panel-header-row">
        <div>
          <span className="section-tag">AquaMind Console</span>
          <h3>AI модель управления</h3>
        </div>
        <span className={`state-pill tone-${report.tone || context.analysis.tone}`}>
          {getToneLabel(report.tone || context.analysis.tone)}
        </span>
      </div>

      <div className="studio-topline">
        <div>
          <span>Источник</span>
          <strong>{sourceLabel}</strong>
        </div>
        <div>
          <span>Уверенность</span>
          <strong>{report.confidence}%</strong>
          <ConfidenceBar value={report.confidence} />
        </div>
        <div>
          <span>Обновлено</span>
          <strong>{updatedAt}</strong>
        </div>
      </div>

      <div className="studio-context-strip">
        <div>
          <span>Район</span>
          <strong>{context.district}</strong>
        </div>
        <div>
          <span>Сценарий</span>
          <strong>{context.snapshot.scenarioLabel}</strong>
        </div>
        <div>
          <span>Фокус</span>
          <strong>{context.viewMode === 'network' ? 'Сеть' : context.viewMode === 'quality' ? 'Качество' : context.viewMode === 'ai' ? 'AI' : 'Реакция'}</strong>
        </div>
      </div>

      <div className="studio-mode-switch">
        <button
          type="button"
          className={mode === 'local' ? 'active' : ''}
          onClick={() => setMode('local')}
        >
          AquaMind
        </button>
        <button
          type="button"
          className={mode === 'gemini' ? 'active' : ''}
          onClick={() => setMode('gemini')}
        >
          Google AI Studio
        </button>
      </div>

      <div className="studio-form">
        <div className="mission-preset-row">
          {MISSION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="mission-preset"
              onClick={() =>
                setConfig((current) => ({
                  ...current,
                  mission: preset,
                }))
              }
            >
              {preset}
            </button>
          ))}
        </div>

        <label className="studio-field">
          <span>Миссия для AI</span>
          <textarea
            rows={3}
            value={config.mission}
            onChange={handleField('mission')}
            placeholder="Например: подготовь план для штаба, инженерный чек-лист и сообщение для жителей."
          />
        </label>

        {mode === 'gemini' ? (
          <div className="claude-config-grid">
            <label className="studio-field">
              <span>Model</span>
              <input value={config.model} onChange={handleField('model')} />
            </label>
            <div className="studio-field claude-key-field">
              <span>Режим данных</span>
              <input value="Server proxy + public context" readOnly />
            </div>
          </div>
        ) : null}

        <button
          type="button"
          className="primary-run-button"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? 'Генерация...' : mode === 'gemini' ? 'Запросить Gemini' : 'Запустить AquaMind'}
        </button>

        <p className="studio-note">
          {mode === 'gemini'
            ? 'Режим Google AI Studio использует server proxy и добавляет внешний публичный контекст к отчёту.'
            : 'AquaMind Local — это наш встроенный аналитический движок, который работает без внешнего API.'}
        </p>

        {error ? <div className="studio-error">{error}</div> : null}
      </div>

      <div className="studio-output">
        <div className="model-summary-card">
          <span>Резюме модели</span>
          <strong>{report.headline}</strong>
          <p>{report.summary}</p>
        </div>

        <div className="output-grid">
          <article>
            <span>Диагноз</span>
            <p>{report.diagnosis}</p>
          </article>
          <article>
            <span>Для штаба</span>
            <p>{report.executive}</p>
          </article>
          <article>
            <span>Для инженеров</span>
            <p>{report.engineering}</p>
          </article>
          <article>
            <span>Для жителей</span>
            <p>{report.citizen}</p>
          </article>
        </div>

        <div className="recommendation-stack">
          {report.recommendations.map((item) => (
            <div key={item} className="recommendation-item">
              <span />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
