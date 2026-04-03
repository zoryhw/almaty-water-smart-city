import json

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .models import AiRun, AutopilotDecisionLog, TelemetryPacket
from .services.analytics import build_analytics_summary, create_alert_events, create_district_frames
from .services.autopilot import create_autopilot_decision
from .services.gemini import DEFAULT_GEMINI_MODEL, create_grounded_chat_reply, create_structured_report
from .services.public_intel import get_public_intel


def json_error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def parse_json_body(request: HttpRequest):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError("Invalid JSON payload.") from error


def summarize_telemetry_payload(payload):
    automation = payload.get("automationByDistrict") or {}
    return {
        "selected_district": payload.get("selectedDistrict"),
        "active_scenario": payload.get("activeScenario"),
        "alert_count": len(payload.get("alertFeed") or []),
        "auto_districts": sum(1 for entry in automation.values() if (entry or {}).get("activeActionIds")),
    }


def serialize_telemetry_record(record):
    return {
        "id": str(record.id),
        "receivedAt": record.received_at.isoformat(),
        "payload": record.payload,
    }


@require_GET
def health_view(request):
    return JsonResponse(
        {
            "ok": True,
            "hasGeminiKey": bool(settings.GEMINI_API_KEY),
            "port": settings.APP_PORT,
            "database": settings.DATABASES["default"]["ENGINE"].split(".")[-1],
            "time": timezone.now().isoformat(),
        }
    )


@require_GET
def public_intel_view(request):
    try:
        payload = get_public_intel(
            district=request.GET.get("district") or "Алматы",
            scenario=request.GET.get("scenario") or "baseline",
        )
        return JsonResponse(payload)
    except Exception as error:
        return json_error(str(error), status=500)


@csrf_exempt
@require_http_methods(["POST"])
def ai_chat_view(request):
    if not settings.GEMINI_API_KEY:
        return json_error("GEMINI_API_KEY is not configured on the server.", status=500)

    try:
        payload = parse_json_body(request)
        response_payload = create_grounded_chat_reply(
            api_key=settings.GEMINI_API_KEY,
            model=payload.get("model") or DEFAULT_GEMINI_MODEL,
            context=payload.get("context") or {},
            alerts=payload.get("alerts") or [],
            knowledge_base=payload.get("knowledgeBase") or [],
            history=payload.get("history") or [],
            message=payload.get("message") or "",
        )
        AiRun.objects.create(
            kind=AiRun.KIND_CHAT,
            model=payload.get("model") or DEFAULT_GEMINI_MODEL,
            district=(payload.get("context") or {}).get("district"),
            tone=response_payload.get("tone", ""),
            request_payload=payload,
            response_payload=response_payload,
        )
        return JsonResponse(response_payload)
    except ValueError as error:
        return json_error(str(error), status=400)
    except Exception as error:
        return json_error(str(error), status=500)


@csrf_exempt
@require_http_methods(["POST"])
def ai_report_view(request):
    if not settings.GEMINI_API_KEY:
        return json_error("GEMINI_API_KEY is not configured on the server.", status=500)

    try:
        payload = parse_json_body(request)
        response_payload = create_structured_report(
            api_key=settings.GEMINI_API_KEY,
            model=payload.get("model") or DEFAULT_GEMINI_MODEL,
            context=payload.get("context") or {},
            mission=payload.get("mission") or "",
        )
        AiRun.objects.create(
            kind=AiRun.KIND_REPORT,
            model=payload.get("model") or DEFAULT_GEMINI_MODEL,
            district=(payload.get("context") or {}).get("district"),
            tone=response_payload.get("tone", ""),
            request_payload=payload,
            response_payload=response_payload,
        )
        return JsonResponse(response_payload)
    except ValueError as error:
        return json_error(str(error), status=400)
    except Exception as error:
        return json_error(str(error), status=500)


@csrf_exempt
@require_http_methods(["POST"])
def ai_autopilot_view(request):
    try:
        payload = parse_json_body(request)
        response_payload = create_autopilot_decision(
            district_snapshots=payload.get("districtSnapshots") or {},
            refresh_bucket=payload.get("refreshBucket") or 0,
            selected_district=payload.get("selectedDistrict"),
            token=payload.get("token") or "",
        )
        AutopilotDecisionLog.objects.create(
            token=payload.get("token") or "",
            selected_district=payload.get("selectedDistrict"),
            refresh_bucket=payload.get("refreshBucket") or 0,
            request_payload=payload,
            response_payload=response_payload,
        )
        return JsonResponse(response_payload)
    except ValueError as error:
        return json_error(str(error), status=400)
    except Exception as error:
        return json_error(str(error), status=500)


@csrf_exempt
@require_http_methods(["POST"])
def telemetry_ingest_view(request):
    try:
        payload = parse_json_body(request)
        summary = summarize_telemetry_payload(payload)
        record = TelemetryPacket.objects.create(
            token=payload.get("token") or "",
            selected_district=summary["selected_district"],
            active_scenario=summary["active_scenario"],
            selected_page=payload.get("selectedPage"),
            session_access=((payload.get("session") or {}).get("access")),
            session_role=((payload.get("session") or {}).get("roleTitle")),
            alert_count=summary["alert_count"],
            auto_districts=summary["auto_districts"],
            payload=payload,
        )
        create_district_frames(record, payload)
        create_alert_events(record, payload)
        return JsonResponse(
            {
                "ok": True,
                "receivedAt": record.received_at.isoformat(),
                "storedRecords": TelemetryPacket.objects.count(),
            }
        )
    except ValueError as error:
        return json_error(str(error), status=400)
    except Exception as error:
        return json_error(str(error), status=500)


@require_GET
def telemetry_latest_view(request):
    records = list(TelemetryPacket.objects.all()[:40])
    last_payload = serialize_telemetry_record(records[0]) if records else None
    history = [
        {
            "id": str(item.id),
            "receivedAt": item.received_at.isoformat(),
            "selectedDistrict": item.selected_district,
            "activeScenario": item.active_scenario,
            "alertCount": item.alert_count,
            "autoDistricts": item.auto_districts,
        }
        for item in records
    ]
    return JsonResponse(
        {
            "ok": True,
            "lastPayload": last_payload,
            "history": history,
        }
    )


@require_GET
def analytics_summary_view(request):
    try:
        district = request.GET.get("district") or "Бостандыкский"
        limit = request.GET.get("limit") or 12
        return JsonResponse(build_analytics_summary(district, limit))
    except Exception as error:
        return json_error(str(error), status=500)
