# Commercialising SwarmAI — internal plan

_Internal, 18 Oct 2026. For the customer-facing pitch use [SwarmAI-Customer-Deck.pptx](SwarmAI-Customer-Deck.pptx).
Prices and costs below are estimates to validate, not quotes._

---

## 1. Is RAG in it?

Yes. The **knowledge base** (Phase 1, P6) is retrieval-augmented generation:

1. Admin uploads PDFs, Word files, web pages or pasted FAQs (Admin → Knowledge).
2. Text is extracted page by page and cut into ~1,200-character overlapping passages.
3. Each passage is embedded with OpenAI `text-embedding-3-small` and stored in Postgres **pgvector** (HNSW index),
   separately per organisation.
4. At question time the **Knowledge agent** runs `kb_search`, gets the closest passages (score ≥ 0.2) and must answer
   only from them, citing *[source, p. N]*. Nothing found → it says so; on the customer desk it hands the chat to staff.

Details: [PLATFORM.md §3](../PLATFORM.md#3-knowledge-base-p6). Not yet built: OCR for scanned PDFs, Google Drive sync,
scheduled re-sync, hybrid keyword + vector search, re-ranking.

## 2. Feature list

**Customer desk (sell this first)**
- AI answers unknown WhatsApp / Telegram senders for the organisation, in their language, text or voice notes.
- Human handoff: on request ("talk to a human", Hinglish too), frustration, refunds/bookings, or unknown answers.
- Staff alert with an AI summary; Inbox with filters, take over, reply on the customer's chat, hand back, close.
- Bot stays silent while staff handle a chat, and resumes knowing what staff said.
- Greeting, hand-over message, business instructions; "Test as a customer" simulator.

**Knowledge base (RAG)** — above.

**Team assistant (per staff member)**
- 11 agents: Email (Gmail), Calendar, Knowledge, Research (web + news with sources), Travel (flights, hotels, IMD
  weather, trip plans), Records (tasks, contacts, Google Sheet), Finance (expenses, receipt photos), Notes & memory,
  Reminders, Shopping (price compare, watches), Documents (images/files).
- Parallel multi-agent answers; web PWA with push-to-talk and read-aloud; Telegram and WhatsApp with voice notes.
- Automations: morning brief, inbox triage, meeting prep, follow-up nudges, price watch, weekly review, reminders.

**Platform and control**
- Organisations, roles (owner/admin/agent/member), expiring invite links.
- Agent registry: on/off, extra instructions, prompt override, model, tools, approval per tool, audience; custom
  agents; industry packs (Support Desk, Clinic Front Desk).
- Approval before side effects (email send, deletes, any tool marked "needs approval").
- Customer-safe tool list enforced in code; per-org data isolation; audit log; usage view.
- Per-org model choice and own OpenAI key (AES-256-GCM encrypted).
- Admin console (8 tabs), Swagger API, one-command setup on macOS/Linux/Windows.

## 3. What to fix before the first paying client

| Gap | Why it matters | Roadmap item |
|---|---|---|
| **Hosting** — today it runs on your laptop with a Cloudflare quick tunnel whose URL changes on restart | A client needs 24×7 uptime, a fixed domain, backups, monitoring | P12 |
| **WhatsApp per client** — each client needs their own Meta Business verification and a real number (not the test number); messages after 24 h need approved templates | Without it the desk can only talk to 5 test numbers | P8 |
| **Cost tracking and caps per org** | Protects your margin when a client gets heavy traffic | P9 |
| **n8n licence** — n8n's Sustainable Use License limits offering it as part of a paid hosted service | Check with n8n, buy a licence, or move channel code into the brain | P13 |
| **Google OAuth verification** for Gmail scopes | Only needed if you sell the team assistant's email features to outsiders | — |
| **Legal** — terms of service, DPA, DPDP Act consent/deletion, GST registration, invoicing | Required to sign any business client | — |
| **Evals** — a test set of 30–50 real questions per client, run before go-live | Proves answer quality, catches regressions | P9 |

The fastest safe path: one small cloud VM per client (Docker Compose as today) + fixed domain + nightly DB backup. That
avoids most multi-tenant hosting risk for the first 3–5 clients.

## 4. Who to sell to first

Pick businesses with **many repeat WhatsApp questions and a small front desk**:

1. **Clinics, dental and diagnostic centres** — pack exists; timings/fees/test prep are perfect for RAG; hand-over for
   appointments.
2. **Coaching institutes and schools** — fees, batches, admissions; peaks during admission season.
3. **D2C brands and local retailers** — "where is my order", returns; needs an order-lookup integration (not built yet).
4. **Housing societies, real-estate brokers** — FAQs and lead capture (lead capture not built yet).

Avoid regulated advice (medical diagnosis, financial advice, legal) beyond FAQ + hand-over.

## 5. How to package and price

Start as a **managed service** (you set it up and run it), not self-serve SaaS: it needs less product work, and you
learn what clients actually ask.

| Item | Suggested (validate) | Notes |
|---|---|---|
| Setup per pack | ₹25,000 – ₹50,000 one-time | Knowledge loading, config, eval set, staff training |
| Starter | ₹4,999 / month | 1 channel, 3 seats, 500 chats |
| Growth | ₹12,999 / month | 2 channels + web, 10 seats, 3,000 chats, packs, team assistant |
| Enterprise | custom | own cloud, own keys, integrations |
| WhatsApp charges | pass-through at cost | Meta's per-message pricing; customer-initiated service replies are currently free inside the 24 h window — check Meta's current India rates |
| Pilot | setup fee + first month at Starter | 4 weeks, agreed KPIs, convert to annual |

**Market check:** Indian WhatsApp tools (WATI, Interakt, AiSensy, Gallabox) sell broadcast + inbox from roughly
₹1,000–₹3,500/month; their AI add-ons cost extra. Your edge is **grounded answers + clean human handoff + approval
rules**, so price above plain inbox tools but stay within an SMB budget.

**Rough unit cost (estimate, verify with real usage logs):**
- LLM: a desk turn with `gpt-4.1-mini` is roughly 5–8k input tokens (prompt + passages + history) and ~300 output —
  around ₹0.25–0.40 per turn at current list prices, so ~₹1–2 per 5-turn conversation. 500 chats ≈ ₹1,000.
- Embeddings: negligible (a 100-page manual costs well under ₹5).
- Hosting: a 2–4 GB VM ≈ ₹1,500–3,000 / month per client.
- So Starter leaves a healthy margin if chats stay near the plan limit. Add overage pricing (e.g. ₹2 per extra chat).

Clients with their own OpenAI key pay the LLM directly — useful for Enterprise.

## 6. Go-to-market steps

1. **Demo org** — a fictional clinic with a real-looking FAQ PDF, price list and timings; rehearse the 10-minute demo
   (Hindi voice note → answer with source → "I want a person" → staff reply from a phone → hand back).
2. **Fix the blockers** in §3 for one hosted client.
3. **3 design partners** — free or heavily discounted pilot in exchange for a case study and weekly feedback.
4. **Measure** — % answered by bot, first-reply time, hand-overs, CSAT; turn into a one-page case study.
5. **Channels** — your network, LinkedIn posts with the demo video, clinic/coaching associations, partnering with
   WhatsApp BSP resellers and local digital-marketing agencies (they already sell WhatsApp to SMBs).
6. **Next packs** from the roadmap (Sales & leads, Collections) once two clients ask for the same thing.

Check your employment contract regarding side businesses and IP before selling.

## 7. Using the deck

- File: `docs/sales/SwarmAI-Customer-Deck.pptx`, 13 slides, speaker notes on every slide.
- Before sending: replace the contact line on the last slide and confirm the prices on slide 12.
- Screenshots come from the demo clinic "Acme Dental" used in testing.
- It only claims features that are built; roadmap packs are labelled as such.
