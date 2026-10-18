# Setting up SwarmAI's integrations

Only the OpenAI key is required. Add the rest as you need them, then re-run the wizard — it validates each key and
updates every `.env` file for you:

- macOS/Linux: `./setup.sh configure && ./setup.sh n8n && ./setup.sh restart`
- Windows: `setup.cmd configure`, `setup.cmd n8n`, `setup.cmd restart`

`./setup.sh doctor` (or `setup.cmd doctor`) shows what is configured and running.

---

## 1. Google (Gmail, Calendar, Sheets) — per user

1. Go to **Google Cloud Console** → create a project (e.g. *SwarmAI*).
2. **APIs & Services → Library** → enable **Gmail API**, **Google Calendar API**, **Google Sheets API** (all three —
   a disabled API only shows up later as "has not been used in project … or it is disabled").
3. **OAuth consent screen** → *External* → app name, support email → scopes are requested at runtime
   (`gmail.modify`, `calendar`, `drive.file`, `openid`, `email`) → add **test users** (every person who will use
   SwarmAI while the app is in *Testing*; up to 100).
4. **Credentials → Create credentials → OAuth client ID** → *Web application*
   - Authorised redirect URI: `http://localhost:4200/api/google/callback` (use your public URL in production).
5. Put the values in `brain/.env`:
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_REDIRECT_URI=http://localhost:4200/api/google/callback
   ```
6. Restart the brain. Each user opens **Settings → Connect Google** in the web app. On first connect SwarmAI creates
   the user's workbook **“SwarmAI — <email>”** with tabs Tasks, Expenses, Contacts, TravelLog, EmailDigest, ActivityLog.
   On Google's screen click *Continue* past "Google hasn't verified this app" and **tick every checkbox** (Gmail is
   unticked easily). Settings shows a red note naming anything missing (a permission or a disabled API).

| Symptom | Fix |
|---|---|
| `Error 403: access_denied` on Google's page | add the account under **Audience → Test users** |
| work account (e.g. company Workspace) blocked | the admin blocks unverified apps — use a personal Gmail |
| "permission not granted" in Settings | Disconnect → Connect, tick every box |
| "API is disabled" in Settings | enable it in the Library, wait 1–2 min, Disconnect → Connect |
| no refresh token | remove SwarmAI at https://myaccount.google.com/permissions and connect again |

---

## 2. Telegram bot

1. In Telegram, open **@BotFather** → `/newbot` → name and username (e.g. `swarmai_priya_bot`) → copy the token.
2. Root `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC…`; `brain/.env`: `TELEGRAM_BOT_USERNAME=swarmai_priya_bot`.
3. Telegram needs a **public HTTPS URL** for n8n's webhook (see §4), set as `N8N_PUBLIC_URL` in the root `.env`, then
   `docker compose up -d n8n`.
4. Run `./n8n/setup.sh` — it updates the credential and publishes **SwarmAI – Telegram channel**.
5. Web app → **Settings → Link Telegram** → open the deep link (or send `/start CODE` to the bot).
6. Optional: send any message to your bot, find your chat id in the brain's `channel_links` table, and set
   `SWARM_ADMIN_TELEGRAM_CHAT_ID` to receive n8n error alerts.

---

## 3. WhatsApp (Cloud API)

1. **developers.facebook.com** → *Create app* → type *Business* → add the **WhatsApp** product.
   Create the app with **only** the WhatsApp use case — extra (Marketing API) use cases add requirements.
2. **WhatsApp → API setup**: note the **Phone number ID** and **WhatsApp Business Account ID**; Meta gives you a free
   test number — add your own phone under **To** (max 5 recipients). The token shown there expires in 24 h.
   **Permanent token:** business.facebook.com → Settings → System users → Add (Admin) → **Assign assets**: the app
   (full control) *and* the WhatsApp account (full control) → **Generate token** → expiry *Never* →
   `whatsapp_business_messaging` + `whatsapp_business_management`. ("No permissions available" = the app isn't
   assigned to the system user yet.)
3. **App settings → Basic**: copy the **App ID** and **App secret** (used by n8n's WhatsApp Trigger to subscribe the
   webhook).
4. Root `.env`:
   ```
   WHATSAPP_ACCESS_TOKEN=…
   WHATSAPP_BUSINESS_ACCOUNT_ID=…
   WHATSAPP_PHONE_NUMBER_ID=…
   META_APP_ID=…
   META_APP_SECRET=…
   ```
   `brain/.env`: `WHATSAPP_DISPLAY_NUMBER=+91…` (for the wa.me link in Settings).
5. Public HTTPS URL for n8n (§4) → `./setup.sh tunnel` (or `./setup.sh n8n` with your own URL) publishes **SwarmAI –
   WhatsApp channel**. n8n registers the webhook with Meta; the script then checks it, replaces a webhook pointing at an
   old tunnel URL, and subscribes the WhatsApp Business Account to the app. Leave **Callback URL / Verify token** on
   Meta's *Configure webhooks* page empty — n8n manages them. Meta allows **one webhook per app**, so use separate apps
   for dev and prod.
   You do **not** need to publish the Meta app or verify the business to use the test number with your own phone;
   that is only needed for your own number or more recipients.
6. Web app → **Settings → Link WhatsApp** → send `LINK CODE` to the number.

Costs: from 1 Oct 2026 Meta charges service messages but the first 1,000 per number per month are free; messages
outside the 24-hour window need approved templates (SwarmAI sends proactive messages to Telegram by default).

---

## 4. Public HTTPS URL for n8n webhooks

Quickest for development — **Cloudflare Tunnel** (free). The setup tool does this for you:
`./setup.sh tunnel` (Windows: `setup.cmd tunnel`) starts a quick tunnel, writes `N8N_PUBLIC_URL`, restarts n8n and
publishes the channel workflows. Manually:
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5678      # prints https://<random>.trycloudflare.com
```
Set `N8N_PUBLIC_URL=https://<random>.trycloudflare.com/` in the root `.env`, then run `./setup.sh n8n`. (ngrok works
the same way.) A quick tunnel's URL changes whenever it restarts (or the Mac reboots) — run `./setup.sh tunnel` again;
`./setup.sh restart` keeps the tunnel running, `./setup.sh stop` ends it. For 24/7 use, run the stack on a small VPS
with a domain or use a named Cloudflare tunnel.

