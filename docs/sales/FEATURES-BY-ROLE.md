# SwarmAI — every feature, and how it helps each type of login

_Customer-facing overview, 18 Oct 2026. Companion to [SwarmAI-Customer-Deck.pptx](SwarmAI-Customer-Deck.pptx).
Everything listed here is built and working; planned items are marked **(roadmap)**._

SwarmAI has **five kinds of people** using it. Four of them log in to the web app (also installable on a phone); the
fifth — your customer — never logs in at all.

| Login | Who it is, typically | Sees in the app |
|---|---|---|
| **Owner** | Business owner, director | Chat · Dashboard · Memory · Inbox · **Admin** · Settings |
| **Admin** | Operations or office manager | Chat · Dashboard · Memory · Inbox · **Admin** · Settings |
| **Agent** | Front-desk / support staff who answer customers | Chat · Dashboard · Memory · **Inbox** · Settings |
| **Member** | Any other employee (sales, accounts, doctors…) | Chat · Dashboard · Memory · Settings |
| **Customer** *(no login)* | Your patients, buyers, students, residents | Just WhatsApp or Telegram — nothing to install |

Everyone with a login also gets their **own private assistant** on the web, WhatsApp and Telegram. What one member
tells their assistant (their mail, tasks, notes) is never visible to anyone else, including the owner.

---

## 1. Complete feature list

### A. Customer desk — for your customers
| Feature | What it does |
|---|---|
| 24×7 answers on WhatsApp and Telegram | Unknown senders automatically talk to your organisation's assistant |
| Any language, text or voice note | English, Hindi, Hinglish and more; voice notes are transcribed |
| Answers from your documents | Uses only your knowledge base; never invents prices, policies or services |
| Greeting | Your own first message to new customers |
| Human handover | When the customer asks for a person, is upset, needs a refund/booking/cancellation, or the answer isn't known |
| Handover summary | Staff see *why* the customer needs a person, in one line |
| Staff alerts | Every owner, admin and agent is alerted on WhatsApp/Telegram, with a link |
| Silent while staff reply | The bot never talks over your team |
| Hand back to bot | The bot resumes and knows what your team said |
| Test as a customer | Try the whole flow in the browser before going live |

### B. Knowledge base (RAG)
| Feature | What it does |
|---|---|
| Upload files | PDF, Word, text, Markdown, CSV, HTML, JSON — up to 15 MB each, several at once |
| Add web pages / PDF links | Re-sync with one click when the page changes |
| Paste text | FAQs, timings, price lists, policies |
| Search by meaning | "kitna lagega cleaning ka" finds "Teeth cleaning: ₹1,500" |
| Citations | Answers name the document and page |
| No guessing | Not in the documents → says so (and hands over on the desk) |
| Test a question | See exactly which passages the bot would use |

### C. Inbox — for staff
| Feature | What it does |
|---|---|
| One shared inbox | All handed-over chats from WhatsApp and Telegram in one place, on desktop or phone |
| Filters | Needs a person · Waiting · With team · With bot · Closed |
| Waiting badge | Red counter on *Inbox* so nothing is missed |
| Full transcript | Customer, bot, staff and system lines, with the handover summary on top |
| Take over / reply | Replies go to the customer's own WhatsApp/Telegram chat |
| Hand back / close | Return the chat to the bot, or close it (reopens if the customer writes again) |

### D. Personal assistant — for every login
| Agent | What it does |
|---|---|
| Email (Gmail) | Find, read, summarise; draft, reply, send, archive (sending needs your approval) |
| Calendar | Agenda, free slots, create/move/cancel events and invites (approval first) |
| Knowledge | Ask the company documents — the same knowledge base customers use |
| Research | Web and news research with sources, read any link |
| Records | To-dos, contacts, and your own Google Sheet (Tasks, Contacts, TravelLog, EmailDigest, ActivityLog) |
| Finance | Log expenses by text or receipt photo; summaries by category and period |
| Notes & memory | Save and search notes; remembers your preferences |
| Reminders | Time-based reminders on WhatsApp, Telegram or web |
| Travel | Flights and hotels with live prices, weather and IMD alerts, India trip plans |
| Shopping | Compare prices across stores; price-drop watches |
| Documents | Understand photos and files: summarise, extract details, translate |
| Custom agents | Built by your admin for your business (e.g. "Order help", "Appointments") |

One message can use several agents at once: *"log ₹450 lunch, remind me at 5 to call Ravi, and what's the weather in
Pune tomorrow"*. Web chat supports push-to-talk and read-aloud.

### E. Automations — work done without being asked
| Automation | When | What you get |
|---|---|---|
| Morning brief | your time (default 08:00) | today's meetings, important mail, tasks, weather alerts, news |
| Inbox triage | every 30 min | urgent-mail alerts; action items turned into tasks |
| Meeting prep | 20–45 min before a meeting | who's attending, recent emails with them, talking points |
| Follow-up nudges | daily 18:00 | sent emails with no reply after 3 days |
| Price watch | daily 09:00 | alert when a watched product drops below your price |
| Weekly review | Sunday 19:00 | spend by category, tasks done/open, next week's load |
| Reminders | every minute | delivered on your chosen channel |

### F. Control, security and administration
| Feature | What it does |
|---|---|
| Approval before action | Sending email, deleting, and any tool the admin marks "needs approval" waits for a person (button on web, YES/NO on phone) |
| Customer-safe tools | Customer chats can only use safe tools — never staff mailboxes, tasks or files, whatever the settings |
| Roles and invites | Owner, admin, agent, member; single-use invite links that expire after 7 days, optionally locked to an email |
| Audit log | Every action, approval, take-over and staff reply, searchable |
| Data separation | Knowledge, conversations and settings are isolated per organisation; personal data per user |
| Own OpenAI key | Optional, stored encrypted, never shown again; AI usage billed to your own account |
| Branding | Assistant name and colour shown in the app and to customers |
| Agent settings | Switch agents on/off, add house rules, change model, choose tools and who can use each agent |
| Industry packs | One-click presets: WhatsApp Support Desk, Clinic Front Desk |
| Usage overview | Members, documents, waiting customers, conversations, actions per agent (30 days) |

