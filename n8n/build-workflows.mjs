// Generates the SwarmAI n8n workflows (n8n 2.x) into ./workflows/*.json.
// Run: node n8n/build-workflows.mjs   (then n8n/setup.sh imports them into the n8n container)
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'workflows');
mkdirSync(OUT, { recursive: true });

// Fixed ids so workflows can reference each other (error workflow) and credentials resolve on import.
export const IDS = {
  telegram: 'SwarmTelegram001',
  whatsapp: 'SwarmWhatsApp001',
  scheduler: 'SwarmScheduler01',
  mcp: 'SwarmMcpTools001',
  errors: 'SwarmErrors00001',
};
export const CREDS = {
  telegram: { id: 'SwarmCredTelegram', name: 'SwarmAI Telegram bot' },
  whatsapp: { id: 'SwarmCredWhatsApp', name: 'SwarmAI WhatsApp Cloud API' },
  whatsappTrigger: { id: 'SwarmCredWaTrigger', name: 'SwarmAI WhatsApp webhook (Meta app)' },
  mcpBearer: { id: 'SwarmCredMcpBearer', name: 'SwarmAI MCP bearer token' },
};

const BRAIN = (path) => `={{ $env.SWARM_BRAIN_URL }}${path}`;
const brainHeaders = { parameters: [{ name: 'X-Swarm-Key', value: '={{ $env.SWARM_N8N_TOKEN }}' }] };

let x = 0;
const node = (name, type, typeVersion, parameters, extra = {}) => ({
  id: randomUUID(), name, type, typeVersion, position: [(x += 240), extra.y ?? 300], parameters, ...extra, y: undefined,
});
const clean = (n) => {
  delete n.y;
  return n;
};

/** POST JSON to the brain with the shared secret. */
const brainPost = (name, path, jsonBody, timeout = 300000) =>
  node(name, 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: BRAIN(path),
    sendHeaders: true,
    headerParameters: brainHeaders,
    sendBody: true,
    specifyBody: 'json',
    jsonBody,
    options: { timeout },
  });

const ifNotEmpty = (name, leftValue) =>
  node(name, 'n8n-nodes-base.if', 2.2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: randomUUID(), leftValue, rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  });

const ifEquals = (name, leftValue, rightValue) =>
  node(name, 'n8n-nodes-base.if', 2.2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: randomUUID(), leftValue, rightValue, operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    options: {},
  });

const code = (name, jsCode, mode = 'runOnceForEachItem') => node(name, 'n8n-nodes-base.code', 2, { mode, jsCode });

const toBase64Property = (name) =>
  node(name, 'n8n-nodes-base.extractFromFile', 1.1, { operation: 'binaryToPropery', binaryPropertyName: 'data', destinationKey: 'data', options: {} });

const conn = (pairs) => {
  const c = {};
  for (const [from, to, outIndex = 0, type = 'main'] of pairs) {
    c[from] ??= {};
    c[from][type] ??= [];
    while (c[from][type].length <= outIndex) c[from][type].push([]);
    c[from][type][outIndex].push({ node: to, type, index: 0 });
  }
  return c;
};

const workflow = (id, name, nodes, connections, settings = {}) => ({
  id,
  name,
  active: false,
  isArchived: false,
  nodes: nodes.map(clean),
  connections,
  settings: { executionOrder: 'v1', timezone: 'Asia/Kolkata', ...(id !== IDS.errors ? { errorWorkflow: IDS.errors } : {}), ...settings },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
});

