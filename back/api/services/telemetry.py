import math

from .analysis import analyze_snapshot
from .data import ALMATY_MAP_CONFIG, DISTRICT_ORDER

SEVERITY_RANK = {
    "critical": 3,
    "warning": 2,
    "normal": 1,
}

CONTROL_NODES = {
    "mainCenter": {
        "id": "main-control-center",
        "title": "Главный центр",
        "position": [43.2447, 76.9154],
    },
    "akimat": {
        "id": "city-akimat",
        "title": "Акимат",
        "position": [43.2395, 76.9452],
    },
}


def clamp(value, minimum, maximum):
    return min(max(value, minimum), maximum)


def hash_value(value):
    hashed = 2166136261
    for character in value:
        hashed ^= ord(character)
        hashed = (hashed * 16777619) & 0xFFFFFFFF
    return hashed


def signed_noise(seed):
    return (hash_value(seed) % 2000) / 1000 - 1


def mix_position(start, end, ratio):
    return [
        round(start[0] + (end[0] - start[0]) * ratio, 4),
        round(start[1] + (end[1] - start[1]) * ratio, 4),
    ]


def offset_position(base, angle, lat_radius, lng_radius):
    return [
        round(base[0] + math.sin(angle) * lat_radius, 4),
        round(base[1] + math.cos(angle) * lng_radius, 4),
    ]


def _pipeline_pressure(snapshot, noise, load):
    value = round(snapshot["overview"]["pressure"] + noise * 0.22, 1)
    tone = "critical" if value < 2.2 or value > 4.2 else "warning" if value < 2.8 or value > 3.7 else "normal"
    return value, tone, f"{value} bar"


def _pipeline_flow(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["pumpLoad"] + noise * 9), 24, 100)
    tone = "critical" if value > 92 else "warning" if value > 82 else "normal"
    return value, tone, f"{value}%"


def _pipeline_leak(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["incidents"] * 14 + snapshot["overview"]["complaints"] * 0.55 + noise * 8), 3, 100)
    tone = "critical" if value > 72 else "warning" if value > 46 else "normal"
    return value, tone, f"{value}%"


def _hub_quality(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["quality"] + noise * 3), 20, 100)
    tone = "critical" if value < 72 else "warning" if value < 86 else "normal"
    return value, tone, str(value)


def _hub_balance(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["coverage"] + snapshot["overview"]["waterLevel"] * 0.16 + noise * 6), 30, 100)
    tone = "critical" if value < 76 else "warning" if value < 88 else "normal"
    return value, tone, f"{value}%"


def _micro_pressure(snapshot, noise, load):
    value = round(snapshot["overview"]["pressure"] - load / 260 + noise * 0.18, 1)
    tone = "critical" if value < 2.1 else "warning" if value < 2.7 else "normal"
    return value, tone, f"{value} bar"


def _micro_quality(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["quality"] - load / 18 + noise * 3), 18, 100)
    tone = "critical" if value < 70 else "warning" if value < 84 else "normal"
    return value, tone, str(value)


def _micro_load(snapshot, noise, load):
    value = clamp(round(load + noise * 5), 20, 100)
    tone = "critical" if value > 90 else "warning" if value > 80 else "normal"
    return value, tone, f"{value}%"


def _building_pressure(snapshot, noise, load):
    value = round(snapshot["overview"]["pressure"] - load / 300 + noise * 0.16, 1)
    tone = "critical" if value < 2.0 else "warning" if value < 2.6 else "normal"
    return value, tone, f"{value} bar"


def _building_quality(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["quality"] - load / 22 + noise * 3), 18, 100)
    tone = "critical" if value < 69 else "warning" if value < 83 else "normal"
    return value, tone, str(value)


def _building_turbidity(snapshot, noise, load):
    value = round(clamp(snapshot["overview"]["turbidity"] + noise * 0.7, 1, 14), 1)
    tone = "critical" if value > 6.4 else "warning" if value > 4.2 else "normal"
    return value, tone, f"{value} NTU"


def _building_service(snapshot, noise, load):
    value = clamp(round(snapshot["overview"]["coverage"] - load / 24 + noise * 4), 40, 100)
    tone = "critical" if value < 86 else "warning" if value < 93 else "normal"
    return value, tone, f"{value}%"


