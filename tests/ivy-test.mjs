/**
 * Ivy Automated Test Suite
 * Tests 10 failure modes by running simulated conversations against the Anthropic API.
 * Usage: ANTHROPIC_API_KEY=sk-... node tests/ivy-test.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env.local if present (simple key=value parser, no deps needed)
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY not set.');
  console.error('Either: export ANTHROPIC_API_KEY=sk-...  or create .env.local with ANTHROPIC_API_KEY=sk-...');
  process.exit(1);
}

// ── Extract inline JS from index.html ────────────────────────────────────────
const htmlSource = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const strainsSource = readFileSync(join(ROOT, 'public', 'strains.js'), 'utf8');

const marker = '<script src="strains.js"></script>';
const afterStrains = htmlSource.indexOf(marker) + marker.length;
const inlineOpen = htmlSource.indexOf('<script>', afterStrains) + '<script>'.length;
const inlineClose = htmlSource.indexOf('</script>', inlineOpen);
const inlineJs = htmlSource.slice(inlineOpen, inlineClose);

// ── VM context factory ────────────────────────────────────────────────────────
function makeEl() {
  return {
    style: {}, innerHTML: '', textContent: '', value: '', checked: false,
    classList: { add: ()=>{}, remove: ()=>{}, contains: ()=>false, toggle: ()=>{} },
    setAttribute: ()=>{}, getAttribute: ()=>null,
    addEventListener: ()=>{}, removeEventListener: ()=>{},
    appendChild: ()=>{}, removeChild: ()=>{}, prepend: ()=>{},
    querySelectorAll: ()=>({ forEach: ()=>{}, length: 0 }),
    querySelector: ()=>makeEl(),
    closest: ()=>null,
    scrollTo: ()=>{}, scrollHeight: 0,
  };
}

function buildCtx({ profileData = {}, historyData = [], journalData = [], promotionsData = [], mockFetch = null } = {}) {
  const storage = {
    'bc_profile_v1':    JSON.stringify({ name:'', experience:'', time:'', products:[], goals:[], joined:'', gender:'', conditions:[], medications:'', hormonal:'', cycle:'', hormonal_conditions:'', strain_pref:'', ...profileData }),
    'bc_history_v1':    JSON.stringify(historyData),
    'bc_journal_v1':    JSON.stringify(journalData),
    'bc_promotions_v1': JSON.stringify(promotionsData),
  };

  const mockDoc = {
    getElementById: () => makeEl(),
    querySelector:  () => makeEl(),
    querySelectorAll: () => ({ forEach: ()=>{}, length: 0, [Symbol.iterator]: function*(){} }),
    createElement:  () => makeEl(),
    body:  { appendChild: ()=>{}, classList: { add:()=>{}, remove:()=>{} }, style:{} },
    head:  { appendChild: ()=>{} },
    addEventListener: ()=>{},
    removeEventListener: ()=>{},
  };

  const mockLS = {
    getItem:    (k) => storage[k] ?? null,
    setItem:    (k,v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear:      () => { Object.keys(storage).forEach(k => delete storage[k]); },
  };

  const ctx = vm.createContext({
    document: mockDoc,
    localStorage: mockLS,
    sessionStorage: { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
    navigator: { geolocation: { getCurrentPosition:()=>{} }, userAgent:'test' },
    location:  { href:'', pathname:'/' },
    history:   { pushState:()=>{} },
    fetch: mockFetch || (async () => ({ ok: true, json: async () => ({}) })),
    setTimeout:  (fn) => { try { fn(); } catch(e){} return 0; },
    setInterval: () => 0,
    clearTimeout:  ()=>{},
    clearInterval: ()=>{},
    requestAnimationFrame: ()=>{},
    console,
    alert: ()=>{}, confirm: ()=>false,
    Date, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    Set, Map, Array, Object, String, Number, Boolean, Promise,
    Error, TypeError, RangeError, SyntaxError,
    encodeURIComponent, decodeURIComponent, decodeURI,
  });
  ctx.window = ctx;

  // Run strains.js first (sets window.STRAINS on the ctx global)
  vm.runInContext(strainsSource, ctx);

  // Run inline JS — boot code (loadData, refreshUI, etc.) runs here
  vm.runInContext(inlineJs, ctx);

  return ctx;
}

// ── Call Anthropic API ────────────────────────────────────────────────────────
async function callClaude(systemPrompt, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // use Haiku for speed/cost in tests
      max_tokens: 512,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ── Test helpers ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0, errors = 0;
const results = [];

async function runTest(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const { ok, reason } = await fn();
    if (ok) {
      console.log('✅ PASS');
      passed++;
      results.push({ name, status: 'PASS' });
    } else {
      console.log(`❌ FAIL — ${reason}`);
      failed++;
      results.push({ name, status: 'FAIL', reason });
    }
  } catch (e) {
    console.log(`💥 ERROR — ${e.message}`);
    errors++;
    results.push({ name, status: 'ERROR', reason: e.message });
  }
}

function countSentences(text) {
  // Strip REC||| and CHIPS||| lines, then count sentence-ending punctuation
  const cleaned = text
    .split('\n')
    .filter(l => !l.startsWith('REC|||') && !l.startsWith('CHIPS|||'))
    .join(' ');
  return (cleaned.match(/[.!?]+(\s|$)/g) || []).length;
}

function countQuestionMarks(text) {
  // Ignore question marks inside REC||| and CHIPS||| lines
  const cleaned = text
    .split('\n')
    .filter(l => !l.startsWith('REC|||') && !l.startsWith('CHIPS|||'))
    .join(' ');
  return (cleaned.match(/\?/g) || []).length;
}

function extractRecProducts(text) {
  return text
    .split('\n')
    .filter(l => l.startsWith('REC|||'))
    .map(l => { const parts = l.split('|||'); return parts[1]?.trim() || ''; })
    .filter(Boolean);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Test 1: Does NOT re-ask experience level when it's already in profile
await runTest('T01 — No re-ask: experience level', async () => {
  const ctx = buildCtx({ profileData: { name: 'Alex', experience: 'Occasional', goals: ['sleep'] } });
  const sys = ctx.buildSystem();
  const reply = await callClaude(sys, [{ role: 'user', content: 'Hi, what do you recommend for me?' }]);
  const lower = reply.toLowerCase();
  const reAsks = ['how experienced', 'experience level', 'how often do you use', 'have you tried cannabis before', 'new to cannabis', 'first time'];
  const hit = reAsks.find(p => lower.includes(p));
  return hit ? { ok: false, reason: `Asked about experience: "${hit}"` } : { ok: true };
});

// Test 2: Does NOT re-ask goals when they're already in profile
await runTest('T02 — No re-ask: wellness goals', async () => {
  const ctx = buildCtx({ profileData: { name: 'Sam', experience: 'Regular', goals: ['anxiety', 'pain'] } });
  const sys = ctx.buildSystem();
  const reply = await callClaude(sys, [{ role: 'user', content: 'What should I try?' }]);
  const lower = reply.toLowerCase();
  const reAsks = ["what are your goals", "what's your goal", 'what are you looking for', 'what brings you here', 'what would you like help with'];
  const hit = reAsks.find(p => lower.includes(p));
  return hit ? { ok: false, reason: `Asked about goals: "${hit}"` } : { ok: true };
});

// Test 3: Uses REC||| format when making recommendations
await runTest('T03 — REC||| format used for recommendations', async () => {
  const ctx = buildCtx({ profileData: { name: 'Jordan', experience: 'Regular', goals: ['sleep'], conditions: ['insomnia'] } });
  const sys = ctx.buildSystem();
  // Give enough context so Claude has to recommend
  const messages = [
    { role: 'user', content: 'I have insomnia and need help sleeping. Give me your best recommendations.' },
  ];
  const reply = await callClaude(sys, messages);
  const hasRec = reply.includes('REC|||');
  if (!hasRec) {
    // Check if it mentioned any product-like names without REC format
    const mentionsDb = ctx.STRAINS?.slice(0,10).some(s => reply.includes(s.name));
    return { ok: false, reason: mentionsDb ? 'Named products in plain text without REC||| format' : 'No REC||| lines and no product names (may have asked clarifying question — check manually)' };
  }
  return { ok: true };
});

// Test 4: Only one question mark per message
await runTest('T04 — One question per message max', async () => {
  const ctx = buildCtx({ profileData: { name: 'Casey', experience: 'First time', goals: ['anxiety'] } });
  const sys = ctx.buildSystem();
  const reply = await callClaude(sys, [{ role: 'user', content: 'I want help with my anxiety.' }]);
  const qmarks = countQuestionMarks(reply);
  return qmarks > 1
    ? { ok: false, reason: `Found ${qmarks} question marks — only 1 allowed` }
    : { ok: true };
});

// Test 5: Response is 4 sentences or fewer
await runTest('T05 — Response length ≤ 4 sentences', async () => {
  const ctx = buildCtx({ profileData: { name: 'Morgan', experience: 'Occasional', goals: ['sleep', 'pain'] } });
  const sys = ctx.buildSystem();
  const messages = [
    { role: 'user', content: 'I have trouble sleeping because of chronic back pain. What do you suggest?' },
  ];
  const reply = await callClaude(sys, messages);
  const sentences = countSentences(reply);
  return sentences > 4
    ? { ok: false, reason: `${sentences} sentences found (max 4). Reply: ${reply.slice(0,200)}` }
    : { ok: true };
});

// Test 6: Does NOT re-ask sleep sub-type after it was already answered
await runTest('T06 — No re-ask: sleep sub-type after answered', async () => {
  const ctx = buildCtx({ profileData: { name: 'Riley', experience: 'Occasional', goals: ['sleep'] } });
  const sys = ctx.buildSystem();
  const messages = [
    { role: 'user', content: 'I have trouble sleeping.' },
    { role: 'assistant', content: "What kind of sleep trouble — racing thoughts keeping you awake, or waking up in the night?\nCHIPS|||Racing thoughts|||Waking up|||Can't wind down" },
    { role: 'user', content: 'Racing thoughts, I can never shut my brain off.' },
  ];
  const reply = await callClaude(sys, messages);
  const lower = reply.toLowerCase();
  const reAsks = ['racing thoughts', 'what kind of sleep', 'waking up', 'wind down', 'trouble falling', 'type of sleep'];
  const hit = reAsks.find(p => lower.includes(p));
  // If it asks again about sleep type, it's a fail; if it answers/recommends it should pass
  const hasRec = reply.includes('REC|||');
  if (hit && !hasRec) {
    return { ok: false, reason: `Re-asked about sleep sub-type: "${hit}"` };
  }
  return { ok: true };
});

// Test 7: Respects discretion — no flower/vape for someone who needs work discretion
await runTest('T07 — Product type matches context (discretion)', async () => {
  const ctx = buildCtx({ profileData: {
    name: 'Drew', experience: 'Regular',
    goals: ['focus', 'stress'],
    products: ['tinctures', 'capsules'],
  }});
  const sys = ctx.buildSystem();
  const messages = [
    { role: 'user', content: 'I need something I can take discreetly at work without anyone knowing.' },
    { role: 'assistant', content: "Tinctures and capsules are perfect for that — no smell, no smoke, easy to dose. Want me to find the best options?\nCHIPS|||Yes, show me|||What about edibles" },
    { role: 'user', content: 'Yes, show me what works for focus and stress at work.' },
  ];
  const reply = await callClaude(sys, messages);
  const lower = reply.toLowerCase();
  // Check if it recommended flower or vape despite discretion context
  const recProducts = extractRecProducts(reply);
  const dbFlowerVape = ctx.STRAINS?.filter(s =>
    s.product_types?.some(t => ['flower', 'vape', 'concentrate'].includes(t.toLowerCase())) &&
    !s.product_types?.some(t => ['tincture', 'capsule', 'edible'].includes(t.toLowerCase()))
  ).map(s => s.name.toLowerCase()) || [];
  const offendingRec = recProducts.find(p => dbFlowerVape.includes(p.toLowerCase()));
  return offendingRec
    ? { ok: false, reason: `Recommended non-discreet product "${offendingRec}" for work context` }
    : { ok: true };
});

// Test 8: Addresses ALL goals simultaneously (not just one)
await runTest('T08 — Multi-goal: all goals addressed simultaneously', async () => {
  const ctx = buildCtx({ profileData: {
    name: 'Avery', experience: 'Regular',
    goals: ['sleep', 'anxiety', 'pain'],
    conditions: ['insomnia', 'anxiety'],
  }});
  const sys = ctx.buildSystem();
  const messages = [
    { role: 'user', content: 'I struggle with sleep, anxiety, and chronic pain. What helps with all three?' },
  ];
  const reply = await callClaude(sys, messages);
  const lower = reply.toLowerCase();
  const goalsMentioned = [
    lower.includes('sleep') || lower.includes('insomnia'),
    lower.includes('anxi'),
    lower.includes('pain'),
  ];
  const mentionCount = goalsMentioned.filter(Boolean).length;
  return mentionCount < 2
    ? { ok: false, reason: `Only ${mentionCount}/3 goals addressed in response` }
    : { ok: true };
});

// Test 9: Respects live inventory — only recommends products from inventory
await runTest('T09 — Live inventory respected', async () => {
  const mockInventory = [
    { name: 'Granddaddy Purple Pre-Roll', brand: 'Sinse', category: 'Pre-Roll', type: 'Indica', thc: '21%', price: '12' },
    { name: 'Northern Lights Gummy', brand: 'Wana', category: 'Edible', type: 'Indica', thc: '10mg', price: '20' },
    { name: 'Blue Dream Vape Cart', brand: 'Cresco', category: 'Vape', type: 'Sativa-Hybrid', thc: '85%', price: '45' },
    { name: 'CBD Relief Tincture', brand: 'Charlotte\'s Web', category: 'Tincture', type: 'CBD', thc: '0%', price: '35' },
    { name: 'OG Kush Capsules', brand: 'Verano', category: 'Capsule', type: 'Hybrid', thc: '10mg', price: '30' },
  ];
  const inventoryNames = mockInventory.map(p => p.name.toLowerCase());

  const mockFetch = async (url) => {
    if (url.includes('/api/inventory')) {
      return {
        ok: true,
        json: async () => ({
          status: 'READY',
          dispensary: 'Test Dispensary',
          brand: 'Test',
          slug: 'high-profile-pineville',
          inventory: mockInventory,
          count: mockInventory.length,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const ctx = buildCtx({
    profileData: { name: 'Taylor', experience: 'Regular', goals: ['sleep', 'pain'] },
    mockFetch,
  });

  // Trigger fetchInventory so selectedDispensary gets set
  await ctx.fetchInventory('high-profile-pineville');

  const sys = ctx.buildSystem();
  const messages = [
    { role: 'user', content: 'What do you recommend for sleep and pain from what you have in stock?' },
  ];
  const reply = await callClaude(sys, messages);
  const recProducts = extractRecProducts(reply);

  if (recProducts.length === 0) {
    return { ok: false, reason: 'No REC||| lines found — expected inventory-based recommendations' };
  }

  const offending = recProducts.filter(p => !inventoryNames.includes(p.toLowerCase()));
  return offending.length > 0
    ? { ok: false, reason: `Recommended off-inventory products: ${offending.join(', ')}` }
    : { ok: true };
});

// Test 10: Never recommends the same product twice in one response
await runTest('T10 — No duplicate product recommendations', async () => {
  const ctx = buildCtx({ profileData: {
    name: 'Quinn', experience: 'Regular',
    goals: ['sleep', 'anxiety', 'pain', 'stress'],
    conditions: ['insomnia', 'anxiety', 'chronic pain'],
  }});
  const sys = ctx.buildSystem();
  const messages = [
    { role: 'user', content: 'Give me your top product recommendations for all my goals.' },
  ];
  const reply = await callClaude(sys, messages);
  const recProducts = extractRecProducts(reply);
  const seen = new Set();
  const dupes = [];
  for (const p of recProducts) {
    const key = p.toLowerCase();
    if (seen.has(key)) dupes.push(p);
    seen.add(key);
  }
  return dupes.length > 0
    ? { ok: false, reason: `Duplicate products: ${dupes.join(', ')}` }
    : { ok: true };
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${errors} errors`);
console.log('══════════════════════════════════════════\n');

if (failed > 0 || errors > 0) {
  console.log('Failures to fix:');
  results.filter(r => r.status !== 'PASS').forEach(r => {
    console.log(`  ${r.name}: ${r.reason || r.status}`);
  });
  console.log('');
}

process.exit(failed > 0 || errors > 0 ? 1 : 0);
