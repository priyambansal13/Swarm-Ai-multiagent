# SwarmAI — Multi-Agent Personal Assistant (LangGraph + n8n)

A personal assistant made of **10 specialist AI agents** coordinated by a **master agent**, reachable from a
**web app (PWA with push-to-talk)**, **Telegram** and **WhatsApp** (text and voice notes). It manages Gmail and Google
Calendar, researches the web, plans travel, tracks expenses/tasks/notes/reminders, watches prices, keeps everything in
your own **Google Sheet**, and runs **7 proactive automations** (morning brief, inbox triage, meeting prep…).
Several users are supported; each connects their own Google account.

**Platform (Phase 1):** **organisations with roles and invitations**, a per-organisation **agent registry** (switch
agents on/off, tune prompts, models, tools and approval rules, add custom agents, apply industry packs), a
**knowledge base** (PDF/Word/web pages → cited answers), a **customer desk** on WhatsApp/Telegram with **human handoff**
to a staff **Inbox**, and an **admin console**. See **[docs/PLATFORM.md](docs/PLATFORM.md)**.

Architecture: **hybrid** — a LangGraph **"brain"** (NestJS) runs every agent; **n8n** runs the channels, the
scheduler and outbound delivery, and exposes channel tools to the brain over **MCP**. See [PLAN.md](PLAN.md) for the
decisions (why n8n, why hybrid, alternatives).