// ───────────────────────────────────────────── Telegram channel
x = 0;
{
  const trigger = node('Telegram Trigger', 'n8n-nodes-base.telegramTrigger', 1.2, { updates: ['message'], additionalFields: { download: true } }, {
    credentials: { telegramApi: CREDS.telegram }, webhookId: randomUUID(),
  });
  const hasFile = ifNotEmpty('Has attachment?', "={{ $binary.data ? 'yes' : '' }}");
  const toB64 = toBase64Property('Attachment → base64');
  const build = code('Build brain request', `// Normalise a Telegram update into the brain's inbound format.
const m = $('Telegram Trigger').item.json.message ?? {};
const bin = $('Telegram Trigger').item.binary?.data;
const body = {
  channel: 'telegram',
  externalId: String(m.chat?.id ?? ''),
  displayName: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || null,
  messageId: String(m.message_id ?? ''),
  text: m.text ?? m.caption ?? null,
};
if ($json.data && bin) {
  const media = { data: $json.data, mime: bin.mimeType || 'application/octet-stream', name: bin.fileName || 'file' };
  if (m.voice || m.audio) body.audio = { ...media, mime: m.voice ? 'audio/ogg' : (m.audio?.mime_type || media.mime) };
  else if (m.photo) body.image = { ...media, mime: media.mime.startsWith('image/') ? media.mime : 'image/jpeg' };
  else if (m.document) body.document = { ...media, mime: m.document.mime_type || media.mime, name: m.document.file_name || media.name };
}
return { json: { chatId: body.externalId, body } };`);
  const ask = brainPost('Ask SwarmAI brain', '/api/channels/inbound', '={{ JSON.stringify($json.body) }}');
  const hasReply = ifNotEmpty('Has reply?', '={{ $json.reply }}');
  const reply = node('Send reply', 'n8n-nodes-base.telegram', 1.2, {
    resource: 'message', operation: 'sendMessage',
    chatId: "={{ $('Build brain request').item.json.chatId }}",
    text: '={{ $json.reply }}',
    additionalFields: { appendAttribution: false, disable_web_page_preview: true },
  }, { credentials: { telegramApi: CREDS.telegram } });
  const hasVoice = ifNotEmpty('Voice reply?', "={{ $('Ask SwarmAI brain').item.json.voice }}");
  const asFile = node('Voice reply → MP3', 'n8n-nodes-base.convertToFile', 1.1, {
    operation: 'toBinary', sourceProperty: 'voice', binaryPropertyName: 'data',
    options: { dataIsBase64: true, fileName: 'swarmai-reply.mp3', mimeType: 'audio/mpeg' },
  });
  const pickVoice = code('Pick voice', "return { json: { voice: $('Ask SwarmAI brain').item.json.voice } };");
  const sendVoice = node('Send voice reply', 'n8n-nodes-base.telegram', 1.2, {
    resource: 'message', operation: 'sendAudio', binaryData: true, binaryPropertyName: 'data',
    chatId: "={{ $('Build brain request').item.json.chatId }}",
    additionalFields: { appendAttribution: false, title: 'SwarmAI', performer: 'SwarmAI' },
  }, { credentials: { telegramApi: CREDS.telegram } });
  writeFileSync(join(OUT, '01-telegram-channel.json'), JSON.stringify(workflow(IDS.telegram, 'SwarmAI – Telegram channel',
    [trigger, hasFile, toB64, build, ask, hasReply, reply, hasVoice, pickVoice, asFile, sendVoice],
    conn([
      ['Telegram Trigger', 'Has attachment?'],
      ['Has attachment?', 'Attachment → base64', 0],
      ['Has attachment?', 'Build brain request', 1],
      ['Attachment → base64', 'Build brain request'],
      ['Build brain request', 'Ask SwarmAI brain'],
      ['Ask SwarmAI brain', 'Has reply?'],
      ['Has reply?', 'Send reply', 0],
      ['Send reply', 'Voice reply?'],
      ['Voice reply?', 'Pick voice', 0],
      ['Pick voice', 'Voice reply → MP3'],
      ['Voice reply → MP3', 'Send voice reply'],
    ])), null, 2));
}

