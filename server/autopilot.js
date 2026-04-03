import { districtOrder } from '../src/data/mockData.js'
import { analyzeSnapshot, getCitySnapshot, getToneLabel } from '../src/utils/analysis.js'
import { operationCatalog } from '../src/utils/operations.js'
import {
  applyAutomationResponses,
  buildTelemetryNetwork,
  deriveAutomationPlan,
} from '../src/utils/telemetry.js'

function normalizeSnapshots(districtSnapshots = {}) {
  return districtOrder.reduce((acc, district) => {
    if (districtSnapshots?.[district]) {
      acc[district] = districtSnapshots[district]
    }

    return acc
  }, {})
}

function buildSelectedDistrictSummary({
  selectedDistrict,
  districtSnapshots,
  automationByDistrict,
  telemetryNetwork,
  decisionSource,
}) {
  const snapshot = districtSnapshots[selectedDistrict]
  const automation = automationByDistrict[selectedDistrict]
  const telemetry = telemetryNetwork.districts[selectedDistrict]

  if (!snapshot || !automation || !telemetry) {
    return {
      district: selectedDistrict,
      headline: 'Автопилот ожидает данные района.',
      tone: 'normal',
      actionLabels: [],
      monitoredFrom: `${selectedDistrict} хаб`,
      decisionSource,
    }
  }

  const analysis = analyzeSnapshot(snapshot)
  const actionLabels = automation.activeActionIds
    .map((actionId) => operationCatalog[actionId]?.label || actionId)
    .filter(Boolean)

  const headline = actionLabels.length
    ? `AI активировал меры по району ${selectedDistrict}: ${actionLabels.join(', ')}.`
    : `AI держит район ${selectedDistrict} под наблюдением без автоматического вмешательства.`

  return {
    district: selectedDistrict,
    headline,
    tone: analysis.tone,
    decisionSource,
    statusLabel: getToneLabel(analysis.tone),
    actionLabels,
    monitoredFrom: automation.monitoredFrom,
    criticalCount: telemetry.criticalCount,
    warningCount: telemetry.warningCount,
    reason: automation.reason,
  }
}

export function createAutopilotDecision({
  districtSnapshots,
  refreshBucket = 0,
  selectedDistrict = districtOrder[0],
  token = '',
}) {
  const normalizedSnapshots = normalizeSnapshots(districtSnapshots)

  if (!districtOrder.every((district) => normalizedSnapshots[district])) {
    throw new Error('Autopilot did not receive a full district snapshot set.')
  }

  const telemetryDraft = buildTelemetryNetwork({
    districtSnapshots: normalizedSnapshots,
    refreshBucket,
  })

  const automationByDistrict = deriveAutomationPlan(telemetryDraft)

  const automatedSnapshots = districtOrder.reduce((acc, district) => {
    acc[district] = applyAutomationResponses(normalizedSnapshots[district], automationByDistrict[district])
    return acc
  }, {})

  const telemetryNetwork = buildTelemetryNetwork({
    districtSnapshots: automatedSnapshots,
    refreshBucket,
    automationByDistrict,
  })

  const city = getCitySnapshot(automatedSnapshots)
  const riskBoard = districtOrder
    .map((district) => {
      const analysis = analyzeSnapshot(automatedSnapshots[district])

      return {
        district,
        tone: analysis.tone,
        riskScore: analysis.riskScore,
        actionCount: automationByDistrict[district]?.activeActionIds?.length || 0,
      }
    })
    .sort((left, right) => right.riskScore - left.riskScore)

  return {
    token,
    decisionAt: new Date().toISOString(),
    decisionSource: 'server-rule-engine',
    automationByDistrict,
    city,
    telemetrySummary: {
      totalSensors: telemetryNetwork.city.totalSensors,
      activeWarnings: telemetryNetwork.city.activeWarnings,
      activeCritical: telemetryNetwork.city.activeCritical,
      centerEscalations: telemetryNetwork.city.centerEscalations,
      akimatEscalations: telemetryNetwork.city.akimatEscalations,
    },
    selectedDistrictSummary: buildSelectedDistrictSummary({
      selectedDistrict,
      districtSnapshots: automatedSnapshots,
      automationByDistrict,
      telemetryNetwork,
      decisionSource: 'server-rule-engine',
    }),
    riskBoard: riskBoard.slice(0, 5),
  }
}