**Production:** runs 24×7 for ₹0/month on one **Oracle Cloud Always Free** ARM server — Docker containers behind Caddy
(automatic HTTPS) on a free DuckDNS address, nightly backups with Telegram alerts. See
**[§17 Production deployment](#17-production-deployment-oracle-cloud-free)** and [docs/DEPLOY-ORACLE.md](docs/DEPLOY-ORACLE.md).

| Part | Tech | Port |
|---|---|---|
| `web/` | Next.js 16.4 PWA, React 19, Tailwind v4, `@ag-ui/client` | **3200** |
| `brain/` | NestJS 12, LangGraph.js 1.5, LangChain 1.x, OpenAI, googleapis, `@langchain/mcp-adapters`, TypeORM | **4200** |
| `n8n/` | n8n 2.43.7 workflows (Telegram, WhatsApp, Scheduler, MCP channel tools, errors) | **5678** |
| `docker-compose.yml` | PostgreSQL 17 + **pgvector** (databases `swarm`, `n8n`) and n8n | **5434**, 5678 |

---

## Contents
1. [Quick start](#1-quick-start)
2. [Local URLs](#2-local-urls)
3. [Architecture](#3-architecture)
4. [Agents & tools](#4-agents--tools)
5. [Automations (proactive flows)](#5-automations)
6. [Channels: web, Telegram, WhatsApp, voice](#6-channels)
7. [External APIs used (all URLs)](#7-external-apis-used-all-urls)
8. [Brain API & Swagger](#8-brain-api--swagger)
9. [n8n workflows](#9-n8n-workflows)
10. [Web app](#10-web-app)
11. [Configuration (env files)](#11-configuration)
12. [Data model](#12-data-model)
13. [Safety, privacy, multi-user](#13-safety-privacy-multi-user)
14. [Testing](#14-testing)
15. [Project structure](#15-project-structure)
16. [Limitations](#16-limitations)
17. [Production deployment (Oracle Cloud, free)](#17-production-deployment-oracle-cloud-free)

---

## 1. Quick start

Prerequisites: **Node.js 20+** and **Docker** (Docker Desktop on Windows/macOS). The setup script checks both, offers
to install them (Homebrew on macOS, winget on Windows) and installs **pnpm** itself.

| OS | Run |
|---|---|
| **macOS / Linux** | `./setup.sh` |
| **Windows** | double-click **`setup.cmd`**, or in PowerShell `.\setup.ps1` |

The guided setup:
1. **Prerequisites:** checks Node.js 20+, pnpm (installs it if missing), and that Docker and Compose are running.
2. **Configuration:** asks for your keys and validates them live (OpenAI, Telegram, SerpAPI, WhatsApp, Google client id). It auto-fills the bot username and WhatsApp number, generates matching secrets, and writes `.env`, `brain/.env` and `web/.env.local` (existing values are kept).
3. **Docker:** starts PostgreSQL (pgvector) and n8n, and waits until they're healthy.
4. **Build:** installs and builds the brain and the web app.
5. **n8n:** creates the credentials, imports the 5 workflows, and publishes them. Channel workflows are published only once their tokens and a public URL exist.
6. **Start:** starts the brain (:4200) and the web app (:3200) in the background, with logs in `.swarm/logs/`.
7. **Verify:** prints the status of every service and integration.

Only the **OpenAI key** is required; press Enter to skip any integration and add it later with `configure`.

| Command (`./setup.sh <cmd>` · `setup.cmd <cmd>` · `node scripts/swarm.mjs <cmd>`) | What it does |
|---|---|
| `setup` *(default)* | everything above |
| `configure` | re-run the key/token wizard only |
| `n8n` | rebuild, import and publish the n8n workflows + credentials |
| `tunnel` | start a Cloudflare quick tunnel and use it as n8n's public URL (Telegram/WhatsApp webhooks). **Don't use it while a server deployment is live** — it moves the webhooks to your laptop |
| `start` · `stop` · `restart` | brain + web (and the tunnel) in the background |
| `status` | services, integrations and n8n workflows |
| `doctor` | prerequisites + configuration checks + status |
| `server-env <domain>` | write a production server's env files into `.swarm/server/` ([DEPLOY-ORACLE.md](docs/DEPLOY-ORACLE.md)) |
| `deploy` | on the server: build and start all containers behind Caddy (HTTPS), import n8n workflows, register webhooks |

Flags: `--yes` (non-interactive: keep existing values, read new ones from environment variables such as
`OPENAI_API_KEY`), `--tunnel`, `--no-build`, `--no-start`.

Then open **http://localhost:3200**, sign up, and use **Settings** to connect Google and link Telegram/WhatsApp.
Where to get each key: **[docs/SETUP-INTEGRATIONS.md](docs/SETUP-INTEGRATIONS.md)**. What you can ask it: **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**. Flow diagrams and every library explained: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. Organisations, agents, knowledge base, customer desk and admin console: **[docs/PLATFORM.md](docs/PLATFORM.md)**. Roadmap of new agents, tools, flows and client packs: **[docs/EXPANSION-PLAN.md](docs/EXPANSION-PLAN.md)**.

<details><summary>Manual setup (without the script)</summary>

```bash
cp .env.example .env && docker compose up -d
cd brain && cp .env.example .env && pnpm install && pnpm build && pnpm start:prod   # set OPENAI_API_KEY, APP_SECRET
cd ../web && cp .env.example .env.local && pnpm install && pnpm build && pnpm start
cd .. && node scripts/swarm.mjs n8n
```
</details>

---

## 2. Local URLs

| What | URL |
|---|---|
| Web app (chat) | http://localhost:3200 |
| Dashboard / Memory / Settings | http://localhost:3200/dashboard · /memory · /settings |
| **Swagger UI (brain)** | **http://localhost:4200/api/docs** |
| OpenAPI JSON | http://localhost:4200/api/docs-json |
| Health & integration status | http://localhost:4200/api/health |
| AG-UI endpoint (SSE) | `POST` http://localhost:4200/api/agui |
| n8n editor | http://localhost:5678 |
| n8n MCP server (channel tools) | http://localhost:5678/mcp/swarm-channels (Bearer token) |
| PostgreSQL | `postgres://swarm:swarm@localhost:5434/swarm` (n8n uses database `n8n`) |
| Google OAuth redirect URI | http://localhost:4200/api/google/callback |

---

## 3. Architecture

Detailed flows (web chat, phone messages, agent graph, scheduler, Google connect, setup) and a library-by-library
explanation: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

![SwarmAI overview](docs/diagrams/01-overview.png)

<details><summary>Technical version (Mermaid)</summary>

```mermaid
flowchart LR
  subgraph USERS["Users"]
    WEB["Web PWA<br/>chat · push-to-talk · approvals"]
    TG["Telegram<br/>text · voice · photos"]
    WA["WhatsApp<br/>text · voice · photos"]
  end
  subgraph N8N["n8n (hands)"]
    TGW["Telegram channel workflow"]
    WAW["WhatsApp channel workflow"]
    SCH["Scheduler — every minute"]
    MCP["MCP Server Trigger<br/>send_telegram_message · send_whatsapp_message"]
  end
  subgraph BRAIN["Brain — NestJS + LangGraph (agents)"]
    API["REST · AG-UI SSE · Swagger"]
    G["Master agent → 10 specialists (parallel)<br/>confirm node: interrupt() before side effects"]
    AUTO["Automations: reminders, brief, triage,<br/>meeting prep, follow-ups, price watch, weekly review"]
    REC["Records: tasks, expenses, notes (pgvector)…"]
  end
  DB[("PostgreSQL + pgvector<br/>users · threads · checkpoints · records · outbox")]
  EXT["Gmail · Calendar · Sheets (per user)<br/>OpenAI · SerpAPI · Open-Meteo · IMD · Wikipedia · Yatra AI"]

  WEB <-->|AG-UI / REST| API
  TG --> TGW -->|POST /channels/inbound| API
  WA --> WAW -->|POST /channels/inbound| API
  SCH -->|POST /automations/tick| AUTO
  AUTO -->|queued messages| SCH --> TG & WA
  G -->|MCP| MCP --> TG & WA
  API --> G --> REC
  G --> EXT
  BRAIN <--> DB
```

</details>

**One turn:** a message arrives (web via AG-UI, or Telegram/WhatsApp via n8n) → the **master agent** reads your
profile facts and history, then calls specialist agents as tools — several at once when the request has several parts
("log ₹300 groceries, remind me at 9, weather in Kochi" runs Finance, Reminders and Travel in parallel). Specialists
use their tools; anything that sends, changes or deletes is only **proposed**. If there are proposals, the graph's
`confirm` node calls LangGraph `interrupt()` → the web shows an approval card (AG-UI `interrupt` outcome) or the
chat asks "Reply YES / NO" → on approval the actions run and are logged. State is checkpointed per thread in Postgres.

---

## 4. Agents & tools

| Agent | Tools | Needs confirmation |
|---|---|---|
| **Master** | `ask_<agent>_agent` × 10, `send_to_my_phone` (n8n MCP) | — |
| **Email** (Gmail) | `gmail_search`, `gmail_read`, `gmail_create_draft`, `gmail_send`, `gmail_reply`, `gmail_archive`, `find_contact` | send, reply, archive |
| **Calendar** (Google) | `calendar_list`, `calendar_free_slots`, `calendar_create`, `calendar_update`, `calendar_delete`, `find_contact` | create, update, delete |
| **Research** | `web_search`, `news_search`, `read_url` | — |
| **Travel** | `search_flights`, `search_hotels`, `get_weather` (+ IMD alerts), `plan_india_trip` (Yatra AI), `log_trip` | — (never books) |
| **Records** | `add_task`, `list_tasks`, `complete_task`, `delete_task`, `add_contact`, `find_contact`, `read_my_sheet` | delete |
| **Finance** | `log_expense`, `expense_summary`, `read_receipt` (vision), `log_receipt_expense` | logging from a receipt photo |
| **Notes & Memory** | `save_note`, `search_notes` (pgvector), `remember_fact`, `list_facts`, `forget_fact` | — |
| **Reminders** | `create_reminder`, `list_reminders`, `cancel_reminder` | — |
| **Shopping** | `search_products`, `create_price_watch`, `list_price_watches`, `stop_price_watch` | — |
| **Documents** | `analyze_attachments` (images via vision, text files) | — |

Models: master `OPENAI_MODEL` (default `gpt-4.1`), specialists and automations `OPENAI_MODEL_FAST`
(`gpt-4.1-mini`), speech-to-text `gpt-4o-mini-transcribe`, text-to-speech `gpt-4o-mini-tts`, embeddings
`text-embedding-3-small` (1536-d, pgvector).

---

## 5. Automations

n8n's **Scheduler** workflow calls `POST /api/automations/tick` every minute. The brain decides per user what is due,
runs heavy jobs in the background, and returns queued messages; n8n delivers them on Telegram/WhatsApp and reports back
(`/api/automations/ack`). Messages for users without a linked phone channel appear in the web app's notification feed.

| Flow | When | Output | Needs |
|---|---|---|---|
| Reminders | every minute | "⏰ Reminder: …" | — |
| Morning brief | user's time (default 08:00, user timezone) | agenda, important unread mail, tasks/reminders today, weather + IMD alerts (home city), news topics | Google for agenda/mail |
| Inbox triage | every 30 min | urgent-mail alerts; EmailDigest rows; action items → Tasks | Google |
| Meeting prep | events starting in 20–45 min | attendees, recent emails with them, talking points | Google |
| Follow-up nudges | daily 18:00 | sent emails with no reply after 3 days | Google |
| Price watch | daily 09:00 | price-drop alerts below your target | SerpAPI |
| Weekly review | Sunday 19:00 | spend by category, tasks done/open, next week's load | — (Google adds calendar) |

Run any of them on demand: `POST /api/automations/run/{brief|triage|meeting_prep|followups|price_watch|weekly_review}`
(the dashboard has "Send my brief now").

---

## 6. Channels

| Channel | How it works |
|---|---|
| **Web PWA** | AG-UI streaming (agent steps, tool calls, shared state, approval interrupts), push-to-talk (`/api/voice/transcribe`), read-aloud (`/api/voice/speak`), photo/text attachments, installable on phones |
| **Telegram** | One bot for all users. n8n Telegram Trigger downloads voice/photos → brain `/api/channels/inbound` → reply text (+ MP3 voice reply when you sent a voice note) |
| **WhatsApp** | One business number. n8n WhatsApp Trigger → media download (Graph API) → brain → reply text (+ audio) |
| **Linking** | Settings → Link Telegram/WhatsApp gives a one-time code (15 min): send `/start CODE` to the bot or `LINK CODE` on WhatsApp. Unlinked chats get instructions only |
| **Confirmations on phones** | Reply `yes` / `haan` / `ok` or `no` / `cancel` / `nahi` |
| **Voice** | Voice notes are transcribed (OpenAI); replies to voice notes come back as voice (toggle in Settings) |

---

## 7. External APIs used (all URLs)

### 7.1 AI
| Service | Endpoint | Key | Used for |
|---|---|---|---|
| OpenAI Chat Completions | `https://api.openai.com/v1/chat/completions` | `OPENAI_API_KEY` | master + specialists (tool calling), automations, vision (receipts/images) |
| OpenAI Audio — transcriptions | `https://api.openai.com/v1/audio/transcriptions` | same | voice notes, push-to-talk |
| OpenAI Audio — speech | `https://api.openai.com/v1/audio/speech` | same | voice replies, read-aloud |
| OpenAI Embeddings | `https://api.openai.com/v1/embeddings` | same | semantic note search (pgvector) |

### 7.2 Google (per user, OAuth 2.0)
| Service | Endpoint(s) | Scope |
|---|---|---|
| OAuth consent / token | `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, revoke `https://oauth2.googleapis.com/revoke` | `openid email` |
| User info | `https://www.googleapis.com/oauth2/v2/userinfo` | `email` |
| Gmail API | `https://gmail.googleapis.com/gmail/v1/users/me/{messages, messages/send, drafts, threads, messages/batchModify, profile}` | `gmail.modify` |
| Calendar API | `https://www.googleapis.com/calendar/v3/calendars/primary/events`, `…/freeBusy` | `calendar` |
| Sheets API | `https://sheets.googleapis.com/v4/spreadsheets` (create, `values:append`, `values:batchUpdate`, `values/get`) | `drive.file` (only files the app creates) |

### 7.3 Search, travel, weather, knowledge
| Service | Endpoint | Key | Fallback |
|---|---|---|---|
| SerpAPI — Google | `https://serpapi.com/search.json?engine=google` | `SERPAPI_KEY` | Wikipedia search + Google News RSS |
| SerpAPI — Google News | `…?engine=google_news` | same | Google News India RSS |
| SerpAPI — Google Shopping | `…?engine=google_shopping` | same | link to Google Shopping |
| SerpAPI — Google Flights | `…?engine=google_flights` (IATA codes, INR) | same | link to Google Flights |
| SerpAPI — Google Hotels | `…?engine=google_hotels` (INR) | same | link to Google Hotels |
| Wikipedia search | `https://en.wikipedia.org/w/api.php?action=query&list=search` | none | — |
| Google News RSS (India) | `https://news.google.com/rss/search?q=…&hl=en-IN&gl=IN&ceid=IN:en` | none | — |
| Open-Meteo geocoding | `https://geocoding-api.open-meteo.com/v1/search` | none | — (India-first matching) |
| Open-Meteo forecast | `https://api.open-meteo.com/v1/forecast` | none | — |
| IMD district warnings (official) | `https://reactjs.imd.gov.in/geoserver/wfs` (`imd:district_warnings_india`) | none | — |
| OSM Nominatim reverse geocoding | `https://nominatim.openstreetmap.org/reverse` (district for IMD) | none | — |
| Yatra AI (our travel planner) | `POST {YATRA_API_URL}/api/trips/plan` | none | — (optional) |
| Any public web page | `read_url` tool (private-network addresses blocked) | none | — |

### 7.4 Messaging (configured in n8n)
| Service | Endpoint | Credential |
|---|---|---|
| Telegram Bot API | `https://api.telegram.org/bot<token>/…` (webhook, getFile, sendMessage, sendAudio) | `TELEGRAM_BOT_TOKEN` |
| WhatsApp Cloud API | `https://graph.facebook.com/<version>/<phone-number-id>/messages`, `/media` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| Meta webhooks (WhatsApp Trigger) | subscription on your Meta app | `META_APP_ID`, `META_APP_SECRET` |
| n8n MCP server | `http://localhost:5678/mcp/swarm-channels` | `N8N_MCP_TOKEN` |

### 7.5 Observability
LangSmith (`https://api.smith.langchain.com`) when `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY`.

---

## 8. Brain API & Swagger

Swagger UI: **http://localhost:4200/api/docs** (all endpoints with request/response examples). Web/API clients use
`Authorization: Bearer <token>` from `/api/auth/login`; n8n uses the `X-Swarm-Key` header.

| Area | Method & path | Auth | Purpose |
|---|---|---|---|
| Auth | `POST /api/auth/signup`, `POST /api/auth/login` | — | create account / get token |
| Me | `GET /api/me`, `PATCH /api/me` | Bearer | profile, settings, integration status |
| Google | `GET /api/google/connect?token=`, `GET /api/google/callback`, `POST /api/google/disconnect` | Bearer / — | per-user OAuth; creates the user's SwarmAI sheet |
| Chat | `POST /api/chat` | Bearer | synchronous turn |
| AG-UI | `POST /api/agui` | Bearer | streaming turn (SSE); interrupts & resume; cancel on disconnect |
| Threads | `GET /api/threads`, `GET/DELETE /api/threads/{id}`, `POST /api/threads/{id}/cancel`, `POST /api/threads/{id}/confirm` | Bearer | conversations, stop, approve/reject |
| Dashboard | `GET /api/dashboard`, `GET /api/notifications` | Bearer | agenda, tasks, reminders, spend, watches, feed |
| Records | `GET /api/records/{tasks|reminders|expenses|contacts|notes|facts|watches|travel|activity|digest}`, `POST /api/records/tasks`, `PATCH /api/records/tasks/{id}`, `POST /api/records/expenses`, `DELETE /api/records/{kind}/{id}` | Bearer | personal data |
| Voice | `POST /api/voice/transcribe`, `POST /api/voice/speak` | Bearer | push-to-talk, read-aloud |
| Channels | `POST /api/channels/inbound` | X-Swarm-Key | Telegram/WhatsApp messages from n8n |
| | `POST /api/channels/link-code`, `GET /api/channels/links`, `DELETE /api/channels/{channel}` | Bearer | link/unlink phone channels |
| Automations | `POST /api/automations/tick`, `POST /api/automations/ack` | X-Swarm-Key | n8n scheduler |
| | `POST /api/automations/run/{job}` | Bearer | run a flow now |
| Health | `GET /api/health` | — | DB, LLM, agents, integration status |

**AG-UI events** (web streaming): `RUN_STARTED` → `STATE_SNAPSHOT` → per agent `STEP_STARTED/FINISHED` · per tool
`TOOL_CALL_START/ARGS/END/RESULT` (`metadata.agent`) · `STATE_DELTA` (agent board) → `TEXT_MESSAGE_*` (streamed
reply) → `RUN_FINISHED` with `outcome` `success` | `interrupt` (`metadata.actions` to approve) | `cancelled`, or
`RUN_ERROR`. Resume with `resume: [{interruptId, status: 'resolved', payload: {approved, actionIds?}}]`.

---

## 9. n8n workflows

Generated by `n8n/build-workflows.mjs` into `n8n/workflows/`, imported and published by `n8n/setup.sh`.

| Workflow | Trigger | Nodes | Status after setup |
|---|---|---|---|
| **SwarmAI – Telegram channel** | Telegram Trigger (downloads attachments) | IF → Extract-from-file (base64) → Code (normalise) → HTTP brain inbound → Telegram send → IF voice → Convert-to-file → Telegram sendAudio | imported; published when `TELEGRAM_BOT_TOKEN` is set |
| **SwarmAI – WhatsApp channel** | WhatsApp Trigger (messages) | Code (parse) → IF media → WhatsApp media URL → HTTP download → base64 → brain → WhatsApp send text/audio | imported; published when WhatsApp + Meta credentials are set |
| **SwarmAI – Scheduler** | Schedule (every minute) | HTTP tick → Split out → IF channel → Telegram/WhatsApp send (error output) → HTTP ack | **published** |
| **SwarmAI – Channel tools (MCP server)** | MCP Server Trigger (Bearer) | `send_telegram_message`, `send_whatsapp_message` tool nodes (`$fromAI` params) | **published** |
| **SwarmAI – Error handler** | Error Trigger | IF admin chat set → Telegram alert | **published**; set as error workflow of all others |

Credentials created by `setup.sh` from the root `.env`: *SwarmAI Telegram bot* (`telegramApi`), *SwarmAI WhatsApp Cloud
API* (`whatsAppApi`), *SwarmAI WhatsApp webhook (Meta app)* (`whatsAppTriggerApi`), *SwarmAI MCP bearer token*
(`httpBearerAuth`). Workflows read `SWARM_BRAIN_URL`, `SWARM_N8N_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and
`SWARM_ADMIN_TELEGRAM_CHAT_ID` from the container environment.

---

## 10. Web app

| Route | What it does |
|---|---|
| `/login`, `/signup` | Email + password; timezone detected from the browser |
| `/` | Chat: conversation list (web/Telegram/WhatsApp badges, "needs approval"), streaming replies with markdown, live **Agents at work** panel, **approval card** (tick actions → approve/reject; restored after reload), Stop, attachments (≤4 images/text files), **push-to-talk** mic, read-aloud, quick prompts |
| `/dashboard` | Today's agenda (or connect-Google prompt), tasks (add/complete/delete), reminders, this month's spend by category + quick log, price watches, notification feed, "Send my brief now", link to your Google Sheet |
| `/memory` | About me (remembered facts, forget), notes, contacts, travel log, email digest, activity log |
| `/settings` | Profile & timezone; brief time/enabled, notify channel, voice replies, news topics, home city, triage & meeting prep; Google connect/disconnect; Telegram/WhatsApp link codes + deep links |
| PWA | `manifest.ts`, icons, service worker (app shell only, never caches `/api`), mobile bottom tab bar, light/dark |

Key files: `src/components/chat/ChatApp.tsx` (AG-UI `HttpAgent`, interrupts, resume, stop),
`chat/ApprovalCard.tsx`, `chat/AgentActivity.tsx`, `chat/Composer.tsx` (MediaRecorder push-to-talk, attachments),
`lib/api.ts` (REST + auth), `AuthProvider.tsx` (token in localStorage).

---

## 11. Configuration

| File | Copy to | Purpose |
|---|---|---|
| `.env.example` (root) | `.env` | Postgres + n8n settings, channel tokens for `n8n/setup.sh`, shared secrets |
| `brain/.env.example` | `brain/.env` | OpenAI, Google OAuth, SerpAPI, n8n MCP, Yatra, LangSmith, `APP_SECRET` |
| `web/.env.example` | `web/.env.local` | `NEXT_PUBLIC_API_URL` |

**Root `.env`:** `POSTGRES_USER/PASSWORD/PORT`, `N8N_PORT`, `N8N_VERSION`, `N8N_ENCRYPTION_KEY`, `TIMEZONE`,
`N8N_PUBLIC_URL` (public HTTPS for webhooks), `SWARM_BRAIN_URL`, `SWARM_N8N_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`TELEGRAM_BOT_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_ID`, `META_APP_SECRET`,
`N8N_MCP_TOKEN`, `SWARM_ADMIN_TELEGRAM_CHAT_ID`.

**`brain/.env`:**
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | **yes** | — | all AI |
| `APP_SECRET` | **yes** | — | signs login tokens, encrypts Google refresh tokens |
| `DATABASE_URL` | **yes** | `postgres://swarm:swarm@localhost:5434/swarm` | Postgres (pgvector) |
| `OPENAI_MODEL`, `OPENAI_MODEL_FAST` | no | `gpt-4.1`, `gpt-4.1-mini` | master / specialists |
| `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | no | `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`, `alloy` | voice |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | for Gmail/Calendar/Sheets | — | per-user OAuth |
| `SERPAPI_KEY` | for flights/hotels/shopping | — | search |
| `SWARM_N8N_TOKEN` | **yes** | `dev-n8n-shared-secret` | must match root `.env` |
| `N8N_MCP_URL`, `N8N_MCP_TOKEN` | for "send to my phone" | — | n8n MCP server |
| `TELEGRAM_BOT_USERNAME`, `WHATSAPP_DISPLAY_NUMBER` | no | — | deep links in Settings |
| `YATRA_API_URL`, `YATRA_WEB_URL` | no | `http://localhost:4100`, `:3100` | India trip plans |
| `PORT`, `PUBLIC_API_URL`, `WEB_URL`, `CORS_ORIGIN` | no | 4200, `http://localhost:4200`, `http://localhost:3200`, same | server |
| `SIGNUP_MODE` | no | `open` | `invite` = new accounts need an invite link (the first account is always allowed); `server-env` sets `invite` for servers |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | no | off | tracing |

---

## 12. Data model

PostgreSQL database `swarm` (TypeORM, auto-sync in dev). Personal tables are per user (`userId`); shared tables are per
organisation (`orgId`):

| Table | Holds |
|---|---|
| `organizations`, `org_invites` | tenants: name, slug, settings (assistant name, colour, models, encrypted own OpenAI key, customer desk); one-time invitations with a role |
| `users` | email, name, password hash (scrypt), timezone, settings (brief time, notify channel, voice replies, news topics, home city…), `orgId`, `role` (owner/admin/agent/member) |
| `agent_configs` | per-organisation agent registry (on/off, prompt, extra instructions, model, tools, approval tools, audience; custom agents) |
| `kb_sources` + `kb_chunks` (`vector(1536)`, HNSW) | knowledge base: files/pages/text and their page-aware passages |
| `conversations`, `conversation_messages` | customer desk chats (bot / waiting / human / closed), assignee, hand-over reason and summary, transcript |
| `channel_links`, `link_codes` | Telegram chat / WhatsApp number ↔ user; one-time link codes |
| `google_accounts` | Google email, **AES-256-GCM encrypted** refresh token, workbook id/url |
| `threads` | conversations (web/telegram/whatsapp), status, pending confirmation |
| `tasks`, `reminders`, `expenses`, `contacts`, `travel_log`, `email_digest`, `price_watches`, `activity` | records |
| `notes` + `note_embeddings` (`vector(1536)`) | notes with semantic search |
| `profile_facts` | long-term memory injected into every conversation |
| `outbox` | proactive messages for n8n to deliver (pending → sending → sent/failed) |
| `automation_state` | per-user job bookkeeping (last run, processed email/event ids) |
| `checkpoints*` | LangGraph state per thread (conversation, pending interrupts) |

**Google Sheet (per user):** tabs **Tasks, Expenses, Contacts, TravelLog, EmailDigest, ActivityLog**, created on
connect; every record write is appended (one-way mirror — Postgres is the source of truth; the Records agent can
also read rows you add manually via `read_my_sheet`).

---

## 13. Safety, privacy, multi-user
- **No side effect without approval:** email send/reply/archive, calendar create/update/delete, task deletion and
  receipt logging are proposals until the user approves (web card or YES/NO). Enforced in code (tools cannot call the
  APIs) and covered by a unit test.
- **Per-user isolation:** every query is scoped by user; threads are checked for ownership; agents run with tools
  bound to the requesting user.
- **Secrets:** Google refresh tokens encrypted at rest; channel tokens live only in n8n (encrypted with
  `N8N_ENCRYPTION_KEY`); n8n ↔ brain calls use a shared secret; the MCP server uses a Bearer token; the LLM never picks
  message recipients (the brain fills in the user's own linked chat).
- **Unknown chats** can't use a personal assistant until linked with a one-time code. If an organisation turned on its
  customer desk, they talk to that organisation's customer bot instead, which only gets **customer-safe tools**
  (knowledge base, web search, weather…) — never a member's mail, calendar or records, whatever the configuration.
- **Roles:** the admin console needs owner/admin, the customer Inbox owner/admin/agent (`RoleGuard`); an organisation's
  own OpenAI key is stored encrypted and never returned by the API.
- **Deleting a conversation** removes its messages and agent state (LangGraph checkpoints) too. Privacy policy text for
  Meta/Google app settings: [docs/PRIVACY-POLICY.md](docs/PRIVACY-POLICY.md).
- **Facts come from sources:** the master agent sends factual questions (dates, prices, news…) to the Research agent
  instead of answering from model memory; the Research agent cross-checks exact dates and numbers.
- **Licensing:** n8n never holds end-users' credentials (the brain does), which keeps n8n within its Sustainable Use
  License for this setup.

---

## 14. Testing
```bash
cd brain && pnpm test        # AG-UI contract test (official verifyEvents) + confirmation-guarantee test, sign-up policy (32 tests)
```
Verified end to end with the real model during development: multi-agent parallel requests, expense/task/reminder
logging, delete → approval → executed / rejected, India-first weather with IMD alerts, Telegram link + text + voice
note (transcribed, MP3 reply) via the inbound API, n8n Scheduler → brain tick → delivery attempt → ack, brain →
n8n MCP tool discovery, web app (signup, streaming chat, approvals, dashboard, settings, mobile).

---

## 15. Project structure
```
swarm-ai/
├── PLAN.md                     # decisions, n8n vs alternatives, LangGraph options
├── README.md                   # this file
├── docs/SETUP-INTEGRATIONS.md  # Google, Telegram, WhatsApp, tunnel, SerpAPI, LangSmith
├── docs/DEPLOY-ORACLE.md       # production runbook (Oracle Cloud Always Free)
├── docs/DEPLOYMENT-ARCHITECTURE.md  # production components, request paths, release pipeline, operations
├── docs/DEPLOYMENT-FREE.md     # free hosting options, costs, risks
├── docs/OPERATIONS.md          # server status / operations cheat sheet
├── docs/PLATFORM.md            # organisations, agent registry, knowledge base, customer desk, admin console
├── docs/sales/                 # customer deck, features by role, commercialisation plan
├── docker-compose.yml          # Postgres (pgvector) + n8n
├── docker-compose.prod.yml     # production overlay: + brain, web, Caddy; localhost-only ports; health checks
├── brain/Dockerfile · web/Dockerfile   # production images (arm64 + x86)
├── infra/init-db.sql           # creates databases swarm & n8n, enables vector
├── infra/Caddyfile             # HTTPS + routing: /api → brain, /webhook → n8n, / → web
├── infra/server-bootstrap.sh   # one-time server setup (Ubuntu/Debian, Oracle Linux/RHEL)
├── infra/backup.sh             # nightly DB dumps, 14 days, Telegram alert on failure
├── setup.sh · setup.ps1 · setup.cmd   # one-command setup for macOS/Linux and Windows
├── scripts/swarm.mjs           # setup & run tool (setup, configure, n8n, tunnel, start/stop, status, doctor, server-env, deploy)
├── n8n/
│   ├── build-workflows.mjs     # generates workflow JSON
│   ├── setup.sh                # = node scripts/swarm.mjs n8n
│   └── workflows/*.json
├── brain/src/
│   ├── agents/                 # graph.service (master + confirm), agents.ts (10 specialists), tools/*, actions.ts
│   ├── agui/                   # AG-UI SSE endpoint + event translation (+ contract test)
│   ├── chat/                   # threads, locks, cancel, confirm
│   ├── channels/               # Telegram/WhatsApp inbound, link codes, voice in/out
│   ├── automations/            # tick + 7 proactive flows
│   ├── google/                 # OAuth, Gmail, Calendar, Sheets
│   ├── integrations/           # OpenAI media, SerpAPI + fallbacks, weather + IMD, web reader, Yatra, n8n MCP
│   ├── records/                # tasks, expenses, notes (pgvector), reminders, outbox…
│   ├── auth/ voice/ health/ db/ common/
└── web/src/                    # Next.js PWA (chat, dashboard, memory, settings)
```

---

## 16. Limitations
- Google requires an OAuth client; while the Google Cloud app is in **Testing** mode only the test users you add (up
  to 100) can connect, and Gmail's restricted scopes need Google verification for a public launch.
- WhatsApp: replies are free within Meta's 24-hour service window (first 1,000 service messages per number per month
  are free from 1 Oct 2026); proactive messages outside that window need approved templates, so briefs/reminders
  default to Telegram.
- Telegram and WhatsApp webhooks need a public HTTPS URL for n8n (tunnel or server).
- Flight, hotel and shopping search need `SERPAPI_KEY`; without it the agents return Google links instead.
- The Google Sheet mirror is one-way (edits in the sheet don't flow back, but the Records agent can read them).
- Reminders are one-off (no recurring reminders yet).
- Local mode runs on one machine: when it sleeps, SwarmAI is offline, and a free Cloudflare quick-tunnel URL changes on
  every restart. The production deployment (§17) removes both problems; it is still a single server (no failover).
- Only one place can receive Telegram/WhatsApp at a time (one webhook per bot / Meta app): the server **or** a laptop.
- The WhatsApp test number only reaches the (max 5) recipients added in Meta; your own number needs business
  verification.
- SerpAPI's free plan is 250 searches/month; when it runs out research falls back to the keyless sources.
- Knowledge base: scanned (image-only) PDFs need OCR first; Google Drive folders and scheduled re-sync are not built
  yet. One Telegram bot per server, so only one organisation should run a Telegram customer desk.

---

## 17. Production deployment (Oracle Cloud, free)

Full runbook: **[docs/DEPLOY-ORACLE.md](docs/DEPLOY-ORACLE.md)** · components, request paths, release pipeline and
operations with diagrams: **[docs/DEPLOYMENT-ARCHITECTURE.md](docs/DEPLOYMENT-ARCHITECTURE.md)** · why Oracle and the
alternatives: [docs/DEPLOYMENT-FREE.md](docs/DEPLOYMENT-FREE.md).

![Deployment components](docs/diagrams/13-deployment.png)

### Where everything runs
One **Oracle Cloud Always Free** VM (Ampere A1 ARM, 1 OCPU / 6 GB or 2 / 12; Oracle Linux 9 or Ubuntu), everything in
Docker, started by `./setup.sh deploy` and restarted automatically after a crash or reboot:

| Container | What | Reachable from the internet |
|---|---|---|
| `swarm-caddy` | Caddy: HTTPS (Let's Encrypt, auto-renewed) and routing | **yes — ports 80/443 only** |
| `swarm-web` | Next.js web app | via Caddy: `https://<your-domain>/` |
| `swarm-brain` | NestJS + LangGraph agents | via Caddy: `https://<your-domain>/api/…` (incl. Swagger `/api/docs`) |
| `swarm-n8n` | **n8n** — Telegram & WhatsApp channels, scheduler, error alerts, MCP channel tools | **webhooks only**: `https://<your-domain>/webhook/…` |
| `swarm-db` | Postgres 17 + pgvector — databases `swarm` (app) and `n8n` (workflows, runs) | no |

Postgres, n8n, brain and web listen on `127.0.0.1` only; the n8n editor and its REST API return 404 from outside.
The address is a free **DuckDNS** name; a cron job on the server re-points it every 5 minutes if the IP ever changes.

### Opening the n8n editor
n8n is on the server, not public. Tunnel to it over SSH from your computer and keep the terminal open:
```bash
ssh -L 5678:localhost:5678 <user>@<server-ip>      # <user> = opc on Oracle Linux, ubuntu on Ubuntu
```
then open **http://localhost:5678**. The first visit asks you to create the n8n **owner account** (separate from any
n8n on your laptop). Workflows are generated from `n8n/build-workflows.mjs`; edits made in the editor are overwritten
the next time `./setup.sh deploy` or `./setup.sh n8n` runs.

### Deploying and updating
| Step | Where | Command |
|---|---|---|
| Prepare the server once | server | `bash infra/server-bootstrap.sh <duckdns-name>` (Docker, Node 22, firewall, swap, security updates, DuckDNS updater, backup cron) |
| Write the server's settings | your computer | `./setup.sh server-env <your-domain>` → copies keys from your local `.env` files, adds public URLs and **new production secrets** into `.swarm/server/` (git-ignored), then `scp` them to `swarm-ai/.env` and `swarm-ai/brain/.env` on the server |
| First deploy / every update | server | `cd swarm-ai && git pull && ./setup.sh deploy` — builds images, starts containers, imports n8n workflows, registers Telegram + WhatsApp webhooks on the public URL, checks HTTPS |

The server's `swarm-ai` folder is a git checkout of `main`, so merging to `main` and running the update command is
the whole release process. `.env` and `brain/.env` on the server are git-ignored and never pulled or pushed.

### Everyday operations (on the server, in `~/swarm-ai`)
Full cheat sheet — health checks from your computer, SSH one-liners, n8n runs, what "good" looks like,
troubleshooting: **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

| Task | Command |
|---|---|
| Status / health | `./setup.sh status` · `docker compose ps` (brain and web show `healthy`) |
| Logs | `docker compose logs -f brain` (or `web`, `n8n`, `caddy`) |
| Restart one part | `docker compose restart brain` |
| Backup now | `infra/backup.sh` |
| Restore | `gunzip -c ~/swarm-backups/swarm-<date>.sql.gz \| docker exec -i swarm-db psql -U swarm -d swarm` |
| DuckDNS failures | `journalctl -t duckdns` (empty = all good) |

### Backups, alerts and secrets
- **Database backups:** nightly at 02:30, both databases, kept 14 days in `~/swarm-backups` on the server; optional
  upload to a private OCI Object Storage bucket (pre-authenticated write URL in `~/.swarm-backup-url`).
- **Alerts:** a failed backup sends a Telegram message to `SWARM_ADMIN_TELEGRAM_CHAT_ID` (the same chat as n8n error
  alerts); a failed DuckDNS update is logged to the system journal.
- **Secrets:** the server can be rebuilt from the repo, but not without `.env`, `brain/.env` (`APP_SECRET` decrypts
  Google tokens and organisation keys), `web/.env.local` and `.swarm/server/` (database password, n8n encryption key).
  Keep an encrypted copy off your computer — commands in [DEPLOY-ORACLE.md → Secrets backup](docs/DEPLOY-ORACLE.md#secrets-backup-your-mac).
  Make a new one after changing any key.

### Who can sign up
A public server is reachable by anyone, and every account uses **your OpenAI key**. `./setup.sh server-env` therefore
sets `SIGNUP_MODE=invite`: the first account (the owner) can sign up normally; after that the sign-up page says
*"Sign-up is by invitation only"* and the API refuses accounts without a valid invite. Add people with
**Admin → Members → Create link** (single use, 7 days, optionally locked to one email). To open sign-up again, set
`SIGNUP_MODE=open` in the server's `brain/.env` and run `docker compose up -d brain`.

### Google login in production
In Google Cloud Console (project that owns the OAuth client):
1. **APIs & Services → Credentials →** your OAuth client → **Authorised redirect URIs** → add
   `https://<your-domain>/api/google/callback` (keep the localhost one for local development).
2. **OAuth consent screen → Audience → Test users** → add every Gmail address that will connect (up to 100 while the
   app is in *Testing*; Google asks testers to reconnect every 7 days until the app is verified).
Each user then connects their own account in **Settings → Connect Google**.

### Laptop vs server
- Telegram and WhatsApp deliver to **one** webhook per bot/app. While the server is live, **don't run
  `./setup.sh tunnel` or `./setup.sh n8n` on your laptop** — either moves the webhooks back to the laptop.
- Keep the laptop stack stopped (`./setup.sh stop` and `docker compose stop`), or use it for web-only development;
  otherwise its scheduler can send duplicate reminders/briefs through the same bot.
- The server has its own database: accounts, organisations and data are not shared with a laptop install.

### Cost
₹0/month for hosting within Oracle's Always Free limits (A1 up to 2 OCPU / 12 GB, 200 GB total disk). Set a ₹1
budget alert in OCI Billing. The AI model (OpenAI) is paid per use — or billed to an organisation's own key — and
WhatsApp follows Meta's pricing.
