from copy import deepcopy
from datetime import datetime, timezone

from .analysis import analyze_snapshot, get_city_snapshot, get_tone_label
from .data import DISTRICT_ORDER
from .operations import OPERATION_CATALOG
from .telemetry import apply_automation_responses, build_telemetry_network, derive_automation_plan


def normalize_snapshots(district_snapshots=None):
    district_snapshots = district_snapshots or {}
    normalized = {}
    for district in DISTRICT_ORDER:
        if district in district_snapshots:
            normalized[district] = deepcopy(district_snapshots[district])
    return normalized


def build_selected_district_summary(selected_district, district_snapshots, automation_by_district, telemetry_network, decision_source):
    snapshot = district_snapshots.get(selected_district)
    automation = automation_by_district.get(selected_district)
    telemetry = telemetry_network["districts"].get(selected_district)
    if not snapshot or not automation or not telemetry:
        return {
            "district": selected_district,
            "headline": "Автопилот ожидает данные района.",
            "tone": "normal",
            "actionLabels": [],
            "monitoredFrom": f"{selected_district} хаб",
            "decisionSource": decision_source,
        }

    analysis = analyze_snapshot(snapshot)
    action_labels = [
        OPERATION_CATALOG.get(action_id, {}).get("label", action_id)
        for action_id in automation.get("activeActionIds", [])
    ]
    headline = (
        f"AI активировал меры по району {selected_district}: {', '.join(action_labels)}."
        if action_labels
        else f"AI держит район {selected_district} под наблюдением без автоматического вмешательства."
    )
    return {
        "district": selected_district,
        "headline": headline,
        "tone": analysis["tone"],
        "decisionSource": decision_source,
        "statusLabel": get_tone_label(analysis["tone"]),
        "actionLabels": action_labels,
        "monitoredFrom": automation["monitoredFrom"],
        "criticalCount": telemetry["criticalCount"],
        "warningCount": telemetry["warningCount"],
        "reason": automation["reason"],
    }


def create_autopilot_decision(district_snapshots, refresh_bucket=0, selected_district=None, token=""):
    selected_district = selected_district or DISTRICT_ORDER[0]
    normalized_snapshots = normalize_snapshots(district_snapshots)
    if not all(district in normalized_snapshots for district in DISTRICT_ORDER):
        raise ValueError("Autopilot did not receive a full district snapshot set.")

    telemetry_draft = build_telemetry_network(normalized_snapshots, refresh_bucket)
    automation_by_district = derive_automation_plan(telemetry_draft)
    automated_snapshots = {
        district: apply_automation_responses(normalized_snapshots[district], automation_by_district[district])
        for district in DISTRICT_ORDER
    }
    telemetry_network = build_telemetry_network(automated_snapshots, refresh_bucket, automation_by_district)
    city = get_city_snapshot(automated_snapshots)

    risk_board = []
    for district in DISTRICT_ORDER:
        analysis = analyze_snapshot(automated_snapshots[district])
        risk_board.append(
            {
                "district": district,
                "tone": analysis["tone"],
                "riskScore": analysis["riskScore"],
                "actionCount": len(automation_by_district.get(district, {}).get("activeActionIds", [])),
            }
        )
    risk_board.sort(key=lambda item: item["riskScore"], reverse=True)

    return {
        "token": token,
        "decisionAt": datetime.now(timezone.utc).isoformat(),
        "decisionSource": "django-rule-engine",
        "automationByDistrict": automation_by_district,
        "city": city,
        "telemetrySummary": {
            "totalSensors": telemetry_network["city"]["totalSensors"],
            "activeWarnings": telemetry_network["city"]["activeWarnings"],
            "activeCritical": telemetry_network["city"]["activeCritical"],
            "centerEscalations": telemetry_network["city"]["centerEscalations"],
            "akimatEscalations": telemetry_network["city"]["akimatEscalations"],
        },
        "selectedDistrictSummary": build_selected_district_summary(
            selected_district,
            automated_snapshots,
            automation_by_district,
            telemetry_network,
            "django-rule-engine",
        ),
        "riskBoard": risk_board[:5],
    }
