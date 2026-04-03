import { buildApiUrl } from './api'

export async function fetchPublicIntel({ district, scenario }) {
  const url = buildApiUrl('/api/public-intel', { district, scenario })
  const response = await fetch(url)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Public intel API error ${response.status}`)
  }

  return response.json()
}