SENSOR_TYPE_CATALOG = {
    "pipeline_pressure": {"label": "Давление магистрали", "reader": _pipeline_pressure},
    "pipeline_flow": {"label": "Нагрузка магистрали", "reader": _pipeline_flow},
    "pipeline_leak": {"label": "Риск утечки", "reader": _pipeline_leak},
    "hub_quality": {"label": "Индекс качества", "reader": _hub_quality},
    "hub_balance": {"label": "Баланс контура", "reader": _hub_balance},
    "micro_pressure": {"label": "Давление микрорайона", "reader": _micro_pressure},
    "micro_quality": {"label": "Санитарный контроль", "reader": _micro_quality},
    "micro_load": {"label": "Загрузка хаба", "reader": _micro_load},
    "building_pressure": {"label": "Давление в ЖК", "reader": _building_pressure},
    "building_quality": {"label": "Качество в доме", "reader": _building_quality},
    "building_turbidity": {"label": "Мутность", "reader": _building_turbidity},
    "building_service": {"label": "Уровень сервиса", "reader": _building_service},
}


def build_sensor(spec, snapshot, bucket):
    definition = SENSOR_TYPE_CATALOG[spec["type"]]
    noise = signed_noise(f"{spec['id']}:{bucket}")
    value, tone, formatted_value = definition["reader"](snapshot, noise, spec["load"])
    return {
        "id": spec["id"],
        "type": spec["type"],
        "title": spec["title"],
        "scope": spec["scope"],
        "parentId": spec["parentId"],
        "district": spec["district"],
        "locationLabel": spec["locationLabel"],
        "position": spec["position"],
        "load": spec["load"],
        "tone": tone,
        "value": value,
        "label": definition["label"],
        "formattedValue": formatted_value,
    }


