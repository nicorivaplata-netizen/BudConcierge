# Ivy Dogfood Agent

Autonomous testing agent for Ivy. Runs named personas against the live Anthropic API using
the same system prompt logic as `public/index.html`'s `buildSystem()`. Reads the real
strain database from `public/strains.js` at runtime so tests always run against current data.

---

## Setup

```bash
cd dogfood
npm install
```

Create a `.env` file in `dogfood/` with your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Or export it in your shell:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Commands

### Run all 8 built-in personas

```bash
node test.js
```

### Run one persona

```bash
node test.js --persona first_timer_sleep
node test.js --persona medical_ssri
node test.js --persona no_profile_cold
node test.js --persona antipsychotic_high_risk
node test.js --persona experienced_ptsd
node test.js --persona opioid_alternative
node test.js --persona returning_journal
node test.js --persona feedback_pivot
```

### Run custom personas from a JSON file

```bash
node test.js --file personas.example.json
node test.js --file my-custom-personas.json
```

---

## Exit codes

- `0` — all personas passed (no hard fails)
- `1` — one or more personas failed or API error

---

## Built-in personas

| Persona | Description | What it tests |
|---|---|---|
| `first_timer_sleep` | First timer with insomnia | Dosing guidance, REC format, no jargon |
| `medical_ssri` | Occasional user on Zoloft | SSRI flag, CBD-dominant rec, no refusal |
| `no_profile_cold` | No profile, just "Hello" | Name question, single question mark |
| `antipsychotic_high_risk` | Beginner on Seroquel | CBD-only, no THC, doctor push |
| `experienced_ptsd` | Experienced user with PTSD | PTSD-aware rec, no beginner lecture |
| `opioid_alternative` | Beginner on OxyContin | Warm validation, interaction flag |
| `returning_journal` | Has ACDC (5★) and Blue Dream (2★) history | Journal referenced by name |
| `feedback_pivot` | Blue Dream caused anxiety spike | Does not re-recommend flagged product |

---

## Check functions (26 total)

### Format checks
| Check | Level | What it verifies |
|---|---|---|
| `has_rec` | FAIL | Response contains at least one `REC\|\|\|` card |
| `english_only` | FAIL | Non-ASCII ratio < 5% |
| `one_question_mark` | WARN | Prose contains ≤ 1 question mark |
| `no_jargon` | WARN | No banned terms: terpenes, cannabinoids, bioavailability, sublingual, psychoactive, entourage effect, metabolize, myrcene, limonene, linalool, caryophyllene |

### Conversation protocol checks
| Check | Level | What it verifies |
|---|---|---|
| `asks_name` | FAIL | Response contains a name question for no-profile users |
| `asks_experience` | FAIL | Response asks about experience level |
| `asks_goals` | FAIL | Response asks about wellness goals |
| `asks_condition` | FAIL | Response asks the condition check question |
| `asks_medication` | FAIL | Response asks the medication check question |
| `protocol_order` | FAIL | Name asked before experience for no-profile users |

### Recommendation quality checks
| Check | Level | What it verifies |
|---|---|---|
| `dosing_guidance` | FAIL | First-timers get mandatory dosing instructions |
| `no_dosing_guidance` | WARN | Experienced users do not get beginner dosing lecture |
| `confident_tone` | WARN | No excessive hedging phrases |
| `multi_goal_addressed` | WARN | Multiple goals covered when persona has 2+ goals |
| `tolerance_mention` | WARN | Experienced users have tolerance acknowledged |

### Medication safety checks
| Check | Level | What it verifies |
|---|---|---|
| `cbd_dominant` | FAIL | CBD-dominant recommendation present for high-risk cases |
| `no_high_thc` | FAIL | No high-THC recommendation for high-risk medication users |
| `doctor_push` | FAIL | Doctor/professional consultation recommended in high-risk scenarios |
| `ssri_flag` | FAIL | SSRI/antidepressant interaction specifically flagged |
| `flags_interaction` | WARN | General interaction or combination effect mentioned |

### Tone and safety checks
| Check | Level | What it verifies |
|---|---|---|
| `no_refusal` | FAIL | No refusal language ("I can't help", "I won't recommend") |
| `no_shame` | FAIL | No shame language ("you shouldn't", "risky choice") |
| `validates_warmly` | WARN | Warm validation present before medical information |
| `ptsd_aware` | WARN | PTSD-specific content (nightmares, hyperarousal, 1:1 ratio) |

### Returning user checks
| Check | Level | What it verifies |
|---|---|---|
| `journal_referenced` | FAIL | Product from journal history mentioned by name |
| `pivots_on_feedback` | FAIL | Flagged product (rated ≤ 2★) not in REC cards |

---

## Check severity

**FAIL** — hard failure. The persona fails if any FAIL check does not pass.  
**WARN** — advisory. Counted in output but does not fail the persona.

---

## Custom persona JSON format

```json
[
  {
    "name": "my_persona",
    "description": "What this persona tests",
    "profile": {
      "name": "Alex",
      "experience": "first_time",
      "goals": ["Better sleep"],
      "conditions": [],
      "medications": "",
      "time": ["evening"],
      "products": [],
      "gender": "",
      "hormonal": "",
      "cycle": "",
      "hormonal_conditions": "",
      "strain_pref": []
    },
    "journal": [],
    "strainHistory": [],
    "conversationHistory": [],
    "userMessage": "What do you recommend for sleep?",
    "checks": ["has_rec", "dosing_guidance", "no_jargon"]
  }
]
```

### Experience values
`first_time` | `beginner` | `occasional` | `regular` | `experienced`

### Journal entry format
```json
{ "product": "ACDC", "rating": 5, "notes": "Worked great for sleep", "date": "2026-06-01" }
```

### Strain history format
```json
{ "name": "Blue Dream", "rating": 2 }
```

Ratings ≥ 4 are marked "worked well". Ratings ≤ 2 are marked "did not work" and trigger the `pivots_on_feedback` check.

---

## When to run

- **Before any commit that touches `buildSystem()`** — verifies the prompt rebuild didn't break any persona path
- **After adding new strains** — confirms strain data loads and new products appear in responses
- **After changing medication rules** — run `antipsychotic_high_risk` and `medical_ssri` individually
- **After changing CHIP FORMAT or REC FORMAT** — run `no_profile_cold` and `first_timer_sleep`
- **After any change to the no-profile onboarding flow** — run `no_profile_cold`

---

## Estimated cost per run

All 8 personas use `claude-sonnet-4-6` with `max_tokens: 1000`.

| Item | Estimate |
|---|---|
| Input tokens per persona | ~2,500 (system prompt ~2,000 + conversation ~500) |
| Output tokens per persona | ~400 average |
| Total tokens for 8 personas | ~23,200 input + ~3,200 output |
| Approximate cost | ~$0.08–$0.12 per full run |

Single persona: ~$0.01.

---

## Model

`claude-sonnet-4-6` — same model used by the production API proxy in `api/chat.js`.
