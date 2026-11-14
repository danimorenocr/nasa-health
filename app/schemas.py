from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MessageInput(StrictModel):
    text: str = Field(min_length=1, max_length=2000)


class ConfirmInput(StrictModel):
    pending_id: UUID
    confirmed: Literal[True]
    origin: str = Field(min_length=2, max_length=120)
    context: str = Field(default="", max_length=500)
    measured_at: datetime | None = None

    @field_validator("measured_at")
    @classmethod
    def aware_timestamp(cls, value):
        if value is not None:
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("Incluye zona horaria en measured_at.")
            return value.astimezone(timezone.utc)
        return value


class MeasurementCandidate(BaseModel):
    kind: Literal["measurement"]
    metric: Literal["heart_rate", "temperature", "blood_pressure", "oxygen_saturation", "glucose", "sleep"]
    values: list[float]
    unit: str
    original_text: str
    suggested_origin: str | None = None
    suggested_measured_at: str | None = None


class SymptomCandidate(BaseModel):
    kind: Literal["symptom"]
    original_text: str


class BatchMeasurementCandidate(BaseModel):
    kind: Literal["batch"]
    measurements: list[MeasurementCandidate]
    original_text: str
    suggested_origin: str | None = None
    suggested_measured_at: str | None = None


Candidate = MeasurementCandidate | SymptomCandidate | BatchMeasurementCandidate


class SessionOut(BaseModel):
    token: str
    expires_after_idle_hours: int
    expires_after_idle_days: int
    storage: Literal["sqlite"]


class MessageOut(BaseModel):
    status: Literal["needs_confirmation", "needs_clarification", "safety_notice", "information"]
    message: str
    candidate: Candidate | None
    source_ids: list[str]
    content_origin: Literal["prototype_template_not_clinical_protocol"]
    rule_set_version: str
    clinical_assessment: Literal["not_performed"]
    communication_sent: Literal[False]
    pending_id: str | None
    pending_expires_at: str | None
    recorded: Literal[False]
    recommendations: list[str] | str | None = None
    llm_used: bool = False


class EntryOut(BaseModel):
    id: str
    recorded_at: str
    measured_at: str
    candidate: Candidate
    origin: str
    context: str
    confirmed_by_user: Literal[True]
    clinical_assessment: Literal["not_performed"]


class RecordedOut(BaseModel):
    status: Literal["recorded"]
    entry: EntryOut
    entries: list[EntryOut] | None = None
    clinical_assessment: Literal["not_performed"]
    message: str


class EntriesOut(BaseModel):
    entries: list[EntryOut]
    count: int
    limit: int
    offset: int


class HistoryPoint(BaseModel):
    t: str
    values: list[float]
    unit: str
    origin: str
    context: str
    entry_id: str


class HistorySeries(BaseModel):
    unit: str
    points: list[HistoryPoint]


class HistoryOut(BaseModel):
    metric: str
    days: int
    as_of: str
    series: list[HistorySeries]
    count: int
    clinical_assessment: Literal["not_performed"]
