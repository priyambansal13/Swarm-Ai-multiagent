#!/usr/bin/env node
/**
 * SwarmAI setup & run tool — works the same on Windows, macOS and Linux (Node.js 20+, no dependencies).
 *
 *   node scripts/swarm.mjs [command] [flags]
 *
 * Commands
 *   setup     (default) prerequisites → configure keys → Docker → install & build → n8n → start → verify
 *   configure only the interactive configuration of .env files (keys, tokens, secrets)
 *   n8n       (re)build, import and publish the n8n workflows + credentials
 *   start     start brain (:4200) and web (:3200) in the background
 *   stop      stop brain, web and the Cloudflare tunnel started by this tool
 *   restart   stop + start
 *   status    show what is running
 *   doctor    check prerequisites, configuration and health
 *   server-env <domain>   (your computer) write the production server's env files into .swarm/server/
 *   deploy    (on the server) build + start all containers behind Caddy, import n8n workflows, register webhooks
 *
 * Flags
 *   --yes        non-interactive: keep existing values, read new ones from environment variables
 *   --no-build   skip pnpm install/build      --no-start   don't start brain/web at the end
 *   --tunnel     start a Cloudflare quick tunnel and use it as n8n's public URL (Telegram/WhatsApp webhooks)
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────── basics
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  rootEnv: join(ROOT, '.env'), rootEnvEx: join(ROOT, '.env.example'),
  brain: join(ROOT, 'brain'), brainEnv: join(ROOT, 'brain', '.env'), brainEnvEx: join(ROOT, 'brain', '.env.example'),
  web: join(ROOT, 'web'), webEnv: join(ROOT, 'web', '.env.local'), webEnvEx: join(ROOT, 'web', '.env.example'),
  run: join(ROOT, '.swarm', 'run'), logs: join(ROOT, '.swarm', 'logs'),
  workflows: join(ROOT, 'n8n', 'workflows'),
};
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const OS_NAME = IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const command = args.find((a) => !a.startsWith('--')) ?? 'setup';
const YES = flag('--yes') || !process.stdin.isTTY;

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31), cyan = c(36);
const ok = (m) => console.log(`  ${green('✔')} ${m}`);
const warn = (m) => console.log(`  ${yellow('!')} ${m}`);
const fail = (m) => console.log(`  ${red('✖')} ${m}`);
const info = (m) => console.log(`  ${dim('·')} ${m}`);
const step = (n, m) => console.log(`\n${bold(cyan(`[${n}]`))} ${bold(m)}`);
const die = (m) => {
  fail(m);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = (n = 32) => randomBytes(n).toString('base64url');

/** Windows needs a shell only for .cmd shims (pnpm/npm/corepack); everything else runs without one so arguments
 *  with spaces (paths, SQL) are passed through intact. */
const needsShell = (cmd) => IS_WIN && /^(pnpm|npm|npx|corepack)$/i.test(cmd);

/** Run a command synchronously; returns { code, out }. */
function sh(cmd, cmdArgs = [], opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: opts.cwd ?? ROOT, encoding: 'utf8', shell: needsShell(cmd), env: { ...process.env, ...opts.env }, stdio: opts.inherit ? 'inherit' : 'pipe', windowsHide: true });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}
function mustRun(label, cmd, cmdArgs, opts = {}) {
  info(`${label}…`);
  const r = sh(cmd, cmdArgs, { ...opts, inherit: opts.inherit ?? false });
  if (r.code !== 0) {
    console.log(dim(r.out.split('\n').slice(-25).join('\n')));
    die(`${label} failed (${cmd} ${cmdArgs.join(' ')})`);
  }
  ok(label);
  return r.out;
}

