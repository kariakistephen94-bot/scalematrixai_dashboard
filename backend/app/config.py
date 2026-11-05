from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / 'backend/.env', extra='ignore')

    google_maps_api_key: str = ''
    google_maps_max_requests: int = Field(default=12, ge=1, le=30)
    google_maps_max_pages: int = Field(default=2, ge=1, le=3)
    openai_api_key: str = ''
    openai_model: str = 'gpt-5.4-mini'
    supabase_url: str = ''
    supabase_secret_key: str = ''
    dashboard_api_token: str = ''
    scheduler_enabled: bool = True
    timezone: str = 'America/Los_Angeles'
    generation_time: str = '08:00'
    target_industry: str = 'Commercial cleaning; Solar businesses; Facility management'
    target_location: str = 'United States; United Kingdom; Nigeria; China'
    daily_prospect_count: int = Field(default=5, ge=1, le=15)
    content_focus: str = 'AI engineering, agents, automation architecture, RAG, evaluations, tools, and practical building lessons'

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        ZoneInfo(value)
        return value

    @property
    def storage_ready(self):
        return bool(self.supabase_url and self.supabase_secret_key)


@lru_cache
def get_settings():
    return Settings()