// ───────────────────────────────────────────── WhatsApp channel
x = 0;
{
  const trigger = node('WhatsApp Trigger', 'n8n-nodes-base.whatsAppTrigger', 1, { updates: ['messages'], options: {} }, {
    credentials: { whatsAppTriggerApi: CREDS.whatsappTrigger }, webhookId: randomUUID(),
  });
  const parse = code('Parse messages', `// One item per incoming user message (status updates are ignored).
const out = [];
for (const item of $input.all()) {
  const v = item.json;
  const val = v.entry?.[0]?.changes?.[0]?.value ?? v;
  const name = val.contacts?.[0]?.profile?.name ?? null;
  for (const msg of val.messages ?? []) {
    const media = msg.audio ?? msg.voice ?? msg.image ?? msg.document ?? null;
    const kind = msg.audio || msg.voice ? 'audio' : msg.image ? 'image' : msg.document ? 'document' : null;
    out.push({ json: {
      phone: msg.from,
      body: { channel: 'whatsapp', externalId: msg.from, to: val.metadata?.phone_number_id ?? null, displayName: name, messageId: msg.id,
              text: msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? null },
      mediaId: media?.id ?? '', mediaKind: kind, mediaMime: media?.mime_type ?? null, mediaName: msg.document?.filename ?? kind,
    } });
  }
}
return out;`, 'runOnceForAllItems');
  const hasMedia = ifNotEmpty('Has media?', '={{ $json.mediaId }}');
  const mediaUrl = node('Get media URL', 'n8n-nodes-base.whatsApp', 1.1, { resource: 'media', operation: 'mediaUrlGet', mediaGetId: '={{ $json.mediaId }}' }, {
    credentials: { whatsAppApi: CREDS.whatsapp },
  });
  const download = node('Download media', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET', url: '={{ $json.url }}', authentication: 'predefinedCredentialType', nodeCredentialType: 'whatsAppApi',
    options: { response: { response: { responseFormat: 'file' } }, timeout: 60000 },
  }, { credentials: { whatsAppApi: CREDS.whatsapp } });
  const toB64 = toBase64Property('Media → base64');
  const build = code('Build brain request', `const p = $('Parse messages').item.json;
const body = { ...p.body };
if ($json.data && p.mediaKind) body[p.mediaKind] = { data: $json.data, mime: p.mediaMime || 'application/octet-stream', name: p.mediaName || 'file' };
return { json: { phone: p.phone, body } };`);
  const ask = brainPost('Ask SwarmAI brain', '/api/channels/inbound', '={{ JSON.stringify($json.body) }}');
  const hasReply = ifNotEmpty('Has reply?', '={{ $json.reply }}');
  const reply = node('Send reply', 'n8n-nodes-base.whatsApp', 1.1, {
    resource: 'message', operation: 'send', phoneNumberId: '={{ $env.WHATSAPP_PHONE_NUMBER_ID }}',
    recipientPhoneNumber: "={{ $('Build brain request').item.json.phone }}", messageType: 'text', textBody: '={{ $json.reply }}', additionalFields: {},
  }, { credentials: { whatsAppApi: CREDS.whatsapp } });
  const hasVoice = ifNotEmpty('Voice reply?', "={{ $('Ask SwarmAI brain').item.json.voice }}");
  const pickVoice = code('Pick voice', "return { json: { voice: $('Ask SwarmAI brain').item.json.voice } };");
  const asFile = node('Voice reply → MP3', 'n8n-nodes-base.convertToFile', 1.1, {
    operation: 'toBinary', sourceProperty: 'voice', binaryPropertyName: 'data',
    options: { dataIsBase64: true, fileName: 'swarmai-reply.mp3', mimeType: 'audio/mpeg' },
  });
  const sendVoice = node('Send voice reply', 'n8n-nodes-base.whatsApp', 1.1, {
    resource: 'message', operation: 'send', phoneNumberId: '={{ $env.WHATSAPP_PHONE_NUMBER_ID }}',
    recipientPhoneNumber: "={{ $('Build brain request').item.json.phone }}", messageType: 'audio', mediaPath: 'useMedian8n', mediaPropertyName: 'data', additionalFields: {},
  }, { credentials: { whatsAppApi: CREDS.whatsapp } });
  writeFileSync(join(OUT, '02-whatsapp-channel.json'), JSON.stringify(workflow(IDS.whatsapp, 'SwarmAI – WhatsApp channel',
    [trigger, parse, hasMedia, mediaUrl, download, toB64, build, ask, hasReply, reply, hasVoice, pickVoice, asFile, sendVoice],
    conn([
      ['WhatsApp Trigger', 'Parse messages'],
      ['Parse messages', 'Has media?'],
      ['Has media?', 'Get media URL', 0],
      ['Has media?', 'Build brain request', 1],
      ['Get media URL', 'Download media'],
      ['Download media', 'Media → base64'],
      ['Media → base64', 'Build brain request'],
      ['Build brain request', 'Ask SwarmAI brain'],
      ['Ask SwarmAI brain', 'Has reply?'],
      ['Has reply?', 'Send reply', 0],
      ['Send reply', 'Voice reply?'],
      ['Voice reply?', 'Pick voice', 0],
      ['Pick voice', 'Voice reply → MP3'],
      ['Voice reply → MP3', 'Send voice reply'],
    ])), null, 2));
}