// ───────────────────────────────────────────── .env files
function readEnv(file) {
  const map = {};
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return map;
}
/** Update keys in place (keeps comments/order); appends keys that don't exist yet. */
function writeEnv(file, updates) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const done = new Set();
  const outLines = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] in updates) {
      done.add(m[1]);
      return `${m[1]}=${updates[m[1]] ?? ''}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) outLines.push(`${k}=${v ?? ''}`);
  writeFileSync(file, outLines.join(os.EOL).replace(/(\r?\n)+$/, '') + os.EOL);
}
const PLACEHOLDER = /^(|change-me.*|dev-n8n-shared-secret|dev-mcp-token|sk-your.*|not-configured)$/;
const isSet = (v) => v != null && !PLACEHOLDER.test(String(v).trim());
function ensureEnvFile(file, example) {
  if (!existsSync(file)) {
    if (!existsSync(example)) die(`Missing ${example}`);
    writeFileSync(file, readFileSync(example, 'utf8'));
    ok(`created ${file.replace(ROOT, '.')}`);
  }
}

// ───────────────────────────────────────────── prompts
let rl;
function prompt(question, { hidden = false, def = '' } = {}) {
  if (YES) return Promise.resolve(def);
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((res) => {
    const shown = def ? (hidden ? ` ${dim('[keep current]')}` : ` ${dim(`[${def}]`)}`) : '';
    const q = `  ${question}${shown}: `;
    if (hidden) {
      // Print the question ourselves, then mask everything readline echoes (including line redraws).
      process.stdout.write(q);
      const orig = rl._writeToOutput;
      rl._writeToOutput = (str) => orig.call(rl, str.replace(/[^\r\n]/g, '•'));
      rl.question('', (a) => {
        rl._writeToOutput = orig;
        res(a.trim() || def);
      });
    } else rl.question(q, (a) => res(a.trim() || def));
  });
}
const yesNo = async (q, def = false) => {
  if (YES) return def;
  const a = (await prompt(`${q} (y/n)`, { def: def ? 'y' : 'n' })).toLowerCase();
  return a.startsWith('y');
};

// ───────────────────────────────────────────── network helpers
const portInUse = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => {
      s.destroy();
      res(true);
    });
    s.on('error', () => res(false));
    s.setTimeout(800, () => {
      s.destroy();
      res(false);
    });
  });
async function http(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout ?? 8000) });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: e.message };
  }
}
async function waitFor(label, fn, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return ok(label), true;
    await sleep(1500);
  }
  warn(`${label} — timed out after ${timeoutMs / 1000}s`);
  return false;
}

// ───────────────────────────────────────────── 1. prerequisites
function installHint(tool) {
  const hints = {
    node: { mac: 'brew install node@22   (or https://nodejs.org)', win: 'winget install OpenJS.NodeJS.LTS', linux: 'https://nodejs.org or your package manager (Node 20+)' },
    docker: { mac: 'Install Docker Desktop (https://docker.com/products/docker-desktop) or OrbStack: brew install --cask orbstack', win: 'winget install Docker.DockerDesktop   (enable WSL 2, then start Docker Desktop)', linux: 'https://docs.docker.com/engine/install/ and the compose plugin' },
    cloudflared: { mac: 'brew install cloudflared', win: 'winget install --id Cloudflare.cloudflared', linux: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/' },
  };
  const h = hints[tool];
  return IS_MAC ? h.mac : IS_WIN ? h.win : h.linux;
}

function prerequisites() {
  step(1, `Prerequisites (${OS_NAME} ${os.release()}, ${os.arch()})`);
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) die(`Node.js ${process.versions.node} found; 20+ required → ${installHint('node')}`);
  ok(`Node.js ${process.versions.node}`);

  let pnpm = sh('pnpm', ['--version']);
  if (pnpm.code !== 0) {
    warn('pnpm not found — installing');
    if (sh('corepack', ['enable', 'pnpm']).code !== 0 || sh('pnpm', ['--version']).code !== 0) {
      mustRun('npm install -g pnpm', 'npm', ['install', '-g', 'pnpm']);
    }
    pnpm = sh('pnpm', ['--version']);
    if (pnpm.code !== 0) die('Could not install pnpm. Install it manually: npm install -g pnpm');
  }
  ok(`pnpm ${pnpm.out.split('\n').at(-1)}`);

  const docker = sh('docker', ['version', '--format', '{{.Server.Version}}']);
  if (docker.code !== 0) {
    if (sh('docker', ['--version']).code === 0) die(`Docker is installed but not running — start ${IS_MAC || IS_WIN ? 'Docker Desktop' : 'the Docker daemon'} and re-run.`);
    die(`Docker not found → ${installHint('docker')}`);
  }
  ok(`Docker ${docker.out}`);
  const compose = sh('docker', ['compose', 'version', '--short']);
  if (compose.code !== 0) die('Docker Compose v2 not found (docker compose). Update Docker.');
  ok(`Docker Compose ${compose.out}`);
}

// ───────────────────────────────────────────── 2. configuration
const volumeExists = (name) => sh('docker', ['volume', 'inspect', name]).code === 0;
const projectName = () => (readEnv(P.rootEnv).COMPOSE_PROJECT_NAME || ROOT.split(/[\\/]/).pop()).toLowerCase().replace(/[^a-z0-9_-]/g, '');

async function validate(kind, v, extra = {}) {
  if (!isSet(v)) return null;
  if (kind === 'openai') {
    const r = await http('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${v}` } });
    return r.status === 200 ? { ok: true } : { ok: false, msg: `OpenAI rejected the key (HTTP ${r.status})` };
  }
  if (kind === 'telegram') {
    const r = await http(`https://api.telegram.org/bot${v}/getMe`);
    return r.json?.ok ? { ok: true, username: r.json.result.username } : { ok: false, msg: 'Telegram rejected the bot token' };
  }
  if (kind === 'serpapi') {
    const r = await http(`https://serpapi.com/account.json?api_key=${encodeURIComponent(v)}`);
    return r.status === 200 ? { ok: true, left: r.json?.total_searches_left } : { ok: false, msg: `SerpAPI rejected the key (HTTP ${r.status})` };
  }
  if (kind === 'whatsapp') {
    const r = await http(`https://graph.facebook.com/v21.0/${extra.phoneId}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(v)}`);
    return r.json?.display_phone_number ? { ok: true, number: r.json.display_phone_number, name: r.json.verified_name } : { ok: false, msg: `Meta rejected the token/phone number id (${r.json?.error?.message ?? r.status})` };
  }
  if (kind === 'google') return /\.apps\.googleusercontent\.com$/.test(v) ? { ok: true } : { ok: false, msg: 'Google client id should end with .apps.googleusercontent.com' };
  return { ok: true };
}

