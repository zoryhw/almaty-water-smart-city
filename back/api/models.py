import uuid

from django.db import models


class TelemetryPacket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)
    token = models.CharField(max_length=128, blank=True)
    selected_district = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    active_scenario = models.CharField(max_length=64, blank=True, null=True)
    selected_page = models.CharField(max_length=64, blank=True, null=True)
    session_access = models.CharField(max_length=32, blank=True, null=True)
    session_role = models.CharField(max_length=128, blank=True, null=True)
    alert_count = models.PositiveIntegerField(default=0)
    auto_districts = models.PositiveIntegerField(default=0)
    payload = models.JSONField(default=dict)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self):
        return f"{self.selected_district or 'unknown'} @ {self.received_at.isoformat()}"


class AutopilotDecisionLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    decision_at = models.DateTimeField(auto_now_add=True, db_index=True)
    token = models.CharField(max_length=128, blank=True)
    selected_district = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    refresh_bucket = models.IntegerField(default=0)
    request_payload = models.JSONField(default=dict)
    response_payload = models.JSONField(default=dict)

    class Meta:
        ordering = ["-decision_at"]

    def __str__(self):
        return f"Autopilot {self.selected_district or 'unknown'} @ {self.decision_at.isoformat()}"


class AiRun(models.Model):
    KIND_CHAT = "chat"
    KIND_REPORT = "report"
    KIND_CHOICES = [
        (KIND_CHAT, "Chat"),
        (KIND_REPORT, "Report"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    model = models.CharField(max_length=128, blank=True)
    district = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    tone = models.CharField(max_length=32, blank=True)
    request_payload = models.JSONField(default=dict)
    response_payload = models.JSONField(default=dict)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.kind}:{self.district or 'unknown'} @ {self.created_at.isoformat()}"


class DistrictCycleSnapshot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    packet = models.ForeignKey(TelemetryPacket, related_name="district_frames", on_delete=models.CASCADE)
    recorded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    district = models.CharField(max_length=128, db_index=True)
    scenario = models.CharField(max_length=64, blank=True, null=True, db_index=True)
    tone = models.CharField(max_length=32, blank=True, db_index=True)
    risk_score = models.PositiveIntegerField(default=0)
    resilience = models.PositiveIntegerField(default=0)
    response_readiness = models.PositiveIntegerField(default=0)
    pressure = models.FloatField(default=0)
    quality = models.PositiveIntegerField(default=0)
    coverage = models.PositiveIntegerField(default=0)
    complaints = models.PositiveIntegerField(default=0)
    incidents = models.PositiveIntegerField(default=0)
    response_eta = models.PositiveIntegerField(default=0)
    pump_load = models.PositiveIntegerField(default=0)
    consumption = models.PositiveIntegerField(default=0)
    active_signals = models.PositiveIntegerField(default=0)
    critical_signals = models.PositiveIntegerField(default=0)
    action_count = models.PositiveIntegerField(default=0)
    monitored_from = models.CharField(max_length=128, blank=True)
    snapshot_payload = models.JSONField(default=dict)

    class Meta:
        ordering = ["-recorded_at"]

    def __str__(self):
        return f"{self.district} @ {self.recorded_at.isoformat()}"


class AlertEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    packet = models.ForeignKey(TelemetryPacket, related_name="alert_events", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    district = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    severity = models.CharField(max_length=32, blank=True, db_index=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    metric = models.CharField(max_length=128, blank=True)
    source = models.CharField(max_length=128, blank=True)
    action = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.severity}:{self.title}"
