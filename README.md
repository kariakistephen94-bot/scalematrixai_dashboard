# ScaleMatrix AI Dashboard

A private, local agency workspace built with **Next.js + React**, **FastAPI**, **OpenAI**, and **Supabase Postgres**.

## What it does

- Generates one original LinkedIn draft and one standalone X/Twitter post per day.
- Uses your saved LinkedIn style guide and real post examples as context. This is prompt-based style grounding, not an OpenAI fine-tuned model.
- Discovers businesses through Google Maps, or uses OpenAI web research for source-backed opportunities.
- Supports commercial cleaning, solar businesses, and facility management across the United States, United Kingdom, and Nigeria.
- Saves drafts, approval state, prospects, private notes, pipeline stages, daily settings, and job history in Supabase.
- Includes a CRM with New, Contacted, Meeting, Proposal, Won, and Lost stages; contact details; deal values in USD/GBP/NGN; and dated follow-ups. Add contacts manually or link discovered prospects.
- Quick Search starts lead discovery immediately and can be repeated on the same day. Adjust search selects one-off niches, markets, and counts without changing daily settings.
- Provides editable post and outreach drafts, copy actions, filters, and CSV export.
- Runs a daily brief at **08:00 America/Los_Angeles** by default, with timezone-aware scheduling and one durable run per day.
- Does not auto-post to LinkedIn/X or send outreach. “Posted” and “Contacted” are manual tracking labels.

## Quick start

The development servers use **3001** (Next.js) and **8001** (FastAPI), so your existing agency landing page on port 3000 stays separate.

### 1. Install dependencies

Use Node.js 20.9+ and Python 3.12+.

```sh
cd frontend
npm install
cd ../backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
python3 scripts/setup_env.py
```

### 2. Configure integrations

Open `backend/.env` and fill in:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
GOOGLE_MAPS_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

`SUPABASE_SECRET_KEY` accepts a Supabase secret API key (`sb_secret_...`) or a legacy service-role key. Do not use the publishable/anon key. The key stays on the Python server. Never prefix secrets with `NEXT_PUBLIC_`.

The setup script creates a private `DASHBOARD_API_TOKEN` shared by `backend/.env` and `frontend/.env.local`. Preserve it in both places. No existing environment files are overwritten.

In your own Supabase project's SQL Editor, run:

`supabase/migrations/001_workspace.sql`

The migration creates only `sm_`-prefixed tables and a run-claim function. It enables RLS, revokes browser roles, and grants the backend service role access. No Supabase project or credentials are created automatically. If Data API exposure is disabled, expose these `public` tables through your project's Data API settings.

### 3. Start locally

From the project root:

```sh
node scripts/dev.mjs
```

Or run each process in a separate terminal:

```sh
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
```

```sh
cd frontend
npm run dev
```

Open **http://127.0.0.1:3001**.

Restart FastAPI after changing `backend/.env`. Next.js reloads `.env.local` during development; restart if needed.

## Daily generation

The FastAPI lifespan starts a scheduler that checks every minute. Once the selected local time is reached, it claims today's daily run in Supabase. A late start catches up that day; it does not manufacture backdated content. All generation is saved for human review.

**FastAPI and your computer must remain running and awake.** Closing the dashboard browser tab does not stop a running backend. Closing the server terminal, sleeping, or shutting down the computer stops generation. For unattended operation, run the backend on an always-on host or process manager; this local project is not deployed.

Pause daily generation in Settings. The global `SCHEDULER_ENABLED=false` environment switch also disables the scheduler. Starting the connected backend after 08:00 can trigger today's run and use OpenAI credits. Manual generation also uses your OpenAI credits.

The system claims runs atomically in Supabase to avoid duplicate daily jobs. Successful content is preserved during retries. Failed jobs appear in Activity and require a manual retry, rather than spending credits in an endless retry loop. Jobs interrupted for over 20 minutes can be reclaimed through a manual run. A single run is bounded to 10 minutes.

Use **Quick Search** in the top bar or Prospects to start a new search immediately with your saved targeting. Use **Adjust search** for a one-off selection. Each click receives a unique run key; retrying that same request does not duplicate the job. Previously saved Google Place IDs and web domains are deduplicated across runs. Results can be fewer than requested when no new matches are available within the request budget. Daily generation still runs at its configured time.

## CRM

Open **CRM** to add a contact or use **Add to CRM** on a discovered business. In Prospects, **Add all to CRM** imports all saved, non-archived leads from the selected source, across every page. Existing CRM contacts are skipped without changing notes, stages, or values; the result shows added and skipped counts. This action imports all saved leads for that source regardless of the current list filters. Open a card to update the stage, value, notes, and follow-up date. **Follow-ups due** filters today and overdue open opportunities. Values are grouped by currency rather than combined without conversion. No outreach or reminder email is sent automatically.

