from ..models import WorkspaceSettings


def defaults(settings):
    return WorkspaceSettings(
        target_industry=settings.target_industry,
        target_location=settings.target_location,
        content_focus=settings.content_focus,
        timezone=settings.timezone,
        generation_time=settings.generation_time,
        daily_prospect_count=settings.daily_prospect_count,
        schedule_enabled=settings.scheduler_enabled,
    )


async def load_workspace(store, settings):
    rows = await store.list('sm_settings', filters={'id': 'eq.default'}, limit=1)
    return WorkspaceSettings.model_validate(rows[0]['value']) if rows else defaults(settings)
