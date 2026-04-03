import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlmatyMap } from './components/AlmatyMap'
import { AiCenter } from './components/AiCenter'
import { OperationsConsole } from './components/OperationsConsole'
import { districtOrder, districts, scenarioProfiles } from './data/mockData'
import {
  analyzeSnapshot,
  buildAiBriefing,
  formatNumber,
  getCitySnapshot,
  getDistrictScenarioSnapshot,
  getToneLabel,
} from './utils/analysis'
import {
  applyOperationalActions,
  operationCatalog,
  getSuggestedOperations,
  makeOperationLogEntry,
} from './utils/operations'
import { buildSensorAlerts } from './utils/aiCenter'
import { applyLiveSnapshotDrift } from './utils/liveSnapshot'
import {
  fetchAnalyticsSummary,
  ingestLiveTelemetry,
  LIVE_MONITOR_INTERVAL_MS,
  requestAutopilotDecision,
} from './utils/liveOps'
import { fetchPublicIntel } from './utils/publicIntel'
import {
  applyAutomationResponses,
  buildTelemetryNetwork,
  deriveAutomationPlan,
} from './utils/telemetry'

const pages = [
  {
    id: 'overview',
    label: 'Обзор',
    eyebrow: 'Сводка',
    title: 'Ключевая картина района',
    description: 'Короткая сводка по району и общая картина по городу',
  },
  {
    id: 'map',
    label: 'Карта',
    eyebrow: 'Карта сети',
    title: 'Сеть Алматы на карте',
    description: 'Карта сети, узлов, маршрутов и инцидентов по городу',
  },
  {
    id: 'operations',
    label: 'Операции',
    eyebrow: 'Рабочая смена',
    title: 'Диспетчерский режим',
    description: 'Рабочий пульт реагирования и сценарии вмешательства по выбранному району',
  },
  {
    id: 'analytics',
    label: 'Аналитика',
    eyebrow: 'Аналитика',
    title: 'Тренды и сравнение',
    description: 'Графики и сравнения, которые объясняют поведение системы',
  },
  {
    id: 'ai',
    label: 'AI центр',
    eyebrow: 'Помощник',
    title: 'AI для штаба и инженеров',
    description: 'Встроенный помощник с поиском по данным, алертами и сценариями действий',
  },
]

const scenarioOrder = ['baseline', 'morning', 'repair', 'quality', 'storm']
const publicPageIds = ['overview', 'map']
const sessionStorageKey = 'awc-access-session-v1'
const privilegeCatalog = [
  { id: 'view_overview', label: 'Обзор', kind: 'page' },
  { id: 'view_map', label: 'Карта', kind: 'page' },
  { id: 'view_operations', label: 'Операции', kind: 'page' },
  { id: 'view_analytics', label: 'Аналитика', kind: 'page' },
  { id: 'view_ai', label: 'AI-центр', kind: 'page' },
  { id: 'manage_operations', label: 'Ручные меры', kind: 'action' },
  { id: 'run_ai_plan', label: 'AI-план', kind: 'action' },
  { id: 'switch_district', label: 'Смена района', kind: 'action' },
  { id: 'control_scenarios', label: 'Смена сценария', kind: 'action' },
]
const pagePrivilegeMap = {
  overview: 'view_overview',
  map: 'view_map',
  operations: 'view_operations',
  analytics: 'view_analytics',
  ai: 'view_ai',
}
const demoAccounts = [
  {
    id: 'dispatcher',
    name: 'Айдана Б.',
    roleTitle: 'Диспетчер смены',
    username: 'dispatcher',
    password: 'water2026',
    description: 'Рабочий доступ к операциям, AI-плану, карте и районной телеметрии.',
    privilegeIds: [
      'view_overview',
      'view_map',
      'view_operations',
      'view_analytics',
      'view_ai',
      'manage_operations',
      'run_ai_plan',
      'switch_district',
      'control_scenarios',
    ],
    homePage: 'operations',
  },
  {
    id: 'engineer',
    name: 'Руслан К.',
    roleTitle: 'Инженер качества',
    username: 'engineer',
    password: 'hydro2026',
    description: 'Фокус на качестве воды, лабораторных метриках, аналитике и AI-поиске.',
    privilegeIds: [
      'view_overview',
      'view_map',
      'view_analytics',
      'view_ai',
      'run_ai_plan',
      'switch_district',
      'control_scenarios',
    ],
    homePage: 'analytics',
  },
  {
    id: 'manager',
    name: 'Сабина А.',
    roleTitle: 'Руководитель смены',
    username: 'manager',
    password: 'city2026',
    description: 'Сводка по городу, аналитика смены и AI-поддержка управленческих решений.',
    privilegeIds: [
      'view_overview',
      'view_analytics',
      'view_ai',
      'run_ai_plan',
      'switch_district',
      'control_scenarios',
    ],
    homePage: 'overview',
  },
]
const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const chartTooltip = {
  contentStyle: {
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid #d9e4ef',
    borderRadius: '14px',
    boxShadow: '0 10px 24px rgba(58, 104, 144, 0.08)',
  },
  labelStyle: {
    color: '#28465d',
    fontWeight: 600,
  },
}

function getInitialPage() {
  if (typeof window === 'undefined') {
    return 'overview'
  }

  const page = window.location.hash.replace('#', '')
  return pages.some((item) => item.id === page) ? page : 'overview'
}

function dedupePrivileges(privilegeIds = []) {
  return [...new Set(privilegeIds.filter((item) => privilegeCatalog.some((entry) => entry.id === item)))]
}

function getPageIdsFromPrivileges(privilegeIds = []) {
  return pages
    .filter((page) => {
      const privilegeId = pagePrivilegeMap[page.id]
      return privilegeId ? privilegeIds.includes(privilegeId) : true
    })
    .map((page) => page.id)
}

function getPrivilegeLabel(privilegeId) {
  return privilegeCatalog.find((item) => item.id === privilegeId)?.label || privilegeId
}

function createSession(accountId = 'public', privilegeIdsOverride) {
  if (accountId === 'public') {
    const privilegeIds = ['view_overview', 'view_map', 'switch_district', 'control_scenarios']
    return {
      id: 'public',
      access: 'public',
      name: 'Городской обзор',
      roleTitle: 'Гостевой режим',
      description: 'Спокойный режим для жителей и общего мониторинга.',
      privilegeIds,
      privilegeLabels: privilegeIds.map(getPrivilegeLabel),
      pageIds: publicPageIds,
      homePage: 'overview',
    }
  }

  const account = demoAccounts.find((item) => item.id === accountId)
  if (!account) {
    return createSession('public')
  }

  const privilegeIds = dedupePrivileges(privilegeIdsOverride || account.privilegeIds || [])
  const pageIds = getPageIdsFromPrivileges(privilegeIds)
  const homePage = pageIds.includes(account.homePage) ? account.homePage : pageIds[0] || 'overview'

  return {
    id: account.id,
    access: 'staff',
    name: account.name,
    roleTitle: account.roleTitle,
    description: account.description,
    privilegeIds,
    privilegeLabels: privilegeIds.map(getPrivilegeLabel),
    pageIds,
    homePage,
  }
}

function getStoredSession() {
  if (typeof window === 'undefined') {
    return createSession('public')
  }

  const rawSession = window.localStorage.getItem(sessionStorageKey)
  if (!rawSession) {
    return createSession('public')
  }

  try {
    const parsed = JSON.parse(rawSession)
    if (parsed?.id) {
      return createSession(parsed.id, parsed.privilegeIds)
    }
  } catch {
    return createSession(rawSession)
  }

  return createSession('public')
}

function pageToViewMode(page) {
  if (page === 'operations') return 'response'
  if (page === 'analytics') return 'quality'
  if (page === 'map' || page === 'overview') return 'network'
  return 'ai'
}

function normalizeAiScenario(scenario) {
  if (scenario === 'storm') return 'crisis'
  if (scenario === 'morning') return 'peak'
  return scenario
}

function AppHeader({ activePage, onPageChange, city, currentTime, activeScenario, visiblePages, session, onOpenAccessPanel }) {
  const timeLabel = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(currentTime)

  const currentPage = visiblePages.find((page) => page.id === activePage) || visiblePages[0] || pages[0]
  const scenario = scenarioProfiles[activeScenario]
  const headerDescription =
    session.access === 'staff'
      ? currentPage.description
      : `${currentPage.description}. Спокойный режим без служебной перегрузки и лишних деталей.`

  return (
    <header className="split-header panel-surface">
      <div className="header-identity">
        <div className="header-kicker-row">
          <p className="eyebrow">Городская система воды</p>
          <span className="header-accent-chip">{currentPage.eyebrow}</span>
        </div>
        <h1>Диспетчерская водоснабжения Алматы</h1>
        <p className="header-subtitle">{headerDescription}</p>
      </div>

      <nav className="split-nav">
        {visiblePages.map((page) => (
          <button
            key={page.id}
            type="button"
            className={activePage === page.id ? 'active' : ''}
            onClick={() => onPageChange(page.id)}
          >
            {page.label}
          </button>
        ))}
      </nav>

      <div className="split-header-side">
        {session.access !== 'staff' ? (
          <button type="button" className="primary-run-button header-login-button" onClick={onOpenAccessPanel}>
            Вход для сотрудников
          </button>
        ) : null}

        <div className="split-header-meta">
          <div>
            <span>Сценарий</span>
            <strong>{scenario.title}</strong>
          </div>
          <div>
            <span>Устойчивость</span>
            <strong>{city.cityResilience}</strong>
          </div>
          <div>
            <span>Время</span>
            <strong>{timeLabel}</strong>
          </div>
        </div>
      </div>
    </header>
  )
}

