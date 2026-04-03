import { useEffect, useMemo, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { almatyMapConfig, districtOrder } from '../data/mockData'
import { formatNumber, getToneLabel } from '../utils/analysis'

const toneColors = {
  normal: '#35c8a6',
  warning: '#ffbf62',
  critical: '#ff7b86',
}

const hotspotLabels = {
  pressure: 'Давление',
  quality: 'Качество',
  incident: 'Инцидент',
  coverage: 'Покрытие',
  consumption: 'Нагрузка',
  service: 'Сервис',
}

function formatRefreshCountdown(totalSeconds) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60)
  const seconds = Math.max(0, totalSeconds) % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatRefreshTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function FocusController({ center, zoom }) {
  const map = useMap()

  useEffect(() => {
    map.flyTo(center, zoom, {
      duration: 1.1,
    })
  }, [center, zoom, map])

  return null
}

export function AlmatyMap({
  selectedDistrict,
  districtStates,
  districtSnapshots,
  districtActions,
  onSelectDistrict,
  telemetry,
  cityTelemetry,
  nextRefreshAt,
  secondsToRefresh,
}) {
  const [focusMode, setFocusMode] = useState('selected')
  const [layers, setLayers] = useState({
    hubs: true,
    routes: true,
    sensors: true,
    escalations: true,
  })

  const selectedMap = almatyMapConfig.districts[selectedDistrict]
  const selectedSnapshot = districtSnapshots[selectedDistrict]
  const activeInterventions = new Set([
    ...Object.entries(districtActions[selectedDistrict] || {})
      .filter(([, enabled]) => enabled)
      .map(([actionId]) => actionId),
    ...(telemetry?.automation?.activeActionIds || []),
  ]).size

  const mapCenter = focusMode === 'city' ? almatyMapConfig.center : selectedMap.position
  const mapZoom = focusMode === 'city' ? almatyMapConfig.zoom : 12.5

  const routeLines = useMemo(() => {
    return districtOrder.map((district) => {
      const districtMap = almatyMapConfig.districts[district]
      const node = almatyMapConfig.nodes.find((item) => item.id === districtMap.source)

      return {
        district,
        tone: districtStates[district].tone,
        positions: [node.position, districtMap.position],
      }
    })
  }, [districtStates])

  const hotspots = useMemo(() => {
    return districtOrder.flatMap((district) => {
      const districtMap = almatyMapConfig.districts[district]
      const districtTone = districtStates[district].tone

      return districtMap.hotspots.map((hotspot) => ({
        ...hotspot,
        district,
        severity: districtTone === 'critical' ? 'critical' : hotspot.severity,
      }))
    })
  }, [districtStates])

  const selectedCommandLinks = useMemo(() => {
    if (!telemetry || !cityTelemetry) {
      return []
    }

    const links = [
      ...telemetry.microHubs.map((hub) => ({
        id: `link-${hub.id}`,
        tone: hub.tone,
        dashArray: '6 8',
        positions: [telemetry.districtHub.position, hub.position],
      })),
      {
        id: `link-center-${telemetry.district}`,
        tone: telemetry.escalateToCenter || telemetry.escalateToAkimat ? 'critical' : telemetry.tone,
        dashArray: '10 8',
        positions: [telemetry.districtHub.position, cityTelemetry.mainCenter.position],
      },
    ]

    if (telemetry.escalateToAkimat) {
      links.push({
        id: `link-akimat-${telemetry.district}`,
        tone: 'critical',
        dashArray: '4 8',
        positions: [cityTelemetry.mainCenter.position, cityTelemetry.akimat.position],
      })
    }

    return links
  }, [cityTelemetry, telemetry])

  const toggleLayer = (key) => {
    setLayers((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  return (
    <section className="almaty-map-panel panel-surface anim delay-7">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Карта сети</p>
          <h3>Интерактивная карта Алматы</h3>
        </div>
        <span className="section-note">Клик по району сразу синхронизирует сводку, рабочие панели и помощника</span>
      </div>

      <div className="map-toolbar">
        <div className="map-focus-switch">
          <button
            type="button"
            className={focusMode === 'selected' ? 'active' : ''}
            onClick={() => setFocusMode('selected')}
          >
            Выбранный район
          </button>
          <button
            type="button"
            className={focusMode === 'city' ? 'active' : ''}
            onClick={() => setFocusMode('city')}
          >
            Весь город
          </button>
        </div>

        <div className="map-layer-toggles">
          <button type="button" className={layers.hubs ? 'active' : ''} onClick={() => toggleLayer('hubs')}>
            Хабы
          </button>
          <button type="button" className={layers.routes ? 'active' : ''} onClick={() => toggleLayer('routes')}>
            Связи
          </button>
          <button type="button" className={layers.sensors ? 'active' : ''} onClick={() => toggleLayer('sensors')}>
            Датчики
          </button>
          <button type="button" className={layers.escalations ? 'active' : ''} onClick={() => toggleLayer('escalations')}>
            Эскалации
          </button>
        </div>
      </div>

      <div className="map-layout">
        <div className="map-shell">
          <MapContainer
            center={almatyMapConfig.center}
            zoom={almatyMapConfig.zoom}
            scrollWheelZoom
            className="almaty-leaflet-map"
          >
            <FocusController center={mapCenter} zoom={mapZoom} />

            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {layers.routes
              ? [
                  ...routeLines.map((route) => (
                    <Polyline
                      key={route.district}
                      positions={route.positions}
                      pathOptions={{
                        color: toneColors[route.tone],
                        weight: selectedDistrict === route.district ? 5 : 3,
                        opacity: selectedDistrict === route.district ? 0.9 : 0.35,
                        dashArray: selectedDistrict === route.district ? '10 8' : '6 8',
                      }}
                    />
                  )),
                  ...selectedCommandLinks.map((link) => (
                    <Polyline
                      key={link.id}
                      positions={link.positions}
                      pathOptions={{
                        color: toneColors[link.tone],
                        weight: 3,
                        opacity: 0.85,
                        dashArray: link.dashArray,
                      }}
                    />
                  )),
                ]
              : null}

            {layers.hubs
              ? [
                  ...almatyMapConfig.nodes.map((node) => (
                    <CircleMarker
                      key={node.id}
                      center={node.position}
                      radius={8}
                      pathOptions={{
                        color: '#1877d6',
                        fillColor: '#3ca0f6',
                        fillOpacity: 0.9,
                        weight: 2,
                      }}
                    >
                      <Tooltip>{node.title}</Tooltip>
                    </CircleMarker>
                  )),
                  <CircleMarker
                    key={cityTelemetry.mainCenter.id}
                    center={cityTelemetry.mainCenter.position}
                    radius={10}
                    pathOptions={{
                      color: toneColors[cityTelemetry.mainCenter.tone],
                      fillColor: '#2d8be7',
                      fillOpacity: 0.92,
                      weight: 3,
                    }}
                  >
                    <Tooltip>{cityTelemetry.mainCenter.title}</Tooltip>
                  </CircleMarker>,
                  <CircleMarker
                    key={cityTelemetry.akimat.id}
                    center={cityTelemetry.akimat.position}
                    radius={9}
                    pathOptions={{
                      color: toneColors[cityTelemetry.akimat.tone],
                      fillColor: '#eef6ff',
                      fillOpacity: 0.96,
                      weight: 3,
                    }}
                  >
                    <Tooltip>{cityTelemetry.akimat.title}</Tooltip>
                  </CircleMarker>,
                  ...districtOrder.map((district) => {
                    const districtMap = almatyMapConfig.districts[district]
                    const districtState = districtStates[district]

                    return (
                      <CircleMarker
                        key={`hub-${district}`}
                        center={districtMap.position}
                        radius={selectedDistrict === district ? 10 : 8}
                        pathOptions={{
                          color: toneColors[districtState.tone],
                          fillColor: toneColors[districtState.tone],
                          fillOpacity: selectedDistrict === district ? 0.72 : 0.38,
                          weight: 3,
                        }}
                      >
                        <Tooltip>{district} хаб</Tooltip>
                      </CircleMarker>
                    )
                  }),
                  ...(telemetry?.microHubs || []).map((hub) => (
                    <CircleMarker
                      key={hub.id}
                      center={hub.position}
                      radius={6}
                      pathOptions={{
                        color: toneColors[hub.tone],
                        fillColor: '#ffffff',
                        fillOpacity: 0.92,
                        weight: 2,
                      }}
                    >
                      <Tooltip>{hub.title}</Tooltip>
                    </CircleMarker>
                  )),
                ]
              : null}

            {districtOrder.map((district) => {
              const districtMap = almatyMapConfig.districts[district]
              const districtState = districtStates[district]
              const snapshot = districtSnapshots[district]
              const actionCount = Object.values(districtActions[district] || {}).filter(Boolean).length

              return (
                <CircleMarker
                  key={district}
                  center={districtMap.position}
                  radius={selectedDistrict === district ? 18 : 13}
                  eventHandlers={{
                    click: () => onSelectDistrict(district),
                  }}
                  pathOptions={{
                    color: toneColors[districtState.tone],
                    fillColor: toneColors[districtState.tone],
                    fillOpacity: selectedDistrict === district ? 0.34 : 0.18,
                    weight: selectedDistrict === district ? 4 : 3,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]}>
                    {district}
                  </Tooltip>
                  <Popup>
                    <div className="map-popup">
                      <strong>{district}</strong>
                      <p>{getToneLabel(districtState.tone)}</p>
                      <div className="map-popup-grid">
                        <span>Давление: {snapshot.overview.pressure} bar</span>
                        <span>Качество: {snapshot.overview.quality}</span>
                        <span>Покрытие: {snapshot.overview.coverage}%</span>
                        <span>Активные меры: {actionCount}</span>
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}

            {layers.sensors
              ? telemetry?.sensors.map((sensor) => (
                  <CircleMarker
                    key={sensor.id}
                    center={sensor.position}
                    radius={sensor.tone === 'critical' ? 6 : 4}
                    pathOptions={{
                      color: toneColors[sensor.tone],
                      fillColor: toneColors[sensor.tone],
                      fillOpacity: 0.96,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="map-popup">
                        <strong>{sensor.title}</strong>
                        <p>{sensor.locationLabel}</p>
                        <div className="map-popup-grid">
                          <span>{sensor.label}: {sensor.formattedValue}</span>
                          <span>Статус: {getToneLabel(sensor.tone)}</span>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))
              : null}

            {layers.escalations
              ? hotspots.map((hotspot) => (
                  <CircleMarker
                    key={hotspot.id}
                    center={hotspot.position}
                    radius={hotspot.severity === 'critical' ? 8 : 6}
                    pathOptions={{
                      color: toneColors[hotspot.severity],
                      fillColor: toneColors[hotspot.severity],
                      fillOpacity: 0.92,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="map-popup">
                        <strong>{hotspot.title}</strong>
                        <p>{hotspot.district}</p>
                        <div className="map-popup-grid">
                          <span>Тип: {hotspotLabels[hotspot.kind] || hotspot.kind}</span>
                          <span>Статус: {getToneLabel(hotspot.severity)}</span>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))
              : null}

            {layers.escalations && telemetry?.autoDispatch ? (
              <CircleMarker
                center={telemetry.districtHub.position}
                radius={22}
                pathOptions={{
                  color: toneColors[telemetry.escalateToAkimat ? 'critical' : 'warning'],
                  fillOpacity: 0,
                  weight: 2,
                  dashArray: '8 10',
                }}
              >
                <Tooltip>AI-эскалация района</Tooltip>
              </CircleMarker>
            ) : null}

            {layers.escalations && telemetry?.escalateToCenter ? (
              <CircleMarker
                center={cityTelemetry.mainCenter.position}
                radius={18}
                pathOptions={{
                  color: toneColors[telemetry.escalateToAkimat ? 'critical' : 'warning'],
                  fillOpacity: 0,
                  weight: 2,
                  dashArray: '6 8',
                }}
              >
                <Tooltip>Контроль главного центра</Tooltip>
              </CircleMarker>
            ) : null}

            {layers.escalations && telemetry?.escalateToAkimat ? (
              <CircleMarker
                center={cityTelemetry.akimat.position}
                radius={16}
                pathOptions={{
                  color: toneColors.critical,
                  fillOpacity: 0,
                  weight: 2,
                  dashArray: '4 6',
                }}
              >
                <Tooltip>Сигнал в акимат</Tooltip>
              </CircleMarker>
            ) : null}
          </MapContainer>
        </div>

        <aside className="map-sidecard">
          <div className="map-sidecard-head">
            <strong>{selectedDistrict}</strong>
            <span>{getToneLabel(districtStates[selectedDistrict].tone)}</span>
          </div>

          <div className="map-sidecard-grid">
            <article>
              <span>Потребление</span>
              <strong>{formatNumber(selectedSnapshot.overview.consumption)} м³</strong>
            </article>
            <article>
              <span>Жалобы</span>
              <strong>{selectedSnapshot.overview.complaints}</strong>
            </article>
            <article>
              <span>Давление</span>
              <strong>{selectedSnapshot.overview.pressure} bar</strong>
            </article>
            <article>
              <span>Датчики / меры</span>
              <strong>{telemetry.totalSensors} / {activeInterventions}</strong>
            </article>
          </div>

          <div className="map-sidecard-block">
            <div className="map-mini-chain">
              {telemetry.observationChain.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <p className="body-text">
              AI отслеживает датчики в живом цикле. До следующего цикла {formatRefreshCountdown(secondsToRefresh)},
              окно обновления в {formatRefreshTime(nextRefreshAt)}.
            </p>
          </div>

          <div className="map-sidecard-grid">
            <article>
              <span>Предупреждения</span>
              <strong>{telemetry.warningCount}</strong>
            </article>
            <article>
              <span>Критичные</span>
              <strong>{telemetry.criticalCount}</strong>
            </article>
            <article>
              <span>Главный центр</span>
              <strong>{cityTelemetry.centerEscalations}</strong>
            </article>
            <article>
              <span>Акимат</span>
              <strong>{cityTelemetry.akimatEscalations}</strong>
            </article>
          </div>

          <div className="map-sidecard-block">
            <strong>Автоматическая реакция</strong>
            <p className="body-text">
              {telemetry.autoDispatch
                ? `AI направил бригаду и перевёл наблюдение в ${telemetry.monitoredFrom}.`
                : 'AI пока ведёт только фоновый мониторинг без автоматического выезда.'}
            </p>
          </div>

          <div className="map-sidecard-block">
            <strong>Главные сигналы</strong>
            <div className="map-alert-list">
              {telemetry.topSensors.slice(0, 4).map((sensor) => (
                <article key={sensor.id}>
                  <span>{sensor.locationLabel}</span>
                  <strong>{sensor.formattedValue}</strong>
                  <small>{sensor.title}</small>
                </article>
              ))}
            </div>
          </div>

          <div className="map-legend">
            <div>
              <span className="legend-dot tone-normal" />
              <small>Стабильно</small>
            </div>
            <div>
              <span className="legend-dot tone-warning" />
              <small>Под риском</small>
            </div>
            <div>
              <span className="legend-dot tone-critical" />
              <small>Критично</small>
            </div>
          </div>

          <div className="map-tips">
            <p>Кликни по району на карте, чтобы пересобрать аналитические блоки.</p>
            <p>Переключай хабы, связи, датчики и эскалации, чтобы следить за маршрутом сигнала до центра и акимата.</p>
          </div>
        </aside>
      </div>
    </section>
  )
}