def build_district_telemetry(district, snapshot, bucket, automation_status=None):
    district_map = ALMATY_MAP_CONFIG["districts"][district]
    source_node = next(
        (item for item in ALMATY_MAP_CONFIG["nodes"] if item["id"] == district_map["source"]),
        ALMATY_MAP_CONFIG["nodes"][0],
    )
    district_analysis = analyze_snapshot(snapshot)
    district_hub = {
        "id": f"district-hub-{district}",
        "title": f"{district} хаб",
        "district": district,
        "tone": district_analysis["tone"],
        "position": district_map["position"],
        "sourceId": source_node["id"],
    }

    micro_hubs = []
    for index, zone in enumerate(snapshot["topology"]):
        angle = (math.pi * 2 * index) / max(len(snapshot["topology"]), 1) + signed_noise(f"{district}:{index}") * 0.45
        micro_hubs.append(
            {
                "id": f"micro-hub-{district}-{index}",
                "title": zone["label"],
                "district": district,
                "load": zone["load"],
                "position": offset_position(district_map["position"], angle, 0.014, 0.016),
                "tone": "critical" if zone["load"] > 90 else "warning" if zone["load"] > 80 else "normal",
            }
        )

    specs = [
        {
            "id": f"pipe-pressure-{district}",
            "type": "pipeline_pressure",
            "title": "Магистральный участок A",
            "scope": "pipeline",
            "parentId": district_hub["id"],
            "district": district,
            "locationLabel": "Магистраль",
            "position": mix_position(source_node["position"], district_map["position"], 0.35),
            "load": snapshot["overview"]["pumpLoad"],
        },
        {
            "id": f"pipe-flow-{district}",
            "type": "pipeline_flow",
            "title": "Магистральный участок B",
            "scope": "pipeline",
            "parentId": district_hub["id"],
            "district": district,
            "locationLabel": "Магистраль",
            "position": mix_position(source_node["position"], district_map["position"], 0.58),
            "load": snapshot["overview"]["pumpLoad"],
        },
        {
            "id": f"pipe-leak-{district}",
            "type": "pipeline_leak",
            "title": "Контроль утечек",
            "scope": "pipeline",
            "parentId": district_hub["id"],
            "district": district,
            "locationLabel": "Магистраль",
            "position": mix_position(source_node["position"], district_map["position"], 0.8),
            "load": snapshot["overview"]["pumpLoad"],
        },
        {
            "id": f"hub-quality-{district}",
            "type": "hub_quality",
            "title": "Контроль качества на хабе",
            "scope": "district-hub",
            "parentId": district_hub["id"],
            "district": district,
            "locationLabel": district_hub["title"],
            "position": offset_position(district_map["position"], math.pi / 4, 0.005, 0.006),
            "load": snapshot["overview"]["sampleRate"],
        },
        {
            "id": f"hub-balance-{district}",
            "type": "hub_balance",
            "title": "Баланс подачи на хабе",
            "scope": "district-hub",
            "parentId": district_hub["id"],
            "district": district,
            "locationLabel": district_hub["title"],
            "position": offset_position(district_map["position"], math.pi * 1.1, 0.005, 0.006),
            "load": snapshot["overview"]["coverage"],
        },
    ]

    for index, hub in enumerate(micro_hubs):
        metric_type = "micro_load" if index % 3 == 0 else "micro_quality" if index % 2 == 0 else "micro_pressure"
        second_metric_type = "micro_quality" if metric_type == "micro_pressure" else "micro_pressure"
        specs.extend(
            [
                {
                    "id": f"micro-primary-{district}-{index}",
                    "type": metric_type,
                    "title": f"{hub['title']}: первичный контур",
                    "scope": "micro-hub",
                    "parentId": hub["id"],
                    "district": district,
                    "locationLabel": hub["title"],
                    "position": offset_position(hub["position"], math.pi / 5, 0.0035, 0.0045),
                    "load": hub["load"],
                },
                {
                    "id": f"micro-secondary-{district}-{index}",
                    "type": second_metric_type,
                    "title": f"{hub['title']}: вторичный контур",
                    "scope": "micro-hub",
                    "parentId": hub["id"],
                    "district": district,
                    "locationLabel": hub["title"],
                    "position": offset_position(hub["position"], math.pi * 1.2, 0.0038, 0.0042),
                    "load": hub["load"],
                },
            ]
        )

    key_sites = snapshot["meta"].get("keySites", [])
    for index, site in enumerate(key_sites):
        anchor_hub = micro_hubs[index % len(micro_hubs)] if micro_hubs else district_hub
        angle = ((index + 1) * math.pi) / 3
        anchor = offset_position(anchor_hub["position"], angle, 0.006 + index * 0.001, 0.008 + index * 0.001)
        specs.extend(
            [
                {
                    "id": f"building-pressure-{district}-{index}",
                    "type": "building_pressure",
                    "title": f"{site}: стояк",
                    "scope": "building",
                    "parentId": anchor_hub["id"],
                    "district": district,
                    "locationLabel": site,
                    "position": anchor,
                    "load": anchor_hub.get("load", snapshot["overview"]["pumpLoad"]),
                },
                {
                    "id": f"building-service-{district}-{index}",
                    "type": "building_quality" if index % 2 == 0 else "building_turbidity",
                    "title": f"{site}: контроль воды",
                    "scope": "building",
                    "parentId": anchor_hub["id"],
                    "district": district,
                    "locationLabel": site,
                    "position": offset_position(anchor, math.pi * 0.7, 0.0025, 0.003),
                    "load": anchor_hub.get("load", snapshot["overview"]["coverage"]),
                },
                {
                    "id": f"building-service-level-{district}-{index}",
                    "type": "building_service",
                    "title": f"{site}: сервис ЖК",
                    "scope": "building",
                    "parentId": micro_hubs[index % len(micro_hubs)]["id"] if micro_hubs else district_hub["id"],
                    "district": district,
                    "locationLabel": site,
                    "position": offset_position(district_map["position"], math.pi * 1.45 + index * 0.55, 0.01, 0.012),
                    "load": micro_hubs[index % len(micro_hubs)]["load"] if micro_hubs else snapshot["overview"]["coverage"],
                },
            ]
        )

    sensors = [build_sensor(spec, snapshot, bucket) for spec in specs]
    previous_sensors = [build_sensor(spec, snapshot, bucket - 1) for spec in specs]
    active_sensors = [sensor for sensor in sensors if sensor["tone"] != "normal"]
    previous_active_count = len([sensor for sensor in previous_sensors if sensor["tone"] != "normal"])
    warning_count = len([sensor for sensor in active_sensors if sensor["tone"] == "warning"])
    critical_count = len([sensor for sensor in active_sensors if sensor["tone"] == "critical"])
    rising = len(active_sensors) > previous_active_count
    quality_alerts = len([sensor for sensor in active_sensors if "quality" in sensor["type"] or "turbidity" in sensor["type"]])
    hydraulic_alerts = len([sensor for sensor in active_sensors if "pressure" in sensor["type"] or "flow" in sensor["type"]])
    service_alerts = len([sensor for sensor in active_sensors if "service" in sensor["type"] or "leak" in sensor["type"]])
    auto_dispatch = critical_count > 0 or (len(active_sensors) >= 4 and rising)
    escalate_to_center = auto_dispatch or len(active_sensors) >= 6 or district_analysis["tone"] == "critical"
    escalate_to_akimat = critical_count >= 3 or (district_analysis["tone"] == "critical" and len(active_sensors) >= 7)
    monitored_from = CONTROL_NODES["mainCenter"]["title"] if escalate_to_akimat or critical_count >= 2 else district_hub["title"]
    tone = "critical" if escalate_to_akimat else "warning" if active_sensors else district_analysis["tone"]

    event_feed = [
        {
            "id": f"telemetry-{district}-{bucket}",
            "time": "сейчас",
            "tone": tone,
            "title": f"Пересчитан пакет датчиков {district}",
            "description": f"Сеть обновила {len(sensors)} сенсоров. Активных сигналов: {len(active_sensors)}, критичных: {critical_count}.",
        }
    ]
    if auto_dispatch:
        event_feed.append(
            {
                "id": f"dispatch-{district}-{bucket}",
                "time": "авто",
                "tone": "critical" if critical_count > 0 else "warning",
                "title": "AI подключил бригаду",
                "description": f"AI направил выездную бригаду и включил удалённое наблюдение из {monitored_from}.",
            }
        )
    if escalate_to_center:
        event_feed.append(
            {
                "id": f"center-{district}-{bucket}",
                "time": "центр",
                "tone": "critical" if escalate_to_akimat else "warning",
                "title": "Эскалация в главный центр",
                "description": f"Районный хаб поднял сигнал в {CONTROL_NODES['mainCenter']['title']} для координации смены и контроля экипажа.",
            }
        )
    if escalate_to_akimat:
        event_feed.append(
            {
                "id": f"akimat-{district}-{bucket}",
                "time": "акимат",
                "tone": "critical",
                "title": "Уведомление в акимат",
                "description": "AI направил срочное уведомление о риске для города и запросил контроль через городской контур.",
            }
        )

    effective_automation = automation_status or {
        "activeActionIds": [],
        "monitoredFrom": monitored_from,
        "escalateToCenter": escalate_to_center,
        "escalateToAkimat": escalate_to_akimat,
    }

    return {
        "district": district,
        "tone": tone,
        "sourceNode": source_node,
        "districtHub": district_hub,
        "microHubs": micro_hubs,
        "sensors": sensors,
        "topSensors": sorted(active_sensors, key=lambda item: SEVERITY_RANK[item["tone"]], reverse=True)[:4],
        "warningCount": warning_count,
        "criticalCount": critical_count,
        "activeSensorCount": len(active_sensors),
        "totalSensors": len(sensors),
        "autoDispatch": auto_dispatch,
        "escalateToCenter": escalate_to_center,
        "escalateToAkimat": escalate_to_akimat,
        "monitoredFrom": monitored_from,
        "qualityAlerts": quality_alerts,
        "hydraulicAlerts": hydraulic_alerts,
        "serviceAlerts": service_alerts,
        "observationChain": [district_hub["title"], CONTROL_NODES["mainCenter"]["title"], CONTROL_NODES["akimat"]["title"]],
        "eventFeed": event_feed,
        "automation": effective_automation,
    }


