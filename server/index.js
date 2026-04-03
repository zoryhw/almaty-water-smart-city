import dotenv from 'dotenv'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createAutopilotDecision } from './autopilot.js'
import { createGroundedChatReply, createStructuredReport } from './gemini.js'
import { getPublicIntel } from './publicIntel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(rootDir, '.env.local') })
dotenv.config({ path: path.join(rootDir, '.env') })

const app = express()
const port = Number(process.env.PORT || 8787)
const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY
const liveTelemetryStore = {
  lastPayload: null,
  history: [],
}

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasGeminiKey: Boolean(apiKey),
    port,
    time: new Date().toISOString(),
  })
})

app.get('/api/public-intel', async (req, res) => {
  try {
    const data = await getPublicIntel({
      district: req.query.district,
      scenario: req.query.scenario,
    })

    res.json(data)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load public intel.',
    })
  }
})

app.post('/api/ai/chat', async (req, res) => {
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' })
    return
  }

  try {
    const payload = await createGroundedChatReply({
      apiKey,
      model: req.body?.model,
      context: req.body?.context,
      alerts: req.body?.alerts,
      knowledgeBase: req.body?.knowledgeBase,
      history: req.body?.history,
      message: req.body?.message,
    })

    res.json(payload)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate grounded chat reply.',
    })
  }
})

app.post('/api/ai/report', async (req, res) => {
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' })
    return
  }

  try {
    const payload = await createStructuredReport({
      apiKey,
      model: req.body?.model,
      context: req.body?.context,
      mission: req.body?.mission,
    })

    res.json(payload)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate structured report.',
    })
  }
})

app.post('/api/ai/autopilot', (req, res) => {
  try {
    const payload = createAutopilotDecision({
      token: req.body?.token,
      districtSnapshots: req.body?.districtSnapshots,
      refreshBucket: req.body?.refreshBucket,
      selectedDistrict: req.body?.selectedDistrict,
    })

    res.json(payload)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to build autopilot decision.',
    })
  }
})

app.post('/api/telemetry/ingest', (req, res) => {
  const receivedAt = new Date().toISOString()
  const record = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    receivedAt,
    payload: req.body || {},
  }

  liveTelemetryStore.lastPayload = record
  liveTelemetryStore.history = [record, ...liveTelemetryStore.history].slice(0, 40)

  res.json({
    ok: true,
    receivedAt,
    storedRecords: liveTelemetryStore.history.length,
  })
})

app.get('/api/telemetry/latest', (req, res) => {
  res.json({
    ok: true,
    lastPayload: liveTelemetryStore.lastPayload,
    history: liveTelemetryStore.history.map((item) => ({
      id: item.id,
      receivedAt: item.receivedAt,
      selectedDistrict: item.payload?.selectedDistrict || null,
      activeScenario: item.payload?.activeScenario || null,
      alertCount: Array.isArray(item.payload?.alertFeed) ? item.payload.alertFeed.length : 0,
      autoDistricts: Object.values(item.payload?.automationByDistrict || {}).filter(
        (entry) => entry?.activeActionIds?.length,
      ).length,
    })),
  })
})

const distDir = path.join(rootDir, 'dist')
app.use(express.static(distDir))

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    next()
    return
  }

  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(port, () => {
  console.log(`smart-city server listening on http://127.0.0.1:${port}`)
})
