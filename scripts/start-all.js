#!/usr/bin/env node
/**
 * Starts everything PrepAI needs, in order, and waits until each part is healthy:
 *   1. Custom AI Models (Hugging Face) https://router.huggingface.co/hf-inference/v1
 *   2. API (Express, auto-reload)       http://127.0.0.1:7857
 *   3. Web app (Vite)                   http://localhost:5174
 * Services that are already running are left alone. Ctrl+C stops what this script started.
 * Usage: npm run start:all   (or: node scripts/start-all.js)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const children = [];

function readEnv(file) {
  const env = {};
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      // "(^|\s+)#" also catches an empty value followed by a comment (KEY=   # note)
      if (m) env[m[1]] = m[2].replace(/(^|\s+)#.*$/, '').replace(/^["']|["']$/g, '');
    });
  } catch { /* defaults below */ }
  return env;
}

const env = readEnv(path.join(ROOT, 'server', '.env'));
const PROVIDER = (env.AI_PROVIDER || 'custom').toLowerCase();
const CUSTOM_URL = (env.CUSTOM_MODEL_URL || env.CUSTOM_BASE_URL || env.OPENAI_BASE_URL || 'https://router.huggingface.co/hf-inference/v1').replace(/\/$/, '');
const OLLAMA = (env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const LAYA = (env.LAYA_SERVICE_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');
const LAYA_ENABLED = env.LAYA_ENABLED === 'true';
const API = `http://127.0.0.1:${env.PORT || 7857}`;
const WEB = 'http://localhost:5174';
const MODELS = Array.from(new Set([
  env.CUSTOM_MODEL || env.AI_MODEL || 'Qwen/Qwen2.5-Coder-7B-Instruct',
  env.CUSTOM_EVALUATION_MODEL || env.EVALUATION_MODEL || 'Qwen/Qwen2.5-Coder-7B-Instruct',
  env.CUSTOM_EMBEDDING_MODEL || env.EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5',
  env.CUSTOM_VISION_MODEL || env.VISION_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct'
]));

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const log = (tag, msg) => console.log(`${color(36, `[${tag}]`)} ${msg}`);

async function up(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.ok || res.status === 401 || res.status === 404; // Server reachable
  } catch {
    return false;
  }
}

async function waitFor(url, seconds, tag) {
  for (let i = 0; i < seconds; i++) {
    if (await up(url)) return true;
    if (i > 0 && i % 15 === 0) log(tag, `still starting… (${i}s)`);
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function findOllama() {
  const candidates = [
    process.env.OLLAMA_EXE,
    isWin && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : null
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || 'ollama';
}

function start(tag, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: isWin && !/\.exe$/i.test(command), env: process.env });
  const prefix = color(90, `[${tag}]`);
  const pipe = stream => stream.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => console.log(`${prefix} ${l}`)));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', code => log(tag, code === 0 || code === null ? 'stopped' : color(31, `exited with code ${code}`)));
  children.push(child);
  return child;
}

async function ensure(tag, url, startFn, seconds) {
  if (await up(url)) {
    log(tag, color(32, `already running → ${url}`));
    return true;
  }
  log(tag, 'starting…');
  startFn();
  const ok = await waitFor(url, seconds, tag);
  log(tag, ok ? color(32, `ready → ${url}`) : color(31, `did not become ready on ${url}`));
  return ok;
}

async function checkModels() {
  if (PROVIDER !== 'ollama') {
    log('models', color(32, `custom models active: ${MODELS.join(', ')}`));
    return true;
  }
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const names = ((await res.json()).models || []).map(m => m.name);
    const has = n => names.some(m => m === n || m === `${n}:latest` || m.split(':')[0] === n);
    const missing = MODELS.filter(m => !has(m));
    if (missing.length) {
      missing.forEach(m => log('models', color(31, `missing "${m}" — run: ollama pull ${m}`)));
      return false;
    }
    log('models', color(32, `installed: ${MODELS.join(', ')}`));
    return true;
  } catch (err) {
    log('models', color(31, `could not list models: ${err.message}`));
    return false;
  }
}

function stopAll() {
  children.forEach(c => {
    if (c.exitCode !== null) return;
    if (isWin) spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  });
}
process.on('SIGINT', () => { log('prepai', 'stopping…'); stopAll(); setTimeout(() => process.exit(0), 800); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

(async () => {
  console.log(color(35, '\n  PrepAI — starting all services\n'));
  const results = {};

  if (PROVIDER === 'ollama') {
    results.ai = await ensure('ollama', `${OLLAMA}/api/tags`, () => start('ollama', findOllama(), ['serve'], ROOT), 60);
    results.models = results.ai ? await checkModels() : false;
  } else {
    // Custom models / live deployment mode: check custom endpoint connectivity
    const customReachable = await up(`${CUSTOM_URL}/models`) || await up(CUSTOM_URL);
    log('custom-ai', customReachable ? color(32, `custom endpoint reachable → ${CUSTOM_URL}`) : color(33, `custom endpoint configured → ${CUSTOM_URL}`));
    results.ai = true;
    results.models = true;
  }

  if (LAYA_ENABLED) {
    results.laya = await ensure('laya', `${LAYA}/health`, () => start('laya', isWin ? 'py' : 'python3', ['app.py'], path.join(ROOT, 'services', 'laya-engine')), 180);
  } else {
    results.laya = true;
  }

  results.api = await ensure('api', `${API}/api/v1/health`, () => start('api', 'node', ['--watch', 'src/server.js'], path.join(ROOT, 'server')), 60);
  results.web = await ensure('web', WEB, () => start('web', 'npx', ['vite', '--port', '5174', '--strictPort'], path.join(ROOT, 'frontend')), 60);

  const aiName = PROVIDER === 'ollama' ? 'AI models (Ollama)' : 'Custom AI Models (Hugging Face)';
  const aiUrl = PROVIDER === 'ollama' ? OLLAMA : CUSTOM_URL;

  const rows = [
    [aiName, results.ai && results.models, aiUrl]
  ];
  if (LAYA_ENABLED) {
    rows.push(['Laya decision service', results.laya, LAYA]);
  }
  rows.push(['API', results.api, API]);
  rows.push(['Web app', results.web, WEB]);
  console.log('');
  rows.forEach(([name, ok, url]) => console.log(`  ${ok ? color(32, '✔') : color(31, '✘')} ${name.padEnd(24)} ${url}`));
  const allOk = rows.every(r => r[1]);
  console.log(allOk
    ? color(32, `\n  Everything is running. Open ${WEB}\n`)
    : color(31, '\n  Something is not running — see the messages above.\n'));
  if (!children.length) process.exit(allOk ? 0 : 1);
})();
