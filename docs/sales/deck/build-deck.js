// SwarmAI customer deck → ../SwarmAI-Customer-Deck.pptx
//   npm install && node build-deck.js            (run in this folder)
// Colours are theme (scheme) colours; they are written into the deck's theme by the pptx skill's apply_theme.js when
// PPTX_SKILL points at it. Without it the deck still builds, but PowerPoint shows its stock palette.
const pptxgen = require('pptxgenjs');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const fa = require('react-icons/fa6');
const path = require('path');
const applyTheme = process.env.PPTX_SKILL ? require(process.env.PPTX_SKILL + '/scripts/apply_theme.js').applyTheme : null;

const OUT = process.argv[2] || path.join(__dirname, '..', 'SwarmAI-Customer-Deck.pptx');
const SHOTS = path.join(__dirname, 'assets'); // admin-console screenshots (demo clinic)

const THEME = {
  name: 'SwarmAI',
  headFontFace: 'Calibri',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1C1917', lt1: 'FFFFFF', dk2: '0F4C47', lt2: 'F4F4F5',
    accent1: 'D97706', accent2: '0F766E', accent3: 'DC2626', accent4: '71717A', accent5: 'FDECC8', accent6: 'D5EFEC',
    hlink: '0F766E', folHlink: '71717A',
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625
pres.title = 'SwarmAI — AI customer desk on WhatsApp';
pres.author = 'SwarmAI';
pres.company = 'SwarmAI';
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ───────────── layouts
const footer = (dark) => [
  { text: { text: 'SwarmAI', options: { x: 0.5, y: 5.2, w: 3, h: 0.3, fontSize: 10, bold: true, color: dark ? C.accent1 : C.accent4, margin: 0 } } },
];
pres.defineSlideMaster({
  title: 'Dark title',
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 1.55, w: 8.8, h: 1.5, fontSize: 40, bold: true, color: C.background1, valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.6, y: 3.2, w: 8.4, h: 1.3, fontSize: 18, color: 'D6D3D1', valign: 'top', margin: 0 }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'Title only',
  background: { color: C.background1 },
  margin: [0.4, 0.5, 0.5, 0.5],
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 0.75, fontSize: 32, bold: true, color: C.text1, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
    ...footer(false),
  ],
  slideNumber: { x: 9.0, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: C.accent4, align: 'right' },
});

// ───────────── helpers
const iconCache = {};
async function icon(name, color = '#FFFFFF') {
  const key = name + color;
  if (!iconCache[key]) {
    const Ic = fa[name];
    if (!Ic) throw new Error('missing icon ' + name);
    const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Ic, { size: 256, color }));
    const buf = await sharp(Buffer.from(svg)).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    iconCache[key] = 'image/png;base64,' + buf.toString('base64');
  }
  return iconCache[key];
}
async function iconCircle(slide, name, x, y, d, fill = C.accent2, id = name) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: `circle-${id}` });
  const p = d * 0.25;
  slide.addImage({ data: await icon(name), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, objectName: `icon-${id}`, altText: '' });
}
const card = (slide, x, y, w, h, fill = C.background2, id = 'card') =>
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { type: 'none' }, objectName: id });
const text = (slide, t, o) => slide.addText(t, { isTextBox: true, margin: 0, valign: 'top', fontSize: 14, color: C.text1, ...o });
const shadow = () => ({ type: 'outer', color: '000000', opacity: 0.18, blur: 8, offset: 2, angle: 90 });
async function shot(file, crop) {
  const buf = await sharp(path.join(SHOTS, file)).extract(crop).png().toBuffer();
  return { data: 'image/png;base64,' + buf.toString('base64'), ratio: crop.width / crop.height };
}
function bullets(items, o = {}) {
  // items: [header, body]
  const runs = [];
  items.forEach(([h, b], i) => {
    runs.push({ text: h, options: { bold: true, fontSize: 15, color: C.text1, breakLine: true } });
    runs.push({ text: b, options: { fontSize: 13, color: C.accent4, paraSpaceAfter: 10, ...(i < items.length - 1 ? { breakLine: true } : {}) } });
  });
  return runs;
}

