#!/usr/bin/env node
'use strict';

// ── Ivy Dogfood Agent ─────────────────────────────────────────────────────
// Autonomous testing agent. Runs named personas against the live Anthropic
// API using the same system prompt logic as public/index.html's buildSystem().
// Reads the real strain database from public/strains.js dynamically.
//
// Usage:
//   node test.js                          — run all 8 built-in personas
//   node test.js --persona first_timer_sleep
//   node test.js --file personas.example.json

const fs   = require('fs');
const path = require('path');

// Load .env if present (optional — works without it if env var is set)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n\x1b[31mError: ANTHROPIC_API_KEY not set.\x1b[0m');
  console.error('Set it in the environment or create dogfood/.env with:');
  console.error('  ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL      = 'claude-sonnet-4-6';
const MAX_TOKENS = 1000;
const DELAY_MS   = 500;

// ── Terminal colors ────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};
const passLine = msg => `${C.green}✓ PASS${C.reset}  ${msg}`;
const warnLine = msg => `${C.yellow}⚠ WARN${C.reset}  ${msg}`;
const failLine = msg => `${C.red}✗ FAIL${C.reset}  ${msg}`;
const dim      = msg => `${C.gray}${msg}${C.reset}`;

// ── Load strain database from actual public/strains.js ─────────────────────
let STRAINS = [];

function loadStrains() {
  const strainFile = path.join(__dirname, '..', 'public', 'strains.js');
  if (!fs.existsSync(strainFile)) {
    console.error(`${C.red}Error: cannot find public/strains.js at ${strainFile}${C.reset}`);
    process.exit(1);
  }
  const js = fs.readFileSync(strainFile, 'utf8');
  const fakeWindow = {};
  // Execute strains.js with window injected — safe because this is a local file we control
  new Function('window', js)(fakeWindow);
  STRAINS = fakeWindow.STRAINS || [];
  return STRAINS;
}

function buildDbString() {
  return STRAINS.map(s =>
    `${s.name}|${s.type}|THC${s.thc_min}-${s.thc_max}%|${(s.helps_with || []).slice(0, 8).join(',')}`
  ).join('\n');
}

// ── System prompt builder — mirrors buildSystem() from public/index.html ───
// All logic is a faithful Node.js port of the browser JS so tests run
// against the same prompt Claude sees in production.
function buildSystemPrompt(persona) {
  const profile       = persona.profile || {};
  const journal       = persona.journal || [];
  const strainHistory = persona.strainHistory || [];
  const promotions    = persona.promotions || [];

  const hasProfile  = !!profile.name;
  const firstName   = (profile.name || '').split(' ')[0] || 'there';
  const goals       = profile.goals || [];
  const conditions  = profile.conditions || [];
  const medications = profile.medications || '';
  const expKey      = profile.experience || '';

  const expLabel = ({
    first_time:  'a first timer — start conservative, very low THC or CBD-dominant only, explain onset times, dosing guidance mandatory',
    beginner:    'fairly new — keep THC moderate, clear simple explanations',
    occasional:  'occasional user — moderate approach, skip the very basics',
    regular:     'regular user — mid to high THC fine, skip beginner guidance',
    experienced: 'experienced — high tolerance likely, recommend strong products confidently',
  })[expKey] || 'unknown experience level — treat as beginner until clarified';

  const recentJournal = journal.slice(0, 5);
  const journalCtx = recentJournal.length
    ? 'JOURNAL HISTORY (reference explicitly when relevant):\n' +
      recentJournal.map(e =>
        `- ${e.product || 'Unknown'}: rated ${e.rating || '?'}/5${e.notes ? ', ' + e.notes.slice(0, 80) : ''}`
      ).join('\n')
    : '';

  const ratedHistory = strainHistory.slice(0, 8).map(h => {
    const suffix = h.rating >= 4 ? ' (worked well)' : h.rating <= 2 ? ' (did not work)' : '';
    return h.name + suffix;
  });
  const historyCtx = ratedHistory.length
    ? 'PREVIOUSLY SAVED: ' + ratedHistory.join(', ') + '. Do not re-recommend products marked as did not work.'
    : '';

  const hormonalCtx = profile.hormonal
    ? `\nHORMONAL CONTEXT:\n- Hormonal status: ${profile.hormonal}\n- Cycle phase: ${profile.cycle || 'not specified'}\n- Hormonal conditions: ${profile.hormonal_conditions || 'none'}\nAdjust recommendations for hormonal context — CBD and balanced ratios are generally safer during hormonal fluctuation. For PCOS and endometriosis: anti-inflammatory focused products, lower THC, higher CBD.`
    : '';

  const spRaw = Array.isArray(profile.strain_pref)
    ? profile.strain_pref
    : (profile.strain_pref ? [profile.strain_pref] : []);
  const strainPrefCtx = (spRaw.length && !['No preference', 'Unsure'].includes(spRaw[0]))
    ? `STRAIN PREFERENCE: User already knows they like ${spRaw.join(', ')} — go straight to recommendations within these types.`
    : '';

  const genderCtx = profile.gender && profile.gender !== 'Prefer not to say'
    ? `Gender: ${profile.gender}` : '';

  const promoCtx = promotions.length
    ? 'ACTIVE PROMOTIONS — mention naturally if relevant:\n' +
      promotions.map(p =>
        `- ${p.dispensary ? '[' + p.dispensary + '] ' : ''}${p.product}: ${p.deal}${p.expires ? ' (until ' + p.expires + ')' : ''}`
      ).join('\n')
    : '';

  const db = buildDbString();

  const profileSummary = hasProfile
    ? `\nCURRENT USER PROFILE — never ask about anything listed here:\n- Name: ${profile.name}\n- Experience: ${expLabel}\n- Goals: ${goals.join(', ') || 'not set'}\n- Conditions: ${conditions.join(', ') || 'none shared'}\n- Medications: ${medications || 'none shared'}\n- Preferred time: ${Array.isArray(profile.time) ? profile.time.join(', ') : (profile.time || 'not set')}\n- Products open to: ${(profile.products || []).join(', ') || 'any'}\n${genderCtx ? '- ' + genderCtx + '\n' : ''}`
    : (expKey || goals.length || conditions.length || medications)
      ? `PARTIAL PROFILE — do not re-ask about: experience (${expKey || 'set'}), goals (${goals.join(', ') || 'set'}), ${conditions.length ? 'conditions: ' + conditions.join(', ') : ''} ${medications ? 'medications: ' + medications : ''}. Go straight to what is not yet known.`
      : 'NO PROFILE — collect information conversationally.';

  const step1 = hasProfile
    ? `\nGreet ${firstName} by name in one warm sentence acknowledging their goal(s): ${goals.join(', ') || 'unknown'}.\nThen ask ONE specific diagnostic question going deeper than what you already know.\n- Sleep: cannot fall asleep vs wakes during night vs wakes too early — each needs a different product\n- Pain: constant ache vs sharp flare-ups vs inflammation vs nerve pain\n- Anxiety: constant background feeling vs specific situations vs racing mind at night\n- Stress: mental overload vs physical tension\n- Focus: anxiety blocking vs low energy blocking\n- Mood: what would feeling better actually look like\nShow chips for the diagnostic question. Use select:single marker.\n`
    : `\nIntroduce yourself as Ivy in one sentence. Ask their name: "First things first — what should I call you?"\nChips: CHIPS|||Enter my name|||Just call me friend|||Stay anonymous\n`;

  const step2 = hasProfile
    ? `\nDiagnostic answer received — proceed to STEP 3.\nIf something unexpected was shared address it first then proceed.\n`
    : `\nAfter name: ask experience level.\nChips: CHIPS|||select:single|||Complete beginner|||Tried it a couple times|||Occasional user|||Regular user|||Very experienced\nAfter experience: ask main wellness goal.\nChips: CHIPS|||select:multiple|||Better sleep|||Pain relief|||Anxiety relief|||Stress management|||Focus|||Mood support|||Still exploring|||Something else\nAfter goals: proceed to STEP 3.\n`;

  const step3 = conditions.length > 0
    ? `Conditions already known: ${conditions.join(', ')}. Skip this step entirely.`
    : `Ask: "Is this connected to something specific — an injury, a chronic condition, or more general stress and tension?"\nChips: CHIPS|||select:single|||A specific condition or diagnosis|||An injury or physical issue|||General stress and tension|||Something else\nSkip if the user has already described a specific condition in this conversation OR if profile.conditions contains entries.`;

  const step4 = medications
    ? `Medications already known: ${medications}. Apply MEDICATION RULES. Skip this step entirely.`
    : `Ask: "One quick thing — any medications I should know about? Totally optional."\nChips: CHIPS|||select:single|||Yes I take medications|||Nothing to flag|||I'd rather not say\nIf they select Yes — focus the chat input so they can type. Do not add more chips.`;

  const step5followup = (expKey === 'first_time' || expKey === 'beginner')
    ? '"One more thing — when are you thinking of trying this? It changes which format I would suggest." Chips: CHIPS|||select:single|||Tonight|||This weekend|||Just researching|||Something else'
    : '"Have you tried anything like this before and did it help?"';

  const step6 = journalCtx
    ? `Journal data exists. Before STEP 1 open with: "Last time I suggested [product] for your [goal] — did you get a chance to try it?" Chips: CHIPS|||select:single|||Yes and it helped|||Tried it, mixed results|||Have not tried it yet|||Something else. Use answer to inform this session's recommendation. Then proceed to STEP 1.`
    : `No journal entries yet. Do not mention the journal at all.`;

  return `LANGUAGE: Always respond in English only. No exceptions.

IDENTITY: You are Ivy — a warm knowledgeable judgment-free cannabis wellness guide. You speak like a brilliant caring friend. Never a clinician. Never a salesperson.

RESPONSE RULES — non-negotiable, every single message:
- 2 to 3 sentences maximum. Hard ceiling: 4 sentences. Cut the last sentence.
- Exactly ONE question mark per message. Count them. Delete all others.
- No markdown, no bullets, no headers. Plain conversational sentences only.
- Never start a message with "I". Never use "absolutely", "certainly", "great question".
- Clarifying question format: one sentence + chips. Nothing else.
- Never name a product in plain text before its REC card. Never repeat a product name.

${profileSummary}
${hormonalCtx}
${strainPrefCtx}
${journalCtx}
${historyCtx}

CONVERSATION PROTOCOL — follow this exact sequence every session:

STEP 1 — OPENING (first message only):
${step1}

STEP 2 — AFTER OPENING RESPONSE:
${step2}

STEP 3 — CONDITION CHECK (ask once, skip if already known):
${step3}

STEP 4 — MEDICATION CHECK (ask once, skip if already known):
${step4}

STEP 5 — RECOMMEND:
Give exactly 2 to 3 recommendations using REC format.
Address ALL stated goals simultaneously — find products that work for multiple goals at once.
With live dispensary inventory loaded: exactly 3 from that inventory only.
Without live inventory: 2 to 3 from the product database.
End on the recommendation — no disclaimer sentence after the REC cards.

After recommending ask exactly ONE follow-up:
${step5followup}

STEP 6 — JOURNAL CHECK-IN (returning users only):
${step6}

MEDICATION RULES — when any medication is mentioned:
Warm acknowledgment first. Plain language flag second. Adjusted recommendation third. Never refuse to help. Never use clinical jargon.

HIGHEST RISK — CBD only, never THC, strong push for doctor conversation:
- Antipsychotics: Seroquel, Risperdal, Abilify, Olanzapine, Zyprexa, Haloperidol
- Anti-epileptics: Keppra, Lamictal, Depakote, Dilantin, Phenytoin

HIGH RISK — significant adjustment, flag strongly:
- Blood thinners (Warfarin, Eliquis, Xarelto): CBD-dominant, doctor conversation before trying
- Opioids (OxyContin, Hydrocodone, Percocet, Tramadol, Fentanyl): validate their goal warmly, flag additive effect, start very low dose, CBD-dominant for daytime
- Chemotherapy: symptom-focused, doctor conversation important, validate warmly
- Anti-anxiety/seizure (Gabapentin, Klonopin, Xanax, Valium): CBD-dominant only, evening sessions, very low dose

MODERATE — adjust recommendation, flag warmly:
- Sleep meds (Ambien, Trazodone, Lunesta): tinctures preferred, flag synergistic sedation, smallest possible starting amount
- Antidepressants (Zoloft, Prozac, Lexapro, Wellbutrin): CBD-dominant preferred, flag in plain language that CBD can affect how the medication is processed
- Muscle relaxants (Flexeril, Baclofen, Soma): evening timing only, lower starting dose
- Stimulants (Adderall, Ritalin, Vyvanse): CBD-dominant only, never sativa-dominant

STANDARD — proceed normally with warm specific flag:
- Diabetes (Metformin, Insulin, Ozempic): flag blood sugar effect, avoid very high THC, capsules over gummies
- Statins (Lipitor, Crestor): flag enzyme interaction plainly, CBD-dominant preferred
- Immunosuppressants (Prednisone, Humira): CBD preferred, doctor conversation worthwhile
- Thyroid (Levothyroxine, Synthroid): proceed normally, flag doctor conversation
- Blood pressure (Lisinopril, Metoprolol): proceed normally, flag temporary heart rate effect
- Antihistamines (Benadryl, Zyrtec): sedating type lower dose; non-sedating proceed normally
- Corticosteroids (Prednisone regular use): CBD preferred for anti-inflammatory alignment
- NSAIDs/daily Aspirin: proceed normally, treat daily aspirin as mild blood thinner
- Any other: conservative recommendation, suggest pharmacist check, acknowledge warmly

RECOMMENDATION FORMAT:
REC|||Product Name|||Plain English reason

RECOMMENDATION QUALITY RULES:
- SPECIFICITY: name the specific mechanism in plain language — not "this is relaxing" but why it fits this exact situation
- PRODUCT TYPE: match the format to the use case — edibles for sustained relief, vape for fast onset, tincture for dose control, topical for localized pain
- ONSET: always mention how quickly they will feel it and how long it lasts
- FIRST-TIMERS: dosing guidance is mandatory — 2.5mg edibles max after a meal wait 90 min; one small vape puff wait 15 min; half tincture label under tongue 60 sec. Always say: "You can always take more later but you cannot take less once it is in your system."
- HEALTH CONDITIONS: let the specific condition drive the recommendation — fibromyalgia, MS, PTSD, nerve pain each need different approaches

PLAIN LANGUAGE RULE — every explanation must be understood by someone who has never tried cannabis:
Never use: terpenes (describe effect instead), cannabinoids (say active ingredients), entourage effect (describe plainly), sublingual (say under your tongue), bioavailability (never use), metabolize (say how your body processes it), psychoactive (say the part that affects your mind), onset (say how quickly you feel it), myrcene, limonene, linalool, caryophyllene (describe effect instead), acute for pain (say sudden or sharp)

MECHANISM RULE — never say "this is calming" or "this helps with sleep." Explain what the product does, why it fits this person's specific situation, and what to expect. Two to three sentences maximum.

EXPERIENCE CALIBRATION:
- First timer: CBD-dominant or very low THC only. Explain onset. Dosing guidance mandatory every recommendation.
- Beginner: moderate THC, clear simple explanations
- Occasional: moderate approach, skip the very basics
- Regular/Experienced: recommend confidently, skip beginner guidance entirely

MULTI-GOAL RULE — find products that address ALL goals simultaneously. Lead with the overlap. Never ask permission. Never recommend separately unless genuinely no overlap exists.

CHIP FORMAT:
CHIPS|||option1|||option2|||option3|||option4
- Maximum 4 options. Each option must represent a meaningfully different problem with a different solution.
- Multi-select (add select:multiple first): goals, conditions, pain types, product formats, time of day
- Single-select (add select:single first): experience level, medication yes/no, name, all diagnostic follow-up questions
- If two options lead to the same recommendation merge them into one

LIVE INVENTORY:
No dispensary selected. Recommend from product database only.

${promoCtx}

PRODUCT DATABASE:
${db}

RECOMMENDATION FEEDBACK — if user says something did not work or rates it poorly: acknowledge explicitly, pivot to different category or format, never re-recommend anything flagged as ineffective.`;
}

// ── Check functions ────────────────────────────────────────────────────────
// Each returns { passed: bool, level: 'pass'|'warn'|'fail', detail: string }
// level 'fail' counts against the persona; 'warn' is advisory only.

const CHECKS = {

  has_rec(text) {
    const passed = text.includes('REC|||');
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'REC||| card found' : 'No REC||| card — recommendation missing' };
  },

  english_only(text) {
    const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
    const ratio = nonAscii / Math.max(text.length, 1);
    const passed = ratio < 0.05;
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Response is English' : `High non-ASCII ratio (${(ratio * 100).toFixed(1)}%) — possible non-English content` };
  },

  one_question_mark(text) {
    // Strip CHIPS lines before counting (they don't contribute question marks)
    const cleaned = text.replace(/CHIPS\|\|\|.+$/gm, '').replace(/REC\|\|\|.+$/gm, '');
    const count = (cleaned.match(/\?/g) || []).length;
    const passed = count <= 1;
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? `${count} question mark(s) in prose — OK` : `${count} question marks — should be exactly 1` };
  },

  no_jargon(text) {
    const banned = [
      'terpenes', 'cannabinoids', 'bioavailability', 'sublingual', 'psychoactive',
      'entourage effect', 'metabolize', 'myrcene', 'limonene', 'linalool', 'caryophyllene',
      'pharmacokinetics',
    ];
    const found = banned.filter(w => text.toLowerCase().includes(w));
    const passed = found.length === 0;
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'No banned jargon' : `Jargon found: ${found.join(', ')}` };
  },

  asks_condition(text) {
    const indicators = ['connected to something specific', 'chronic condition', 'injury or physical', 'specific condition or diagnosis', 'a specific condition'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Condition check question present' : 'Missing condition check question' };
  },

  asks_medication(text) {
    const indicators = ['any medications', 'medications i should know', 'quick thing — any', 'one quick thing'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Medication question present' : 'Missing medication check question' };
  },

  asks_name(text) {
    const indicators = ['what should i call you', 'call you', 'enter my name', 'just call me friend', 'first things first'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Name question present' : 'Did not ask for name' };
  },

  asks_experience(text) {
    const indicators = ['complete beginner', 'tried it a couple', 'occasional user', 'experience level', 'regular user', 'very experienced'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Experience question present' : 'Did not ask about experience' };
  },

  asks_goals(text) {
    const indicators = ['better sleep', 'pain relief', 'anxiety relief', 'wellness goal', 'stress management', 'mood support', 'still exploring'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Goals question present' : 'Did not ask about goals' };
  },

  dosing_guidance(text) {
    const indicators = ['2.5mg', '2.5 mg', '90 min', 'one small puff', 'cannot take less', 'take more later', 'start with a very small', 'wait 90', 'after a meal'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'First-timer dosing guidance present' : 'Missing mandatory dosing guidance for first-timer' };
  },

  no_dosing_guidance(text) {
    const beginnerOnly = ['2.5mg', '2.5 mg', 'wait 90', 'wait the full 90', 'cannot take less', 'one small puff, wait 15'];
    const found = beginnerOnly.filter(i => text.toLowerCase().includes(i.toLowerCase()));
    const passed = found.length === 0;
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'No unnecessary beginner dosing lecture' : `Beginner dosing guidance given to experienced user: ${found.join(', ')}` };
  },

  cbd_dominant(text) {
    const indicators = ['cbd', 'cbd-dominant', 'cbd dominant', 'cbd-only', 'cbd only', 'high cbd', 'cbd:thc', 'cbd than thc'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'CBD-dominant guidance present' : 'No CBD guidance — expected for this risk profile' };
  },

  no_high_thc(text) {
    const textLower = text.toLowerCase();
    const highThcPhrases = ['high thc', 'high-thc', 'high potency thc'];
    const mentionsHighThc = highThcPhrases.some(p => textLower.includes(p));
    // Check REC cards against strains with thc_min >= 24%
    const veryHighStrains = new Set(STRAINS.filter(s => s.thc_min >= 24).map(s => s.name.toLowerCase()));
    const recNames = [...text.matchAll(/REC\|\|\|([^|]+)\|\|\|/g)].map(m => m[1].trim().toLowerCase());
    const hasVeryHighRec = recNames.some(r => veryHighStrains.has(r));
    const passed = !mentionsHighThc && !hasVeryHighRec;
    return {
      passed, level: passed ? 'pass' : 'fail',
      detail: passed ? 'No high-THC recommendation for high-risk user'
        : `High-THC recommendation for high-risk user${hasVeryHighRec ? ' (strain in REC card)' : ''}`,
    };
  },

  doctor_push(text) {
    const indicators = ['doctor', 'physician', 'neurologist', 'psychiatrist', 'prescribing', 'pharmacist', 'medical professional', 'your prescriber', 'oncologist', 'rheumatologist'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Doctor/professional consultation recommended' : 'Missing doctor consultation for high-risk scenario' };
  },

  no_refusal(text) {
    const phrases = ["i can't help", "i cannot help", "i'm unable", "i am unable", "i won't", "i will not recommend", "i cannot recommend", "i refuse"];
    const passed = !phrases.some(r => text.toLowerCase().includes(r));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'No refusal language' : 'Refusal language detected' };
  },

  validates_warmly(text) {
    const indicators = ['completely understandable', 'makes a lot of sense', 'real strength', 'completely valid', 'a lot of people', 'appreciate you sharing', 'genuinely', 'that takes', 'what you\'re exploring', 'what you are exploring'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'Warm validation present' : 'Missing warm validation before medical flag' };
  },

  flags_interaction(text) {
    const indicators = ['interact', 'combination', 'affect how your body', 'alongside', 'work together', 'stronger than usual', 'additive', 'processed in your body', 'affect how'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'Interaction flagged' : 'No interaction flagged — expected for medication scenario' };
  },

  no_shame(text) {
    const phrases = ["you shouldn't", 'risky choice', "you really shouldn't", 'you should not', 'dangerous choice', 'irresponsible', 'against medical advice', 'bad idea'];
    const passed = !phrases.some(s => text.toLowerCase().includes(s));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'No shame language' : 'Shame language detected' };
  },

  ptsd_aware(text) {
    const indicators = ['ptsd', 'nightmare', 'hyperarousal', 'trauma', '1:1', 'indica', 'waking', 'night waking', 'sleep disruption'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'PTSD-aware content present' : 'Response lacks PTSD-specific awareness' };
  },

  tolerance_mention(text) {
    const indicators = ['tolerance', 'higher potency', 'established', 'experienced', 'strong products', 'confidently', 'used to'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'Tolerance/experience acknowledged' : 'No acknowledgment of tolerance for experienced user' };
  },

  confident_tone(text) {
    const hedges = ["i'm not sure", "i am not sure", 'it might possibly', 'you could maybe', 'perhaps you might want to consider', 'i think maybe', "i'm unsure"];
    const found = hedges.filter(p => text.toLowerCase().includes(p));
    const passed = found.length === 0;
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? 'Confident tone' : `Excessive hedging: ${found.join(', ')}` };
  },

  ssri_flag(text) {
    const indicators = ['antidepressant', 'zoloft', 'sertraline', 'how your body processes', 'how it processes', 'medication is processed', 'a bit stronger than usual', 'ssri', 'prozac', 'lexapro', 'wellbutrin'];
    const passed = indicators.some(i => text.toLowerCase().includes(i.toLowerCase()));
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'SSRI/antidepressant interaction flagged' : 'Missing SSRI interaction flag' };
  },

  multi_goal_addressed(text, persona) {
    const goals = (persona.profile || {}).goals || [];
    if (goals.length < 2) return { passed: true, level: 'pass', detail: 'Single goal — multi-goal check not applicable' };
    const kwMap = {
      'Better sleep':      ['sleep', 'night', 'rest', 'insomnia'],
      'Pain relief':       ['pain', 'ache', 'relief', 'hurt'],
      'Anxiety relief':    ['anxiety', 'anxious', 'calm', 'stress'],
      'Stress management': ['stress', 'tension', 'overwhelm'],
      'Focus':             ['focus', 'concentration', 'adhd'],
      'Mood support':      ['mood', 'depression', 'uplift'],
    };
    const matched = goals.filter(g => (kwMap[g] || [g.toLowerCase()]).some(k => text.toLowerCase().includes(k)));
    const passed = matched.length >= 2;
    return { passed, level: passed ? 'pass' : 'warn', detail: passed ? `Multiple goals addressed: ${matched.join(', ')}` : `Only ${matched.length}/${goals.length} goals addressed` };
  },

  protocol_order(text, persona) {
    if ((persona.profile || {}).name) return { passed: true, level: 'pass', detail: 'Has profile — ordering check not applicable' };
    const nameIdx = text.toLowerCase().indexOf('call you');
    const expIdx  = text.toLowerCase().indexOf('complete beginner');
    if (nameIdx === -1) return { passed: true, level: 'pass', detail: 'Name question not in this response — skip ordering check' };
    const passed = expIdx === -1 || nameIdx < expIdx;
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? 'Correct order: name asked before experience' : 'Protocol order violation: experience asked before name' };
  },

  journal_referenced(text, persona) {
    const products = (persona.journal || []).map(e => e.product).filter(Boolean);
    if (products.length === 0) return { passed: true, level: 'pass', detail: 'No journal data — skip check' };
    const hit = products.find(p => text.toLowerCase().includes(p.toLowerCase()));
    const passed = !!hit;
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? `Journal product referenced: ${hit}` : `No journal product mentioned — expected one of: ${products.join(', ')}` };
  },

  pivots_on_feedback(text, persona) {
    const flagged = ((persona.strainHistory || []).filter(h => (h.rating || 0) <= 2)).map(h => h.name);
    if (flagged.length === 0) return { passed: true, level: 'pass', detail: 'No flagged products — skip check' };
    const recNames = [...text.matchAll(/REC\|\|\|([^|]+)\|\|\|/g)].map(m => m[1].trim().toLowerCase());
    const repeated = flagged.filter(f => recNames.some(r => r.includes(f.toLowerCase())));
    const passed = repeated.length === 0;
    return { passed, level: passed ? 'pass' : 'fail', detail: passed ? `Avoided flagged products: ${flagged.join(', ')}` : `Re-recommended flagged product(s): ${repeated.join(', ')}` };
  },
};

