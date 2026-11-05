"""Project showcase: records live in sm_settings (key `project:<uuid>`), uploads and a public
`projects.json` live in a public Supabase Storage bucket that the marketing website reads."""
import json
import re
from urllib.parse import parse_qs, urlparse

import httpx

BUCKET = 'showcase'
MAX_UPLOAD = 50 * 1024 * 1024  # Supabase Storage's default per-file limit
VIDEO_TYPES = {'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'}
IMAGE_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}


class ShowcaseError(Exception):
    pass


def video_info(url):
    """Classify a demo-video URL so the website can embed it correctly."""
    url = (url or '').strip()
    if not url:
        return None
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower().removeprefix('www.')
    if host in ('youtube.com', 'm.youtube.com', 'youtu.be'):
        vid = None
        if host == 'youtu.be':
            vid = parsed.path.strip('/').split('/')[0]
        elif parsed.path == '/watch':
            vid = (parse_qs(parsed.query).get('v') or [None])[0]
        else:
            m = re.match(r'^/(?:shorts|embed|live)/([\w-]{6,20})', parsed.path)
            vid = m.group(1) if m else None
        if vid and re.fullmatch(r'[\w-]{6,20}', vid):
            return {'type': 'youtube', 'id': vid, 'url': f'https://www.youtube.com/watch?v={vid}',
                    'embed': f'https://www.youtube-nocookie.com/embed/{vid}', 'thumbnail': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'}
    if host == 'vimeo.com':
        m = re.match(r'^/(\d+)', parsed.path)
        if m:
            return {'type': 'embed', 'url': url, 'embed': f'https://player.vimeo.com/video/{m.group(1)}'}
    if host == 'loom.com':
        m = re.match(r'^/(?:share|embed)/([a-f0-9]{32})', parsed.path)
        if m:
            return {'type': 'embed', 'url': url, 'embed': f'https://www.loom.com/embed/{m.group(1)}'}
    if parsed.scheme == 'https' and re.search(r'\.(mp4|webm|mov)$', parsed.path, re.I):
        return {'type': 'file', 'url': url}
    raise ShowcaseError('Use a YouTube, Vimeo or Loom link, or upload an MP4/WebM/MOV file.')


class Showcase:
    def __init__(self, settings, store):
        self.settings = settings
        self.store = store

    def _headers(self, extra=None):
        key = self.settings.supabase_secret_key
        headers = {'apikey': key, 'Authorization': f'Bearer {key}'}
        return {**headers, **(extra or {})}

    def _base(self):
        return self.settings.supabase_url.rstrip('/')

    def public_url(self, path):
        return f'{self._base()}/storage/v1/object/public/{BUCKET}/{path}'

    async def ensure_bucket(self, client):
        response = await client.post(f'{self._base()}/storage/v1/bucket', headers=self._headers(), json={'id': BUCKET, 'name': BUCKET, 'public': True})
        if response.status_code not in (200, 201, 400, 409):
            raise ShowcaseError('Could not prepare file storage in Supabase.')

    async def upload(self, path, content, content_type):
        if len(content) > MAX_UPLOAD:
            raise ShowcaseError('That file is over 50 MB. Upload it to YouTube (unlisted is fine) and paste the link instead.')
        async with httpx.AsyncClient(timeout=300) as client:
            await self.ensure_bucket(client)
            response = await client.post(f'{self._base()}/storage/v1/object/{BUCKET}/{path}', content=content,
                                         headers=self._headers({'Content-Type': content_type, 'x-upsert': 'true'}))
        if response.is_error:
            raise ShowcaseError('Supabase rejected the upload (file may be too large for your plan). Try a YouTube link instead.')
        return self.public_url(path)

    async def publish(self):
        """Write the public projects.json the website reads: published projects only."""
        rows = await self.store.list('sm_settings', filters={'id': 'like.project:*'}, limit=500)
        projects = []
        for row in rows:
            value = row['value']
            if not value.get('published'):
                continue
            video = video_info(value.get('video_url'))
            thumb = value.get('thumbnail_url') or (video or {}).get('thumbnail') or ''
            projects.append({
                'id': row['id'][8:], 'title': value['title'], 'summary': value.get('summary', ''), 'link': value.get('link', ''),
                'tags': value.get('tags', []), 'video': video, 'thumbnail': thumb, 'created_at': value.get('created_at', ''),
                'order': value.get('order', 0),
            })
        projects.sort(key=lambda p: (p['order'], p['created_at']), reverse=False)
        body = json.dumps({'projects': projects}, ensure_ascii=False).encode()
        async with httpx.AsyncClient(timeout=60) as client:
            await self.ensure_bucket(client)
            response = await client.post(f'{self._base()}/storage/v1/object/{BUCKET}/projects.json', content=body,
                                         headers=self._headers({'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': 'max-age=30'}))
        if response.is_error:
            raise ShowcaseError('Saved, but could not publish to the website feed.')
        return len(projects)