def derive_automation_plan(telemetry_network):
    plan = {}
    for district in DISTRICT_ORDER:
        summary = telemetry_network["districts"].get(district)
        if not summary:
            continue
        active_action_ids = []
        if summary["autoDispatch"]:
            active_action_ids.append("dispatchCrew")
        if summary["hydraulicAlerts"] >= 2:
            active_action_ids.append("reserveBypass")
        if summary["qualityAlerts"] >= 2 or summary["criticalCount"] > 0:
            active_action_ids.append("flushLine")
        if summary["serviceAlerts"] >= 2 or summary["warningCount"] >= 3:
            active_action_ids.append("notifyResidents")

        plan[district] = {
            "district": district,
            "activeActionIds": active_action_ids,
            "dispatchCrew": "dispatchCrew" in active_action_ids,
            "reserveBypass": "reserveBypass" in active_action_ids,
            "flushLine": "flushLine" in active_action_ids,
            "notifyResidents": "notifyResidents" in active_action_ids,
            "monitoredFrom": summary["monitoredFrom"],
            "escalateToCenter": summary["escalateToCenter"],
            "escalateToAkimat": summary["escalateToAkimat"],
            "reason": "Рост сигналов активировал автоматическое реагирование AI."
            if summary["autoDispatch"]
            else "Система продолжает удалённый мониторинг без выезда.",
        }
    return plan


