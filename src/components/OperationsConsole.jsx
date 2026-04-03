import { operationCatalog } from '../utils/operations'

export function OperationsConsole({
  selectedDistrict,
  snapshot,
  analysis,
  actions,
  operationsLog,
  onToggleAction,
  onRunAiPlan,
  onClearActions,
  canManageOperations,
  canRunAiPlan,
  automation,
  activeActionCount,
}) {
  const activeCount = activeActionCount ?? Object.values(actions || {}).filter(Boolean).length

  return (
    <section className="operations-console panel-surface anim delay-8">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Операции</p>
          <h3>Пульт вмешательства</h3>
        </div>
        <span className="section-note">Любое действие сразу меняет расчёт по выбранному району прямо в интерфейсе</span>
      </div>

      <div className="operations-topline">
        <article>
          <span>Район</span>
          <strong>{selectedDistrict}</strong>
        </article>
        <article>
          <span>Активные меры</span>
          <strong>{activeCount}</strong>
        </article>
        <article>
          <span>Время реакции</span>
          <strong>{snapshot.overview.responseEta} мин</strong>
        </article>
        <article>
          <span>Статус</span>
          <strong>{analysis.tone === 'critical' ? 'Критично' : analysis.tone === 'warning' ? 'Под риском' : 'Стабильно'}</strong>
        </article>
      </div>

      <div className="operations-actions-row">
        <button type="button" className="primary-run-button" onClick={onRunAiPlan} disabled={!canRunAiPlan}>
          Запустить AI-план
        </button>
        <button type="button" className="ghost-button" onClick={onClearActions} disabled={!canManageOperations}>
          Снять все меры
        </button>
      </div>

      {!canManageOperations || !canRunAiPlan ? (
        <div className="operations-permission-note">
          {!canManageOperations ? 'Ручное управление мерами отключено для текущего профиля.' : null}
          {!canManageOperations && !canRunAiPlan ? ' ' : null}
          {!canRunAiPlan ? 'Запуск AI-плана также ограничен настройками доступа.' : null}
        </div>
      ) : null}

      {automation?.activeActionIds?.length ? (
        <div className="operations-permission-note">
          AI уже автоматически включил: {automation.activeActionIds.map((actionId) => operationCatalog[actionId]?.label || actionId).join(', ')}.
          Контроль ведётся через {automation.monitoredFrom}.
        </div>
      ) : null}

      <div className="operations-grid">
        {Object.entries(operationCatalog).map(([actionId, item]) => {
          const active = Boolean(actions?.[actionId])

          return (
            <button
              key={actionId}
              type="button"
              className={`operation-card ${active ? 'active' : ''}`}
              onClick={() => onToggleAction(actionId)}
              disabled={!canManageOperations}
            >
              <div className="operation-card-head">
                <span>{item.badge}</span>
                <strong>{item.label}</strong>
              </div>
              <p>{item.description}</p>
              <small>{item.effect}</small>
            </button>
          )
        })}
      </div>

      <div className="operations-bottom">
        <article className="inner-panel">
          <span className="eyebrow">Operational outcome</span>
          <h4>Ожидаемый результат</h4>
          <div className="task-list">
            <div className="task-item">
              <span />
              <p>Жалобы сейчас: {snapshot.overview.complaints}. Чем больше активных мер, тем быстрее стабилизируется район.</p>
            </div>
            <div className="task-item">
              <span />
              <p>Качество воды: {snapshot.overview.quality}. Промывка и лабораторный цикл особенно полезны при санитарном риске.</p>
            </div>
            <div className="task-item">
              <span />
              <p>Покрытие сервиса: {snapshot.overview.coverage}%. Резервный контур помогает поднять доступность подачи.</p>
            </div>
          </div>
        </article>

        <article className="inner-panel">
          <span className="eyebrow">Command log</span>
          <h4>Последние действия</h4>
          <div className="operations-log">
            {operationsLog.length ? (
              operationsLog.map((entry) => (
                <div key={entry.id} className="log-row">
                  <strong>{entry.timestamp}</strong>
                  <div>
                    <span>{entry.district}</span>
                    <p>
                      {operationCatalog[entry.actionId]?.label || entry.actionId}
                      {entry.enabled ? ' включено' : ' отключено'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="log-row">
                <strong>--:--</strong>
                <div>
                  <span>Ожидание</span>
                  <p>Пока не было ручных вмешательств.</p>
                </div>
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