(async () => {
  // ═════════════ Introduction
  pres.addSection({ title: 'Introduction' });

  // 1 — title
  {
    const s = pres.addSlide({ masterName: 'Dark title', sectionTitle: 'Introduction' });
    s.addText('AI staff on WhatsApp that answers your customers — and knows when to call your team', { placeholder: 'title' });
    s.addText('Customer desk  ·  Knowledge base  ·  Team assistant', { placeholder: 'body' });
    await iconCircle(s, 'FaComments', 0.6, 0.55, 0.75, C.accent1, 'logo');
    text(s, 'SwarmAI', { x: 1.5, y: 0.7, w: 3, h: 0.45, fontSize: 22, bold: true, color: C.background1, valign: 'middle', objectName: 'brand' });
    s.addNotes('SwarmAI puts an AI assistant on the channels your customers already use — WhatsApp, Telegram and the web. It answers from your own documents, and the moment it is unsure, or the customer wants a person, it hands the chat to your team. Nothing that matters happens without a human OK.');
  }

  // 2 — problem
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Introduction' });
    s.addText('Your customers message you all day', { placeholder: 'title' });
    const items = [
      ['FaRotate', 'Same questions, every day', 'Timings, prices, “where is my order”, directions — your staff answer them again and again.'],
      ['FaClock', 'Messages after hours wait', 'A customer who writes at 10 pm hears back the next morning — or goes to a competitor.'],
      ['FaMobileScreen', 'Chats scattered on phones', 'Staff reply from personal phones. Nobody sees who answered what, or which chat is still open.'],
    ];
    for (let i = 0; i < 3; i++) {
      const x = 0.5 + i * 3.08;
      card(s, x, 1.35, 2.86, 2.85, C.background2, `problem-${i}`);
      await iconCircle(s, items[i][0], x + 0.3, 1.6, 0.62, C.accent3, `problem-${i}`);
      text(s, items[i][1], { x: x + 0.3, y: 2.4, w: 2.3, h: 0.6, fontSize: 17, bold: true, objectName: `problem-h-${i}` });
      text(s, items[i][2], { x: x + 0.3, y: 3.0, w: 2.3, h: 1.1, fontSize: 13, color: C.accent4, objectName: `problem-b-${i}` });
    }
    text(s, 'The result: slow replies, tired staff and leads that never come back.', { x: 0.5, y: 4.45, w: 9, h: 0.4, fontSize: 16, italic: true, color: C.text2, objectName: 'problem-result' });
    s.addNotes('Ask the customer how many WhatsApp messages they get a day, how many are repeat questions, and what happens to messages that arrive after hours.');
  }

  // 3 — meet SwarmAI
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Introduction' });
    s.addText('Meet SwarmAI', { placeholder: 'title' });
    text(s, 'A team of AI agents that works on the channels your customers already use — and always lets your people take over.', { x: 0.5, y: 1.35, w: 3.6, h: 2.0, fontSize: 21, color: C.text2, bold: true, objectName: 'meet-lead' });
    const chips = [['FaWhatsapp', 'WhatsApp'], ['FaTelegram', 'Telegram'], ['FaGlobe', 'Web app'], ['FaMicrophone', 'Voice notes']];
    for (let i = 0; i < 4; i++) {
      const x = 0.5 + (i % 2) * 1.8, y = 3.6 + Math.floor(i / 2) * 0.62;
      card(s, x, y, 1.7, 0.5, C.accent6, `chip-${i}`);
      s.addImage({ data: await icon(chips[i][0], '#' + HEX.accent2), x: x + 0.13, y: y + 0.12, w: 0.26, h: 0.26, objectName: `chip-icon-${i}`, altText: '' });
      text(s, chips[i][1], { x: x + 0.47, y, w: 1.2, h: 0.5, fontSize: 12, bold: true, color: C.text2, valign: 'middle', objectName: `chip-t-${i}` });
    }
    const pillars = [
      ['FaHeadset', 'Customer desk', 'Answers customers 24×7 on WhatsApp and Telegram, and hands the chat to your team when needed.'],
      ['FaBookOpen', 'Knowledge base', 'Learns from your PDFs, Word files, web pages and FAQs — and quotes them, not the internet.'],
      ['FaUserTie', 'Team assistant', 'Email, calendar, tasks, reminders, expenses and research for your own staff.'],
    ];
    for (let i = 0; i < 3; i++) {
      const y = 1.35 + i * 1.22;
      card(s, 4.5, y, 5.0, 1.07, C.background2, `pillar-${i}`);
      await iconCircle(s, pillars[i][0], 4.72, y + 0.23, 0.6, C.accent2, `pillar-${i}`);
      text(s, pillars[i][1], { x: 5.55, y: y + 0.13, w: 3.8, h: 0.35, fontSize: 16, bold: true, objectName: `pillar-h-${i}` });
      text(s, pillars[i][2], { x: 5.55, y: y + 0.47, w: 3.8, h: 0.55, fontSize: 12, color: C.accent4, objectName: `pillar-b-${i}` });
    }
    s.addNotes('Three products on one platform. Most customers start with the customer desk plus the knowledge base; the team assistant is an add-on for owners and staff.');
  }

  // ═════════════ Product
  pres.addSection({ title: 'Product' });

  // 4 — flow
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('How a customer conversation flows', { placeholder: 'title' });
    const steps = [
      ['FaCommentDots', 'Customer writes', 'On WhatsApp or Telegram — text or voice note, in their own language.', C.accent2],
      ['FaBookOpen', 'Bot answers', 'From your documents, naming the source. If it isn’t there, it says so.', C.accent2],
      ['FaTriangleExclamation', 'Hands over', 'Customer asks for a person, is upset, wants a refund or booking — or the answer isn’t known.', C.accent1],
      ['FaHeadset', 'Team replies', 'Staff get an alert with a summary and reply from the Inbox, on the customer’s own chat.', C.accent1],
      ['FaRotate', 'Bot resumes', 'One click hands the chat back. The bot knows what your team said.', C.accent2],
    ];
    for (let i = 0; i < 5; i++) {
      const x = 0.5 + i * 1.84;
      await iconCircle(s, steps[i][0], x + 0.5, 1.4, 0.7, steps[i][3], `step-${i}`);
      if (i < 4) s.addShape(pres.shapes.LINE, { x: x + 1.3, y: 1.75, w: 1.0, h: 0, line: { color: C.accent4, width: 1.25, dashType: 'dash', endArrowType: 'triangle' }, objectName: `arrow-${i}` });
      text(s, `${i + 1}. ${steps[i][1]}`, { x, y: 2.3, w: 1.7, h: 0.4, fontSize: 15, bold: true, align: 'center', objectName: `step-h-${i}` });
      text(s, steps[i][2], { x: x + 0.02, y: 2.75, w: 1.66, h: 1.45, fontSize: 12, color: C.accent4, align: 'center', objectName: `step-b-${i}` });
    }
    card(s, 0.5, 4.35, 9, 0.6, C.accent5, 'flow-note');
    text(s, 'While a person is handling the chat, the bot stays silent — your customer never gets two answers.', { x: 0.75, y: 4.35, w: 8.5, h: 0.6, fontSize: 14, valign: 'middle', color: C.text1, objectName: 'flow-note-t' });
    s.addNotes('This is the core loop. Steps 1–2 handle the repeat questions automatically. Steps 3–5 are what makes it safe: the bot knows its limits and your team stays in charge.');
  }

  // 5 — desk screenshot
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('The customer desk in action', { placeholder: 'title' });
    s.addText(bullets([
      ['Answers in the customer’s language', 'English, Hindi, Hinglish — text or voice notes.'],
      ['Hands over with a summary', 'Your team sees why the customer needs a person.'],
      ['Quiet while your team replies', 'Then picks up exactly where they left off.'],
      ['Test before you go live', '“Test as a customer” runs the full flow in the browser.'],
    ]), { isTextBox: true, x: 0.5, y: 1.3, w: 3.3, h: 3.75, valign: 'top', margin: 0, objectName: 'desk-points' });
    const img = await shot('a-desk.png', { left: 296, top: 208, width: 992, height: 687 });
    const w = 5.5, h = w / img.ratio;
    s.addImage({ data: img.data, x: 4.0, y: 1.3, w, h, shadow: shadow(), objectName: 'desk-shot', altText: 'Customer desk settings and the test-as-a-customer chat, showing a staff reply and the bot resuming' });
    s.addNotes('Screenshot from the admin console with a demo dental clinic. On the right, a staff member answered a refund question, handed the chat back, and the bot answered the follow-up using what the staff member said.');
  }

  // 6 — knowledge / RAG
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('Answers only from your documents', { placeholder: 'title' });
    const steps = [
      ['FaFileLines', 'Add your content', 'PDF, Word, web pages, or paste your FAQs and price list.'],
      ['FaMagnifyingGlass', 'Searched by meaning', '“kitna lagega cleaning ka” finds “Teeth cleaning: ₹1,500”.'],
      ['FaCircleCheck', 'Answer with the source', 'Every answer names the document and page.'],
      ['FaHandshake', 'No guessing', 'Not in your documents? It says so and hands over.'],
    ];
    for (let i = 0; i < 4; i++) {
      const y = 1.3 + i * 0.93;
      await iconCircle(s, steps[i][0], 0.5, y + 0.05, 0.55, i === 3 ? C.accent1 : C.accent2, `kb-${i}`);
      text(s, steps[i][1], { x: 1.25, y, w: 2.85, h: 0.32, fontSize: 15, bold: true, objectName: `kb-h-${i}` });
      text(s, steps[i][2], { x: 1.25, y: y + 0.33, w: 2.85, h: 0.55, fontSize: 12, color: C.accent4, objectName: `kb-b-${i}` });
    }
    const img = await shot('a-knowledge.png', { left: 296, top: 188, width: 992, height: 538 });
    const w = 5.2, h = w / img.ratio;
    s.addImage({ data: img.data, x: 4.3, y: 1.3, w, h, shadow: shadow(), objectName: 'kb-shot', altText: 'Knowledge page: upload files, add a web page, and test a question with matching passages' });
    text(s, '“Test a question” shows exactly which passages the bot will use — before any customer asks.', { x: 4.3, y: 1.3 + h + 0.2, w: 5.2, h: 0.6, fontSize: 12, italic: true, color: C.accent4, objectName: 'kb-caption' });
    s.addNotes('Technically this is retrieval-augmented generation (RAG): documents are split into passages, embedded, stored in a vector index per organisation, and the most relevant passages are given to the model with an instruction to answer only from them and cite them. Scanned image-only PDFs need OCR first.');
  }

  // 7 — team assistant
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('An assistant for your team, too', { placeholder: 'title' });
    const agents = [
      ['FaEnvelope', 'Email', 'Read, summarise, draft, reply'],
      ['FaCalendarDays', 'Calendar', 'Agenda, free slots, invites'],
      ['FaBookOpen', 'Knowledge', 'Your documents, cited'],
      ['FaMagnifyingGlass', 'Research', 'Web and news, with sources'],
      ['FaListCheck', 'Tasks & contacts', 'To-dos, Google Sheet sync'],
      ['FaWallet', 'Expenses', 'Log from a receipt photo'],
      ['FaBell', 'Reminders', 'On WhatsApp, Telegram, web'],
      ['FaNoteSticky', 'Notes & memory', 'Remembers preferences'],
      ['FaPlane', 'Travel', 'Flights, hotels, trip plans'],
      ['FaCartShopping', 'Shopping', 'Price compare, drop alerts'],
      ['FaFileLines', 'Documents', 'Summarise, extract, translate'],
      ['FaPlus', 'Your own agents', 'Built in the admin console'],
    ];
    for (let i = 0; i < 12; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 0.5 + col * 2.28, y = 1.25 + row * 0.86;
      const custom = i === 11;
      card(s, x, y, 2.16, 0.74, custom ? C.accent5 : C.background2, `agent-${i}`);
      await iconCircle(s, agents[i][0], x + 0.12, y + 0.15, 0.44, custom ? C.accent1 : C.accent2, `agent-${i}`);
      text(s, agents[i][1], { x: x + 0.66, y: y + 0.1, w: 1.45, h: 0.3, fontSize: 13, bold: true, objectName: `agent-h-${i}` });
      text(s, agents[i][2], { x: x + 0.66, y: y + 0.39, w: 1.45, h: 0.3, fontSize: 10, color: C.accent4, objectName: `agent-b-${i}` });
    }
    card(s, 0.5, 3.92, 9, 1.05, C.text2, 'auto-band');
    await iconCircle(s, 'FaClock', 0.75, 4.15, 0.6, C.accent1, 'auto');
    text(s, 'It works without being asked', { x: 1.55, y: 4.07, w: 7.7, h: 0.35, fontSize: 15, bold: true, color: C.background1, objectName: 'auto-h' });
    text(s, 'Morning brief · urgent-mail alerts · meeting prep · follow-up nudges · price-drop alerts · weekly review — delivered on WhatsApp or Telegram.', { x: 1.55, y: 4.42, w: 7.7, h: 0.5, fontSize: 12, color: 'E7E5E4', objectName: 'auto-b' });
    s.addNotes('One message can use several agents at once: “log ₹450 lunch, remind me at 5 to call Ravi, and what’s the weather in Pune tomorrow”. Email and calendar connect per person to their own Google account.');
  }

  // 8 — control
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('You stay in control', { placeholder: 'title' });
    const items = [
      ['FaCircleCheck', 'Approval before action', 'Sending email, deleting, or any tool you choose waits for a person to approve.'],
      ['FaShieldHalved', 'Customers stay in their lane', 'Customer chats can only use safe tools — never your mailbox, tasks or files.'],
      ['FaUserGroup', 'Roles for your team', 'Owner, admin, agent and member. Invite links that expire after 7 days.'],
      ['FaClipboardList', 'Full audit log', 'Every action, take-over and reply is recorded and searchable.'],
      ['FaBuilding', 'Your data, kept separate', 'Documents and conversations are isolated per organisation.'],
      ['FaKey', 'Your own AI account', 'Optionally use your own OpenAI key, stored encrypted.'],
    ];
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3);
      const x = 0.5 + col * 3.08, y = 1.3 + row * 1.88;
      card(s, x, y, 2.86, 1.7, C.background2, `ctl-${i}`);
      await iconCircle(s, items[i][0], x + 0.25, y + 0.25, 0.52, C.accent2, `ctl-${i}`);
      text(s, items[i][1], { x: x + 0.9, y: y + 0.25, w: 1.85, h: 0.55, fontSize: 14, bold: true, valign: 'middle', objectName: `ctl-h-${i}` });
      text(s, items[i][2], { x: x + 0.25, y: y + 0.9, w: 2.45, h: 0.75, fontSize: 12, color: C.accent4, objectName: `ctl-b-${i}` });
    }
    s.addNotes('The biggest objection is “what if the AI does something wrong?”. Answer: anything with a side effect is a proposal a human approves, customers physically cannot reach internal tools, and every action is logged.');
  }

  // 9 — hosting
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('Always on, safely hosted', { placeholder: 'title' });
    const stages = [
      ['FaUserGroup', 'Customers & team', 'WhatsApp, Telegram and the web app — from any phone or browser.', C.accent4],
      ['FaLock', 'One secure entrance', 'Encrypted HTTPS only. Nothing else on the server is reachable from the internet.', C.accent1],
      ['FaRobot', 'SwarmAI', 'AI agents, workflows and your data on a private network inside the server.', C.accent2],
      ['FaShieldHalved', 'Backups & alerts', 'Every night, kept 14 days. Your team is told on Telegram if anything fails.', C.accent2],
    ];
    for (let i = 0; i < 4; i++) {
      const x = 0.5 + i * 2.32;
      card(s, x, 1.3, 2.0, 2.15, C.background2, `host-${i}`);
      await iconCircle(s, stages[i][0], x + 0.7, 1.45, 0.6, stages[i][3], `host-${i}`);
      text(s, stages[i][1], { x: x + 0.12, y: 2.15, w: 1.76, h: 0.35, fontSize: 14, bold: true, align: 'center', objectName: `host-h-${i}` });
      text(s, stages[i][2], { x: x + 0.15, y: 2.52, w: 1.7, h: 0.88, fontSize: 11, color: C.accent4, align: 'center', objectName: `host-b-${i}` });
      if (i < 3) s.addShape(pres.shapes.LINE, { x: x + 2.03, y: 2.37, w: 0.26, h: 0, line: { color: C.accent4, width: 1.5, endArrowType: 'triangle' }, objectName: `host-arrow-${i}` });
    }
    const points = [
      ['FaClock', 'Runs 24×7', 'In the cloud — restarts itself after a crash or reboot. Your laptop can be off.'],
      ['FaKey', 'Invite-only access', 'Only people you invite can create an account on your SwarmAI.'],
      ['FaBuilding', 'Or in your own cloud', 'The same setup runs on your server with your own AI account.'],
    ];
    for (let i = 0; i < 3; i++) {
      const x = 0.5 + i * 3.08;
      card(s, x, 3.7, 2.86, 1.25, C.accent5, `hostpt-${i}`);
      await iconCircle(s, points[i][0], x + 0.2, 3.9, 0.46, C.accent1, `hostpt-${i}`);
      text(s, points[i][1], { x: x + 0.78, y: 3.85, w: 1.95, h: 0.32, fontSize: 14, bold: true, objectName: `hostpt-h-${i}` });
      text(s, points[i][2], { x: x + 0.78, y: 4.17, w: 1.98, h: 0.72, fontSize: 11, color: C.text1, objectName: `hostpt-b-${i}` });
    }
    s.addNotes('How it is run: one cloud server with a single encrypted entrance; everything else (AI agents, workflow engine, database) is on a private network inside it. Containers restart automatically, health is checked continuously, the database is backed up every night and the team gets a Telegram message if a backup fails. Sign-up is invite-only on hosted servers. For clients who need it, the same setup runs in their own cloud with their own AI account.');
  }

  // 9b — admin
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('Set up without writing code', { placeholder: 'title' });
    const img = await shot('a-agents.png', { left: 296, top: 168, width: 992, height: 682 });
    const w = 5.2, h = w / img.ratio;
    s.addImage({ data: img.data, x: 0.5, y: 1.3, w, h, shadow: shadow(), objectName: 'admin-shot', altText: 'Admin console agents page with on/off switches and per-agent settings' });
    const items = [
      'Switch agents on or off',
      'Add house rules: tone, language, what never to say',
      'Choose models and which tools need approval',
      'Create your own agents',
      'Apply an industry pack in one click',
      'Invite your team and set roles',
      'See usage, approvals and the audit log',
    ];
    for (let i = 0; i < items.length; i++) {
      const y = 1.35 + i * 0.52;
      s.addImage({ data: await icon('FaCircleCheck', '#' + HEX.accent2), x: 6.05, y: y + 0.07, w: 0.26, h: 0.26, objectName: `admin-check-${i}`, altText: '' });
      text(s, items[i], { x: 6.45, y, w: 3.05, h: 0.45, fontSize: 13, valign: 'middle', objectName: `admin-item-${i}` });
    }
    s.addNotes('Everything a client changes later — greeting, hand-over message, instructions, documents — is done in the admin console. Changes reach the bot within about 30 seconds.');
  }

  // 10 — packs
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Product' });
    s.addText('Ready-made industry packs', { placeholder: 'title' });
    text(s, 'AVAILABLE NOW', { x: 0.5, y: 1.25, w: 4, h: 0.3, fontSize: 11, bold: true, color: C.accent2, charSpacing: 2, objectName: 'packs-now' });
    const now = [
      ['FaHeadset', 'WhatsApp Support Desk', 'Product, order and policy questions answered from your documents. Complaints, refunds and cancellations go straight to your team with the order details collected.'],
      ['FaTooth', 'Clinic Front Desk', 'Timings, fees, doctors and test preparation. Never gives medical advice. Appointment requests go to the front desk; emergencies get the 112 message.'],
    ];
    for (let i = 0; i < 2; i++) {
      const y = 1.6 + i * 1.72;
      card(s, 0.5, y, 5.1, 1.56, C.accent6, `pack-${i}`);
      await iconCircle(s, now[i][0], 0.72, y + 0.22, 0.6, C.accent2, `pack-${i}`);
      text(s, now[i][1], { x: 1.5, y: y + 0.18, w: 3.95, h: 0.35, fontSize: 16, bold: true, objectName: `pack-h-${i}` });
      text(s, now[i][2], { x: 1.5, y: y + 0.55, w: 3.95, h: 0.95, fontSize: 12, color: C.text1, objectName: `pack-b-${i}` });
    }
    text(s, 'ON THE ROADMAP', { x: 6.0, y: 1.25, w: 3.5, h: 0.3, fontSize: 11, bold: true, color: C.accent4, charSpacing: 2, objectName: 'packs-next' });
    const next = [
      ['FaBullhorn', 'Sales & leads'], ['FaMoneyBillWave', 'Collections'], ['FaUserTie', 'HR & hiring'],
      ['FaHouse', 'Real estate'], ['FaGraduationCap', 'Education'], ['FaBoxOpen', 'D2C commerce'],
    ];
    for (let i = 0; i < 6; i++) {
      const y = 1.6 + i * 0.555;
      card(s, 6.0, y, 3.5, 0.45, C.background2, `next-${i}`);
      s.addImage({ data: await icon(next[i][0], '#' + HEX.accent4), x: 6.17, y: y + 0.1, w: 0.25, h: 0.25, objectName: `next-icon-${i}`, altText: '' });
      text(s, next[i][1], { x: 6.6, y, w: 2.8, h: 0.45, fontSize: 13, valign: 'middle', color: C.text1, objectName: `next-t-${i}` });
    }
    s.addNotes('A pack is a preset: agents, instructions, greeting and hand-over rules for an industry. We load your documents on top and tune it during the pilot. Roadmap packs are built on request with the first client in that industry.');
  }

  // ═════════════ Working together
  pres.addSection({ title: 'Working together' });

  // 11 — rollout
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Working together' });
    s.addText('Live in four weeks', { placeholder: 'title' });
    const weeks = [
      ['Week 1', 'Discover & load', 'Your top questions, hand-over rules and documents go into the knowledge base.'],
      ['Week 2', 'Configure & test', 'Greeting, tone and pack set up. Your team tests as customers.'],
      ['Week 3', 'Soft launch', 'Live on your WhatsApp number. Your team handles hand-overs from the Inbox.'],
      ['Week 4', 'Review & go live', 'We review the numbers together, fill knowledge gaps and switch fully on.'],
    ];
    s.addShape(pres.shapes.LINE, { x: 0.85, y: 1.62, w: 6.9, h: 0, line: { color: C.accent4, width: 1.5 }, objectName: 'timeline' });
    for (let i = 0; i < 4; i++) {
      const x = 0.5 + i * 2.3;
      s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: 1.47, w: 0.3, h: 0.3, fill: { color: i === 3 ? C.accent1 : C.accent2 }, line: { color: C.background1, width: 2 }, objectName: `dot-${i}` });
      text(s, weeks[i][0], { x, y: 1.9, w: 2.1, h: 0.3, fontSize: 12, bold: true, color: i === 3 ? C.accent1 : C.accent2, objectName: `wk-${i}` });
      text(s, weeks[i][1], { x, y: 2.2, w: 2.1, h: 0.35, fontSize: 16, bold: true, objectName: `wk-h-${i}` });
      text(s, weeks[i][2], { x, y: 2.6, w: 2.05, h: 0.95, fontSize: 12, color: C.accent4, objectName: `wk-b-${i}` });
    }
    text(s, 'WHAT WE MEASURE', { x: 0.5, y: 3.75, w: 4, h: 0.3, fontSize: 11, bold: true, color: C.accent4, charSpacing: 2, objectName: 'kpi-label' });
    const kpis = ['Questions answered by the bot', 'First-reply time', 'Chats handed to your team', 'Customer satisfaction'];
    for (let i = 0; i < 4; i++) {
      const x = 0.5 + i * 2.3;
      card(s, x, 4.1, 2.15, 0.75, C.accent5, `kpi-${i}`);
      text(s, kpis[i], { x: x + 0.15, y: 4.1, w: 1.85, h: 0.75, fontSize: 13, bold: true, valign: 'middle', objectName: `kpi-t-${i}` });
    }
    s.addNotes('You provide: your FAQs, price list and policies; a WhatsApp Business number verified with Meta; and one or two staff for the Inbox. We agree the target numbers in week 1.');
  }

  // 12 — pricing
  {
    const s = pres.addSlide({ masterName: 'Title only', sectionTitle: 'Working together' });
    s.addText('Simple, predictable pricing', { placeholder: 'title' });
    const plans = [
      ['Starter', '₹4,999', '/month', ['1 channel (WhatsApp or Telegram)', '3 team seats', '500 customer chats / month', '50 documents', 'Email support'], false],
      ['Growth', '₹12,999', '/month', ['WhatsApp + Telegram + web', '10 team seats', '3,000 customer chats / month', 'Industry pack + custom agents', 'Team assistant for staff'], true],
      ['Enterprise', 'Custom', '', ['Unlimited seats and chats', 'Your own cloud or server', 'Your own AI account and keys', 'Custom integrations', 'Priority support'], false],
    ];
    for (let i = 0; i < 3; i++) {
      const [name, price, per, feats, hi] = plans[i];
      const x = 0.5 + i * 3.08;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.25, w: 2.86, h: 3.4, rectRadius: 0.12, fill: { color: hi ? C.text2 : C.background2 }, line: { type: 'none' }, shadow: hi ? shadow() : undefined, objectName: `plan-${i}` });
      text(s, name, { x: x + 0.25, y: 1.42, w: 2.4, h: 0.35, fontSize: 16, bold: true, color: hi ? C.accent5 : C.text1, objectName: `plan-name-${i}` });
      text(s, [
        { text: price, options: { fontSize: 30, bold: true, color: hi ? C.background1 : C.text1 } },
        { text: per ? ' ' + per : '', options: { fontSize: 12, color: hi ? 'E7E5E4' : C.accent4 } },
      ], { x: x + 0.25, y: 1.8, w: 2.4, h: 0.6, valign: 'middle', objectName: `plan-price-${i}` });
      text(s, feats.map((f, j) => ({ text: f, options: { bullet: { indent: 12 }, paraSpaceAfter: 4, ...(j < feats.length - 1 ? { breakLine: true } : {}) } })),
        { x: x + 0.25, y: 2.55, w: 2.45, h: 2.0, fontSize: 12, color: hi ? C.background1 : C.text1, objectName: `plan-feats-${i}` });
    }
    text(s, 'All plans are hosted 24×7 with HTTPS and nightly backups. One-time setup from ₹25,000 per pack. WhatsApp charges from Meta are billed at cost. Prices exclude GST and are indicative — the final quote follows the discovery call.',
      { x: 0.5, y: 4.75, w: 9, h: 0.45, fontSize: 10, color: C.accent4, objectName: 'pricing-note' });
    s.addNotes('Indicative prices — confirm before sending. A pilot can be offered as the setup fee plus the first month at Starter price.');
  }

  // 13 — close
  {
    const s = pres.addSlide({ masterName: 'Dark title', sectionTitle: 'Working together' });
    s.addText('Let’s start with a 4-week pilot', { placeholder: 'title' });
    s.addText('1.  A 30-minute call about your customers’ top questions\n2.  You share your FAQs, price list and policies\n3.  Within a week, you test SwarmAI on your own data', { placeholder: 'body' });
    text(s, '[Your name]  ·  [email]  ·  [phone]', { x: 0.6, y: 4.65, w: 8.8, h: 0.4, fontSize: 14, color: C.accent1, bold: true, objectName: 'contact' });
    s.addNotes('Replace the contact line before sending.');
  }

  await pres.writeFile({ fileName: OUT });
  if (applyTheme) await applyTheme(OUT, THEME);
  else console.warn('PPTX_SKILL not set: theme colours not applied');
  console.log('wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