def apply_automation_responses(snapshot, automation=None):
    automation = automation or {}
    if not automation.get("activeActionIds"):
        return snapshot

    next_snapshot = {
        **snapshot,
        "overview": dict(snapshot["overview"]),
        "topology": [dict(item) for item in snapshot["topology"]],
        "trends": {key: [dict(item) for item in snapshot["trends"][key]] for key in snapshot["trends"]},
    }

    if automation.get("dispatchCrew"):
        next_snapshot["overview"]["fieldTeams"] = clamp(next_snapshot["overview"]["fieldTeams"] + 1, 1, 8)
        next_snapshot["overview"]["responseEta"] = clamp(next_snapshot["overview"]["responseEta"] - 4, 8, 60)
        next_snapshot["overview"]["complaints"] = clamp(next_snapshot["overview"]["complaints"] - 2, 0, 90)
        next_snapshot["overview"]["incidents"] = clamp(next_snapshot["overview"]["incidents"] - 1, 0, 12)
    if automation.get("reserveBypass"):
        next_snapshot["overview"]["pressure"] = round(clamp(next_snapshot["overview"]["pressure"] + 0.3, 1.1, 4.4), 1)
        next_snapshot["overview"]["coverage"] = clamp(next_snapshot["overview"]["coverage"] + 1, 68, 100)
        next_snapshot["overview"]["pumpLoad"] = clamp(next_snapshot["overview"]["pumpLoad"] - 4, 24, 98)
    if automation.get("flushLine"):
        next_snapshot["overview"]["quality"] = clamp(next_snapshot["overview"]["quality"] + 5, 25, 100)
        next_snapshot["overview"]["turbidity"] = round(clamp(next_snapshot["overview"]["turbidity"] - 0.8, 1, 12), 1)
        next_snapshot["overview"]["sampleRate"] = clamp(next_snapshot["overview"]["sampleRate"] + 4, 60, 100)
    if automation.get("notifyResidents"):
        next_snapshot["overview"]["complaints"] = clamp(next_snapshot["overview"]["complaints"] - 2, 0, 90)
    return next_snapshot


def build_telemetry_network(district_snapshots, refresh_bucket, automation_by_district=None):
    automation_by_district = automation_by_district or {}
    districts = {
        district: build_district_telemetry(
            district,
            district_snapshots[district],
            refresh_bucket,
            automation_by_district.get(district),
        )
        for district in DISTRICT_ORDER
    }
    district_entries = list(districts.values())
    event_feed = []
    for item in district_entries:
        for event in item["eventFeed"]:
            event_feed.append({**event, "district": item["district"]})
    event_feed.sort(key=lambda item: SEVERITY_RANK[item["tone"]], reverse=True)

    total_sensors = sum(item["totalSensors"] for item in district_entries)
    active_warnings = sum(item["warningCount"] for item in district_entries)
    active_critical = sum(item["criticalCount"] for item in district_entries)
    center_escalations = len([item for item in district_entries if item["escalateToCenter"]])
    akimat_escalations = len([item for item in district_entries if item["escalateToAkimat"]])
    return {
        "refreshBucket": refresh_bucket,
        "districts": districts,
        "city": {
            "totalSensors": total_sensors,
            "activeWarnings": active_warnings,
            "activeCritical": active_critical,
            "autoDispatches": len([item for item in district_entries if item["autoDispatch"]]),
            "centerEscalations": center_escalations,
            "akimatEscalations": akimat_escalations,
            "mainCenter": {
                **CONTROL_NODES["mainCenter"],
                "tone": "critical" if akimat_escalations > 0 else "warning" if center_escalations > 2 else "normal",
            },
            "akimat": {
                **CONTROL_NODES["akimat"],
                "tone": "critical" if akimat_escalations > 0 else "normal",
            },
            "eventFeed": event_feed[:12],
        },
    }
