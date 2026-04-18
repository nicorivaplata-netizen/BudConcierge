# BudConcierge

AI-powered cannabis recommendation app. Personalized guidance for dispensary
customers and medical patients — no judgment, no stigma, every background welcome.

---

## Deploy in 15 minutes

### What you need first
- Node.js installed → https://nodejs.org (download LTS version)
- GitHub account → https://github.com (free)
- Anthropic API key → https://console.anthropic.com (free to start)
- Vercel account → https://vercel.com (free, sign up with GitHub)

---

### Step 1 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key — it looks like: sk-ant-api03-...
6. Save it somewhere safe (you'll need it in Step 4)

---

### Step 2 — Put this project on GitHub

1. Go to https://github.com and log in
2. Click the "+" icon → "New repository"
3. Name it: budconcierge
4. Leave it Public (required for free Vercel hosting)
5. Click "Create repository"
6. On your computer, open Terminal (Mac) or Command Prompt (Windows)
7. Run these commands one by one:

   cd Desktop                          ← or wherever you saved this folder
   cd budconcierge
   git init
   git add .
   git commit -m "Initial BudConcierge build"
   git branch -M main
   git remote add origin https://github.com/YOURUSERNAME/budconcierge.git
   git push -u origin main

   (Replace YOURUSERNAME with your actual GitHub username)

---

### Step 3 — Deploy to Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click "Add New Project"
3. Find "budconcierge" in your list and click "Import"
4. Leave all settings as default
5. Click "Deploy"
6. Wait ~60 seconds — Vercel builds your app

---

### Step 4 — Add your API key (critical!)

1. In Vercel, go to your project → Settings → Environment Variables
2. Add this variable:
   - Name:  ANTHROPIC_API_KEY
   - Value: (paste your key from Step 1)
3. Click Save
4. Go to Deployments → click the 3 dots on your latest deployment → "Redeploy"
5. Wait 30 seconds

Your app is now live at: https://budconcierge.vercel.app
(Vercel gives you a free URL automatically)

---

### Step 5 — Custom domain (optional, ~$12/year)

1. Buy a domain at https://namecheap.com (search "budconcierge.com" or similar)
2. In Vercel → Settings → Domains → Add your domain
3. Vercel shows you DNS records to add — copy them into Namecheap's DNS settings
4. Wait up to 24 hours for it to go live worldwide (usually under 1 hour)

---

## Cost breakdown

| Service         | Cost          | Notes                          |
|----------------|---------------|-------------------------------|
| Vercel hosting | Free          | Up to 100GB bandwidth/month   |
| Anthropic API  | ~$0.003/chat  | Pay as you go, no minimum     |
| Domain name    | ~$12/year     | Optional                      |
| Total at 100 users/day | ~$15/month | Scales with usage |

---

## Selling to dispensaries

**Pitch**: "We put a 24/7 AI budtender on your website and in your store — for less
than one hour of staff time per month."

**Pricing ideas**:
- $149/month per dispensary location (white-label, their branding)
- $299/month with menu integration (matches their live inventory)
- Revenue share: 2% of attributed sales

**How to approach them**:
1. Build a demo with a local dispensary's actual menu
2. Show the before/after: generic menu vs BudConcierge recommendations
3. Offer a 30-day free trial
4. Ask for an intro to their marketing manager, not the owner

---

## File structure

```
budconcierge/
├── api/
│   └── chat.js          ← Backend proxy (keeps API key secret)
├── public/
│   ├── index.html       ← Main app (Home + Chat + Profile)
│   ├── strains.js       ← Strain database (30 products)
│   └── styles.css       ← Global styles
├── vercel.json          ← Deployment config
├── package.json         ← Project metadata
└── README.md            ← This file
```

---

## Tech stack

- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework needed)
- **Backend**: Vercel Edge Functions (Node.js)
- **AI**: Anthropic Claude Sonnet 4
- **Storage**: localStorage (browser) — no database needed for v1
- **Hosting**: Vercel (free tier)

---

Built with Claude · For questions: rebuild the chat history in claude.ai