CRM records are separate JSON documents in the existing server-only `sm_settings` table, under `crm:<uuid>` keys; daily preferences remain under `default`. Each contact is saved separately. No additional migration is required. Linked leads use stable record IDs to prevent duplicate imports. Linked CRM records display the actual source business name, phone number, website, address, and website-availability tag automatically. Google details are resolved live by the original Place ID; user-owned contact fields and workflow data are saved separately. Existing generated labels are no longer shown as company names.

## Data and review boundaries

Before setup, the UI shows honest zero-state counts and a read-only reference library. It does not create fictional prospects or claim that new content was generated. All mutable workspace records use Supabase, not localStorage or a fallback database.

Prospect source URLs must be present in the search provider's actual source set. Suggested automation opportunities are hypotheses, not confirmed needs or buying intent. Public company information may still need human verification; no private email addresses or decision-maker names are guessed. Outreach is only drafted, never sent.

Generated visual suggestions are design briefs, not rendered images. Source references remain clickable alongside generated posts.

This is a local, single-owner dashboard. Both servers bind to loopback. The Next.js server proxies allowlisted API routes to FastAPI with a private token; credentials never reach client JavaScript. Add user authentication and production access controls before exposing it beyond localhost.

## Code layout

```text
frontend/
  app/                   Next.js page, layout, API proxy, global styles
  components/            Overview, ContentStudio, Prospects, editors, Settings
  lib/                   Client API helpers and saved reference-post snapshot
  public/                Branding assets
backend/
  app/
    config.py            Environment configuration
    models.py            Input and model-output validation
    main.py              Protected FastAPI endpoints and application lifecycle
    scheduler.py         Timezone-aware daily scheduling
    storage.py           Server-only Supabase REST adapter
    references.py        Saved writing context loader
    services/
      ai.py              OpenAI web research and structured generation
      generation.py      Durable generation workflow and partial failure handling
      workspace.py       Saved workspace settings
  tests/                 Mocked backend verification, no real API calls
references/              Copied LinkedIn guide, system prompt, and real post examples
supabase/migrations/     Database setup and atomic run claim
scripts/                 Local environment setup and combined startup
```

The original LinkedIn workspace and marketing dashboard are unchanged. Reference snapshots came from `Documents/linkedin_trained_model`; workflow patterns were reviewed in `Documents/marketing_engine`. To refresh training context, copy updated guides/posts into `references/` and regenerate `frontend/lib/reference-posts.json` from `references/posts.json`.

## Verification

```sh
cd frontend
npm run format:check
npm run build
cd ../backend
.venv/bin/python -m pytest -q
```

Backend tests use mocked storage and AI responses. Live OpenAI generation and Supabase persistence require your credentials and the migration.


## Google Maps lead discovery

Google Maps is now the default lead source. The original OpenAI web-research source remains selectable in Settings and the discovery dialog.

1. Add `GOOGLE_MAPS_API_KEY` to `backend/.env`.
2. Enable **Places API (New)** in that key's Google Cloud project and configure its billing/quota. Keep the key server-side and restrict it to the Places API.
3. Apply `supabase/migrations/002_google_maps.sql` after the original migration.
4. Restart FastAPI, select your niches/markets in Settings, and use **Prospects → Google Maps**.

The existing daily scheduler now runs the selected discovery source at 08:00 America/Los_Angeles by default. Maps prospecting does not require OpenAI; daily content still does. A content failure does not block Maps discovery. Existing OpenAI web leads are preserved.

The backend rotates cities within the US, UK, and Nigeria and rotates niche/country combinations across days. It retrieves IDs through paginated Places Text Search with deduplication and a bounded query budget. `GOOGLE_MAPS_MAX_REQUESTS` defaults to 12 search-page requests per job and `GOOGLE_MAPS_MAX_PAGES` to 2 pages per query. Transient failures retry up to twice, so physical HTTP calls can exceed the page-request budget. Google charges depend on the requested fields and your billing plan. Fewer than the requested number of new listings can be returned; partial results are preserved if later searches fail.

Supabase stores Google Place IDs, your selected niche/country/city context, pipeline stage, and your own notes. Google business names, addresses, phone numbers, websites, and provider attributions are fetched live through `/maps/leads` and are not stored in the database or exported. Listing details are loaded only when the Maps list is opened, paged, filtered, or refreshed; general dashboard polling does not fetch them. Five listings load per page, with at most ten permitted by the API. Duplicate Place IDs are ignored without resetting notes or stages. Different business locations can have distinct Place IDs.

The Maps panel displays Google Maps attribution and any returned third-party provider attribution. Links open the source listing or business website; no messages are sent automatically. A pipeline label such as “contacted” is manual tracking.

### New FastAPI endpoints