n8n 2.x activates published workflows from a queue ~30 s after it starts, so webhooks appear shortly after a restart —
the setup script waits for them. Debug n8n with `N8N_LOG_LEVEL=debug docker compose up -d n8n`.

---

## 5. n8n ↔ brain

| Setting | Where | Must match |
|---|---|---|
| `SWARM_N8N_TOKEN` | root `.env` and `brain/.env` | yes — header `X-Swarm-Key` on n8n → brain calls |
| `SWARM_BRAIN_URL` | root `.env` | how the n8n container reaches the brain (default `http://host.docker.internal:4200`) |
| `N8N_MCP_TOKEN` | root `.env` (credential) and `brain/.env` | yes — Bearer token of the MCP server |
| `N8N_MCP_URL` | `brain/.env` | `http://localhost:5678/mcp/swarm-channels` |

Check: `curl localhost:4200/api/health` → `"n8nMcp": "connected (send_whatsapp_message, send_telegram_message)"`.

---

## 6. SerpAPI (web, news, flights, hotels, shopping)

Sign up at https://serpapi.com → copy the API key → `brain/.env`: `SERPAPI_KEY=…` → restart the brain. The free plan
has 250 searches/month (a research question uses 1–2; each price watch 1/day). Without it, research falls back to
Wikipedia + Google News RSS — snippets only, noticeably less reliable for exact facts such as festival dates — and
flights/hotels/shopping return Google links.

---

## 7. Yatra AI (optional)

Run the travel-planner project (`travel-planner/backend` on :4100). `brain/.env`:
`YATRA_API_URL=http://localhost:4100`, `YATRA_WEB_URL=http://localhost:3100`. The Travel agent's `plan_india_trip`
tool then returns full day-wise plans with a link.

---

## 8. LangSmith tracing (optional)

`brain/.env`: `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY=…`, `LANGSMITH_PROJECT=swarm-ai` → every run, agent, LLM
and tool call appears in LangSmith.

---

## 9. Customer desk (optional)

To let customers (non-members) chat with your organisation's assistant on WhatsApp/Telegram:
1. Run `./setup.sh n8n` once after updating SwarmAI — the channel workflows gained a *Has reply?* step (the bot stays
   silent while staff handle a chat) and pass the receiving WhatsApp `phone_number_id`.
2. In the web app: Admin → Knowledge (add documents), Admin → Customer desk (turn it on, describe your business).
3. With Meta's **test number**, only the (max 5) numbers on the *To* list can message it — add a colleague's phone to
   play the customer. A real business number needs Meta business verification.
4. Staff get hand-over alerts on their notify channel (Settings) — make sure their Telegram/WhatsApp is linked.

Details: [PLATFORM.md](PLATFORM.md).

## 10. Error alerts and debugging

- `SWARM_ADMIN_TELEGRAM_CHAT_ID` (root `.env`) — your Telegram chat id; n8n's error workflow messages you when a workflow
  fails. Recreate n8n after changing it: `docker compose up -d n8n`.
- Brain log `.swarm/logs/brain.log` shows every agent and tool call (`→ research agent: …`, `research.web_search …`).
- n8n → **Executions** shows every channel message and scheduler tick.