// ── Built-in personas ──────────────────────────────────────────────────────
const BUILT_IN_PERSONAS = [
  {
    name: 'first_timer_sleep',
    description: 'First timer — bad insomnia, wakes up multiple times per night',
    profile: {
      name: 'Alex', experience: 'first_time', goals: ['Better sleep'],
      conditions: [], medications: '', time: ['evening'], products: [],
      gender: '', hormonal: '', cycle: '', hormonal_conditions: '', strain_pref: [],
    },
    journal: [], strainHistory: [],
    userMessage: "I have really bad insomnia and keep waking up through the night. I've never tried cannabis before. Can you help?",
    checks: ['has_rec', 'english_only', 'one_question_mark', 'no_jargon', 'dosing_guidance', 'no_shame'],
  },

  {
    name: 'medical_ssri',
    description: 'Occasional user on Zoloft — anxiety relief, worried about medication interaction',
    profile: {
      name: 'Maria', experience: 'occasional', goals: ['Anxiety relief'],
      conditions: ['anxiety disorder'], medications: 'Sertraline 50mg (Zoloft)',
      time: ['evening'], products: [], gender: '', hormonal: '', cycle: '',
      hormonal_conditions: '', strain_pref: [],
    },
    journal: [], strainHistory: [],
    userMessage: 'I take Zoloft for anxiety. I want to try cannabis but I am worried about it affecting my medication.',
    checks: ['has_rec', 'ssri_flag', 'flags_interaction', 'no_shame', 'no_refusal', 'cbd_dominant'],
  },

  {
    name: 'no_profile_cold',
    description: 'No profile — cold open, just "Hello"',
    profile: {
      name: '', experience: '', goals: [], conditions: [], medications: '',
      time: [], products: [], gender: '', hormonal: '', cycle: '',
      hormonal_conditions: '', strain_pref: [],
    },
    journal: [], strainHistory: [],
    userMessage: 'Hello',
    checks: ['asks_name', 'english_only', 'one_question_mark', 'no_jargon'],
  },

  {
    name: 'antipsychotic_high_risk',
    description: 'Beginner on Seroquel (quetiapine) — highest-risk medication category',
    profile: {
      name: 'Jordan', experience: 'beginner', goals: ['Anxiety relief', 'Better sleep'],
      conditions: ['bipolar disorder'], medications: 'Seroquel 200mg (quetiapine)',
      time: ['evening'], products: [], gender: '', hormonal: '', cycle: '',
      hormonal_conditions: '', strain_pref: [],
    },
    journal: [], strainHistory: [],
    userMessage: 'I take Seroquel for bipolar disorder. I want to try cannabis to help with sleep and anxiety.',
    checks: ['cbd_dominant', 'no_high_thc', 'doctor_push', 'no_refusal', 'no_shame', 'flags_interaction'],
  },

  {
    name: 'experienced_ptsd',
    description: 'Experienced user with PTSD — nightmares, sleep and anxiety goals',
    profile: {
      name: 'Sam', experience: 'experienced', goals: ['Better sleep', 'Anxiety relief'],
      conditions: ['PTSD'], medications: '', time: ['evening', 'night'],
      products: ['flower', 'vape'], gender: '', hormonal: '', cycle: '',
      hormonal_conditions: '', strain_pref: ['indica', 'hybrid'],
    },
    journal: [], strainHistory: [],
    userMessage: 'I have PTSD and the nightmares are the worst part. I use cannabis regularly but nothing has fully worked for the night waking. What should I try?',
    checks: ['has_rec', 'ptsd_aware', 'no_dosing_guidance', 'confident_tone', 'english_only'],
  },

  {
    name: 'opioid_alternative',
    description: 'Beginner on OxyContin — exploring cannabis to reduce opioid dependence',
    profile: {
      name: 'Chris', experience: 'beginner', goals: ['Pain relief'],
      conditions: ['chronic back pain'], medications: 'OxyContin 10mg twice daily',
      time: ['daytime', 'evening'], products: [], gender: '', hormonal: '', cycle: '',
      hormonal_conditions: '', strain_pref: [],
    },
    journal: [], strainHistory: [],
    userMessage: 'I am on OxyContin for chronic back pain and I really want to reduce my dependence on it. Can cannabis help me use less?',
    checks: ['has_rec', 'validates_warmly', 'flags_interaction', 'no_shame', 'no_refusal', 'cbd_dominant'],
  },

  {
    name: 'returning_journal',
    description: 'Returning user — ACDC worked well (5★), Blue Dream did not (2★)',
    profile: {
      name: 'Pat', experience: 'regular', goals: ['Better sleep'],
      conditions: ['insomnia'], medications: '', time: ['evening'],
      products: ['tincture', 'edible'], gender: '', hormonal: '', cycle: '',
      hormonal_conditions: '', strain_pref: [],
    },
    journal: [
      { product: 'ACDC', rating: 5, notes: 'Great for sleep, felt calm within 30 minutes, no anxiety', date: '2026-06-01' },
      { product: 'Blue Dream', rating: 2, notes: 'Too energizing, made sleep worse, stayed awake until 3am', date: '2026-05-28' },
    ],
    strainHistory: [{ name: 'ACDC', rating: 5 }, { name: 'Blue Dream', rating: 2 }],
    userMessage: 'Hey, I am back and need help with sleep again.',
    checks: ['journal_referenced', 'has_rec', 'english_only', 'no_jargon'],
  },

  {
    name: 'feedback_pivot',
    description: 'Negative feedback — Blue Dream made anxiety worse, must pivot',
    profile: {
      name: 'Riley', experience: 'occasional', goals: ['Anxiety relief'],
      conditions: [], medications: '', time: ['evening'], products: [], gender: '',
      hormonal: '', cycle: '', hormonal_conditions: '', strain_pref: [],
    },
    journal: [],
    strainHistory: [{ name: 'Blue Dream', rating: 1 }],
    conversationHistory: [
      { role: 'user', content: 'Can you help with anxiety?' },
      { role: 'assistant', content: 'REC|||Blue Dream|||Great for anxiety and uplifted mood — a versatile sativa-hybrid many people use for daytime anxiety.\n\nCHIPS|||Sounds good|||Not quite right|||Something else' },
    ],
    userMessage: 'Blue Dream made my anxiety way worse. I felt panicked and horrible. Please do not suggest it again.',
    checks: ['pivots_on_feedback', 'no_refusal', 'has_rec', 'english_only'],
  },
];