function AccessRibbon({
  session,
  onOpenAccessPanel,
  onExitToGuest,
  onToggleSessionPrivilege,
  onResetSessionPrivileges,
  accessNotice,
}) {
  const isStaffMode = session.access === 'staff'

  return (
    <section className="access-ribbon panel-surface">
      <div className="access-ribbon-copy">
        <p className="eyebrow">{isStaffMode ? 'Профиль доступа' : 'Открытый доступ'}</p>
        <h3>{session.roleTitle}</h3>
        <p className="body-text">
          {isStaffMode ? `${session.name}. ${session.description}` : session.description}
        </p>
      </div>

      <div className="access-ribbon-center">
        {isStaffMode ? (
          <>
            <p className="access-ribbon-help">
              Нажмите на привилегию, чтобы сразу включить или убрать её для текущей рабочей сессии.
            </p>
            <div className="access-ribbon-tags">
              {privilegeCatalog.map((privilege) => {
                const active = session.privilegeIds.includes(privilege.id)

                return (
                  <button
                    key={privilege.id}
                    type="button"
                    className={`access-pill ${active ? 'active' : 'inactive'}`}
                    onClick={() => onToggleSessionPrivilege(privilege.id)}
                  >
                    <span>{privilege.kind === 'page' ? 'Раздел' : 'Действие'}</span>
                    <strong>{privilege.label}</strong>
                  </button>
                )
              })}
            </div>
            {accessNotice ? <p className="access-ribbon-inline-note">{accessNotice}</p> : null}
          </>
        ) : (
          <div className="access-ribbon-tags">
            {session.privilegeLabels.map((label) => (
              <span key={label} className="access-pill active static">
                <strong>{label}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="access-ribbon-actions">
        {isStaffMode ? (
          <button type="button" className="ghost-button" onClick={onResetSessionPrivileges}>
            Сбросить права
          </button>
        ) : null}
        <button type="button" className="primary-run-button" onClick={onOpenAccessPanel}>
          {isStaffMode ? 'Сменить аккаунт' : 'Вход для сотрудников'}
        </button>
        {isStaffMode ? (
          <button type="button" className="ghost-button" onClick={onExitToGuest}>
            В режим гостя
          </button>
        ) : null}
      </div>
    </section>
  )
}

function PublicControlBar({
  selectedDistrict,
  onSelectDistrict,
  activeScenario,
  onScenarioChange,
  canSwitchDistrict = true,
  canControlScenarios = true,
}) {
  return (
    <section className="public-toolbar panel-surface">
      <div className="public-toolbar-copy">
        <p className="eyebrow">Навигация</p>
        <h3>Быстрые настройки обзора</h3>
        <p className="body-text">
          Здесь можно спокойно переключать район и сценарий без служебных панелей, журналов и операционных настроек.
        </p>
      </div>

      <div className="public-toolbar-controls">
        <label className="control-field">
          <span>Район</span>
          <select
            value={selectedDistrict}
            onChange={(event) => onSelectDistrict(event.target.value)}
            disabled={!canSwitchDistrict}
          >
            {districtOrder.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span>Сценарий</span>
          <select
            value={activeScenario}
            onChange={(event) => onScenarioChange(event.target.value)}
            disabled={!canControlScenarios}
          >
            {scenarioOrder.map((scenarioKey) => (
              <option key={scenarioKey} value={scenarioKey}>
                {scenarioProfiles[scenarioKey].title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

function AccountAccessPanel({
  isOpen,
  authForm,
  authError,
  selectedProfileId,
  selectedPrivilegeIds,
  onClose,
  onAuthChange,
  onSubmit,
  onUseGuestMode,
  onUseWorkProfile,
  onTogglePrivilege,
  onResetPrivileges,
}) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="auth-overlay" role="presentation" onClick={onClose}>
      <section className="auth-modal panel-surface" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="auth-header">
          <div>
            <p className="eyebrow">Доступ</p>
            <h2>Выберите режим работы</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="auth-grid">
          <article className="auth-card">
            <p className="eyebrow">Гостевой режим</p>
            <h3>Обычный пользователь</h3>
            <p className="body-text">
              Понятный интерфейс без операционных журналов, AI-команд и служебных инструментов.
            </p>
            <ul className="simple-list">
              <li>Доступ к обзору и карте.</li>
              <li>Сниженная визуальная нагрузка и только ключевые метрики.</li>
              <li>Подходит для жителей и внешнего мониторинга.</li>
            </ul>
            <button type="button" className="primary-run-button" onClick={onUseGuestMode}>
              Открыть гостевой режим
            </button>
          </article>

          <article className="auth-card">
            <p className="eyebrow">Рабочие профили</p>
            <h3>Вход для сотрудников</h3>
            <p className="body-text">
              Выберите рабочую роль и войдите в профиль с нужными экранами и уровнем доступа.
            </p>

            <div className="auth-role-list">
              {demoAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className={`auth-role-button ${selectedProfileId === account.id ? 'active' : ''}`}
                  onClick={() => onUseWorkProfile(account.id)}
                >
                  <strong>{account.roleTitle}</strong>
                  <span>{account.username} / {account.password}</span>
                  <small>{account.description}</small>
                  <div className="auth-role-permissions">
                    {account.privilegeIds.map((privilegeId) => (
                      <span key={`${account.id}-${privilegeId}`} className="auth-role-chip">
                        {getPrivilegeLabel(privilegeId)}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="auth-permission-panel">
              <div className="auth-permission-head">
                <div>
                  <span>Индивидуальные привилегии</span>
                  <strong>
                    {demoAccounts.find((account) => account.id === selectedProfileId)?.roleTitle || 'Выбранный профиль'}
                  </strong>
                </div>
                <button type="button" className="ghost-button" onClick={onResetPrivileges}>
                  Сбросить
                </button>
              </div>
              <p className="body-text">
                Перед входом можно локально добавить или убрать права для выбранного сотрудника.
              </p>
              <div className="auth-permission-grid">
                {privilegeCatalog.map((privilege) => {
                  const active = selectedPrivilegeIds.includes(privilege.id)

                  return (
                    <button
                      key={privilege.id}
                      type="button"
                      className={`auth-permission-chip ${active ? 'active' : 'inactive'}`}
                      onClick={() => onTogglePrivilege(privilege.id)}
                    >
                      <span>{privilege.kind === 'page' ? 'Раздел' : 'Действие'}</span>
                      <strong>{privilege.label}</strong>
                      <small>{active ? 'Убрать' : 'Добавить'}</small>
                    </button>
                  )
                })}
              </div>
            </div>

            <form className="auth-form" onSubmit={onSubmit}>
              <label className="control-field">
                <span>Логин</span>
                <input
                  type="text"
                  name="username"
                  value={authForm.username}
                  onChange={onAuthChange}
                  placeholder="dispatcher"
                  autoComplete="username"
                />
              </label>

              <label className="control-field">
                <span>Пароль</span>
                <input
                  type="password"
                  name="password"
                  value={authForm.password}
                  onChange={onAuthChange}
                  placeholder="water2026"
                  autoComplete="current-password"
                />
              </label>

              {authError ? <p className="form-error">{authError}</p> : null}

              <button type="submit" className="primary-run-button">
                Войти в рабочий профиль
              </button>
            </form>
          </article>
        </div>
      </section>
    </div>
  )
}

function SidePanel({
  selectedDistrict,
  onSelectDistrict,
  activeScenario,
  onScenarioChange,
  districtStates,
  city,
  analysis,
  canSwitchDistrict = true,
  canControlScenarios = true,
}) {
  return (
    <aside className="split-sidebar panel-surface">
      <section className="sidebar-block">
        <p className="eyebrow">Контекст района</p>
        <div className="sidebar-hero-card">
          <strong>{selectedDistrict}</strong>
          <span>{getToneLabel(analysis.tone)}</span>
          <p>Выбранный район служит опорной точкой для общей городской сводки и текущего сценария.</p>
        </div>
      </section>

      <section className="sidebar-block">
        <p className="eyebrow">Город</p>
        <div className="sidebar-city-grid">
          <article>
            <span>Покрытие</span>
            <strong>{city.averageCoverage}%</strong>
          </article>
          <article>
            <span>Качество</span>
            <strong>{city.averageQuality}</strong>
          </article>
          <article>
            <span>Жалобы</span>
            <strong>{city.totalComplaints}</strong>
          </article>
          <article>
            <span>Нестабильные</span>
            <strong>{city.unstableDistricts}</strong>
          </article>
        </div>
      </section>

      <section className="sidebar-block">
        <p className="eyebrow">Сценарии</p>
        <div className="sidebar-scenarios">
          {scenarioOrder.map((key) => (
            <button
              key={key}
              type="button"
              className={activeScenario === key ? 'active' : ''}
              onClick={() => onScenarioChange(key)}
              disabled={!canControlScenarios}
            >
              {scenarioProfiles[key].title}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-block">
        <p className="eyebrow">Районы</p>
        <div className="sidebar-districts">
          {districtOrder.map((district) => (
            <button
              key={district}
              type="button"
              className={selectedDistrict === district ? 'active' : ''}
              onClick={() => onSelectDistrict(district)}
              disabled={!canSwitchDistrict}
            >
              <div>
                <strong>{district}</strong>
                <span>{districtStates[district].zone}</span>
              </div>
              <small>{districtStates[district].resilience}</small>
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}

function ShellStatusBar({ district, scenario, analysis, snapshot, activeActionsCount, isStaffMode }) {
  const items = isStaffMode
    ? [
        { label: 'Район', value: district },
        { label: 'Сценарий', value: scenarioProfiles[scenario].title },
        { label: 'Статус', value: getToneLabel(analysis.tone) },
        { label: 'Покрытие', value: `${snapshot.overview.coverage}%` },
        { label: 'Pressure', value: `${snapshot.overview.pressure} bar` },
        { label: 'Активные меры', value: `${activeActionsCount}` },
      ]
    : [
        { label: 'Район', value: district },
        { label: 'Сценарий', value: scenarioProfiles[scenario].title },
        { label: 'Статус', value: getToneLabel(analysis.tone) },
        { label: 'Покрытие', value: `${snapshot.overview.coverage}%` },
        { label: 'Качество', value: `${snapshot.overview.quality}` },
        { label: 'ETA', value: `${snapshot.overview.responseEta} мин` },
      ]

  return (
    <section className="status-ribbon panel-surface">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  )
}

function LiveControlStrip({
  selectedDistrict,
  selectedAutomation,
  alertFeed,
  serverSync,
  autopilotSummary,
  nextRefreshAt,
  secondsToRefresh,
}) {
  const topAlerts = alertFeed.slice(0, 3)
  const selectedActions = (selectedAutomation?.activeActionIds || [])
    .map((actionId) => operationCatalog[actionId]?.label || actionId)
    .filter(Boolean)

  const syncLabel =
    serverSync.status === 'syncing'
      ? 'Синхронизация...'
      : serverSync.status === 'error'
        ? 'Ошибка синхронизации'
        : serverSync.status === 'synced'
          ? 'Сервер получил данные'
          : 'Ожидание первого цикла'

  return (
    <section className="live-control-strip panel-surface">
      <article className={`live-control-card sync-${serverSync.status || 'idle'}`}>
        <span className="eyebrow">Живой мониторинг</span>
        <strong>{formatRefreshCountdown(secondsToRefresh)}</strong>
        <p>
          Следующий цикл в {formatRefreshTime(nextRefreshAt)}. {syncLabel}
        </p>
        <small>
          Автопилот: {autopilotSummary?.decisionSource === 'server-rule-engine' ? 'серверный контур' : 'локальный fallback'}
          {serverSync.lastSyncAt ? ` • сервер: ${formatRefreshTime(new Date(serverSync.lastSyncAt))}` : ''}
        </small>
      </article>

      <article className="live-control-card">
        <span className="eyebrow">AI по району</span>
        <strong>{selectedDistrict}</strong>
        <p>
          {selectedActions.length
            ? `Авто-меры: ${selectedActions.join(', ')}.`
            : 'AI пока ведёт наблюдение без автоматического вмешательства.'}
        </p>
        <small>{autopilotSummary?.reason || selectedAutomation?.reason}</small>
      </article>

      <article className="live-control-card live-control-alerts">
        <span className="eyebrow">Realtime alert feed</span>
        {topAlerts.length ? (
          <div className="live-alert-list">
            {topAlerts.map((alert) => (
              <div key={alert.id} className={`live-alert-item tone-${alert.severity}`}>
                <strong>{alert.district}</strong>
                <p>{alert.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>Активных предупреждений сейчас нет. Система остаётся под фоновым мониторингом.</p>
        )}
      </article>
    </section>
  )
}

function PublicIntelCard({
  publicIntel,
  loading,
  error,
  title = 'Внешний контекст района',
  eyebrow = 'Открытые данные',
  className = '',
}) {
  return (
    <article className={`content-card panel-surface ${className}`.trim()}>
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>

      {loading ? (
        <div className="sidebar-hero-card">
          <strong>Подтягиваю открытые данные</strong>
          <p>Загружаю погодный фон и внешний стресс для выбранного района.</p>
        </div>
      ) : error ? (
        <div className="sidebar-hero-card">
          <strong>Внешний контекст временно недоступен</strong>
          <p>{error}</p>
        </div>
      ) : publicIntel ? (
        <>
          <div className="kpi-grid-simple">
            <div>
              <span>Сейчас</span>
              <strong>{publicIntel.current.temperature}°C</strong>
            </div>
            <div>
              <span>Ветер</span>
              <strong>{publicIntel.current.windSpeed} км/ч</strong>
            </div>
            <div>
              <span>Осадки</span>
              <strong>{publicIntel.peakHour.precipitationProbability}%</strong>
            </div>
            <div>
              <span>Пик стресса</span>
              <strong>{publicIntel.peakHour.stressIndex}</strong>
            </div>
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
          <strong>Открытые данные пока не загружены</strong>
          <p>Внешний контекст появится после получения погодного прогноза и расчёта внешнего стресса.</p>
        </div>
      )}
    </article>
  )
}

function HealthMetricsCard({ analysis, briefing, className = '' }) {
  const metrics = [
    { label: 'Устойчивость', value: `${analysis.resilience}%` },
    { label: 'Готовность к ответу', value: `${analysis.responseReadiness}%` },
    { label: 'Уверенность в качестве', value: `${analysis.qualityConfidence}%` },
    { label: 'Сервисный баланс', value: `${analysis.serviceBalance}%` },
  ]

  return (
    <article className={`content-card panel-surface ${className}`.trim()}>
      <p className="eyebrow">Состояние системы</p>
      <h3>Насколько район готов к нагрузке</h3>
      <div className="kpi-grid-simple">
        {metrics.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="fact-stack">
        <div className="fact-row">
          <span>Риск</span>
          <p>{briefing.risk}</p>
        </div>
        <div className="fact-row">
          <span>Директива</span>
          <p>{briefing.directive}</p>
        </div>
      </div>
    </article>
  )
}

function formatDelta(delta, suffix = '') {
  if (!delta) {
    return `0${suffix}`
  }

  return `${delta > 0 ? '+' : ''}${delta}${suffix}`
}

function getImpactTone({ delta, betterWhen }) {
  if (!delta) {
    return 'neutral'
  }

  const improved = betterWhen === 'down' ? delta < 0 : delta > 0
  return improved ? 'good' : 'bad'
}

function OperationImpactCard({ beforeSnapshot, afterSnapshot, className = '' }) {
  const rows = [
    {
      label: 'ETA реакции',
      before: beforeSnapshot.overview.responseEta,
      after: afterSnapshot.overview.responseEta,
      delta: afterSnapshot.overview.responseEta - beforeSnapshot.overview.responseEta,
      suffix: ' мин',
      betterWhen: 'down',
    },
    {
      label: 'Давление',
      before: beforeSnapshot.overview.pressure,
      after: afterSnapshot.overview.pressure,
      delta: Number((afterSnapshot.overview.pressure - beforeSnapshot.overview.pressure).toFixed(1)),
      suffix: ' bar',
      betterWhen: 'up',
    },
    {
      label: 'Качество',
      before: beforeSnapshot.overview.quality,
      after: afterSnapshot.overview.quality,
      delta: afterSnapshot.overview.quality - beforeSnapshot.overview.quality,
      suffix: '',
      betterWhen: 'up',
    },
    {
      label: 'Покрытие',
      before: beforeSnapshot.overview.coverage,
      after: afterSnapshot.overview.coverage,
      delta: afterSnapshot.overview.coverage - beforeSnapshot.overview.coverage,
      suffix: '%',
      betterWhen: 'up',
    },
    {
      label: 'Жалобы',
      before: beforeSnapshot.overview.complaints,
      after: afterSnapshot.overview.complaints,
      delta: afterSnapshot.overview.complaints - beforeSnapshot.overview.complaints,
      suffix: '',
      betterWhen: 'down',
    },
  ]

  return (
    <article className={`content-card panel-surface ${className}`.trim()}>
      <p className="eyebrow">Прогноз эффекта</p>
      <h3>Эффект включённых мер</h3>
      <div className="impact-grid">
        {rows.map((row) => (
          <div key={row.label} className="impact-row">
            <div>
              <span>{row.label}</span>
              <strong>
                {row.before}
                {row.suffix} → {row.after}
                {row.suffix}
              </strong>
            </div>
            <b className={`delta-pill ${getImpactTone(row)}`}>{formatDelta(row.delta, row.suffix)}</b>
          </div>
        ))}
      </div>
    </article>
  )
}

function formatRefreshCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatRefreshTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function TelemetryMeshCard({
  district,
  telemetry,
  cityTelemetry,
  nextRefreshAt,
  secondsToRefresh,
  eyebrow = 'Сенсорная сеть',
  title = 'Сенсорная сеть и эскалация',
  className = '',
}) {
  return (
    <article className={`content-card panel-surface ${className}`.trim()}>
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
      <div className="kpi-grid-simple">
        <div>
          <span>Датчики</span>
          <strong>{telemetry.totalSensors}</strong>
        </div>
        <div>
          <span>Предупреждения</span>
          <strong>{telemetry.warningCount}</strong>
        </div>
        <div>
          <span>Критичные</span>
          <strong>{telemetry.criticalCount}</strong>
        </div>
        <div>
          <span>Следующий цикл</span>
          <strong>{formatRefreshCountdown(secondsToRefresh)}</strong>
        </div>
      </div>
      <div className="fact-stack">
        <div className="fact-row">
          <span>Цепочка</span>
          <p>{telemetry.observationChain.join(' → ')}</p>
        </div>
        <div className="fact-row">
          <span>AI-реакция</span>
          <p>
            {telemetry.autoDispatch
              ? `AI уже отправил бригаду и держит район ${district} под наблюдением из ${telemetry.monitoredFrom}.`
              : `AI держит район ${district} под профилактическим мониторингом без автоматического выезда.`}
          </p>
        </div>
        <div className="fact-row">
          <span>Город</span>
          <p>
            По городу сейчас {cityTelemetry.totalSensors} сенсоров, {cityTelemetry.centerEscalations} эскалаци(й) в
            главный центр и {cityTelemetry.akimatEscalations} сигнал(ов) в акимат.
          </p>
        </div>
        <div className="fact-row">
          <span>Обновление</span>
          <p>Сетка пересчитывается в живом цикле. Ближайшее обновление в {formatRefreshTime(nextRefreshAt)}.</p>
        </div>
      </div>

      <ul className="simple-list">
        {telemetry.topSensors.map((sensor) => (
          <li key={sensor.id}>
            {sensor.title}: {sensor.label} = {sensor.formattedValue} ({sensor.locationLabel})
          </li>
        ))}
      </ul>
    </article>
  )
}

function AutomationResponseCard({
  district,
  telemetry,
  automation,
  cityTelemetry,
  nextRefreshAt,
  secondsToRefresh,
  eyebrow = 'Автоответ',
  title = 'AI, выездные бригады и контроль',
  className = '',
}) {
  return (
    <article className={`content-card panel-surface ${className}`.trim()}>
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
      <div className="fact-stack">
        <div className="fact-row">
          <span>Текущий режим</span>
          <p>{automation.reason}</p>
        </div>
        <div className="fact-row">
          <span>Наблюдение</span>
          <p>Район {district} сейчас сопровождается через {automation.monitoredFrom}.</p>
        </div>
        <div className="fact-row">
          <span>Эскалация</span>
          <p>
            {automation.escalateToAkimat
              ? 'Сигнал уже поднят в главный центр и акимат.'
              : automation.escalateToCenter
                ? 'Сигнал поднят в главный центр, акимат пока в режиме ожидания.'
                : 'Пока достаточно районного хаба без городской эскалации.'}
          </p>
        </div>
        <div className="fact-row">
          <span>Следующий цикл</span>
          <p>
            Через {formatRefreshCountdown(secondsToRefresh)} сетка датчиков пересчитает статус. Ближайшее окно в{' '}
            {formatRefreshTime(nextRefreshAt)}.
          </p>
        </div>
      </div>

      <div className="kpi-grid-simple">
        <div>
          <span>Авто-бригад</span>
          <strong>{telemetry.autoDispatch ? 1 : 0}</strong>
        </div>
        <div>
          <span>Центр</span>
          <strong>{cityTelemetry.centerEscalations}</strong>
        </div>
        <div>
          <span>Акимат</span>
          <strong>{cityTelemetry.akimatEscalations}</strong>
        </div>
        <div>
          <span>Авто-меры</span>
          <strong>{automation.activeActionIds.length}</strong>
        </div>
      </div>

      <div className="timeline-board">
        <div className="timeline-grid">
          {telemetry.eventFeed.slice(0, 4).map((event) => (
            <div key={event.id} className="timeline-row">
              <strong>{event.time}</strong>
              <div>
                <span>{event.title}</span>
                <p>{event.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function OverviewPage({
  district,
  snapshot,
  analysis,
  briefing,
  city,
  activeActionsCount,
  publicIntel,
  publicIntelLoading,
  publicIntelError,
  telemetry,
  cityTelemetry,
  nextRefreshAt,
  secondsToRefresh,
}) {
  const kpis = [
    { label: 'Уровень воды', value: `${snapshot.overview.waterLevel}%` },
    { label: 'Давление', value: `${snapshot.overview.pressure} bar` },
    { label: 'Качество', value: `${snapshot.overview.quality}` },
    { label: 'ETA', value: `${snapshot.overview.responseEta} мин` },
    { label: 'Жалобы', value: `${snapshot.overview.complaints}` },
    { label: 'Активные меры', value: `${activeActionsCount}` },
  ]

  const compareRows = [
    {
      label: 'Покрытие',
      local: snapshot.overview.coverage,
      city: city.averageCoverage,
      suffix: '%',
    },
    {
      label: 'Качество',
      local: snapshot.overview.quality,
      city: city.averageQuality,
      suffix: '',
    },
    {
      label: 'Pressure',
      local: Math.round(snapshot.overview.pressure * 20),
      city: Math.round(city.averagePressure * 20),
      suffix: '',
      displayLocal: `${snapshot.overview.pressure} bar`,
      displayCity: `${city.averagePressure} bar`,
    },
  ]

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Обзор района</p>
          <h2>Ключевая картина района</h2>
        </div>
        <span className={`mini-tone tone-${analysis.tone}`}>{getToneLabel(analysis.tone)}</span>
      </div>

      <div className="page-grid page-grid-overview">
        <article className="content-card panel-surface hero-card overview-card-main">
          <div className="hero-card-topline">
            <div>
              <p className="eyebrow">Короткая сводка</p>
              <h3>{briefing.headline}</h3>
            </div>
            <div className={`hero-spotlight tone-${analysis.tone}`}>
              <span>Фокус района</span>
              <strong>{district}</strong>
              <small>{getToneLabel(analysis.tone)} • риск {analysis.riskScore}</small>
            </div>
          </div>
          <p className="body-text">{briefing.summary}</p>
          <div className="hero-ribbon">
            <span>Главный акцент смены</span>
            <strong>{briefing.directive}</strong>
          </div>
          <div className="kpi-grid-simple">
            {kpis.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <PublicIntelCard
          className="overview-card-side"
          publicIntel={publicIntel}
          loading={publicIntelLoading}
          error={publicIntelError}
          title="Что происходит снаружи"
        />
      </div>

      <div className="page-grid page-grid-overview">
        <article className="content-card panel-surface overview-card-wide">
          <p className="eyebrow">Район и город</p>
          <h3>{district} на фоне города</h3>
          <div className="compare-list">
            {compareRows.map((row) => {
              const localValue = row.displayLocal || `${row.local}${row.suffix}`
              const cityValue = row.displayCity || `${row.city}${row.suffix}`
              return (
                <div key={row.label} className="compare-row">
                  <div className="compare-head">
                    <span>{row.label}</span>
                    <strong>{localValue}</strong>
                  </div>
                  <div className="compare-track">
                    <div style={{ width: `${clamp(row.local, 0, 100)}%` }} />
                  </div>
                  <small>Среднее по городу: {cityValue}</small>
                </div>
              )
            })}
          </div>
        </article>

        <HealthMetricsCard analysis={analysis} briefing={briefing} className="overview-card-side" />
      </div>

      <div className="page-grid page-grid-overview">
        <article className="content-card panel-surface overview-card-side">
          <p className="eyebrow">Рекомендации</p>
          <h3>Ключевые акценты</h3>
          <ul className="simple-list">
            {briefing.recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <TelemetryMeshCard
          className="overview-card-wide"
          district={district}
          telemetry={telemetry}
          cityTelemetry={cityTelemetry}
          nextRefreshAt={nextRefreshAt}
          secondsToRefresh={secondsToRefresh}
          eyebrow="Сенсорная сеть"
          title="Хабы, датчики и цепочка эскалации"
        />
      </div>
    </section>
  )
}

function MapPage({
  selectedDistrict,
  districtStates,
  districtSnapshots,
  districtActions,
  onSelectDistrict,
  briefing,
  telemetry,
  cityTelemetry,
  nextRefreshAt,
  secondsToRefresh,
}) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Карта сети</p>
          <h2>Сеть Алматы на карте</h2>
        </div>
      </div>

      <AlmatyMap
        selectedDistrict={selectedDistrict}
        districtStates={districtStates}
        districtSnapshots={districtSnapshots}
        districtActions={districtActions}
        onSelectDistrict={onSelectDistrict}
        telemetry={telemetry}
        cityTelemetry={cityTelemetry}
        nextRefreshAt={nextRefreshAt}
        secondsToRefresh={secondsToRefresh}
      />

      <div className="page-grid page-grid-overview">
        <article className="content-card panel-surface page-card-compact">
          <p className="eyebrow">На контроле</p>
          <ul className="simple-list">
            {briefing.watchlist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <AutomationResponseCard
          className="page-card-priority"
          district={selectedDistrict}
          telemetry={telemetry}
          automation={telemetry.automation}
          cityTelemetry={cityTelemetry}
          nextRefreshAt={nextRefreshAt}
          secondsToRefresh={secondsToRefresh}
          eyebrow="Маршрут сигнала"
          title="Кто наблюдает и куда уходит сигнал"
        />
      </div>
    </section>
  )
}

function OperationsPage({
  selectedDistrict,
  baseSnapshot,
  snapshot,
  analysis,
  actions,
  operationsLog,
  onToggleAction,
  onRunAiPlan,
  onClearActions,
  briefing,
  publicIntel,
  publicIntelLoading,
  publicIntelError,
  canManageOperations,
  canRunAiPlan,
  telemetry,
  automation,
  cityTelemetry,
  nextRefreshAt,
  secondsToRefresh,
  activeActionCount,
}) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Рабочая смена</p>
          <h2>Пульт реагирования</h2>
        </div>
      </div>

      <div className="page-grid page-grid-overview">
        <OperationsConsole
          selectedDistrict={selectedDistrict}
          snapshot={snapshot}
          analysis={analysis}
          actions={actions}
          operationsLog={operationsLog}
          onToggleAction={onToggleAction}
          onRunAiPlan={onRunAiPlan}
          onClearActions={onClearActions}
          canManageOperations={canManageOperations}
          canRunAiPlan={canRunAiPlan}
          automation={automation}
          activeActionCount={activeActionCount}
        />

        <div className="page-stack">
          <OperationImpactCard beforeSnapshot={baseSnapshot} afterSnapshot={snapshot} className="page-card-priority" />

          <PublicIntelCard
            className="page-card-compact"
            publicIntel={publicIntel}
            loading={publicIntelLoading}
            error={publicIntelError}
            title="Внешний фон для диспетчера"
            eyebrow="Внешний фон"
          />

          <AutomationResponseCard
            className="page-card-priority"
            district={selectedDistrict}
            telemetry={telemetry}
            automation={automation}
            cityTelemetry={cityTelemetry}
            nextRefreshAt={nextRefreshAt}
            secondsToRefresh={secondsToRefresh}
          />

          <article className="content-card panel-surface">
            <p className="eyebrow">Текущий контекст</p>
            <div className="fact-stack">
              {briefing.watchlist.map((item) => (
                <div key={item} className="fact-row">
                  <span>Контроль</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}

function AnalyticsPage({
  district,
  snapshot,
  comparison,
  analysis,
  publicIntel,
  publicIntelLoading,
  publicIntelError,
  telemetry,
  automation,
  nextRefreshAt,
  secondsToRefresh,
  backendAnalytics,
  backendAnalyticsLoading,
  backendAnalyticsError,
}) {
  const healthBars = [
    { name: 'Risk', value: analysis.riskScore, tone: analysis.tone },
    { name: 'Resilience', value: analysis.resilience, tone: 'normal' },
    { name: 'Response', value: analysis.responseReadiness, tone: 'warning' },
    { name: 'Quality', value: analysis.qualityConfidence, tone: 'normal' },
    { name: 'Service', value: analysis.serviceBalance, tone: 'normal' },
  ]
  const localAverageRisk = Math.round(comparison.reduce((sum, item) => sum + item.risk, 0) / comparison.length)
  const localAverageResilience = Math.round(comparison.reduce((sum, item) => sum + item.resilience, 0) / comparison.length)
  const backendLatest = backendAnalytics?.latestCycle
  const backendCity = backendAnalytics?.city
  const backendTimeline = backendAnalytics?.timeline?.district || []
  const backendRecentEvents = backendAnalytics?.recentEvents || []
  const backendPatternSummary = backendAnalytics?.patternSummary
  const backendRanking = backendAnalytics?.ranking || []
  const districtRank =
    (backendRanking.length
      ? backendRanking.findIndex((item) => item.district === district) + 1
      : [...comparison].sort((left, right) => right.risk - left.risk).findIndex((item) => item.id === district) + 1) || 1
  const averageRisk = backendCity?.averageRisk ?? localAverageRisk
  const averageResilience = backendCity?.averageResilience ?? localAverageResilience
  const operationsMetrics = [
    { label: 'Инциденты', value: `${backendLatest?.incidents ?? snapshot.overview.incidents}` },
    { label: 'Жалобы', value: `${backendLatest?.complaints ?? snapshot.overview.complaints}` },
    { label: 'Response ETA', value: `${backendLatest?.responseEta ?? snapshot.overview.responseEta} мин` },
    { label: 'Нагрузка насосов', value: `${backendLatest?.pumpLoad ?? snapshot.overview.pumpLoad}%` },
    { label: 'Энергопотребление', value: `${snapshot.overview.energyUse}%` },
    { label: 'Полевые бригады', value: `${snapshot.overview.fieldTeams}` },
  ]
  const qualityMetrics = [
    { label: 'Качество воды', value: `${backendLatest?.quality ?? snapshot.overview.quality}` },
    { label: 'Покрытие', value: `${backendLatest?.coverage ?? snapshot.overview.coverage}%` },
    { label: 'Хлор', value: `${snapshot.overview.chlorine} мг/л` },
    { label: 'Мутность', value: `${snapshot.overview.turbidity} NTU` },
    { label: 'Частота проб', value: `${snapshot.overview.sampleRate}%` },
    { label: 'Потребление', value: formatNumber(backendLatest?.consumption ?? snapshot.overview.consumption) },
  ]
  const analyticsLiveMetrics = [
    { label: 'Активные сигналы', value: `${backendLatest?.activeSignals ?? telemetry.activeSensorCount}` },
    { label: 'Критичные датчики', value: `${backendLatest?.criticalSignals ?? telemetry.criticalCount}` },
    { label: 'Циклы на сервере', value: `${backendPatternSummary?.cyclesStored ?? 0}` },
    { label: 'Следующий цикл', value: formatRefreshCountdown(secondsToRefresh) },
  ]

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Аналитика</p>
          <h2>Тренды и сравнение</h2>
        </div>
      </div>

      <div className="analytics-priority-grid">
        <article className="content-card panel-surface analytics-overview-card">
          <p className="eyebrow">Живой контур района</p>
          <h3>{district} в текущем цикле мониторинга и серверной истории</h3>
          <p className="body-text">
            Аналитика синхронизирована с живым циклом датчиков и накопленной серверной историей.
            {' '}
            {backendPatternSummary?.cyclesStored
              ? `Backend уже сохранил ${backendPatternSummary.cyclesStored} цикл(ов) наблюдения.`
              : 'История начнёт накапливаться после первых серверных циклов.'}
            {' '}
            Ближайшее обновление в {formatRefreshTime(nextRefreshAt)}.
          </p>
          <div className="kpi-grid-simple analytics-live-grid">
            {analyticsLiveMetrics.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card panel-surface analytics-rank-card">
          <p className="eyebrow">Позиция района</p>
          <h3>
            {districtRank} из {comparison.length}
          </h3>
          <div className="fact-stack">
            <div className="fact-row">
              <span>Средний риск по городу</span>
              <p>{averageRisk}</p>
            </div>
            <div className="fact-row">
              <span>Средняя устойчивость</span>
              <p>{averageResilience}%</p>
            </div>
            <div className="fact-row">
              <span>Наблюдение</span>
              <p>{backendLatest?.monitoredFrom || automation.monitoredFrom}</p>
            </div>
          </div>
        </article>
      </div>

      <div className="analytics-kpi-grid">
        <article className="content-card panel-surface analytics-kpi-card">
          <span className="eyebrow">Индекс риска</span>
          <h3>{analysis.riskScore}</h3>
          <p className="body-text">Сводный локальный риск района по телеметрии и инцидентам.</p>
        </article>
        <article className="content-card panel-surface analytics-kpi-card">
          <span className="eyebrow">Устойчивость</span>
          <h3>{analysis.resilience}%</h3>
          <p className="body-text">Оставшийся запас устойчивости по модели района.</p>
        </article>
        <article className="content-card panel-surface analytics-kpi-card">
          <span className="eyebrow">Готовность</span>
          <h3>{analysis.responseReadiness}%</h3>
          <p className="body-text">Готовность района выдержать эскалацию без срыва SLA.</p>
        </article>
        <article className="content-card panel-surface analytics-kpi-card">
          <span className="eyebrow">Внешний пик</span>
          <h3>{publicIntel?.peakHour?.stressIndex ?? '--'}</h3>
          <p className="body-text">Пиковый внешний стресс по открытым данным и погодному фону.</p>
        </article>
      </div>

      <div className="analytics-detail-grid">
        <article className="content-card panel-surface analytics-detail-card">
          <p className="eyebrow">Профиль смены</p>
          <h3>Живая картина смены</h3>
          <div className="kpi-grid-simple">
            {operationsMetrics.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card panel-surface analytics-detail-card">
          <p className="eyebrow">Качество и гидравлика</p>
          <h3>Лаборатория и гидравлика</h3>
          <div className="kpi-grid-simple">
            {qualityMetrics.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card panel-surface analytics-detail-card">
          <p className="eyebrow">Backend summary</p>
          <h3>Что backend уже понял по району</h3>
          <div className="fact-stack">
            <div className="fact-row">
              <span>Место по риску</span>
              <p>
                {districtRank} из {comparison.length}. Средний риск по городу: {averageRisk}, у района:
                {' '}
                {backendLatest?.riskScore ?? analysis.riskScore}.
              </p>
            </div>
            <div className="fact-row">
              <span>Доминирующий сценарий</span>
              <p>
                {backendPatternSummary?.dominantScenario || snapshot.scenarioLabel}. Среднее число авто-мер по району:
                {' '}
                {backendPatternSummary?.averageActionCount ?? automation.activeActionIds.length}.
              </p>
            </div>
            <div className="fact-row">
              <span>Риск по истории</span>
              <p>
                {backendPatternSummary
                  ? `За накопленную историю backend видит дельту риска ${backendPatternSummary.riskDelta}. Самый турбулентный район в последнем серверном цикле: ${backendPatternSummary.mostTurbulentDistrict}.`
                  : 'Серверный pattern summary появится после накопления нескольких циклов.'}
              </p>
            </div>
          </div>
        </article>

        <article className="content-card panel-surface analytics-detail-card">
          <p className="eyebrow">Backend events</p>
          <h3>Последние события из базы</h3>
          {backendAnalyticsLoading ? (
            <div className="fact-stack">
              <div className="fact-row">
                <span>Сервер</span>
                <p>Загружаю события и историю из backend.</p>
              </div>
            </div>
          ) : backendAnalyticsError ? (
            <div className="fact-stack">
              <div className="fact-row">
                <span>Сервер</span>
                <p>{backendAnalyticsError}</p>
              </div>
            </div>
          ) : backendRecentEvents.length ? (
            <div className="fact-stack">
              {backendRecentEvents.slice(0, 3).map((event) => (
                <div key={event.id} className="fact-row">
                  <span>{event.label}</span>
                  <p>
                    {event.title}. {event.district ? `${event.district}. ` : ''}
                    {event.metric ? `${event.metric}. ` : ''}
                    {event.source}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="fact-stack">
              <div className="fact-row">
                <span>События</span>
                <p>Backend пока не накопил событий для этой зоны.</p>
              </div>
            </div>
          )}
        </article>
      </div>

      <div className="page-grid page-grid-analytics">
        {backendTimeline.length ? (
          <article className="content-card panel-surface analytics-chart-primary">
            <p className="eyebrow">Server history</p>
            <div className="simple-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={backendTimeline}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                  <XAxis dataKey="label" stroke="#7690a4" />
                  <YAxis stroke="#7690a4" domain={[0, 100]} />
                  <Tooltip {...chartTooltip} />
                  <Line type="monotone" dataKey="riskScore" stroke="#ff7b86" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="resilience" stroke="#4caef7" strokeWidth={2.2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
        ) : null}

        {backendTimeline.length ? (
          <article className="content-card panel-surface analytics-chart-secondary">
            <p className="eyebrow">Server signals</p>
            <div className="simple-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={backendTimeline}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                  <XAxis dataKey="label" stroke="#7690a4" />
                  <YAxis stroke="#7690a4" />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="activeSignals" fill="#4caef7" radius={[10, 10, 0, 0]} />
                  <Bar dataKey="criticalSignals" fill="#ff7b86" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        ) : null}

        <article className="content-card panel-surface analytics-chart-primary">
          <p className="eyebrow">Контур устойчивости</p>
          <div className="simple-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={healthBars}>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                <XAxis dataKey="name" stroke="#7690a4" />
                <YAxis stroke="#7690a4" domain={[0, 100]} />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                  {healthBars.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.tone === 'critical' ? '#ff7b86' : entry.tone === 'warning' ? '#ffbf62' : '#4caef7'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="content-card panel-surface analytics-chart-secondary">
          <p className="eyebrow">Внешний стресс</p>
          {publicIntelLoading ? (
            <div className="sidebar-hero-card">
              <strong>Загружаю публичный прогноз</strong>
              <p>Строю внешний контур риска по открытым данным.</p>
            </div>
          ) : publicIntelError ? (
            <div className="sidebar-hero-card">
              <strong>Публичная аналитика недоступна</strong>
              <p>{publicIntelError}</p>
            </div>
          ) : publicIntel ? (
            <div className="simple-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={publicIntel.hourly}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                  <XAxis dataKey="label" stroke="#7690a4" />
                  <YAxis stroke="#7690a4" domain={[0, 100]} />
                  <Tooltip {...chartTooltip} />
                  <Line type="monotone" dataKey="stressIndex" stroke="#ff7b86" strokeWidth={2.5} dot={false} />
                  <Line
                    type="monotone"
                    dataKey="precipitationProbability"
                    stroke="#4caef7"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </article>

        <article className="content-card panel-surface analytics-chart-secondary">
          <p className="eyebrow">Потребление</p>
          <div className="simple-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapshot.trends.consumption}>
                <defs>
                  <linearGradient id="miniFlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4caef7" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4caef7" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                <XAxis dataKey="time" stroke="#7690a4" />
                <YAxis stroke="#7690a4" />
                <Tooltip {...chartTooltip} />
                <Area type="monotone" dataKey="value" stroke="#3299eb" strokeWidth={2.5} fill="url(#miniFlow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="content-card panel-surface analytics-chart-secondary">
          <p className="eyebrow">Давление</p>
          <div className="simple-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snapshot.trends.pressure}>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                <XAxis dataKey="time" stroke="#7690a4" />
                <YAxis stroke="#7690a4" />
                <Tooltip {...chartTooltip} />
                <Line type="monotone" dataKey="value" stroke="#7f8dff" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="content-card panel-surface analytics-chart-secondary">
          <p className="eyebrow">Качество</p>
          <div className="simple-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snapshot.trends.quality}>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                <XAxis dataKey="time" stroke="#7690a4" />
                <YAxis stroke="#7690a4" />
                <Tooltip {...chartTooltip} />
                <Line type="monotone" dataKey="value" stroke="#35c8a6" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="content-card panel-surface analytics-chart-primary">
          <p className="eyebrow">Сравнение районов</p>
          <div className="simple-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparison}>
                <CartesianGrid strokeDasharray="4 4" stroke="#e2ebf2" />
                <XAxis dataKey="name" stroke="#7690a4" />
                <YAxis stroke="#7690a4" />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="risk" radius={[10, 10, 0, 0]}>
                  {comparison.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.tone === 'critical' ? '#ff7b86' : entry.tone === 'warning' ? '#ffbf62' : '#4caef7'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </section>
  )
}

function AiPage({
  context,
  districtSnapshots,
  operationsLog,
  onRunAiPlan,
  publicIntel,
  publicIntelLoading,
  publicIntelError,
  canRunAiPlan,
}) {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Помощник</p>
          <h2>Рабочий помощник для поиска, ответов и контроля системы</h2>
        </div>
      </div>

      <AiCenter
        context={context}
        districtSnapshots={districtSnapshots}
        operationsLog={operationsLog}
        onRunAiPlan={onRunAiPlan}
        publicIntel={publicIntel}
        publicIntelLoading={publicIntelLoading}
        publicIntelError={publicIntelError}
        canRunAiPlan={canRunAiPlan}
      />
    </section>
  )
}

function App() {
  const [session, setSession] = useState(getStoredSession)
  const [activePage, setActivePage] = useState(getInitialPage)
  const [isAccessPanelOpen, setIsAccessPanelOpen] = useState(false)
  const [authForm, setAuthForm] = useState({ username: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [accessNotice, setAccessNotice] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState(() => demoAccounts[0]?.id || '')
  const [selectedPrivilegeIds, setSelectedPrivilegeIds] = useState(() => demoAccounts[0]?.privilegeIds || [])
  const [selectedDistrict, setSelectedDistrict] = useState('Бостандыкский')
  const [activeScenario, setActiveScenario] = useState('baseline')
  const [districtActions, setDistrictActions] = useState({})
  const [operationsLog, setOperationsLog] = useState([])
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [monitorCycle, setMonitorCycle] = useState(0)
  const [lastMonitorUpdateAt, setLastMonitorUpdateAt] = useState(() => new Date())
  const [publicIntel, setPublicIntel] = useState(null)
  const [publicIntelLoading, setPublicIntelLoading] = useState(true)
  const [publicIntelError, setPublicIntelError] = useState('')
  const [autopilotState, setAutopilotState] = useState({
    token: '',
    decisionSource: 'local-fallback',
    automationByDistrict: null,
    selectedDistrictSummary: null,
  })
  const [serverSync, setServerSync] = useState({
    status: 'idle',
    lastSyncAt: '',
    lastError: '',
    storedRecords: 0,
  })
  const [backendAnalytics, setBackendAnalytics] = useState(null)
  const [backendAnalyticsLoading, setBackendAnalyticsLoading] = useState(true)
  const [backendAnalyticsError, setBackendAnalyticsError] = useState('')
  const telemetryBucket = monitorCycle
  const nextTelemetryRefresh = new Date(lastMonitorUpdateAt.getTime() + LIVE_MONITOR_INTERVAL_MS)
  const secondsToTelemetryRefresh = Math.max(
    0,
    Math.ceil((nextTelemetryRefresh.getTime() - currentTime.getTime()) / 1000),
  )
  const latestAutopilotTokenRef = useRef('')
  const visiblePages = useMemo(
    () => pages.filter((page) => session.pageIds.includes(page.id)),
    [session],
  )
  const isStaffMode = session.access === 'staff'
  const canManageOperations = session.privilegeIds?.includes('manage_operations')
  const canRunAiPlan = session.privilegeIds?.includes('run_ai_plan')
  const canSwitchDistrict = session.privilegeIds?.includes('switch_district')
  const canControlScenarios = session.privilegeIds?.includes('control_scenarios')

  useEffect(() => {
    const syncPage = () => setActivePage(getInitialPage())
    window.addEventListener('hashchange', syncPage)
    if (!window.location.hash) {
      window.location.hash = 'overview'
    }

    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMonitorCycle((current) => current + 1)
      setLastMonitorUpdateAt(new Date())
    }, LIVE_MONITOR_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    window.localStorage.setItem(
      sessionStorageKey,
      JSON.stringify({
        id: session.id,
        privilegeIds: session.privilegeIds,
      }),
    )
    return undefined
  }, [session])

  useEffect(() => {
    if (isAccessPanelOpen) {
      return
    }

    const currentAccount = demoAccounts.find((account) => account.id === session.id) || demoAccounts[0]
    if (!currentAccount) {
      return
    }

    setSelectedProfileId(currentAccount.id)
    setSelectedPrivilegeIds(session.access === 'staff' ? session.privilegeIds : currentAccount.privilegeIds)
  }, [isAccessPanelOpen, session])

  useEffect(() => {
    if (!isAccessPanelOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsAccessPanelOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAccessPanelOpen])

  const scenarioSnapshots = useMemo(() => {
    return districtOrder.reduce((acc, district) => {
      acc[district] = getDistrictScenarioSnapshot(districts[district], scenarioProfiles[activeScenario])
      return acc
    }, {})
  }, [activeScenario])

  const manualDistrictSnapshots = useMemo(() => {
    return districtOrder.reduce((acc, district) => {
      acc[district] = applyOperationalActions(scenarioSnapshots[district], districtActions[district])
      return acc
    }, {})
  }, [districtActions, scenarioSnapshots])

  const liveDistrictSnapshots = useMemo(() => {
    return districtOrder.reduce((acc, district) => {
      acc[district] = applyLiveSnapshotDrift(manualDistrictSnapshots[district], district, telemetryBucket, activeScenario)
      return acc
    }, {})
  }, [activeScenario, manualDistrictSnapshots, telemetryBucket])

  const telemetryDraft = useMemo(
    () =>
      buildTelemetryNetwork({
        districtSnapshots: liveDistrictSnapshots,
        refreshBucket: telemetryBucket,
      }),
    [liveDistrictSnapshots, telemetryBucket],
  )

  const localAutomationByDistrict = useMemo(
    () => deriveAutomationPlan(telemetryDraft),
    [telemetryDraft],
  )

  const districtActionsSignature = useMemo(() => JSON.stringify(districtActions), [districtActions])
  const autopilotToken = useMemo(
    () => `${activeScenario}:${telemetryBucket}:${districtActionsSignature}`,
    [activeScenario, districtActionsSignature, telemetryBucket],
  )

  useEffect(() => {
    const controller = new AbortController()
    latestAutopilotTokenRef.current = autopilotToken

    requestAutopilotDecision(
      {
        token: autopilotToken,
        selectedDistrict,
        activeScenario: normalizeAiScenario(activeScenario),
        refreshBucket: telemetryBucket,
        districtSnapshots: liveDistrictSnapshots,
      },
      controller.signal,
    )
      .then((payload) => {
        if (latestAutopilotTokenRef.current !== payload.token) {
          return
        }

        setAutopilotState({
          token: payload.token,
          decisionSource: payload.decisionSource,
          automationByDistrict: payload.automationByDistrict,
          selectedDistrictSummary: payload.selectedDistrictSummary,
        })
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }

        setAutopilotState((current) => ({
          ...current,
          token: '',
          decisionSource: 'local-fallback',
          automationByDistrict: null,
        }))
      })

    return () => controller.abort()
  }, [activeScenario, autopilotToken, liveDistrictSnapshots, selectedDistrict, telemetryBucket])

  const automationByDistrict = useMemo(
    () =>
      autopilotState.token === autopilotToken && autopilotState.automationByDistrict
        ? autopilotState.automationByDistrict
        : localAutomationByDistrict,
    [autopilotState.automationByDistrict, autopilotState.token, autopilotToken, localAutomationByDistrict],
  )

  const districtSnapshots = useMemo(() => {
    return districtOrder.reduce((acc, district) => {
      acc[district] = applyAutomationResponses(liveDistrictSnapshots[district], automationByDistrict[district])
      return acc
    }, {})
  }, [automationByDistrict, liveDistrictSnapshots])

  const telemetryNetwork = useMemo(
    () =>
      buildTelemetryNetwork({
        districtSnapshots,
        refreshBucket: telemetryBucket,
        automationByDistrict,
      }),
    [automationByDistrict, districtSnapshots, telemetryBucket],
  )

  const selectedSnapshot = districtSnapshots[selectedDistrict]
  const selectedBaseSnapshot = scenarioSnapshots[selectedDistrict]
  const selectedTelemetry = telemetryNetwork.districts[selectedDistrict]
  const selectedAutomation = automationByDistrict[selectedDistrict] || {
    activeActionIds: [],
    monitoredFrom: `${selectedDistrict} хаб`,
    escalateToCenter: false,
    escalateToAkimat: false,
    reason: 'AI не активировал автоматические меры.',
  }
  const autopilotSummary = autopilotState.selectedDistrictSummary || {
    district: selectedDistrict,
    decisionSource: autopilotState.decisionSource,
    reason: selectedAutomation.reason,
  }
  const analysis = useMemo(() => analyzeSnapshot(selectedSnapshot), [selectedSnapshot])
  const city = useMemo(() => getCitySnapshot(districtSnapshots), [districtSnapshots])
  const briefing = useMemo(
    () => buildAiBriefing(selectedDistrict, selectedSnapshot, analysis, pageToViewMode(activePage), activeScenario),
    [selectedDistrict, selectedSnapshot, analysis, activePage, activeScenario],
  )

  const liveSignals = useMemo(() => {
    const alertsByDistrict = {}
    const alertFeed = districtOrder
      .flatMap((district) => {
        const districtSnapshot = districtSnapshots[district]
        const districtAnalysis = analyzeSnapshot(districtSnapshot)
        const districtAlerts = buildSensorAlerts(
          {
            district,
            snapshot: districtSnapshot,
            analysis: districtAnalysis,
            city,
            activeScenario: normalizeAiScenario(activeScenario),
            telemetry: telemetryNetwork.districts[district],
            cityTelemetry: telemetryNetwork.city,
            automation: automationByDistrict[district],
          },
          districtSnapshots,
          operationsLog,
        ).map((alert) => ({
          ...alert,
          id: `${district}-${alert.id}`,
          district,
        }))

        alertsByDistrict[district] = districtAlerts
        return districtAlerts
      })
      .sort((left, right) => {
        const rank = { critical: 3, warning: 2, normal: 1 }
        return rank[right.severity] - rank[left.severity]
      })
      .slice(0, 10)

    return {
      alertsByDistrict,
      alertFeed,
    }
  }, [activeScenario, automationByDistrict, city, districtSnapshots, operationsLog, telemetryNetwork])

  const districtStates = useMemo(
    () =>
      districtOrder.reduce((acc, district) => {
        const snapshot = districtSnapshots[district]
        const current = analyzeSnapshot(snapshot)
        acc[district] = {
          tone: current.tone,
          resilience: current.resilience,
          coverage: snapshot.overview.coverage,
          quality: snapshot.overview.quality,
          zone: snapshot.meta.zone,
        }
        return acc
      }, {}),
    [districtSnapshots],
  )

  useEffect(() => {
    let active = true

    setPublicIntelLoading(true)
    setPublicIntelError('')

    fetchPublicIntel({
      district: selectedDistrict,
      scenario: activeScenario,
    })
      .then((data) => {
        if (!active) {
          return
        }

        setPublicIntel(data)
      })
      .catch((requestError) => {
        if (!active) {
          return
        }

        setPublicIntel(null)
        setPublicIntelError(requestError.message)
      })
      .finally(() => {
        if (active) {
          setPublicIntelLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedDistrict, activeScenario])

  useEffect(() => {
    const controller = new AbortController()

    setBackendAnalyticsLoading(true)
    setBackendAnalyticsError('')

    fetchAnalyticsSummary(
      {
        district: selectedDistrict,
        limit: 12,
      },
      controller.signal,
    )
      .then((payload) => {
        setBackendAnalytics(payload)
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return
        }

        setBackendAnalytics(null)
        setBackendAnalyticsError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBackendAnalyticsLoading(false)
        }
      })

    return () => controller.abort()
  }, [selectedDistrict, serverSync.lastSyncAt])

  const comparison = useMemo(
    () =>
      districtOrder.map((district) => {
        const current = analyzeSnapshot(districtSnapshots[district])
        return {
          id: district,
          name: district.replace('ский', ''),
          risk: current.riskScore,
          resilience: current.resilience,
          tone: current.tone,
        }
      }),
    [districtSnapshots],
  )

  useEffect(() => {
    const controller = new AbortController()

    setServerSync((current) => ({
      ...current,
      status: 'syncing',
      lastError: '',
    }))

    ingestLiveTelemetry(
      {
        token: autopilotToken,
        activeScenario,
        selectedDistrict,
        selectedPage: activePage,
        session: {
          id: session.id,
          access: session.access,
          roleTitle: session.roleTitle,
        },
        districtSnapshots,
        city,
        telemetryNetwork,
        automationByDistrict,
        alertFeed: liveSignals.alertFeed,
        operationsLog,
      },
      controller.signal,
    )
      .then((payload) => {
        setServerSync({
          status: 'synced',
          lastSyncAt: payload.receivedAt,
          lastError: '',
          storedRecords: payload.storedRecords || 0,
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return
        }

        setServerSync((current) => ({
          ...current,
          status: 'error',
          lastError: error.message,
        }))
      })

    return () => controller.abort()
  }, [
    activePage,
    activeScenario,
    autopilotToken,
    automationByDistrict,
    city,
    districtSnapshots,
    liveSignals.alertFeed,
    operationsLog,
    selectedDistrict,
    session.access,
    session.id,
    session.roleTitle,
    telemetryNetwork,
  ])

  useEffect(() => {
    if (visiblePages.some((page) => page.id === activePage)) {
      return
    }

    const fallbackPage = visiblePages.find((page) => page.id === session.homePage) || visiblePages[0]
    if (!fallbackPage) {
      return
    }

    window.location.hash = fallbackPage.id
    setActivePage(fallbackPage.id)
  }, [activePage, session.homePage, visiblePages])

  const activeActionsCountTotal = new Set([
    ...Object.entries(districtActions[selectedDistrict] || {})
      .filter(([, enabled]) => enabled)
      .map(([actionId]) => actionId),
    ...selectedAutomation.activeActionIds,
  ]).size

  const aiContext = useMemo(
    () => ({
      district: selectedDistrict,
      snapshot: selectedSnapshot,
      analysis,
      city,
      viewMode: pageToViewMode(activePage),
      activeScenario: normalizeAiScenario(activeScenario),
      briefing,
      telemetry: selectedTelemetry,
      cityTelemetry: telemetryNetwork.city,
      automation: selectedAutomation,
    }),
    [
      selectedDistrict,
      selectedSnapshot,
      analysis,
      city,
      activePage,
      activeScenario,
      briefing,
      selectedTelemetry,
      selectedAutomation,
      telemetryNetwork.city,
    ],
  )

  const openAccessPanel = () => {
    setAuthError('')
    setAccessNotice('')
    setIsAccessPanelOpen(true)
  }

  const handlePageChange = (page) => {
    window.location.hash = page
    setActivePage(page)
  }

  const handleSelectDistrict = (district) => {
    if (!canSwitchDistrict) {
      return
    }

    setSelectedDistrict(district)
  }

  const handleScenarioChange = (scenarioKey) => {
    if (!canControlScenarios) {
      return
    }

    setActiveScenario(scenarioKey)
  }

  const handleAccessFormChange = (event) => {
    const { name, value } = event.target
    setAuthForm((current) => ({ ...current, [name]: value }))
    setAuthError('')
  }

  const handleUseWorkProfile = (accountId) => {
    const account = demoAccounts.find((item) => item.id === accountId)
    if (!account) {
      return
    }

    setSelectedProfileId(account.id)
    setSelectedPrivilegeIds(account.privilegeIds)
    setAuthForm({
      username: account.username,
      password: account.password,
    })
    setAuthError('')
    setAccessNotice('')
  }

  const handleTogglePrivilege = (privilegeId) => {
    setSelectedPrivilegeIds((current) =>
      current.includes(privilegeId) ? current.filter((item) => item !== privilegeId) : [...current, privilegeId],
    )
    setAuthError('')
  }

  const handleResetPrivileges = () => {
    const account = demoAccounts.find((item) => item.id === selectedProfileId)
    if (!account) {
      return
    }

    setSelectedPrivilegeIds(account.privilegeIds)
    setAuthError('')
    setAccessNotice('')
  }

  const handleGuestMode = () => {
    const nextSession = createSession('public')
    setSession(nextSession)
    setIsAccessPanelOpen(false)
    setAuthError('')
    setAccessNotice('')
    setAuthForm({ username: '', password: '' })
    window.location.hash = nextSession.homePage
    setActivePage(nextSession.homePage)
  }

  const handleWorkerLogin = (event) => {
    event.preventDefault()

    const normalizedUsername = authForm.username.trim().toLowerCase()
    const normalizedPassword = authForm.password.trim()
    const account = demoAccounts.find(
      (item) => item.username === normalizedUsername && item.password === normalizedPassword,
    )

    if (!account) {
      setAuthError('Неверный логин или пароль. Используй один из рабочих профилей справа.')
      return
    }

    const privilegeIds = selectedProfileId === account.id ? dedupePrivileges(selectedPrivilegeIds) : account.privilegeIds
    if (!getPageIdsFromPrivileges(privilegeIds).length) {
      setAuthError('Нужно оставить хотя бы один доступный раздел для входа в рабочий профиль.')
      return
    }

    const nextSession = createSession(account.id, privilegeIds)
    setSession(nextSession)
    setIsAccessPanelOpen(false)
    setAuthError('')
    setAccessNotice('')
    window.location.hash = nextSession.homePage
    setActivePage(nextSession.homePage)
  }

  const handleToggleSessionPrivilege = (privilegeId) => {
    let nextNotice = ''

    setSession((currentSession) => {
      if (currentSession.access !== 'staff') {
        return currentSession
      }

      const currentPrivilegeIds = dedupePrivileges(currentSession.privilegeIds)
      const nextPrivilegeIds = currentPrivilegeIds.includes(privilegeId)
        ? currentPrivilegeIds.filter((item) => item !== privilegeId)
        : [...currentPrivilegeIds, privilegeId]

      if (!getPageIdsFromPrivileges(nextPrivilegeIds).length) {
        nextNotice = 'Нужно оставить хотя бы один рабочий раздел, иначе профиль не сможет открыть интерфейс.'
        return currentSession
      }

      nextNotice = nextPrivilegeIds.includes(privilegeId)
        ? `${getPrivilegeLabel(privilegeId)} включён для текущей сессии.`
        : `${getPrivilegeLabel(privilegeId)} отключён для текущей сессии.`

      return createSession(currentSession.id, nextPrivilegeIds)
    })

    if (nextNotice) {
      setAccessNotice(nextNotice)
    }
  }

  const handleResetSessionPrivileges = () => {
    if (session.access !== 'staff') {
      return
    }

    const account = demoAccounts.find((item) => item.id === session.id)
    if (!account) {
      return
    }

    setSession(createSession(account.id, account.privilegeIds))
    setAccessNotice('Права профиля восстановлены по умолчанию.')
  }

  const handleToggleAction = (actionId) => {
    if (!canManageOperations) {
      return
    }

    const nextEnabled = !districtActions[selectedDistrict]?.[actionId]
    setDistrictActions((current) => ({
      ...current,
      [selectedDistrict]: {
        ...current[selectedDistrict],
        [actionId]: nextEnabled,
      },
    }))
    setOperationsLog((current) => [
      makeOperationLogEntry(selectedDistrict, actionId, nextEnabled),
      ...current,
    ].slice(0, 8))
  }

  const handleRunAiPlan = () => {
    if (!canRunAiPlan) {
      return
    }

    const suggested = getSuggestedOperations(analysis)
    const currentActions = districtActions[selectedDistrict] || {}

    setDistrictActions((current) => ({
      ...current,
      [selectedDistrict]: suggested.reduce(
        (acc, actionId) => ({ ...acc, [actionId]: true }),
        { ...current[selectedDistrict] },
      ),
    }))

    setOperationsLog((current) => [
      ...suggested
        .filter((actionId) => !currentActions[actionId])
        .map((actionId) => makeOperationLogEntry(selectedDistrict, actionId, true)),
      ...current,
    ].slice(0, 8))
  }

  const handleClearActions = () => {
    if (!canManageOperations) {
      return
    }

    const activeActionIds = Object.entries(districtActions[selectedDistrict] || {})
      .filter(([, enabled]) => enabled)
      .map(([actionId]) => actionId)

    if (!activeActionIds.length) {
      return
    }

    setDistrictActions((current) => ({ ...current, [selectedDistrict]: {} }))
    setOperationsLog((current) => [
      ...activeActionIds.map((actionId) => makeOperationLogEntry(selectedDistrict, actionId, false)),
      ...current,
    ].slice(0, 8))
  }

  return (
    <div className={`app-shell-v5 minimal-mode split-app-shell ${isStaffMode ? 'app-mode-staff' : 'app-mode-public'}`}>
      <main className={isStaffMode ? 'split-layout' : 'public-layout'}>
        {isStaffMode ? (
          <SidePanel
            selectedDistrict={selectedDistrict}
            onSelectDistrict={handleSelectDistrict}
            activeScenario={activeScenario}
            onScenarioChange={handleScenarioChange}
            districtStates={districtStates}
            city={city}
            analysis={analysis}
            canSwitchDistrict={canSwitchDistrict}
            canControlScenarios={canControlScenarios}
          />
        ) : null}

        <section className="split-main">
          <AppHeader
            activePage={activePage}
            onPageChange={handlePageChange}
            city={city}
            currentTime={currentTime}
            activeScenario={activeScenario}
            visiblePages={visiblePages}
            session={session}
            onOpenAccessPanel={openAccessPanel}
          />

          {isStaffMode ? (
            <AccessRibbon
              session={session}
              onOpenAccessPanel={openAccessPanel}
              onExitToGuest={handleGuestMode}
              onToggleSessionPrivilege={handleToggleSessionPrivilege}
              onResetSessionPrivileges={handleResetSessionPrivileges}
              accessNotice={accessNotice}
            />
          ) : null}

          {!isStaffMode ? (
            <PublicControlBar
              selectedDistrict={selectedDistrict}
              onSelectDistrict={handleSelectDistrict}
              activeScenario={activeScenario}
              onScenarioChange={handleScenarioChange}
              canSwitchDistrict={canSwitchDistrict}
              canControlScenarios={canControlScenarios}
            />
          ) : null}

          <ShellStatusBar
            district={selectedDistrict}
            scenario={activeScenario}
            analysis={analysis}
            snapshot={selectedSnapshot}
            activeActionsCount={activeActionsCountTotal}
            isStaffMode={isStaffMode}
          />

          <LiveControlStrip
            selectedDistrict={selectedDistrict}
            selectedAutomation={selectedAutomation}
            alertFeed={liveSignals.alertFeed}
            serverSync={serverSync}
            autopilotSummary={autopilotSummary}
            nextRefreshAt={nextTelemetryRefresh}
            secondsToRefresh={secondsToTelemetryRefresh}
          />

          {activePage === 'overview' ? (
            <OverviewPage
              district={selectedDistrict}
              snapshot={selectedSnapshot}
              analysis={analysis}
              briefing={briefing}
              city={city}
              activeActionsCount={activeActionsCountTotal}
              publicIntel={publicIntel}
              publicIntelLoading={publicIntelLoading}
              publicIntelError={publicIntelError}
              telemetry={selectedTelemetry}
              cityTelemetry={telemetryNetwork.city}
              nextRefreshAt={nextTelemetryRefresh}
              secondsToRefresh={secondsToTelemetryRefresh}
            />
          ) : null}

          {activePage === 'map' ? (
            <MapPage
              selectedDistrict={selectedDistrict}
              districtStates={districtStates}
              districtSnapshots={districtSnapshots}
              districtActions={districtActions}
              onSelectDistrict={handleSelectDistrict}
              briefing={briefing}
              telemetry={selectedTelemetry}
              cityTelemetry={telemetryNetwork.city}
              nextRefreshAt={nextTelemetryRefresh}
              secondsToRefresh={secondsToTelemetryRefresh}
            />
          ) : null}

          {activePage === 'operations' ? (
            <OperationsPage
              selectedDistrict={selectedDistrict}
              baseSnapshot={selectedBaseSnapshot}
              snapshot={selectedSnapshot}
              analysis={analysis}
              actions={districtActions[selectedDistrict] || {}}
              operationsLog={operationsLog}
              onToggleAction={handleToggleAction}
              onRunAiPlan={handleRunAiPlan}
              onClearActions={handleClearActions}
              briefing={briefing}
              publicIntel={publicIntel}
              publicIntelLoading={publicIntelLoading}
              publicIntelError={publicIntelError}
              canManageOperations={canManageOperations}
              canRunAiPlan={canRunAiPlan}
              telemetry={selectedTelemetry}
              automation={selectedAutomation}
              cityTelemetry={telemetryNetwork.city}
              nextRefreshAt={nextTelemetryRefresh}
              secondsToRefresh={secondsToTelemetryRefresh}
              activeActionCount={activeActionsCountTotal}
            />
          ) : null}

          {activePage === 'analytics' ? (
            <AnalyticsPage
              district={selectedDistrict}
              snapshot={selectedSnapshot}
              comparison={comparison}
              analysis={analysis}
              publicIntel={publicIntel}
              publicIntelLoading={publicIntelLoading}
              publicIntelError={publicIntelError}
              telemetry={selectedTelemetry}
              automation={selectedAutomation}
              nextRefreshAt={nextTelemetryRefresh}
              secondsToRefresh={secondsToTelemetryRefresh}
              backendAnalytics={backendAnalytics}
              backendAnalyticsLoading={backendAnalyticsLoading}
              backendAnalyticsError={backendAnalyticsError}
            />
          ) : null}

          {activePage === 'ai' ? (
            <AiPage
              context={aiContext}
              districtSnapshots={districtSnapshots}
              operationsLog={operationsLog}
              onRunAiPlan={handleRunAiPlan}
              publicIntel={publicIntel}
              publicIntelLoading={publicIntelLoading}
              publicIntelError={publicIntelError}
              canRunAiPlan={canRunAiPlan}
            />
          ) : null}
        </section>
      </main>

      <AccountAccessPanel
        isOpen={isAccessPanelOpen}
        authForm={authForm}
        authError={authError}
        selectedProfileId={selectedProfileId}
        selectedPrivilegeIds={selectedPrivilegeIds}
        onClose={() => setIsAccessPanelOpen(false)}
        onAuthChange={handleAccessFormChange}
        onSubmit={handleWorkerLogin}
        onUseGuestMode={handleGuestMode}
        onUseWorkProfile={handleUseWorkProfile}
        onTogglePrivilege={handleTogglePrivilege}
        onResetPrivileges={handleResetPrivileges}
      />
    </div>
  )
}

export default App
