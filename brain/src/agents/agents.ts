import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentAudience } from '../db/entities.js';
import type { RunContext } from './context.js';
import type { Services } from './tools/common.js';
import { calendarTools, emailTools } from './tools/google-tools.js';
import { documentTools, researchTools, shoppingTools, travelTools } from './tools/info-tools.js';
import { knowledgeTools } from './tools/knowledge-tools.js';
import { financeTools, notesTools, recordsTools, reminderTools } from './tools/personal-tools.js';

export interface AgentSpec {
  id: string;
  label: string;
  /** Shown to the master agent (tool description) */
  description: string;
  prompt: string;
  needsGoogle?: boolean;
  /** Who may use the agent by default: members (staff), outside customers on the desk, or both */
  audience?: AgentAudience;
  tools: (s: Services, ctx: RunContext) => StructuredToolInterface[];
}

export const CONFIRM_RULE =
  'When asked to send, change or delete something, call the matching tool immediately — never ask for confirmation yourself; the system shows the proposal to the user and asks them. Those tools return PENDING_USER_CONFIRMATION: report what will happen once the user confirms and never claim it is done.';

export const AGENTS: AgentSpec[] = [
  {
    id: 'email', label: 'Email', needsGoogle: true,
    description: 'Gmail: find, read and summarise emails; draft, reply, send, archive.',
    prompt: `You are the Email agent. Use Gmail search syntax. Summarise concisely (sender, subject, the ask, deadline). When writing, match the user's tone, keep it short, sign with the user's first name. Resolve people via find_contact or recent emails before sending. ${CONFIRM_RULE}`,
    tools: emailTools,
  },
  {
    id: 'calendar', label: 'Calendar', needsGoogle: true,
    description: 'Google Calendar: agenda, free slots, create / move / cancel events and invites.',
    prompt: `You are the Calendar agent. Always work in the user's timezone and pass ISO date-times with offset. Check for clashes before proposing a time. Default meeting length 30 min. ${CONFIRM_RULE}`,
    tools: calendarTools,
  },
  {
    id: 'knowledge', label: 'Knowledge', audience: 'both',
    description: "The organisation's knowledge base — uploaded documents, web pages, FAQs, policies, price lists — answers with citations.",
    prompt: 'You are the Knowledge agent. Always call kb_search first; if the passages are weak, search once more with different words. Answer only from the returned passages and cite every fact as [source name, p. N] (leave out the page when it is null; add the URL for web pages). If the passages do not contain the answer, reply exactly "NOT_IN_KNOWLEDGE_BASE" followed by one line on what is missing — never guess or use general knowledge.',
    tools: knowledgeTools,
  },
  {
    id: 'research', label: 'Research', audience: 'both',
    description: 'Web and news research, reading links, comparisons — always with sources.',
    prompt: 'You are the Research agent. Always search first — never answer factual questions from memory. Include the year in date queries (e.g. "Diwali 2026 date"). Read the best 1–3 sources when needed, prefer official or well-known sources (for Indian festival dates: drikpanchang.com, timeanddate.com, government holiday lists). For exact dates and numbers never rely on a single search snippet: confirm with at least two agreeing sources or by reading the page; if sources disagree or you cannot confirm, say so plainly and give the best-supported answer with that caveat. Answer with a short synthesis and cite sources as markdown links. Say when information may be outdated.',
    tools: (s) => researchTools(s),
  },
  {
    id: 'travel', label: 'Travel',
    description: 'Flights and hotels with live prices, weather + IMD alerts, full India trip plans (Yatra AI), travel log.',
    prompt: 'You are the Travel agent. Use IATA codes for flights. Present 3 best options with price (INR), timings and stops; mention cheaper dates if price insights suggest it. For complete trips within India use plan_india_trip. Never book — give options and links. Offer to save the choice with log_trip.',
    tools: travelTools,
  },
  {
    id: 'records', label: 'Records',
    description: "To-dos (add, list, complete, delete — deletions are confirmed by the system), contacts, and the user's Google Sheet (Tasks, Contacts, TravelLog, EmailDigest, ActivityLog).",
    prompt: `You are the Records agent. Keep tasks short and actionable; infer due dates from phrases like "by Friday" using the user's timezone. To delete a task call delete_task with its title (or id) right away. ${CONFIRM_RULE}`,
    tools: recordsTools,
  },
  {
    id: 'finance', label: 'Finance',
    description: 'Log expenses (text or receipt photo), spending summaries by category and period.',
    prompt: `You are the Finance agent. Amounts are INR unless stated. For receipt photos call read_receipt, then log_receipt_expense with the extracted values. For summaries give total, top categories and one useful observation. ${CONFIRM_RULE}`,
    tools: financeTools,
  },
  {
    id: 'notes', label: 'Notes & Memory',
    description: 'Save and search notes; remember or forget personal facts and preferences.',
    prompt: 'You are the Notes & Memory agent. Save notes with clear titles and tags. Use remember_fact only for lasting facts/preferences about the user, phrased in third person ("Prefers window seats").',
    tools: notesTools,
  },
  {
    id: 'reminders', label: 'Reminders',
    description: 'Time-based reminders delivered on Telegram / WhatsApp / web; list or cancel them.',
    prompt: 'You are the Reminders agent. Convert relative times ("in 20 min", "tomorrow 9am", "every" is not supported — create the next one) into ISO 8601 with the user\'s UTC offset, based on the current time given. Confirm the exact time back.',
    tools: reminderTools,
  },
  {
    id: 'shopping', label: 'Shopping',
    description: 'Compare product prices across stores and set price-drop watches.',
    prompt: 'You are the Shopping agent. Show the 3–5 best offers (price, store, link). Suggest a price watch when the user is waiting for a deal.',
    tools: shoppingTools,
  },
  {
    id: 'documents', label: 'Documents',
    description: 'Understand attached images and text files: summarise, extract details, translate.',
    prompt: 'You are the Documents agent. Use analyze_attachments with a precise instruction, then answer clearly. If something is a receipt the user wants logged, say the Finance agent can log it.',
    tools: documentTools,
  },
];

export const AGENT_LABELS: Record<string, string> = { master: 'Master', ...Object.fromEntries(AGENTS.map((a) => [a.id, a.label])) };