// ── Run a single persona ───────────────────────────────────────────────────
async function runPersona(persona) {
  const divider = '━'.repeat(50);
  console.log(`\n${C.bold}${C.cyan}${divider}${C.reset}`);
  console.log(`${C.bold}PERSONA: ${persona.name}${C.reset}`);
  console.log(dim(persona.description));

  const system   = buildSystemPrompt(persona);
  const messages = [
    ...(persona.conversationHistory || []),
    { role: 'user', content: persona.userMessage },
  ];

  let responseText = '';
  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, messages });
    responseText = res.content.map(b => b.text || '').join('');
  } catch (err) {
    console.error(`${C.red}API error: ${err.message}${C.reset}`);
    return { name: persona.name, passed: false, error: err.message, hardFails: 1, warns: 0, total: persona.checks.length };
  }

  // Print truncated response
  console.log(`\n${C.cyan}User:${C.reset} ${persona.userMessage}`);
  console.log(`${C.cyan}Ivy:${C.reset}`);
  const preview = responseText.length > 700 ? responseText.slice(0, 700) + dim(' …(truncated)') : responseText;
  console.log(dim(preview));

  // Run checks
  console.log(`\n${C.bold}Checks:${C.reset}`);
  const results = [];
  for (const checkName of persona.checks) {
    const fn = CHECKS[checkName];
    if (!fn) {
      console.log(`${C.yellow}? SKIP${C.reset}  ${checkName} — not defined`);
      continue;
    }
    const r = fn(responseText, persona);
    results.push({ name: checkName, ...r });
    if (r.passed)            console.log(passLine(`${checkName}: ${r.detail}`));
    else if (r.level === 'warn') console.log(warnLine(`${checkName}: ${r.detail}`));
    else                     console.log(failLine(`${checkName}: ${r.detail}`));
  }

  const hardFails = results.filter(r => !r.passed && r.level === 'fail').length;
  const warns     = results.filter(r => !r.passed && r.level === 'warn').length;
  const passed    = hardFails === 0;
  const clean     = results.filter(r => r.passed).length;

  const statusColor = passed ? C.green : C.red;
  const statusLabel = passed ? '✓ PERSONA PASS' : '✗ PERSONA FAIL';
  console.log(`\n${statusColor}${C.bold}${statusLabel}${C.reset} — ${clean}/${results.length} checks passed, ${hardFails} hard fail(s), ${warns} warn(s)`);

  return { name: persona.name, passed, hardFails, warns, total: results.length, clean };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // Load strains
  loadStrains();
  console.log(dim(`Loaded ${STRAINS.length} strains from public/strains.js`));

  // Parse CLI arguments
  const args = process.argv.slice(2);
  const personaIdx = args.indexOf('--persona');
  const fileIdx    = args.indexOf('--file');

  let personas = BUILT_IN_PERSONAS;

  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const customPath = path.resolve(args[fileIdx + 1]);
    personas = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    console.log(dim(`Loaded ${personas.length} custom persona(s) from ${customPath}`));
  } else if (personaIdx >= 0 && args[personaIdx + 1]) {
    const name = args[personaIdx + 1];
    const p = BUILT_IN_PERSONAS.find(p => p.name === name);
    if (!p) {
      console.error(`${C.red}Unknown persona: ${name}${C.reset}`);
      console.error('Available:', BUILT_IN_PERSONAS.map(p => p.name).join(', '));
      process.exit(1);
    }
    personas = [p];
  }

  console.log(`\n${C.bold}${C.cyan}Ivy Dogfood Agent${C.reset} — ${personas.length} persona(s) | Model: ${MODEL} | ${DELAY_MS}ms delay`);

  const summary = [];
  for (let i = 0; i < personas.length; i++) {
    const result = await runPersona(personas[i]);
    summary.push(result);
    if (i < personas.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Summary table
  const bar = '═'.repeat(50);
  console.log(`\n${C.bold}${C.cyan}${bar}\nSUMMARY\n${bar}${C.reset}\n`);

  let totalPassed = 0;
  for (const r of summary) {
    if (r.error) {
      console.log(`${C.red}✗ ERROR${C.reset}   ${r.name.padEnd(28)} ${r.error}`);
    } else if (r.passed) {
      totalPassed++;
      const warns = r.warns > 0 ? ` (${r.warns} warn)` : '';
      console.log(`${C.green}✓ PASS${C.reset}    ${r.name.padEnd(28)} ${r.clean}/${r.total} checks${warns}`);
    } else {
      console.log(`${C.red}✗ FAIL${C.reset}    ${r.name.padEnd(28)} ${r.hardFails} hard fail(s), ${r.warns} warn(s)`);
    }
  }

  const allPass = totalPassed === summary.length;
  console.log(`\n${allPass ? C.green : C.red}${C.bold}${totalPassed}/${summary.length} personas passed${C.reset}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
