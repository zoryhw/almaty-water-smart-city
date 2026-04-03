from django.contrib import admin

from .models import AiRun, AlertEvent, AutopilotDecisionLog, DistrictCycleSnapshot, TelemetryPacket


@admin.register(TelemetryPacket)
class TelemetryPacketAdmin(admin.ModelAdmin):
    list_display = (
        "received_at",
        "selected_district",
        "active_scenario",
        "selected_page",
        "alert_count",
        "auto_districts",
    )
    search_fields = ("selected_district", "active_scenario", "selected_page", "session_role")
    ordering = ("-received_at",)


@admin.register(AutopilotDecisionLog)
class AutopilotDecisionLogAdmin(admin.ModelAdmin):
    list_display = ("decision_at", "selected_district", "refresh_bucket", "token")
    search_fields = ("selected_district", "token")
    ordering = ("-decision_at",)


@admin.register(AiRun)
class AiRunAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "district", "model", "tone")
    search_fields = ("district", "model", "kind")
    ordering = ("-created_at",)


@admin.register(DistrictCycleSnapshot)
class DistrictCycleSnapshotAdmin(admin.ModelAdmin):
    list_display = (
        "recorded_at",
        "district",
        "scenario",
        "tone",
        "risk_score",
        "active_signals",
        "critical_signals",
        "action_count",
    )
    search_fields = ("district", "scenario", "monitored_from")
    ordering = ("-recorded_at",)


@admin.register(AlertEvent)
class AlertEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "district", "severity", "title", "source")
    search_fields = ("district", "title", "source", "severity")
    ordering = ("-created_at",)
