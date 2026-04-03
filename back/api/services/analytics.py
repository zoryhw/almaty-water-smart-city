from collections import Counter, defaultdict

from django.db.models import Q
from django.utils import timezone

from api.models import AlertEvent, DistrictCycleSnapshot, TelemetryPacket

from .analysis import analyze_snapshot


def _format_label(dt):
    return timezone.localtime(dt).strftime("%H:%M:%S")


def create_district_frames(packet, payload):
    district_snapshots = payload.get("districtSnapshots") or {}
    telemetry_districts = ((payload.get("telemetryNetwork") or {}).get("districts")) or {}
    automation_by_district = payload.get("automationByDistrict") or {}
    scenario = payload.get("activeScenario")
    rows = []

    for district, snapshot in district_snapshots.items():
        overview = snapshot.get("overview") or {}
        analysis = analyze_snapshot(snapshot)
        telemetry = telemetry_districts.get(district) or {}
        automation = automation_by_district.get(district) or {}
        rows.append(
            DistrictCycleSnapshot(
                packet=packet,
                district=district,
                scenario=scenario,
                tone=analysis["tone"],
                risk_score=analysis["riskScore"],
                resilience=analysis["resilience"],
                response_readiness=analysis["responseReadiness"],
                pressure=overview.get("pressure") or 0,
                quality=overview.get("quality") or 0,
                coverage=overview.get("coverage") or 0,
                complaints=overview.get("complaints") or 0,
                incidents=overview.get("incidents") or 0,
                response_eta=overview.get("responseEta") or 0,
                pump_load=overview.get("pumpLoad") or 0,
                consumption=overview.get("consumption") or 0,
                active_signals=telemetry.get("activeSensorCount") or 0,
                critical_signals=telemetry.get("criticalCount") or 0,
                action_count=len(automation.get("activeActionIds") or []),
                monitored_from=automation.get("monitoredFrom") or telemetry.get("monitoredFrom") or "",
                snapshot_payload=snapshot,
            )
        )

    if rows:
        DistrictCycleSnapshot.objects.bulk_create(rows)


def create_alert_events(packet, payload):
    alerts = payload.get("alertFeed") or []
    rows = []
    for alert in alerts:
        rows.append(
            AlertEvent(
                packet=packet,
                district=alert.get("district"),
                severity=alert.get("severity") or "normal",
                title=alert.get("title") or "Событие системы",
                description=alert.get("description") or "",
                metric=str(alert.get("metric") or ""),
                source=alert.get("source") or "",
                action=alert.get("action") or "",
            )
        )

    if rows:
        AlertEvent.objects.bulk_create(rows)


def _serialize_latest_cycle(frame):
    if not frame:
        return None
    return {
        "district": frame.district,
        "scenario": frame.scenario,
        "tone": frame.tone,
        "riskScore": frame.risk_score,
        "resilience": frame.resilience,
        "responseReadiness": frame.response_readiness,
        "pressure": frame.pressure,
        "quality": frame.quality,
        "coverage": frame.coverage,
        "complaints": frame.complaints,
        "incidents": frame.incidents,
        "responseEta": frame.response_eta,
        "pumpLoad": frame.pump_load,
        "consumption": frame.consumption,
        "activeSignals": frame.active_signals,
        "criticalSignals": frame.critical_signals,
        "actionCount": frame.action_count,
        "monitoredFrom": frame.monitored_from,
        "receivedAt": frame.packet.received_at.isoformat(),
        "label": _format_label(frame.packet.received_at),
    }