async function ask(label, current, { hidden = true, envName, required = false, kind, extra } = {}) {
  let value = process.env[envName ?? ''] && !isSet(current) ? process.env[envName] : current;
  for (;;) {
    const answer = await prompt(label, { hidden, def: isSet(value) ? value : '' });
    value = answer;
    if (!isSet(value)) {
      if (required && !YES) {
        warn('This one is required.');
        continue;
      }
      return '';
    }
    if (!kind) return value;
    const v = await validate(kind, value, typeof extra === 'function' ? extra() : extra);
    if (!v || v.ok) return Object.assign(new String(value), v ?? {});
    warn(v.msg);
    if (YES || !(await yesNo('Re-enter it?', true))) return value;
  }
}

async function configure() {
  step(2, 'Configuration (.env files)');
  ensureEnvFile(P.rootEnv, P.rootEnvEx);
  ensureEnvFile(P.brainEnv, P.brainEnvEx);
  ensureEnvFile(P.webEnv, P.webEnvEx);
  const root = readEnv(P.rootEnv);
  const brain = readEnv(P.brainEnv);
  const pj = projectName();
  const R = {}; // root updates
  const B = {}; // brain updates

  // Secrets that must match across files. Never rotate keys that protect existing data.
  if (!isSet(root.N8N_ENCRYPTION_KEY)) {
    if (volumeExists(`${pj}_swarm_n8n`)) warn('n8n already initialised with the default encryption key — keeping it (changing it would break saved credentials).');
    else R.N8N_ENCRYPTION_KEY = secret(32), ok('generated N8N_ENCRYPTION_KEY');
  }
  if (!isSet(brain.APP_SECRET)) B.APP_SECRET = secret(48), ok('generated APP_SECRET');
  const n8nToken = isSet(root.SWARM_N8N_TOKEN) ? root.SWARM_N8N_TOKEN : isSet(brain.SWARM_N8N_TOKEN) ? brain.SWARM_N8N_TOKEN : secret(24);
  const mcpToken = isSet(root.N8N_MCP_TOKEN) ? root.N8N_MCP_TOKEN : isSet(brain.N8N_MCP_TOKEN) ? brain.N8N_MCP_TOKEN : secret(24);
  Object.assign(R, { SWARM_N8N_TOKEN: n8nToken, N8N_MCP_TOKEN: mcpToken });
  Object.assign(B, { SWARM_N8N_TOKEN: n8nToken, N8N_MCP_TOKEN: mcpToken });

  const pgUser = root.POSTGRES_USER || 'swarm', pgPass = root.POSTGRES_PASSWORD || 'swarm', pgPort = root.POSTGRES_PORT || '5434';
  const n8nPort = root.N8N_PORT || '5678';
  B.DATABASE_URL = `postgres://${pgUser}:${pgPass}@localhost:${pgPort}/swarm`;
  B.N8N_MCP_URL = `http://localhost:${n8nPort}/mcp/swarm-channels`;
  R.SWARM_BRAIN_URL = root.SWARM_BRAIN_URL || 'http://host.docker.internal:4200';
  if (!root.TIMEZONE) R.TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone.replace('Asia/Calcutta', 'Asia/Kolkata') || 'Asia/Kolkata';

  console.log(dim('\n  Press Enter to keep the current value or skip an optional integration.'));
  console.log(bold('\n  OpenAI (required)'));
  const openai = await ask('OpenAI API key', brain.OPENAI_API_KEY, { envName: 'OPENAI_API_KEY', required: true, kind: 'openai' });
  if (!isSet(openai)) die('OPENAI_API_KEY is required (set it in brain/.env or export OPENAI_API_KEY and re-run).');
  B.OPENAI_API_KEY = String(openai);
  openai.ok ? ok('OpenAI key works') : warn('OpenAI key not verified');

  console.log(bold('\n  Google — Gmail, Calendar, Sheets  ') + dim('(docs/SETUP-INTEGRATIONS.md §1; redirect URI http://localhost:4200/api/google/callback)'));
  const gid = await ask('Google OAuth client ID', brain.GOOGLE_CLIENT_ID, { hidden: false, envName: 'GOOGLE_CLIENT_ID', kind: 'google' });
  B.GOOGLE_CLIENT_ID = String(gid || '');
  if (isSet(gid)) B.GOOGLE_CLIENT_SECRET = String(await ask('Google OAuth client secret', brain.GOOGLE_CLIENT_SECRET, { envName: 'GOOGLE_CLIENT_SECRET' }) || '');
  B.GOOGLE_REDIRECT_URI = brain.GOOGLE_REDIRECT_URI || 'http://localhost:4200/api/google/callback';

  console.log(bold('\n  SerpAPI — web search, flights, hotels, shopping  ') + dim('(https://serpapi.com)'));
  const serp = await ask('SerpAPI key', brain.SERPAPI_KEY, { envName: 'SERPAPI_KEY', kind: 'serpapi' });
  B.SERPAPI_KEY = String(serp || '');
  if (serp?.ok) ok(`SerpAPI key works${serp.left != null ? ` (${serp.left} searches left)` : ''}`);

  console.log(bold('\n  Telegram bot  ') + dim('(@BotFather → /newbot)'));
  const tg = await ask('Telegram bot token', root.TELEGRAM_BOT_TOKEN, { envName: 'TELEGRAM_BOT_TOKEN', kind: 'telegram' });
  R.TELEGRAM_BOT_TOKEN = String(tg || '');
  if (tg?.username) B.TELEGRAM_BOT_USERNAME = tg.username, ok(`Telegram bot @${tg.username}`);
  R.SWARM_ADMIN_TELEGRAM_CHAT_ID = await prompt('Your Telegram chat id for n8n error alerts (optional)', { def: root.SWARM_ADMIN_TELEGRAM_CHAT_ID || '' });

  console.log(bold('\n  WhatsApp Cloud API  ') + dim('(Meta for Developers → WhatsApp → API setup)'));
  const waPhone = await prompt('WhatsApp phone number ID', { def: root.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '' });
  R.WHATSAPP_PHONE_NUMBER_ID = waPhone;
  if (waPhone) {
    const waToken = await ask('WhatsApp access token', root.WHATSAPP_ACCESS_TOKEN, { envName: 'WHATSAPP_ACCESS_TOKEN', kind: 'whatsapp', extra: { phoneId: waPhone } });
    R.WHATSAPP_ACCESS_TOKEN = String(waToken || '');
    if (waToken?.number) B.WHATSAPP_DISPLAY_NUMBER = waToken.number, ok(`WhatsApp number ${waToken.number} (${waToken.name})`);
    R.WHATSAPP_BUSINESS_ACCOUNT_ID = await prompt('WhatsApp Business Account ID', { def: root.WHATSAPP_BUSINESS_ACCOUNT_ID || '' });
    R.META_APP_ID = await prompt('Meta App ID', { def: root.META_APP_ID || '' });
    R.META_APP_SECRET = String((await ask('Meta App secret', root.META_APP_SECRET, { envName: 'META_APP_SECRET' })) || '');
  }

  console.log(bold('\n  Optional extras'));
  B.YATRA_API_URL = await prompt('Yatra AI travel planner API URL (blank to disable)', { def: brain.YATRA_API_URL ?? 'http://localhost:4100' });
  const ls = await ask('LangSmith API key (tracing)', brain.LANGSMITH_API_KEY, { envName: 'LANGSMITH_API_KEY' });
  B.LANGSMITH_API_KEY = String(ls || '');
  B.LANGSMITH_TRACING = isSet(ls) ? 'true' : 'false';

  writeEnv(P.rootEnv, R);
  writeEnv(P.brainEnv, B);
  writeEnv(P.webEnv, { NEXT_PUBLIC_API_URL: readEnv(P.webEnv).NEXT_PUBLIC_API_URL || 'http://localhost:4200' });
  ok('wrote .env, brain/.env, web/.env.local');
}

