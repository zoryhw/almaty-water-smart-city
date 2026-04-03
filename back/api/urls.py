from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health_view, name="health"),
    path("public-intel", views.public_intel_view, name="public_intel"),
    path("analytics/summary", views.analytics_summary_view, name="analytics_summary"),
    path("ai/chat", views.ai_chat_view, name="ai_chat"),
    path("ai/report", views.ai_report_view, name="ai_report"),
    path("ai/autopilot", views.ai_autopilot_view, name="ai_autopilot"),
    path("telemetry/ingest", views.telemetry_ingest_view, name="telemetry_ingest"),
    path("telemetry/latest", views.telemetry_latest_view, name="telemetry_latest"),
]
