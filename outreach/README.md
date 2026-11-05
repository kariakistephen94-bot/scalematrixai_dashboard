# Outreach (ScaleMatrix dashboard)

WhatsApp outreach to **solar companies in Abuja and Lagos**: takes up to 150 leads a day from the dashboard's Google Maps scraper, messages them from up to **six** WhatsApp accounts at irregular intervals, tracks delivery and replies, and shows it all in the dashboard's **Outreach** tab.

It runs as its own Node service next to the dashboard (it holds the WhatsApp sessions). The dashboard talks to it through a server-side proxy (`frontend/app/api/outreach/`), so its token never reaches the browser.

It reuses, without modifying them:

- **The dashboard's Google Maps scraper** (the FastAPI backend, `backend/app/services/google_maps.py`): the only source of leads. This service never calls Google itself.
- **solar_outreach_scripts.md**: the pitch wording in `src/messages.js`.
- **whatsapp-gateway** (`~/Documents/whatsapp-gateway`): one instance per account, started by `npm run gateways`, each with its own paired session under `data/`.

## Start

From the dashboard root, `node scripts/dev.mjs` starts everything (FastAPI, Next.js, this service and the gateways). **The FastAPI backend must be running**, because that is where the scraper lives. Or run just the outreach parts, from `outreach/` (plus the backend and frontend yourself):

```bash
npm run gateways   # terminal 1: one WhatsApp gateway per active account (ports 3101-3106)
npm start          # terminal 2: discovery, sender, webhooks (port 3200)
```

Open the dashboard (http://127.0.0.1:3001) → **Outreach**. For each account press **Connect WhatsApp** and scan its QR (WhatsApp → Settings → Linked devices). When the accounts show *Connected*, press **Resume sending**. Sending starts **paused**; nothing goes out until you resume it.

First-time setup: `npm run init` creates `.env` with random secrets, copies the scraper token from `backend/.env`, and links the dashboard (`OUTREACH_URL` / `OUTREACH_API_TOKEN` in `frontend/.env.local`). Running `npm run init` again only fills in what's missing. Needs Node 22.5+ (built-in `node:sqlite`, no `npm install`).

## Using up to six accounts

Set `ACCOUNT_COUNT` (1–6) in `outreach/.env`, run `npm run init` once (it fills any missing secrets), restart the gateways and the service, then link each new account from the dashboard. Accounts are A–F on ports 3101–3106; give them friendly names with `ACCOUNT_A_LABEL=…`.

Accounts work independently: each has its own connection state, warm-up, daily cap, send window gap and pause button. A disconnected account just waits; the others keep sending. The daily 150 leads are shared out between whichever accounts are ready, and a lead is only ever messaged once (follow-ups come from the same account).

## What it does

**Discovery** (daily from 05:00 Lagos, or "Find leads now")
- Asks your scraper for a **Quick Search**: niche *Solar businesses*, country Nigeria, one city at a time (Abuja, Lagos, alternating so each reaches 75). Settings are passed for that run only; your saved dashboard settings are not changed.
- The scraper keeps only listings with a phone number and **20+ Google reviews** (the new `min_reviews` option, off by default everywhere else). Each run saves up to **15** leads, so a 150-lead day is about 10 runs (`SCRAPER_MAX_RUNS_PER_DAY`, default 14).
- Every few minutes the service imports whatever new Solar/Nigeria leads the scraper has saved, including ones from searches you run yourself and the dashboard's own daily run. Mobile numbers become outreach-ready leads; landlines are kept as *call-only*. Imported leads are moved to *shortlisted* in the scraper (unusable ones to *archived*), and to *contacted* once the first message goes out.
- Stops at **150 ready leads/day** if that many exist. Surplus is *banked* for tomorrow. **There may not be 150 new solar companies with 20+ reviews in Abuja and Lagos each day**: the scraper searches city-wide (Google returns at most about 60 results per search) and never repeats a business, so expect the daily count to fall short and shrink over time. When the scraper has nothing new, discovery stops and says so.
- **AI Agent caution:** after every search, the dashboard's AI Agent can research each new lead with OpenAI (its "automatic research" setting, on by default). Discovery pauses while that is on, so it doesn't spend OpenAI credit on every outreach-triggered search. Turn it off on the AI Agent page (or set `SCRAPER_ALLOW_AI_RESEARCH=true` to run anyway).

**Sending** (per account)
- Mon–Sat 09:00–17:30 Lagos, only while connected, only up to today's cap.
- Gap = remaining window / remaining cap, randomised 0.5x–1.5x (60s–15min), plus a 10–25 min breather every 8–14 sends.
- Warm-up: 25 on day one, +10 a day, up to 75 per account.
- Three first-message variants pitching AI lead-reply and survey-booking assistants to solar companies (from `solar_outreach_scripts.md`), introduced as `SENDER_NAME` from `COMPANY_NAME`, with a time-of-day greeting and a "Reply STOP" line on every message.
- Follow-ups after day 3 and 7 from the same account, only if there's no reply.
- Never resends to a lead, never retries an *uncertain* send, never contacts opted-out leads.

**Tracking**
- Receipts and replies arrive through the gateways' webhooks. Tiles: Sent, Failed, Sent + failed, Uncertain, Delivered, Read, Replied leads, Reply conversion.
- STOP / "please stop" / "don't message me" opts a lead out automatically.
- Only replies from businesses you've messaged are stored; other chats on those numbers are discarded unseen.

## No AI in the messages

Messages come from fixed templates in `src/messages.js`; only the business name, city, greeting and your sender line are filled in. Nothing is sent to OpenAI or any model, and the service's only outbound calls are to your dashboard backend (the scraper) and your local WhatsApp gateways.

## Settings

All in `outreach/.env` (see `.env.example`): `DAILY_LEAD_TARGET`, `MIN_REVIEW_COUNT`, `MIN_RATING`, `SCRAPER_MAX_RUNS_PER_DAY`, `ACCOUNT_COUNT`, `DAILY_CAP_PER_ACCOUNT`, `SEND_WINDOW`, `SEND_DAYS`, `FOLLOWUP_DAYS`, `SENDER_NAME`, `COMPANY_NAME`. Which cities and niche are searched is set in `src/scraper.js` (Solar businesses; Abuja and Lagos). Message copy: `src/messages.js`.

## Risks

- The gateway is an **unofficial linked-device client**. Cold messaging can get a number banned however slowly it sends. Use numbers you can afford to lose; more accounts spreads the volume but not the risk per number.
- `uncertain` means the gateway didn't answer; the message may or may not have gone out, so it is left alone.
- Numbers are not checked for being on WhatsApp first. Messages to non-WhatsApp numbers show as Sent but never Delivered.
- Keep `outreach/data/` private: WhatsApp sessions and lead phone numbers live there.

## Tests

```bash
npm test
```

Unit tests use fakes of the scraper API and the gateways, so they cost nothing and send nothing. The backend's own Maps tests: `cd backend && .venv/bin/python -m pytest -q`.