- `GET /maps/leads?offset=0&limit=5` — live details plus saved workflow metadata; optional `niche`, `country`, and `stage` filters.
- `PATCH /maps/leads/{id}` — save your notes and pipeline stage.
- `POST /generate/prospects` — queued Google Maps discovery when `prospect_source=google_maps`.
- `POST /generate/daily` — content and the selected discovery source, with independent error handling.

Every endpoint requires the existing private dashboard token. The Next.js proxy forwards only the allowlisted routes and never exposes the Google key. No Google scraping browser or paid third-party scraping account is required. Live Maps verification needs your key and database migration.

Sources: https://developers.google.com/maps/documentation/places/web-service/text-search and https://developers.google.com/maps/documentation/places/web-service/policies

## Google Maps contact filters

Discovery now requests phone and website fields and only saves new listing IDs when a phone number is listed. Phone-only businesses are accepted. In Prospects, filter by **All phone leads**, **Phone + website**, or **No website**. “No website” means no usable website is listed on Google Maps; it is not a claim that the business has no site anywhere. Existing saved listings are checked live as you browse. Failed lookups are excluded with a retry notice, not marked as lacking a website. Each page scans a bounded batch; Next continues through the remaining saved listings. Google contact details remain live rather than stored. These fields use Google's Text Search Enterprise billing tier.

## CRM source details

`POST /crm/businesses` resolves up to 20 selected CRM records at a time. The CRM loads these on open and refresh, separately from general dashboard polling. The table and lead editor show source details automatically; the main editable fields are sales stage, next follow-up, and notes. Optional contact-person/email and deal-value fields are collapsible. Missing email addresses are never guessed.

When the Place Details quota is exhausted, the Maps adapter uses the official Text Search endpoint, groups records by the saved niche/city/country, and accepts only results whose Place IDs exactly match the saved record. Up to two search pages per group are checked. A short circuit breaker avoids retrying the exhausted Details endpoint for 60 seconds; no Google business data is cached to disk or saved into CRM fields. Unmatched or unavailable listings show an explicit error rather than another business's information. User notes, stages, dates, values, and contact overrides are preserved.

Frontend CRM field/payload checks: `cd frontend && node --test tests/crm-display.test.mjs`.

### AI owner research agent

Open **AI Agent** in the dashboard. **Run Agent** researches the next unresearched CRM leads (default five, configurable). New leads from Quick Search and the daily discovery run are automatically added to CRM and researched, up to 15 per search. Disable automatic research from the AI Agent screen if needed.

Search uses the existing server-side OpenAI key and web search tool. No extra search key or database migration is needed. Public owner candidates, evidence URLs and outreach drafts are stored separately in Supabase `sm_settings`, under `agent_lead:` keys. Candidates require review; the agent never overwrites existing CRM contact fields or sends outreach. If no reliable ownership evidence is found, it records that outcome. Failed research can be retried per lead. The local backend must remain running for jobs to finish.

Authenticated FastAPI endpoints: `GET /agent`, `PUT /agent/settings`, `POST /agent/run` (request_id and optional contact_ids), and `POST /crm/{id}/research-owner`. Progress is persisted under `agent_run:` keys and appears in Activity as AI owner research. Repeating the same request_id does not create another job. Per-lead retries use new requests. Automatic research only targets newly saved discovery results; existing leads can be imported into CRM and processed with Run Agent.

### Custom outreach and market focus

AI Agent now has selectable services, countries, niches, market tiers and individual areas. Country options are Nigeria, United States, United Kingdom and China. Nigeria discovery is restricted to Abuja, Lagos and Port Harcourt. Each other country has three higher-output, three middle-output and three lower-output area presets, with a starting city per area. UK entries are regions; Chinese entries are provinces or municipalities. The presets are curated using regional GDP context, not business-size, budget or poverty classifications. The source links are available inside each country selector. Search rotates through selected areas within the existing request budget; a single search does not promise coverage of every selected area.

Quick Search and Settings control discovery areas. AI Agent focus controls which saved leads are processed and the services offered. Changing messaging focus makes existing drafts eligible for regeneration. **Generate custom messages for all matching leads** imports matching saved prospects into CRM and generates an individual message per business. You can also view, copy or regenerate a message in CRM lead details. Messages follow the supplied Nigerian solar outreach template where appropriate, adapting to the business niche and selected services. All drafts remain for review only.

Greetings are assembled separately from the message body and refreshed when viewed or copied: Lagos time for Nigeria, London for the UK, Shanghai for China and the known US state's timezone (falling back to the selected US timezone). Dash and hyphen filtering now covers generated posts, research prose, messages and summaries, while preserving URLs, telephone numbers, identifiers and timestamps.

