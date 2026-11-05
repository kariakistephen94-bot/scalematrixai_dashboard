from typing import Literal
from uuid import UUID
from datetime import date
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
import ipaddress
import re

from pydantic import BaseModel, Field, field_validator, model_validator
from .text_filters import clean_outreach, clean_generated


class GeneratedText(BaseModel):
    @model_validator(mode='before')
    @classmethod
    def remove_dashes(cls, value):
        return clean_generated(value)


class WorkspaceSettings(BaseModel):
    prospect_source: Literal["google_maps", "web_research"] = "google_maps"
    target_industry: str = Field(default='Commercial cleaning; Solar businesses; Facility management', min_length=3, max_length=250)
    target_location: str = Field(default='United States; United Kingdom; Nigeria; China', min_length=2, max_length=150)
    content_focus: str = Field(default='AI engineering, agents, automation architecture, RAG, evaluations, tools, and practical building lessons', min_length=5, max_length=500)
    timezone: str = 'America/Los_Angeles'
    generation_time: str = '08:00'
    daily_prospect_count: int = Field(default=5, ge=1, le=15)
    # Maps discovery only: skip listings with fewer Google reviews than this. 0 = no filter (the default).
    min_reviews: int = Field(default=0, ge=0, le=1000)
    schedule_enabled: bool = True
    target_tiers: list[Literal['higher', 'middle', 'lower']] = Field(default_factory=lambda: ['higher', 'middle', 'lower'], min_length=1, max_length=3)
    target_areas: list[str] = Field(default_factory=list, max_length=30)

    @field_validator('timezone')
    @classmethod
    def validate_zone(cls, value):
        try:
            ZoneInfo(value)
        except Exception as exc:
            raise ValueError('Use a valid IANA timezone, such as America/Los_Angeles.') from exc
        return value

    @field_validator('generation_time')
    @classmethod
    def validate_time(cls, value):
        if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
            raise ValueError('Use a 24-hour time, such as 08:00.')
        return value


class ContentDraft(GeneratedText):
    platform: Literal['linkedin', 'twitter']
    title: str = Field(min_length=5, max_length=160)
    body: str = Field(min_length=20, max_length=3000)
    topic: str = Field(min_length=3, max_length=100)
    rationale: str = Field(min_length=10, max_length=800)
    visual_brief: str = Field(max_length=1000)

    @field_validator('body')
    @classmethod
    def no_individual_tags(cls, value):
        if re.search(r'(?<!\w)@[A-Za-z0-9_]+', value):
            raise ValueError('Drafts must not include unverified account mentions.')
        return value


class DailyContent(BaseModel):
    linkedin: ContentDraft
    twitter: ContentDraft


class ProspectCandidate(GeneratedText):
    name: str = Field(min_length=2, max_length=180)
    website: str
    industry: str = Field(max_length=200)
    location: str = Field(max_length=180)
    opportunity: str = Field(min_length=10, max_length=800)
    evidence: str = Field(min_length=10, max_length=1200)
    source_url: str
    contact_url: str | None
    outreach_draft: str = Field(min_length=20, max_length=2000)

    _clean_outreach = field_validator('outreach_draft')(clean_outreach)

    @field_validator('website', 'source_url', 'contact_url')
    @classmethod
    def public_url(cls, value):
        if value is None:
            return value
        parsed = urlparse(value)
        host = parsed.hostname or ''
        if parsed.scheme not in ('https', 'http') or '.' not in host or parsed.username or parsed.password or host.endswith('.local') or host == 'localhost':
            raise ValueError('Use a public HTTP website.')
        try:
            if not ipaddress.ip_address(host).is_global:
                raise ValueError('Private network URLs are not allowed.')
        except ValueError as exc:
            if 'Private network' in str(exc):
                raise
        return value


class ProspectResults(BaseModel):
    prospects: list[ProspectCandidate] = Field(max_length=15)


class PostUpdate(GeneratedText):
    body: str | None = Field(default=None, min_length=1, max_length=3000)
    status: Literal['draft', 'approved', 'posted', 'archived'] | None = None


class ProspectUpdate(GeneratedText):
    stage: Literal['new', 'shortlisted', 'contacted', 'qualified', 'archived'] | None = None
    notes: str | None = Field(default=None, max_length=4000)
    outreach_draft: str | None = Field(default=None, max_length=3000)

    _clean_outreach = field_validator('outreach_draft')(clean_outreach)


class MapsLeadUpdate(BaseModel):
    stage: Literal["new", "shortlisted", "contacted", "qualified", "archived"] | None = None
    notes: str | None = Field(default=None, max_length=4000)


class QuickSearch(BaseModel):
    request_id: UUID
    workspace: WorkspaceSettings | None = None


class CRMContact(BaseModel):
    company: str = Field(min_length=2, max_length=180)
    contact_name: str = Field(default='', max_length=180)
    email: str = Field(default='', max_length=254)
    phone: str = Field(default='', max_length=80)
    stage: Literal['new', 'contacted', 'meeting', 'proposal', 'won', 'lost'] = 'new'
    value: float = Field(default=0, ge=0, le=1000000000, allow_inf_nan=False)
    currency: Literal['USD', 'GBP', 'NGN'] = 'USD'
    follow_up: date | None = None
    notes: str = Field(default='', max_length=8000)
    source_type: Literal['manual', 'web_research', 'google_maps'] = 'manual'
    source_id: UUID | None = None

    @field_validator('email')
    @classmethod
    def valid_contact_email(cls, value):
        if value and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address.')
        return value


class CRMBulkImport(BaseModel):
    source_type: Literal['google_maps', 'web_research']


class CRMBusinessLookup(BaseModel):
    contact_ids: list[UUID] = Field(min_length=1, max_length=20)


class ProjectBody(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    summary: str = Field(default='', max_length=1200)
    video_url: str = Field(default='', max_length=500)
    thumbnail_url: str = Field(default='', max_length=500)
    link: str = Field(default='', max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=8)
    published: bool = True
    order: int = Field(default=0, ge=0, le=100000)
