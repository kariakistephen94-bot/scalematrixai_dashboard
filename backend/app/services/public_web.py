"""Small, bounded fetches of public company websites; never social login pages."""
import asyncio
import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import httpx

class WebsiteHTML(HTMLParser):
    def __init__(self):
        super().__init__();self.links=[];self.text=[];self.hidden=0;self.title=[];self.in_title=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag in ('script','style','noscript'): self.hidden+=1
        if tag=='title': self.in_title=True
        if tag=='a' and attrs.get('href'): self.links.append(attrs['href'])
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript'):self.hidden=max(0,self.hidden-1)
        if tag=='title':self.in_title=False
    def handle_data(self,value):
        if not self.hidden and value.strip():self.text.append(value.strip())
        if self.in_title:self.title.append(value.strip())

async def public_url(value):
    try:
        parsed=urlparse(value);host=parsed.hostname or ''
        if parsed.scheme not in ('http','https') or parsed.username or parsed.password or parsed.port not in (None,80,443) or not host or host.endswith(('.local','.internal')):return False
        async with asyncio.timeout(4):
            addresses=await asyncio.get_running_loop().getaddrinfo(host,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (ValueError,OSError):return False

async def website_page(url):
    async with httpx.AsyncClient(timeout=15,follow_redirects=False,headers={'User-Agent':'ScaleMatrixAI Research/1.0 (+https://scalematrixai.com)'}) as client:
        for _ in range(4):
            if not await public_url(url):return None
            async with client.stream('GET',url) as response:
                if response.status_code in (301,302,303,307,308):
                    url=urljoin(url,response.headers.get('location',''));continue
                if response.status_code!=200 or 'html' not in response.headers.get('content-type','').lower():return None
                content=bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content)>1500000:return None
            parser=WebsiteHTML();parser.feed(content.decode('utf-8',errors='replace'))
            return {'url':url,'links':[urljoin(url,href) for href in parser.links],'title':' '.join(parser.title),'text':' '.join(parser.text)[:50000]}
    return None

async def tiktok_profile(url):
    """Official public creator-profile oEmbed API; no login or feed scraping."""
    try:
        async with httpx.AsyncClient(timeout=15,follow_redirects=False) as client:
            response=await client.get('https://www.tiktok.com/oembed',params={'url':url})
        if response.status_code!=200 or len(response.content)>100000:return None
        data=response.json()
        if data.get('provider_name')!='TikTok' or not data.get('author_url') or not data.get('author_name'):return None
        return {'url':data['author_url'],'name':data['author_name'],'verification_url':str(response.request.url)}
    except (httpx.HTTPError,ValueError):return None