Additional authenticated endpoints: `POST /agent/messages` starts background bulk messaging; `GET /crm/{id}/message` retrieves a lead's draft and `POST /crm/{id}/message` regenerates it using the current offer focus. No database migration or additional API key is required.

### Social Leads

The **Social Leads** tab has separate X/Twitter, Instagram, TikTok and LinkedIn views, niche/country filters, source evidence, custom opening messages, pagination and CSV export. Research targets can be counted across platforms or on each platform. The requested default is **100 businesses per niche on each platform**, displayed as twelve separate targets. A company can have several verified platform links while remaining one business record. Counts exclude unsupported or quarantined records.

Discovery uses the existing OpenAI web-search key and primary company websites. An account is accepted only when its exact profile is returned by search evidence, or its exact link is present on a matching company's official website. URL normalization rejects search pages, post-only Instagram URLs, personal LinkedIn profiles and non-platform hosts. Evidence must explicitly support the chosen business niche, and geography follows the existing market presets. A source-backed profile is not a guarantee of present account activity or current account ownership. No social logins, guessed handles or automated outreach are used.

All results and progress save server-side to Supabase `sm_settings` under `social_lead:`, `social_run:`, `social_query:` and `social_stop:` keys. No new SQL migration is required. Jobs are bounded and resumable; saved query history and companies prevent repeated work. The local backend must remain running for UI-started research. The standalone worker `backend/.venv/bin/python scripts/research_social.py --target 100 --mode per_platform` can run independently while the dashboard is restarted. Stop controls take effect after current batches finish. If a run is interrupted or returns insufficient evidence, start another research run to continue from saved results; missing evidence is never padded to meet a target.

Authenticated API endpoints: `GET /social`, `GET /social/leads`, `POST /social/search`, `POST /social/runs/{id}/stop`. The first provides all twelve niche/platform counts; the second supports platform, niche, country, text search, offset and limit filters.


Solar company and founder research
---------------------------------
Social Leads defaults to Solar businesses. The ongoing solar-only pass uses `scripts/research_social.py --solar-only --geography countrywide --target 100 --mode per_platform --batches 240` with the backend virtual environment. Nigeria remains limited to Abuja, Lagos and Port Harcourt. Existing non-solar records are retained.

`scripts/research_solar_founders.py` researches the solar companies already saved, then checks newly discovered companies while research is running. Supported founder or owner names, optional sourced personal profiles, affiliation evidence and timestamps are stored separately under `social_founders:<company_id>` in Supabase settings. These appear in the table, review panel and CSV. CEO/director roles alone do not establish ownership. Unconfirmed names are not saved as founders. The scripts use existing backend environment settings and do not send outreach. Run these with `backend/.venv/bin/python` from the project root.


Public Instagram verification can run without OpenAI credits:
`backend/.venv/bin/python scripts/research_instagram_public.py --seeds backend/app/data/solar-instagram-website-candidates.json --target 148`
The seed file contains unverified website candidates, never preverified leads. The script requires fetched company identity, solar services, country evidence and an exact first-party Instagram link before saving. It deduplicates against Supabase and stops at the requested total. `--new-only` skips enrichment of existing solar leads. Nigerian candidates remain restricted to Lagos, Abuja and Port Harcourt.

UK and US Instagram research can be restricted explicitly with `--countries 'United States' 'United Kingdom'`. The round-two candidate file is `backend/app/data/solar-instagram-website-candidates-round2.json`; these remain unverified candidates until fetched and checked. The second requested pass targets 248 total Instagram profiles, adding 100 to the verified baseline of 148.

## WhatsApp outreach (Outreach tab)

The **Outreach** tab takes solar-company leads for Abuja and Lagos from this dashboard's own Google Maps scraper (20+ reviews, mobile numbers, up to 150 a day if the scraper can find that many) and sends paced WhatsApp messages from up to six linked accounts, with delivery/read/reply tracking. It lives in `outreach/` as its own Node service (it holds the WhatsApp sessions) and reuses `~/Documents/whatsapp-gateway`. The dashboard reaches it through the server-side proxy `frontend/app/api/outreach/`, using `OUTREACH_URL` and `OUTREACH_API_TOKEN` from `frontend/.env.local`.

- Setup, accounts (`ACCOUNT_COUNT`, 1–6) and behaviour: [outreach/README.md](outreach/README.md).
- `node scripts/dev.mjs` starts the outreach service and gateways too when `outreach/.env` exists.
- Sending starts **paused**; press **Resume sending** in the tab once your accounts are connected.
- Unlike the rest of this dashboard, this feature **does send messages** (WhatsApp, via unofficial linked-device sessions). Cold messaging can get a number banned.
- The scraper gained one optional setting, `min_reviews` (workspace settings / Quick Search, default 0 = off), plus rating and review count in live business details. Nothing changes unless you set it.