// ───────────────────────────────────────────── 3. docker
async function docker() {
  step(3, 'Docker: PostgreSQL (pgvector) + n8n');
  mustRun('docker compose up -d', 'docker', ['compose', 'up', '-d']);
  await waitFor('PostgreSQL healthy', async () => sh('docker', ['inspect', '-f', '{{.State.Health.Status}}', 'swarm-db']).out === 'healthy');
  const port = readEnv(P.rootEnv).N8N_PORT || '5678';
  await waitFor(`n8n up on :${port}`, async () => (await http(`http://localhost:${port}/healthz`)).status === 200, 120_000);
}

// ───────────────────────────────────────────── 4. install & build
function build() {
  step(4, 'Install & build (brain, web)');
  const pnpmArgs = ['install', '--config.strict-dep-builds=false'];
  mustRun('brain: pnpm install', 'pnpm', pnpmArgs, { cwd: P.brain });
  mustRun('brain: build', 'pnpm', ['build'], { cwd: P.brain });
  mustRun('web: pnpm install', 'pnpm', pnpmArgs, { cwd: P.web });
  mustRun('web: build', 'pnpm', ['build'], { cwd: P.web });
}

// ───────────────────────────────────────────── 5. n8n workflows & credentials
async function n8n() {
  step(5, 'n8n: workflows + credentials');
  const env = readEnv(P.rootEnv);
  const container = env.N8N_CONTAINER || 'swarm-n8n';
  mustRun('generate workflows', process.execPath, [join(ROOT, 'n8n', 'build-workflows.mjs')]);
  const val = (k) => (isSet(env[k]) ? env[k] : 'not-configured');
  const creds = [
    { id: 'SwarmCredTelegram', name: 'SwarmAI Telegram bot', type: 'telegramApi', data: { accessToken: val('TELEGRAM_BOT_TOKEN'), baseUrl: 'https://api.telegram.org' } },
    { id: 'SwarmCredWhatsApp', name: 'SwarmAI WhatsApp Cloud API', type: 'whatsAppApi', data: { accessToken: val('WHATSAPP_ACCESS_TOKEN'), businessAccountId: val('WHATSAPP_BUSINESS_ACCOUNT_ID') } },
    { id: 'SwarmCredWaTrigger', name: 'SwarmAI WhatsApp webhook (Meta app)', type: 'whatsAppTriggerApi', data: { clientId: val('META_APP_ID'), clientSecret: val('META_APP_SECRET') } },
    { id: 'SwarmCredMcpBearer', name: 'SwarmAI MCP bearer token', type: 'httpBearerAuth', data: { token: val('N8N_MCP_TOKEN') } },
  ];
  const tmp = join(os.tmpdir(), `swarm-creds-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify(creds));
  try {
    mustRun('copy credentials', 'docker', ['cp', tmp, `${container}:/tmp/swarm-credentials.json`]);
  } finally {
    rmSync(tmp, { force: true });
  }
  sh('docker', ['exec', container, 'sh', '-c', 'rm -rf /tmp/swarm-workflows && mkdir -p /tmp/swarm-workflows']);
  for (const f of readdirSync(P.workflows).filter((f) => f.endsWith('.json'))) {
    if (sh('docker', ['cp', join(P.workflows, f), `${container}:/tmp/swarm-workflows/${f}`]).code !== 0) die(`could not copy ${f}`);
  }
  mustRun('import credentials', 'docker', ['exec', container, 'n8n', 'import:credentials', '--input=/tmp/swarm-credentials.json']);
  sh('docker', ['exec', '-u', 'root', container, 'rm', '-f', '/tmp/swarm-credentials.json']);
  mustRun('import workflows', 'docker', ['exec', container, 'n8n', 'import:workflow', '--separate', '--input=/tmp/swarm-workflows']);

  const publish = (id, label, when = true, why = '') => {
    if (!when) return warn(`${label}: not published (${why})`);
    sh('docker', ['exec', container, 'n8n', 'publish:workflow', `--id=${id}`]).code === 0 ? ok(`published ${label}`) : warn(`could not publish ${label}`);
  };
  const publicUrl = env.N8N_PUBLIC_URL || '';
  const hasPublic = /^https:\/\//.test(publicUrl);
  publish('SwarmErrors00001', 'Error handler');
  publish('SwarmScheduler01', 'Scheduler');
  publish('SwarmMcpTools001', 'Channel tools (MCP server)');
  publish('SwarmTelegram001', 'Telegram channel', isSet(env.TELEGRAM_BOT_TOKEN) && hasPublic, !isSet(env.TELEGRAM_BOT_TOKEN) ? 'no TELEGRAM_BOT_TOKEN' : 'N8N_PUBLIC_URL must be a public https URL (use --tunnel)');
  const telegram = isSet(env.TELEGRAM_BOT_TOKEN) && hasPublic;
  const whatsapp = isSet(env.WHATSAPP_ACCESS_TOKEN) && isSet(env.META_APP_ID) && isSet(env.META_APP_SECRET) && hasPublic;
  publish('SwarmWhatsApp001', 'WhatsApp channel', whatsapp,
    !isSet(env.WHATSAPP_ACCESS_TOKEN) || !isSet(env.META_APP_ID) ? 'WhatsApp/Meta credentials not set' : 'N8N_PUBLIC_URL must be a public https URL (use --tunnel)');
  // Meta allows one webhook per app: drop one that points at an old tunnel URL, or n8n refuses to activate the trigger.
  if (whatsapp) await metaWebhook(env, 'clean');
  const port = env.N8N_PORT || '5678';
  const restartN8n = async () => {
    mustRun('restart n8n (activates published workflows)', 'docker', ['compose', 'up', '-d', '--force-recreate', 'n8n']);
    await waitFor('n8n back up', async () => (await http(`http://localhost:${port}/healthz`)).status === 200, 120_000);
  };
  await restartN8n();
  // n8n 2.x activates published workflows from a queue a little after start-up, then registers their webhooks.
  if (telegram) {
    const tg = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`;
    await waitFor('Telegram webhook registered', async () => (await http(tg)).json?.result?.url?.startsWith(publicUrl), 120_000);
  }
  if (whatsapp && !(await metaWebhook(env, 'verify'))) {
    // n8n can register before its GET (challenge) webhook is live and Meta rejects it — one more restart fixes it.
    await restartN8n();
    if (!(await metaWebhook(env, 'verify'))) warn('WhatsApp webhook not registered with Meta — check n8n logs (docker logs swarm-n8n)');
  }
}

// WhatsApp: n8n's trigger registers the app webhook; the WhatsApp Business Account must also subscribe the app.
async function metaWebhook(env, mode) {
  const g = 'https://graph.facebook.com/v23.0';
  const appToken = encodeURIComponent(`${env.META_APP_ID}|${env.META_APP_SECRET}`);
  const subs = async () => (await http(`${g}/${env.META_APP_ID}/subscriptions?access_token=${appToken}`)).json?.data ?? [];
  const current = async () => (await subs()).find((s) => s.object === 'whatsapp_business_account' && s.active);
  if (mode === 'clean') {
    const s = await current();
    if (s && !s.callback_url.startsWith(env.N8N_PUBLIC_URL)) {
      const r = await http(`${g}/${env.META_APP_ID}/subscriptions?object=whatsapp_business_account&access_token=${appToken}`, { method: 'DELETE' });
      r.json?.success ? ok('removed WhatsApp webhook pointing at an old URL') : warn(`could not remove old WhatsApp webhook: ${r.text.slice(0, 160)}`);
    }
    return true;
  }
  const registered = await waitFor('WhatsApp webhook registered with Meta', async () => (await current())?.callback_url?.startsWith(env.N8N_PUBLIC_URL), 120_000);
  if (!registered) return false;
  const auth = { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } };
  const r = await http(`${g}/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`, { method: 'POST', ...auth });
  r.json?.success ? ok('WhatsApp Business Account subscribed to the app') : warn(`could not subscribe the app to the WhatsApp Business Account: ${r.text.slice(0, 160)}`);
  return true;
}

// ───────────────────────────────────────────── tunnel (public URL for webhooks)
async function tunnel() {
  step('+', 'Cloudflare quick tunnel for n8n webhooks');
  if (sh('cloudflared', ['--version']).code !== 0) return warn(`cloudflared not installed → ${installHint('cloudflared')}`);
  mkdirSync(P.logs, { recursive: true });
  const log = join(P.logs, 'tunnel.log');
  const port = readEnv(P.rootEnv).N8N_PORT || '5678';
  const old = readPid('tunnel');
  if (old) {
    killTree(old);
    ok(`stopped the previous tunnel (pid ${old})`);
  }
  rmSync(log, { force: true });
  const fd = openSync(log, 'a');
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  savePid('tunnel', child.pid);
  let url = null;
  await waitFor('tunnel URL', async () => {
    url = existsSync(log) ? readFileSync(log, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null : null;
    return !!url;
  }, 60_000);
  child.unref();
  if (!url) return;
  writeEnv(P.rootEnv, { N8N_PUBLIC_URL: `${url}/` });
  ok(`N8N_PUBLIC_URL=${url}/ (changes every time the quick tunnel restarts)`);
}

// ───────────────────────────────────────────── start / stop / status
const pidFile = (name) => join(P.run, `${name}.pid`);
function savePid(name, pid) {
  mkdirSync(P.run, { recursive: true });
  writeFileSync(pidFile(name), String(pid));
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function readPid(name) {
  if (!existsSync(pidFile(name))) return null;
  const pid = Number(readFileSync(pidFile(name), 'utf8'));
  return alive(pid) ? pid : null;
}
function killTree(pid) {
  if (IS_WIN) sh('taskkill', ['/PID', String(pid), '/T', '/F']);
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
  }
}

const SERVICES = {
  brain: { cwd: P.brain, port: 4200, cmd: [process.execPath, 'dist/main.js'], ready: 'http://localhost:4200/api/health', built: () => existsSync(join(P.brain, 'dist', 'main.js')) },
  web: { cwd: P.web, port: 3200, cmd: [process.execPath, join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', '3200'], ready: 'http://localhost:3200', built: () => existsSync(join(P.web, '.next', 'BUILD_ID')) },
};

async function start() {
  step(6, 'Start brain & web');
  mkdirSync(P.logs, { recursive: true });
  for (const [name, s] of Object.entries(SERVICES)) {
    if (readPid(name)) {
      ok(`${name} already running (pid ${readPid(name)})`);
      continue;
    }
    if (await portInUse(s.port)) {
      warn(`port ${s.port} is already in use — not starting ${name}. If it's an older SwarmAI ${name}, stop it and run: node scripts/swarm.mjs start`);
      continue;
    }
    if (!s.built()) {
      warn(`${name} is not built yet — run: node scripts/swarm.mjs setup`);
      continue;
    }
    // The detached child writes straight to its log file, so it keeps running after this script exits.
    const fd = openSync(join(P.logs, `${name}.log`), 'a');
    const child = spawn(s.cmd[0], s.cmd.slice(1), { cwd: s.cwd, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, NODE_ENV: 'production' } });
    closeSync(fd);
    child.unref();
    savePid(name, child.pid);
    await waitFor(`${name} on :${s.port}`, async () => (await http(s.ready)).status === 200, 90_000);
  }
}

