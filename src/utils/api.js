const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()
const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '')

function normalizePath(path) {
  return path.startsWith('/') ? path : `/${path}`
}

export function resolveApiUrl(path) {
  const normalizedPath = normalizePath(path)
  return normalizedApiBaseUrl ? `${normalizedApiBaseUrl}${normalizedPath}` : normalizedPath
}

export function buildApiUrl(path, params = {}) {
  const normalizedPath = normalizePath(path)

  const url = normalizedApiBaseUrl
    ? new URL(`${normalizedApiBaseUrl}${normalizedPath}`)
    : new URL(
        normalizedPath,
        typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
      )

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  return url
}
