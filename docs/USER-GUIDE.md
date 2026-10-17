# SwarmAI — what you can do

SwarmAI is one assistant you can reach from three places. All three share the same memory, tasks and history.

| Where | How | Best for |
|---|---|---|
| **Web app** — http://localhost:3200 (installable as an app) | type, or hold the 🎤 button to talk | long answers, approval cards, dashboard, memory, settings |
| **Telegram** — @Priyam_swarmAIbot | text, voice notes, photos, files | everyday use on the phone; reminders & briefs arrive here |
| **WhatsApp** — +1 555-203-3937 (Meta test number) | text, voice notes, photos, documents | same as Telegram |

Voice notes are transcribed, and if you speak, SwarmAI also answers with a voice note. You can mix English and
Hinglish.

**Safety rule:** anything that sends, creates, changes or deletes something (email, calendar event, expense, task
deletion, reminder…) is shown to you first. On the web you get **Approve / Reject** buttons; on Telegram/WhatsApp reply
**YES** (yes, ok, haan, 👍…) or **NO** (no, cancel, nahi, 👎…). Nothing happens until you approve.

---

## The 10 specialist agents

You never pick an agent — just ask. The master agent routes the request, and several agents can work in parallel on
one message (e.g. *"check my calendar tomorrow and the weather in Pune"*). The web app shows which agents are working.

### 📧 Email (Gmail)
- *"Summarise my unread emails from today"* · *"Any emails from HDFC this week?"*
- *"Read the latest email from Rahul"*
- *"Reply to Rahul saying I'll send the deck by Friday"* → shows the draft → YES to send
- *"Draft an email to hr@company.com asking for my Form 16"* (saved as a Gmail draft)
- *"Archive all newsletters from yesterday"*

### 📅 Calendar (Google Calendar)
- *"What's on my calendar this week?"* · *"When am I free tomorrow afternoon?"*
- *"Schedule a call with Rahul tomorrow 4 pm for 30 minutes and invite rahul@x.com"*
- *"Move my 3 pm meeting to 5 pm"* · *"Cancel Friday's dentist appointment"*

### 🔎 Research
- *"What's the latest on the RBI repo rate?"* · *"Compare Ola S1 Pro vs Ather 450X"*
- *"Summarise this article: https://…"* — reads any public link
- Always answers with sources. (Without a SerpAPI key it uses Wikipedia + Google News.)

### ✈️ Travel
- *"Weather in Kochi tomorrow"* — Open-Meteo forecast + **IMD district warnings**
- *"Plan a 4-day trip to Udaipur in December for 2 people, mid budget"* — full day-wise plan from **Yatra AI**
  (your travel-planner project) with a link to open it
- *"Log my trip: Delhi → Jaipur, 20–22 Nov"* → TravelLog tab
- *"Flights Delhi to Goa on 12 Dec"* / *"Hotels in Manali under ₹4000"* — live prices need **SERPAPI_KEY**;
  without it you get ready-made Google Flights/Hotels links

### 🗂️ Records (tasks, contacts, your Google Sheet)
- *"Add a task: renew car insurance by 30 Nov"* · *"What are my open tasks?"* · *"Mark the insurance task done"*
- *"Delete the task about the gym"* (confirmed first)
- *"Save contact: Anita, +91 98…, anita@x.com, college friend"* · *"What's Anita's number?"*
- *"Show my TravelLog sheet"* — reads any tab of your workbook

### 💰 Finance
- *"Spent 450 on lunch"* · *"Paid 1200 for Uber this week"*
- Send a **photo of a receipt** → it reads the amount, merchant and category and logs it
- *"How much did I spend on food this month?"* · *"Expense summary for October by category"*
- Every expense is also a row in the **Expenses** tab of your Google Sheet

### 📝 Notes & memory
- *"Note: wifi password at mom's is …"* · *"What did I note about the Goa villa?"* (searches by meaning)
- *"Remember I'm vegetarian"* · *"Remember my manager is Suresh"* → used automatically in later answers
- *"What do you know about me?"* · *"Forget that I live in Noida"*
- The web app's **Memory** page lists everything it remembers, and you can delete any item there

### ⏰ Reminders
- *"Remind me in 20 minutes to call mom"* (one-off reminders; repeating reminders aren't supported yet)
- *"Remind me on 25 Oct at 9 am to pay the credit card bill"*
- *"What reminders do I have?"* · *"Cancel the credit card reminder"*
- Delivered on your **notify channel** (Settings → currently Telegram)

### 🛒 Shopping
- *"Best price for AirPods Pro 2"* — compares stores (needs SERPAPI_KEY)
- *"Tell me when the Sony WH-1000XM5 drops below ₹22,000"* → price watch, checked daily at 9 am
- *"List my price watches"* · *"Stop watching the Sony headphones"*

### 📄 Documents & images
- Send a photo/screenshot/PDF/text file: *"summarise this"*, *"extract the dates and amounts"*,
  *"translate to English"*, *"what does this error mean?"*

---

## Automations (run by n8n in the background)

| What | When | Where it arrives |
|---|---|---|
| **Morning brief** — today's agenda, weather, open tasks, important mail | daily at your brief time (default 08:00) | notify channel |
| **Inbox triage** — flags important new emails | through the day (if enabled) | notify channel |
| **Meeting prep** — context before upcoming meetings (attendees, related emails) | before meetings (if enabled) | notify channel |
| **Follow-ups** — sent emails still waiting for a reply | daily 18:00 | notify channel |
| **Price-drop alerts** | daily 09:00 (needs SERPAPI_KEY) | notify channel |
| **Weekly review** — what you did, spent, what's coming | Sundays 19:00 | notify channel |
| **Reminders** | at the exact time | notify channel |
| **Workflow error alerts** | when an n8n workflow fails | your Telegram (set `SWARM_ADMIN_TELEGRAM_CHAT_ID`) |

Turn these on/off, change the brief time, timezone, notify channel (Telegram / WhatsApp / web) in **Settings**. The
**Dashboard** has "run now" buttons to try each job immediately.

---

## Web app pages
- **Chat** — conversations, live agent activity, approval cards, push-to-talk, stop button
- **Dashboard** — tasks, upcoming reminders, recent expenses, activity, run automations now
- **Memory** — notes and remembered facts (delete any item)
- **Settings** — profile, timezone, notify channel, automations, Connect/Disconnect Google, Link/Unlink Telegram &
  WhatsApp

## Your Google Sheet — "SwarmAI — bansalpriyam17@gmail.com"
| Tab | Filled when |
|---|---|
| Tasks | you add / complete tasks |
| Expenses | you log expenses or receipts |
| Contacts | you save contacts |
| TravelLog | you log trips |
| EmailDigest | inbox triage / briefs summarise mail |
| ActivityLog | every approved action (audit trail) |

## For developers
- API + Swagger: http://localhost:4200/api/docs (also AG-UI streaming at `POST /api/agui`)
- n8n editor: http://localhost:5678 — see executions of every channel message and scheduler tick
- Logs: `.swarm/logs/` · status: `./setup.sh status` · checks: `./setup.sh doctor`

## Good to know
- Everything runs on this Mac: if it sleeps or shuts down, SwarmAI is offline. After a restart run `./setup.sh start`,
  and `./setup.sh tunnel` (the free tunnel URL changes; the script re-registers Telegram/WhatsApp webhooks).
- WhatsApp uses Meta's **test number**: only numbers on the app's *To* list (max 5) can talk to it. Your own number
  needs Meta business verification.
- Several people can use SwarmAI: each signs up in the web app and connects their own Google account and chats.