function stop({ tunnel = true } = {}) {
  step('■', 'Stop');
  for (const name of tunnel ? ['web', 'brain', 'tunnel'] : ['web', 'brain']) {
    const pid = readPid(name);
    if (pid) {
      killTree(pid);
      ok(`stopped ${name} (pid ${pid})`);
    } else info(`${name} not running (started by this tool)`);
    rmSync(pidFile(name), { force: true });
  }
  info('Docker containers keep running — stop them with: docker compose stop');
}

async function status() {
  step('?', 'Status');
  const env = readEnv(P.rootEnv);
  const health = await http('http://localhost:4200/api/health');
  if (health.json) {
    ok(`brain :4200 — ${health.json.status}; db ${health.json.database}; LLM ${health.json.llm?.configured ? health.json.llm.model : 'not configured'}`);
    for (const [k, v] of Object.entries(health.json.integrations ?? {})) info(`${k}: ${v}`);
  } else fail('brain :4200 not reachable');
  (await http('http://localhost:3200')).status === 200 ? ok('web :3200') : fail('web :3200 not reachable');
  (await http(`http://localhost:${env.N8N_PORT || 5678}/healthz`)).status === 200 ? ok(`n8n :${env.N8N_PORT || 5678}`) : fail('n8n not reachable');
  const pg = sh('docker', ['inspect', '-f', '{{.State.Health.Status}}', 'swarm-db']).out;
  pg === 'healthy' ? ok('PostgreSQL healthy') : fail(`PostgreSQL: ${pg || 'not running'}`);
  const wf = sh('docker', ['exec', 'swarm-db', 'psql', '-U', env.POSTGRES_USER || 'swarm', '-d', 'n8n', '-At', '-c', 'select name, active from workflow_entity order by name;']);
  if (wf.code === 0) for (const line of wf.out.split('\n').filter(Boolean)) { const [n, a] = line.split('|'); (a === 't' ? ok : info)(`n8n workflow ${a === 't' ? 'active' : 'inactive'}: ${n}`); }
  const tun = readPid('tunnel');
  if (tun) ok(`tunnel running → ${env.N8N_PUBLIC_URL}`);
  console.log(`\n  ${bold('Open')}  web ${cyan('http://localhost:3200')} · Swagger ${cyan('http://localhost:4200/api/docs')} · n8n ${cyan(`http://localhost:${env.N8N_PORT || 5678}`)}`);
  if (existsSync(P.logs)) info(`logs: ${P.logs}`);
}

async function doctor() {
  prerequisites();
  step('✚', 'Configuration check');
  const root = readEnv(P.rootEnv), brain = readEnv(P.brainEnv), web = readEnv(P.webEnv);
  const chk = (cond, good, bad) => (cond ? ok(good) : warn(bad));
  chk(existsSync(P.rootEnv) && existsSync(P.brainEnv) && existsSync(P.webEnv), '.env files present', 'missing .env files — run setup');
  chk(isSet(brain.OPENAI_API_KEY), 'OPENAI_API_KEY set', 'OPENAI_API_KEY missing (required)');
  chk(isSet(brain.APP_SECRET), 'APP_SECRET set', 'APP_SECRET missing (required)');
  for (const k of ['SWARM_N8N_TOKEN', 'N8N_MCP_TOKEN']) {
    if (root[k] !== brain[k]) warn(`${k} differs between .env and brain/.env — run setup or configure`);
    else if (!isSet(brain[k])) warn(`${k} is still the development default — run setup or configure to generate one`);
    else ok(`${k} set and matching (root ↔ brain)`);
  }
  chk(isSet(brain.GOOGLE_CLIENT_ID) && isSet(brain.GOOGLE_CLIENT_SECRET), 'Google OAuth configured', 'Google OAuth not configured (Gmail/Calendar/Sheets disabled)');
  chk(isSet(brain.SERPAPI_KEY), 'SerpAPI configured', 'SerpAPI not configured (flights/hotels/shopping disabled; keyless research fallback)');
  chk(isSet(root.TELEGRAM_BOT_TOKEN), 'Telegram token set', 'Telegram not configured');
  chk(isSet(root.WHATSAPP_ACCESS_TOKEN), 'WhatsApp token set', 'WhatsApp not configured');
  chk(/^https:\/\//.test(root.N8N_PUBLIC_URL || ''), `public URL ${root.N8N_PUBLIC_URL}`, 'N8N_PUBLIC_URL is not public https — Telegram/WhatsApp webhooks need it (setup --tunnel)');
  chk(!!web.NEXT_PUBLIC_API_URL, `web → ${web.NEXT_PUBLIC_API_URL}`, 'web/.env.local missing NEXT_PUBLIC_API_URL');
  await status();
}

// ───────────────────────────────────────────── production server (docs/DEPLOY-ORACLE.md)
const SERVER_DIR = join(ROOT, '.swarm', 'server');
const PROD_COMPOSE = 'docker-compose.yml:docker-compose.prod.yml';
// plain host name: labels of 1–63 letters/digits/hyphens, not starting or ending with a hyphen; no scheme, port or path
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** On your computer: write the server's .env and brain/.env into .swarm/server/ from the local ones, with public URLs
 *  for `domain` and fresh production secrets. Secrets are kept on later runs (the database password must not change). */
function serverEnv() {
  step('S', 'Server configuration');
  const domain = (args.filter((a) => !a.startsWith('--'))[1] ?? '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) die('Usage: node scripts/swarm.mjs server-env <domain>   e.g. my-swarm.duckdns.org');
  if (!existsSync(P.rootEnv) || !existsSync(P.brainEnv)) die('Run setup first — .env and brain/.env are copied from this computer');
  mkdirSync(SERVER_DIR, { recursive: true });
  const rootOut = join(SERVER_DIR, '.env'), brainOut = join(SERVER_DIR, 'brain.env');
  const prev = readEnv(rootOut);
  const keep = (k, n = 32) => (isSet(prev[k]) ? prev[k] : secret(n));
  const s = {
    POSTGRES_PASSWORD: keep('POSTGRES_PASSWORD', 24), N8N_ENCRYPTION_KEY: keep('N8N_ENCRYPTION_KEY'),
    SWARM_N8N_TOKEN: keep('SWARM_N8N_TOKEN'), N8N_MCP_TOKEN: keep('N8N_MCP_TOKEN'),
  };
  const url = `https://${domain}`;
  if (!existsSync(rootOut)) writeFileSync(rootOut, readFileSync(P.rootEnv, 'utf8'), { mode: 0o600 });
  writeEnv(rootOut, { COMPOSE_FILE: PROD_COMPOSE, APP_DOMAIN: domain, N8N_PUBLIC_URL: `${url}/`, SWARM_BRAIN_URL: 'http://brain:4200', ...s });
  writeFileSync(brainOut, readFileSync(P.brainEnv, 'utf8'), { mode: 0o600 });
  writeEnv(brainOut, {
    PUBLIC_API_URL: url, WEB_URL: url, CORS_ORIGIN: url, GOOGLE_REDIRECT_URI: `${url}/api/google/callback`,
    SWARM_N8N_TOKEN: s.SWARM_N8N_TOKEN, N8N_MCP_TOKEN: s.N8N_MCP_TOKEN, YATRA_API_URL: '', YATRA_WEB_URL: '',
    SIGNUP_MODE: 'invite', // public server: invite links only (the first account is always allowed)
  });
  ok(`wrote .swarm/server/.env and .swarm/server/brain.env for ${url} (secrets not shown)`);
  info('copy them to the server (docs/DEPLOY-ORACLE.md step 4):');
  console.log(`      scp .swarm/server/.env <user>@<server-ip>:swarm-ai/.env`);
  console.log(`      scp .swarm/server/brain.env <user>@<server-ip>:swarm-ai/brain/.env`);
  info(`Google: add ${url}/api/google/callback as an authorised redirect URI of your OAuth client`);
}

/** On the server: build and start every container (Caddy, web, brain, n8n, Postgres), then import the n8n workflows
 *  and register the Telegram/WhatsApp webhooks on the public URL. Safe to re-run after `git pull`. */
async function deploy() {
  step('D', 'Deploy (production containers)');
  const env = readEnv(P.rootEnv);
  if (env.COMPOSE_FILE !== PROD_COMPOSE) die(`.env must contain COMPOSE_FILE=${PROD_COMPOSE} — create it with server-env on your computer`);
  if (!DOMAIN_RE.test(env.APP_DOMAIN ?? '')) die('.env needs APP_DOMAIN set to a plain host name, e.g. my-swarm.duckdns.org');
  if (!existsSync(P.brainEnv)) die('brain/.env is missing — copy .swarm/server/brain.env from your computer');
  if (sh('docker', ['compose', 'version']).code !== 0) die('Docker with the compose plugin is required (infra/server-bootstrap.sh installs it)');
  mustRun('build images (first time takes a few minutes)', 'docker', ['compose', 'build'], { inherit: true });
  mustRun('start containers', 'docker', ['compose', 'up', '-d', '--remove-orphans']);
  await waitFor('PostgreSQL healthy', async () => sh('docker', ['inspect', '-f', '{{.State.Health.Status}}', 'swarm-db']).out === 'healthy');
  await waitFor('brain healthy', async () => (await http('http://localhost:4200/api/health')).status === 200, 180_000);
  await waitFor('web up', async () => (await http('http://localhost:3200')).status === 200, 120_000);
  await waitFor('n8n up', async () => (await http(`http://localhost:${env.N8N_PORT || 5678}/healthz`)).status === 200, 120_000);
  await n8n();
  await waitFor(`https://${env.APP_DOMAIN} reachable (HTTPS certificate)`, async () => (await http(`https://${env.APP_DOMAIN}/api/health`)).status === 200, 180_000);
  await status();
  console.log(`\n  ${bold('Live')}  ${cyan(`https://${env.APP_DOMAIN}`)}   · n8n editor: ssh -L 5678:localhost:5678 ${os.userInfo().username}@<server-ip>, then http://localhost:5678`);
}

function summary() {
  const brain = readEnv(P.brainEnv);
  console.log(`\n${bold(green('SwarmAI is set up.'))}`);
  console.log(`  Web app      ${cyan('http://localhost:3200')}   (sign up, then Settings → connect Google / link Telegram & WhatsApp)`);
  console.log(`  Swagger      ${cyan('http://localhost:4200/api/docs')}`);
  console.log(`  n8n          ${cyan('http://localhost:5678')}`);
  if (isSet(brain.GOOGLE_CLIENT_ID)) console.log(`  Google       add redirect URI ${cyan(brain.GOOGLE_REDIRECT_URI || 'http://localhost:4200/api/google/callback')} to your OAuth client`);
  console.log(`\n  Manage:  ${bold('node scripts/swarm.mjs')} start | stop | restart | status | doctor | n8n | configure`);
  console.log(`  Integration guide: docs/SETUP-INTEGRATIONS.md`);
}

// ───────────────────────────────────────────── main
(async () => {
  console.log(bold(`\nSwarmAI — ${command} (${OS_NAME})`));
  try {
    switch (command) {
      case 'setup':
        prerequisites();
        await configure();
        if (flag('--tunnel')) await tunnel();
        await docker();
        if (!flag('--no-build')) build();
        await n8n();
        if (!flag('--no-start')) await start();
        await status();
        summary();
        break;
      case 'configure': await configure(); info('Apply changes: node scripts/swarm.mjs n8n  and  node scripts/swarm.mjs restart'); break;
      case 'n8n': await n8n(); break;
      case 'tunnel': await tunnel(); await n8n(); break;
      case 'start': await start(); await status(); break;
      case 'stop': stop(); break;
      case 'restart': stop({ tunnel: false }); await sleep(1500); await start(); await status(); break;
      case 'status': await status(); break;
      case 'doctor': await doctor(); break;
      case 'server-env': serverEnv(); break;
      case 'deploy': await deploy(); break;
      default: die(`Unknown command "${command}". Use: setup | configure | n8n | tunnel | start | stop | restart | status | doctor | server-env | deploy`);
    }
  } finally {
    rl?.close();
  }
})();
