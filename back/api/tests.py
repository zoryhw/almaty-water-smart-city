from django.test import Client, TestCase

from .services.data import DISTRICT_ORDER
from .services.telemetry import build_telemetry_network, derive_automation_plan


def build_snapshot(
    water_level,
    pressure,
    incidents,
    consumption,
    quality,
    coverage,
    complaints,
    response_eta,
    pump_load,
    energy_use,
    chlorine,
    turbidity,
    sample_rate,
    field_teams,
):
    return {
        "meta": {"keySites": ["Узел 1", "Узел 2", "Узел 3"]},
        "overview": {
            "waterLevel": water_level,
            "pressure": pressure,
            "incidents": incidents,
            "consumption": consumption,
            "quality": quality,
            "coverage": coverage,
            "complaints": complaints,
            "responseEta": response_eta,
            "pumpLoad": pump_load,
            "energyUse": energy_use,
            "chlorine": chlorine,
            "turbidity": turbidity,
            "sampleRate": sample_rate,
            "fieldTeams": field_teams,
        },
        "topology": [
            {"label": "Северная ветка", "load": 84},
            {"label": "Центр", "load": 88},
            {"label": "Южная ветка", "load": 79},
        ],
        "trends": {
            "consumption": [{"time": "06:00", "value": consumption - 1000}, {"time": "20:00", "value": consumption}],
            "pressure": [{"time": "06:00", "value": round(pressure + 0.2, 1)}, {"time": "20:00", "value": pressure}],
            "incidents": [{"time": "06:00", "value": max(0, incidents - 1)}, {"time": "20:00", "value": incidents}],
            "quality": [{"time": "06:00", "value": min(100, quality + 2)}, {"time": "20:00", "value": quality}],
        },
    }


def build_district_snapshots():
    snapshots = {}
    for district in DISTRICT_ORDER:
        snapshots[district] = build_snapshot(66, 3.1, 2, 12000, 86, 94, 10, 19, 68, 44, 0.64, 3.5, 92, 2)

    snapshots["Жетысуский"] = build_snapshot(41, 2.2, 5, 12800, 69, 86, 33, 32, 84, 67, 0.49, 6.2, 83, 3)
    snapshots["Бостандыкский"] = build_snapshot(58, 2.7, 3, 15500, 79, 92, 21, 24, 76, 58, 0.58, 4.9, 89, 3)
    return snapshots


class ApiSmokeTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_autopilot_endpoint(self):
        response = self.client.post(
            "/api/ai/autopilot",
            data={
                "token": "smoke-token",
                "refreshBucket": 12,
                "selectedDistrict": "Жетысуский",
                "districtSnapshots": build_district_snapshots(),
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["token"], "smoke-token")
        self.assertIn("automationByDistrict", payload)
        self.assertIn("selectedDistrictSummary", payload)

    def test_telemetry_ingest_and_latest(self):
        district_snapshots = build_district_snapshots()
        telemetry_network = build_telemetry_network(district_snapshots, 1)
        automation_by_district = derive_automation_plan(telemetry_network)
        ingest_response = self.client.post(
            "/api/telemetry/ingest",
            data={
                "token": "cycle-1",
                "selectedDistrict": "Бостандыкский",
                "activeScenario": "baseline",
                "selectedPage": "analytics",
                "session": {"access": "staff", "roleTitle": "Диспетчер смены"},
                "districtSnapshots": district_snapshots,
                "telemetryNetwork": telemetry_network,
                "automationByDistrict": automation_by_district,
                "alertFeed": [{"id": "alert-1"}, {"id": "alert-2"}],
            },
            content_type="application/json",
        )
        self.assertEqual(ingest_response.status_code, 200)
        latest_response = self.client.get("/api/telemetry/latest")
        self.assertEqual(latest_response.status_code, 200)
        latest_payload = latest_response.json()
        self.assertEqual(latest_payload["history"][0]["selectedDistrict"], "Бостандыкский")
        self.assertEqual(latest_payload["history"][0]["alertCount"], 2)

    def test_analytics_summary_endpoint(self):
        district_snapshots = build_district_snapshots()

        for bucket in (1, 2):
            district_snapshots["Бостандыкский"]["overview"]["complaints"] += bucket
            telemetry_network = build_telemetry_network(district_snapshots, bucket)
            automation_by_district = derive_automation_plan(telemetry_network)
            response = self.client.post(
                "/api/telemetry/ingest",
                data={
                    "token": f"cycle-{bucket}",
                    "selectedDistrict": "Бостандыкский",
                    "activeScenario": "baseline",
                    "selectedPage": "analytics",
                    "session": {"access": "staff", "roleTitle": "Диспетчер смены"},
                    "districtSnapshots": district_snapshots,
                    "telemetryNetwork": telemetry_network,
                    "automationByDistrict": automation_by_district,
                    "alertFeed": [
                        {
                            "id": f"alert-{bucket}",
                            "district": "Бостандыкский",
                            "severity": "warning",
                            "title": "Рост жалоб",
                            "description": "Нагрузка на линию связи увеличивается.",
                            "metric": f"{district_snapshots['Бостандыкский']['overview']['complaints']} жалоб",
                            "source": "Обращения жителей",
                            "action": "Проверить нагрузку смены.",
                        }
                    ],
                },
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200)

        analytics_response = self.client.get("/api/analytics/summary?district=Бостандыкский&limit=8")
        self.assertEqual(analytics_response.status_code, 200)
        analytics_payload = analytics_response.json()
        self.assertTrue(analytics_payload["ok"])
        self.assertEqual(analytics_payload["district"], "Бостандыкский")
        self.assertGreaterEqual(len(analytics_payload["timeline"]["district"]), 2)
        self.assertTrue(analytics_payload["latestCycle"]["riskScore"] >= 0)
        self.assertTrue(len(analytics_payload["ranking"]) >= 1)
        self.assertTrue(len(analytics_payload["recentEvents"]) >= 1)
