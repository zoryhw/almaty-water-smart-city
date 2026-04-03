def clamp(value, minimum, maximum):
    return min(max(value, minimum), maximum)


def get_tone_label(tone):
    if tone == "critical":
        return "Критично"
    if tone == "warning":
        return "Под риском"
    return "Стабильно"


def _status(label, tone):
    return {"label": label, "tone": tone}


def _water_status(value):
    if value < 30:
        return _status("Критично", "critical")
    if value < 45:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def _pressure_status(value):
    if value < 2:
        return _status("Критично", "critical")
    if value < 2.6:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def _incident_status(value):
    if value > 5:
        return _status("Критично", "critical")
    if value >= 4:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def _quality_status(value):
    if value < 60:
        return _status("Критично", "critical")
    if value < 78:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def _coverage_status(value):
    if value < 85:
        return _status("Критично", "critical")
    if value < 93:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def _complaint_status(value):
    if value > 30:
        return _status("Критично", "critical")
    if value >= 18:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def _pump_status(value):
    if value > 85:
        return _status("Критично", "critical")
    if value >= 72:
        return _status("Внимание", "warning")
    return _status("Норма", "normal")


def analyze_snapshot(snapshot):
    overview = snapshot["overview"]
    statuses = {
        "waterLevel": _water_status(overview["waterLevel"]),
        "pressure": _pressure_status(overview["pressure"]),
        "incidents": _incident_status(overview["incidents"]),
        "quality": _quality_status(overview["quality"]),
        "coverage": _coverage_status(overview["coverage"]),
        "complaints": _complaint_status(overview["complaints"]),
        "pumpLoad": _pump_status(overview["pumpLoad"]),
    }

    weighted_risk = (
        (100 - overview["waterLevel"]) * 0.16
        + max(0, 3.6 - overview["pressure"]) * 24 * 0.22
        + overview["incidents"] * 7.8 * 0.16
        + (100 - overview["quality"]) * 0.16
        + (100 - overview["coverage"]) * 0.12
        + overview["complaints"] * 0.38
        + max(0, overview["pumpLoad"] - 60) * 0.35
    )

    risk_score = round(clamp(weighted_risk, 9, 97))
    resilience = 100 - risk_score
    response_readiness = clamp(
        round(96 - risk_score * 0.48 - overview["responseEta"] * 0.44 + overview["fieldTeams"] * 4.5),
        28,
        97,
    )

    chlorine_balance = max(0, 1 - abs(0.68 - overview["chlorine"]) * 2.3)
    turbidity_balance = max(0, 1 - overview["turbidity"] / 12)
    quality_confidence = clamp(
        round(
            overview["quality"] * 0.56
            + overview["sampleRate"] * 0.24
            + chlorine_balance * 14
            + turbidity_balance * 14
        ),
        34,
        98,
    )
    service_balance = clamp(
        round(
            overview["coverage"] * 0.4
            + overview["waterLevel"] * 0.26
            + overview["pressure"] * 15
            - overview["incidents"] * 4.5
        ),
        26,
        98,
    )

    tone = "normal"
    if (
        statuses["pressure"]["tone"] == "critical"
        or statuses["incidents"]["tone"] == "critical"
        or statuses["quality"]["tone"] == "critical"
        or statuses["complaints"]["tone"] == "critical"
    ):
        tone = "critical"
    elif any(status["tone"] == "warning" for status in statuses.values()):
        tone = "warning"

    return {
        "statuses": statuses,
        "riskScore": risk_score,
        "resilience": resilience,
        "tone": tone,
        "responseReadiness": response_readiness,
        "qualityConfidence": quality_confidence,
        "serviceBalance": service_balance,
    }


def get_city_snapshot(district_snapshots):
    analyzed = [{"snapshot": item, "analysis": analyze_snapshot(item)} for item in district_snapshots.values()]
    count = max(len(analyzed), 1)
    return {
        "averageCoverage": round(sum(item["snapshot"]["overview"]["coverage"] for item in analyzed) / count),
        "averagePressure": round(sum(item["snapshot"]["overview"]["pressure"] for item in analyzed) / count, 1),
        "averageQuality": round(sum(item["snapshot"]["overview"]["quality"] for item in analyzed) / count),
        "waterReserve": round(sum(item["snapshot"]["overview"]["waterLevel"] for item in analyzed) / count),
        "demandLoad": round(sum(item["snapshot"]["overview"]["pumpLoad"] for item in analyzed) / count),
        "totalIncidents": sum(item["snapshot"]["overview"]["incidents"] for item in analyzed),
        "totalComplaints": sum(item["snapshot"]["overview"]["complaints"] for item in analyzed),
        "unstableDistricts": sum(1 for item in analyzed if item["analysis"]["tone"] != "normal"),
        "cityResilience": round(sum(item["analysis"]["resilience"] for item in analyzed) / count),
    }