---

## 2. How each login benefits

### 👑 Owner
**Uses:** Admin console, Inbox, personal assistant, morning brief.

- **Sets the business up once, in an afternoon** — upload FAQs and price list, pick an industry pack, write the
  greeting and hand-over message, invite the team. No developer needed.
- **Sees the whole operation** — waiting customers, conversation volume, which agents are used, and a searchable audit
  log of every action.
- **Keeps control of risk** — decides which actions need approval and what the bot must never say ("never discuss
  prices of other clinics", "never give medical advice").
- **Starts the day informed** — morning brief on WhatsApp: meetings, urgent mail, tasks, weather alerts.
- **Controls cost** — choose the AI model, or plug in the company's own OpenAI account.

**Efficiency gain:** customers keep getting answers when the owner and staff are busy or offline; the owner stops
being the person everyone asks "what's our policy on…?" — the knowledge base answers staff too.

### 🛠 Admin (operations / office manager)
**Uses:** Admin console, Inbox, personal assistant.

- **Keeps knowledge current** — new price list? Upload it, delete the old one; the bot uses it within minutes.
  Web pages re-sync with one click.
- **Checks quality before customers do** — *Test a question* and *Test as a customer*.
- **Tunes behaviour without code** — tone, language, extra instructions per agent; custom agents for the business.
- **Manages the team** — invite links with roles, change roles, remove people.
- **Reviews pending approvals and the audit log** across the team.

**Efficiency gain:** changes that used to mean briefing every staff member ("from Monday, cleaning is ₹1,500") are
made once, and every answer — to customers and staff — updates at the same time.

### 🎧 Agent (front desk / support staff)
**Uses:** Inbox (desktop or phone), personal assistant.

- **Only sees the chats that need a human** — the bot handles routine questions; the Inbox shows the rest with a red
  badge and an alert on the agent's phone.
- **Starts with context, not from zero** — one-line summary and full transcript before replying.
- **Replies from one place** to WhatsApp and Telegram customers, without using a personal phone.
- **Hands back when done** — the bot continues the conversation consistently with what the agent said.
- **Asks the knowledge base too** — "what is the cancellation policy for packages?" with the source.

**Efficiency gain:** staff stop typing the same answers all day and spend their time on complaints, bookings and
sales — the conversations where a human actually matters. Shared inbox = no lost chats when someone is on leave.

### 💼 Member (any employee)
**Uses:** personal assistant on web, WhatsApp and Telegram; automations.

- **Email and calendar by chat or voice** — "summarise unread mail from clients", "find a free hour with Ravi on
  Thursday and send an invite" (approve before it's sent).
- **Never forgets** — reminders, follow-up nudges for unanswered emails, meeting prep before every meeting.
- **Paperwork in seconds** — photograph a receipt to log an expense; tasks and contacts sync to their Google Sheet.
- **Fast answers** — company documents (Knowledge), web research with sources, travel and prices.
- **Private by design** — their mail, notes and tasks are visible only to them.

**Efficiency gain:** the small admin jobs — checking mail, scheduling, logging expenses, chasing replies — are done by
message or voice note from anywhere, instead of switching between five apps.

### 🙋 Customer (no login)
**Uses:** WhatsApp or Telegram — the app they already have.

- **Instant answers at any hour** — timings, fees, policies, directions — in their own language, even as a voice note.
- **Correct answers** — taken from the business's own documents, not guessed.
- **A real person when needed** — just ask ("talk to a human", "kisi se baat karni hai"); urgent and sensitive
  requests are handed over automatically, with a clear "a person will reply here" message.
- **No repetition** — staff see the whole conversation, so the customer doesn't explain twice.

**Benefit to the business:** faster replies mean fewer customers lost to competitors, and a consistent experience
whoever is on shift.

---

## 3. Efficiency at a glance

| Task | Before | With SwarmAI | Who benefits |
|---|---|---|---|
| Repeat customer question (timings, fees, policy) | Staff read and type a reply, often hours later | Answered instantly, with the source, 24×7 | Customer, Agent |
| Customer needs a person | Message sits in someone's personal phone | Handed over with a summary; whole team alerted | Customer, Agent |
| Policy or price change | Brief every staff member, hope they remember | Upload once; bot and staff answers update | Admin, Owner |
| New staff member | Learns FAQs over weeks | Asks the Knowledge agent from day one | Agent, Member |
| Find out what happened on a chat | Ask around | Transcript + audit log | Owner, Admin |
| Daily planning | Open mail, calendar, task app separately | Morning brief on WhatsApp | Everyone |
| Meeting preparation | Search old emails manually | Prep note arrives before the meeting | Member, Owner |
| Unanswered emails | Forgotten | Follow-up nudge after 3 days | Member |
| Expense logging | Keep receipts, type later | Photo → logged and categorised | Member |
| Risky actions (send, delete, refund) | Depend on individual care | Need an explicit approval; recorded | Owner |

---

## 4. Coming next (roadmap)

Finer roles and approval rules by amount or recipient · WhatsApp message templates for follow-ups after 24 hours ·
cost tracking and caps per organisation · answer-quality tests per client · OCR for scanned PDFs · Google Drive sync ·
packs for Sales & leads, Collections, HR & hiring, Real estate, Education and D2C commerce.