def build_analytics_summary(district, limit=12):
    limit = max(4, min(int(limit or 12), 40))
    district_frames_desc = list(
        DistrictCycleSnapshot.objects.filter(district=district)
        .select_related("packet")
        .order_by("-recorded_at")[:limit]
    )
    district_frames = list(reversed(district_frames_desc))
    latest_frame = district_frames_desc[0] if district_frames_desc else None

    recent_packets_desc = list(TelemetryPacket.objects.order_by("-received_at")[:limit])
    recent_packets = list(reversed(recent_packets_desc))
    packet_ids = [packet.id for packet in recent_packets_desc]
    frames_by_packet = defaultdict(list)
    if packet_ids:
        for frame in (
            DistrictCycleSnapshot.objects.filter(packet_id__in=packet_ids)
            .select_related("packet")
            .order_by("recorded_at")
        ):
            frames_by_packet[frame.packet_id].append(frame)

    district_timeline = [
        {
            "receivedAt": frame.packet.received_at.isoformat(),
            "label": _format_label(frame.packet.received_at),
            "riskScore": frame.risk_score,
            "resilience": frame.resilience,
            "pressure": frame.pressure,
            "quality": frame.quality,
            "coverage": frame.coverage,
            "complaints": frame.complaints,
            "incidents": frame.incidents,
            "activeSignals": frame.active_signals,
            "criticalSignals": frame.critical_signals,
            "actionCount": frame.action_count,
        }
        for frame in district_frames
    ]

    city_timeline = []
    latest_ranking = []
    for packet in recent_packets:
        frames = frames_by_packet.get(packet.id, [])
        if not frames:
            continue
        city_timeline.append(
            {
                "receivedAt": packet.received_at.isoformat(),
                "label": _format_label(packet.received_at),
                "averageRisk": round(sum(frame.risk_score for frame in frames) / len(frames)),
                "averageResilience": round(sum(frame.resilience for frame in frames) / len(frames)),
                "averagePressure": round(sum(frame.pressure for frame in frames) / len(frames), 1),
                "averageQuality": round(sum(frame.quality for frame in frames) / len(frames)),
                "averageCoverage": round(sum(frame.coverage for frame in frames) / len(frames)),
                "totalActiveSignals": sum(frame.active_signals for frame in frames),
                "totalCriticalSignals": sum(frame.critical_signals for frame in frames),
                "autoDistricts": sum(1 for frame in frames if frame.action_count > 0),
            }
        )

    if recent_packets_desc:
        latest_packet_frames = frames_by_packet.get(recent_packets_desc[0].id, [])
        latest_ranking = sorted(
            [
                {
                    "district": frame.district,
                    "tone": frame.tone,
                    "scenario": frame.scenario,
                    "riskScore": frame.risk_score,
                    "resilience": frame.resilience,
                    "activeSignals": frame.active_signals,
                    "criticalSignals": frame.critical_signals,
                    "actionCount": frame.action_count,
                    "updatedAt": frame.packet.received_at.isoformat(),
                }
                for frame in latest_packet_frames
            ],
            key=lambda item: item["riskScore"],
            reverse=True,
        )

    recent_events = list(
        AlertEvent.objects.filter(Q(district=district) | Q(severity="critical"))
        .select_related("packet")
        .order_by("-created_at")[:8]
    )

    dominant_scenario = Counter(frame.scenario for frame in district_frames if frame.scenario).most_common(1)
    average_action_count = (
        round(sum(frame.action_count for frame in district_frames) / len(district_frames), 1)
        if district_frames
        else 0
    )
    risk_delta = (
        district_timeline[-1]["riskScore"] - district_timeline[0]["riskScore"]
        if len(district_timeline) > 1
        else 0
    )

    city_overview = city_timeline[-1] if city_timeline else None
    return {
        "ok": True,
        "district": district,
        "latestCycle": _serialize_latest_cycle(latest_frame),
        "city": {
            "averageRisk": city_overview["averageRisk"] if city_overview else None,
            "averageResilience": city_overview["averageResilience"] if city_overview else None,
            "averagePressure": city_overview["averagePressure"] if city_overview else None,
            "averageQuality": city_overview["averageQuality"] if city_overview else None,
            "averageCoverage": city_overview["averageCoverage"] if city_overview else None,
            "totalActiveSignals": city_overview["totalActiveSignals"] if city_overview else 0,
            "totalCriticalSignals": city_overview["totalCriticalSignals"] if city_overview else 0,
            "autoDistricts": city_overview["autoDistricts"] if city_overview else 0,
        },
        "timeline": {
            "district": district_timeline,
            "city": city_timeline,
        },
        "ranking": latest_ranking,
        "recentEvents": [
            {
                "id": str(event.id),
                "district": event.district,
                "severity": event.severity,
                "title": event.title,
                "description": event.description,
                "metric": event.metric,
                "source": event.source,
                "action": event.action,
                "receivedAt": event.packet.received_at.isoformat(),
                "label": _format_label(event.packet.received_at),
            }
            for event in recent_events
        ],
        "patternSummary": {
            "cyclesStored": len(city_timeline),
            "districtCycles": len(district_timeline),
            "dominantScenario": dominant_scenario[0][0] if dominant_scenario else None,
            "mostTurbulentDistrict": latest_ranking[0]["district"] if latest_ranking else district,
            "averageActionCount": average_action_count,
            "riskDelta": risk_delta,
            "totalPackets": TelemetryPacket.objects.count(),
            "totalAlertEvents": AlertEvent.objects.count(),
            "criticalBursts": len([frame for frame in district_frames if frame.critical_signals > 0]),
        },
    }
