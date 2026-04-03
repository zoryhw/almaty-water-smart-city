import { buildApiUrl, resolveApiUrl } from './api'

export const LIVE_MONITOR_INTERVAL_MS = 12 * 1000

async function parseJsonOrThrow(response, fallbackMessage) {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || fallbackMessage || `API error ${response.status}`)
  }

  return response.json()
}

export async function requestAutopilotDecision(payload, signal) {
  const response = await fetch(resolveApiUrl('/api/ai/autopilot'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  })

  return parseJsonOrThrow(response, `Autopilot API error ${response.status}`)
}

export async function ingestLiveTelemetry(payload, signal) {
  const response = await fetch(resolveApiUrl('/api/telemetry/ingest'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  })

  return parseJsonOrThrow(response, `Telemetry ingest API error ${response.status}`)
}

export async function fetchAnalyticsSummary({ district, limit = 12 } = {}, signal) {
  const url = buildApiUrl('/api/analytics/summary', { district, limit })
  const response = await fetch(url, { signal })
  return parseJsonOrThrow(response, `Analytics API error ${response.status}`)
}