// ───────────────────────────────────────────── Scheduler (every minute → brain tick → deliver)
x = 0;
{
  const every = node('Every minute', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
  const tick = brainPost('Tick brain', '/api/automations/tick', '={{ JSON.stringify({}) }}', 60000);
  const split = node('One item per message', 'n8n-nodes-base.splitOut', 1, { fieldToSplitOut: 'deliveries', options: {} });
  const isTg = ifEquals('Telegram?', '={{ $json.channel }}', 'telegram');
  const sendTg = node('Send on Telegram', 'n8n-nodes-base.telegram', 1.2, {
    resource: 'message', operation: 'sendMessage', chatId: '={{ $json.chatId }}', text: '={{ $json.text }}',
    additionalFields: { appendAttribution: false, disable_web_page_preview: true },
  }, { credentials: { telegramApi: CREDS.telegram }, onError: 'continueErrorOutput' });
  const sendWa = node('Send on WhatsApp', 'n8n-nodes-base.whatsApp', 1.1, {
    resource: 'message', operation: 'send', phoneNumberId: '={{ $env.WHATSAPP_PHONE_NUMBER_ID }}',
    recipientPhoneNumber: '={{ $json.chatId }}', messageType: 'text', textBody: '={{ $json.text }}', additionalFields: {},
  }, { credentials: { whatsAppApi: CREDS.whatsapp }, onError: 'continueErrorOutput' });
  const ackSent = brainPost('Ack delivered', '/api/automations/ack', "={{ JSON.stringify({ sent: [$('One item per message').item.json.id] }) }}", 30000);
  const ackFail = brainPost('Ack failed', '/api/automations/ack',
    "={{ JSON.stringify({ failed: [{ id: $('One item per message').item.json.id, error: String($json.error?.message ?? $json.error ?? 'send failed').slice(0, 300) }] }) }}", 30000);
  writeFileSync(join(OUT, '03-scheduler.json'), JSON.stringify(workflow(IDS.scheduler, 'SwarmAI – Scheduler (reminders, briefs, alerts)',
    [every, tick, split, isTg, sendTg, sendWa, ackSent, ackFail],
    conn([
      ['Every minute', 'Tick brain'],
      ['Tick brain', 'One item per message'],
      ['One item per message', 'Telegram?'],
      ['Telegram?', 'Send on Telegram', 0],
      ['Telegram?', 'Send on WhatsApp', 1],
      ['Send on Telegram', 'Ack delivered', 0],
      ['Send on Telegram', 'Ack failed', 1],
      ['Send on WhatsApp', 'Ack delivered', 0],
      ['Send on WhatsApp', 'Ack failed', 1],
    ])), null, 2));
}

// ───────────────────────────────────────────── Channel tools exposed to the brain over MCP
x = 0;
{
  const trigger = node('MCP Server Trigger', '@n8n/n8n-nodes-langchain.mcpTrigger', 2, { authentication: 'bearerAuth', path: 'swarm-channels' }, {
    credentials: { httpBearerAuth: CREDS.mcpBearer }, webhookId: 'swarm-channels',
  });
  const tg = node('send_telegram_message', 'n8n-nodes-base.telegramTool', 1.2, {
    descriptionType: 'manual',
    toolDescription: "Send a Telegram message to the given chat id (the user's linked Telegram chat).",
    resource: 'message', operation: 'sendMessage',
    chatId: "={{ $fromAI('chatId', 'Telegram chat id', 'string') }}",
    text: "={{ $fromAI('text', 'Message text', 'string') }}",
    additionalFields: { appendAttribution: false },
  }, { credentials: { telegramApi: CREDS.telegram }, y: 500 });
  const wa = node('send_whatsapp_message', 'n8n-nodes-base.whatsAppTool', 1.1, {
    descriptionType: 'manual',
    toolDescription: "Send a WhatsApp text to the given phone number (the user's linked WhatsApp, international format without +).",
    resource: 'message', operation: 'send', phoneNumberId: '={{ $env.WHATSAPP_PHONE_NUMBER_ID }}',
    recipientPhoneNumber: "={{ $fromAI('chatId', 'WhatsApp phone number', 'string') }}",
    messageType: 'text', textBody: "={{ $fromAI('text', 'Message text', 'string') }}", additionalFields: {},
  }, { credentials: { whatsAppApi: CREDS.whatsapp }, y: 500 });
  writeFileSync(join(OUT, '04-channel-tools-mcp.json'), JSON.stringify(workflow(IDS.mcp, 'SwarmAI – Channel tools (MCP server)',
    [trigger, tg, wa],
    conn([
      ['send_telegram_message', 'MCP Server Trigger', 0, 'ai_tool'],
      ['send_whatsapp_message', 'MCP Server Trigger', 0, 'ai_tool'],
    ])), null, 2));
}

// ───────────────────────────────────────────── Error handler
x = 0;
{
  const trigger = node('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, {});
  const has = ifNotEmpty('Admin chat configured?', '={{ $env.SWARM_ADMIN_TELEGRAM_CHAT_ID }}');
  const notify = node('Notify admin on Telegram', 'n8n-nodes-base.telegram', 1.2, {
    resource: 'message', operation: 'sendMessage', chatId: '={{ $env.SWARM_ADMIN_TELEGRAM_CHAT_ID }}',
    text: "=⚠️ SwarmAI workflow failed\n{{ $('Error Trigger').item.json.workflow.name }} → {{ $('Error Trigger').item.json.execution.lastNodeExecuted }}\n{{ $('Error Trigger').item.json.execution.error.message }}\n{{ $('Error Trigger').item.json.execution.url }}",
    additionalFields: { appendAttribution: false, disable_web_page_preview: true },
  }, { credentials: { telegramApi: CREDS.telegram } });
  writeFileSync(join(OUT, '05-error-handler.json'), JSON.stringify(workflow(IDS.errors, 'SwarmAI – Error handler',
    [trigger, has, notify], conn([['Error Trigger', 'Admin chat configured?'], ['Admin chat configured?', 'Notify admin on Telegram', 0]])), null, 2));
}

console.log(`Workflows written to ${OUT}`);
