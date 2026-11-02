# SIGNAL Automation Setup Guide

## What this does

Every day at **5 AM Malaysia time** (after US market close):
1. GitHub Actions wakes up
2. Fetches current prices (US stocks + Malaysian stocks)
3. Sends your portfolio + news + rules to Gemini AI
4. Gets back a fresh daily brief with action recommendations
5. Writes `daily_brief.json` to your repo
6. Your SIGNAL dashboard displays it next time you open the app

**Cost: RM 0 forever.** Gemini free tier covers your usage.

---

## Step 1: Get your Gemini API key (5 minutes, FREE)

1. Open **https://aistudio.google.com/apikey** in browser
2. Sign in with your Google account (same one as Gemini Pro if you have it)
3. Click **"Create API key"** button
4. Choose **"Create API key in new project"** OR select existing project
5. Copy the key immediately — looks like: `AIzaSyA_1234567890abcdefghijklm`
6. Save it somewhere safe (Notes app, password manager)

⚠️ **Keep this key private.** Anyone with this key can use your free tier.

---

## Step 2: Confirm your Finnhub API key

You should already have this from earlier SIGNAL setup. If not:
1. Go to **https://finnhub.io/register**
2. Sign up with email
3. Copy API key from dashboard

---

## Step 3: Add both keys to GitHub Secrets (3 minutes)

1. Open your **`signal` GitHub repo**
2. Click **"Settings"** tab (top right, next to Insights)
3. Left sidebar → **"Secrets and variables"** → **"Actions"**
4. Click green **"New repository secret"** button
5. Add first secret:
   - **Name:** `GEMINI_API_KEY`
   - **Secret:** paste your Gemini key
   - Click **"Add secret"**
6. Click **"New repository secret"** again
7. Add second secret:
   - **Name:** `FINNHUB_API_KEY`
   - **Secret:** paste your Finnhub key
   - Click **"Add secret"**

Both secrets should now appear in the list (values hidden).

---

## Step 4: Upload the 4 files to your repo (5 minutes)

Open your `signal` repo. For each file below, do: **Add file → Upload files**

### File 1: `.github/workflows/daily-brief.yml`
This creates the folder path too. On GitHub:
1. Click **"Add file"** → **"Create new file"**
2. In filename, type: `.github/workflows/daily-brief.yml`
3. (The slashes auto-create the folders)
4. Open `daily-brief.yml` from this bundle, copy ALL contents
5. Paste into GitHub editor
6. Scroll down → click green **"Commit changes"**

### File 2: `scripts/generate-brief.mjs`
1. Click **"Add file"** → **"Create new file"**
2. Filename: `scripts/generate-brief.mjs`
3. Open `generate-brief.mjs` from bundle, copy all contents
4. Paste → **"Commit changes"**

### File 3: `portfolio.json`
1. Click **"Add file"** → **"Create new file"**
2. Filename: `portfolio.json`
3. Open `portfolio.json` from bundle, copy all contents
4. Paste → **"Commit changes"**

### File 4: `index.html` (replace existing)
1. In repo root, click existing `index.html`
2. Click pencil icon (edit) at top-right of file viewer
3. Delete all current content (Ctrl+A, Delete)
4. Open `index.html` from bundle, copy all contents
5. Paste → **"Commit changes"**

---

## Step 5: Test it manually (1 minute)

1. In your repo, click **"Actions"** tab (top navigation)
2. Left sidebar → click **"Daily Portfolio Brief"**
3. Click **"Run workflow"** button on the right
4. Confirm → **"Run workflow"** (green button)
5. Wait 30-60 seconds, refresh the page
6. You should see a workflow run with ✓ green checkmark

If ✓ green: setup works. If ✗ red: click the run → check logs → send me the error.

---

## Step 6: See it on your dashboard

1. Wait 1 minute for GitHub Pages to redeploy
2. Open **mrbuffaloburger.github.io/signal/**
3. Force-close the app on your phone and reopen (or hard refresh browser: Ctrl+Shift+R)
4. Scroll to the top — you'll see a **purple-bordered "Today's SIGNAL Brief"** section
5. Shows: regime, portfolio health, top actions, written summary

---

## After setup — your new routine

### Daily (0 time needed)
- Workflow runs at 5 AM MYT automatically
- No action from you

### Morning check (30 seconds)
- Open SIGNAL on phone
- Read the Daily Brief at the top
- See any flagged actions

### When you trade (edit portfolio.json)
When you buy or sell:
1. Go to repo → `portfolio.json`
2. Click pencil (edit)
3. Change `shares` or `avgCost` for the symbol
4. Commit the change
5. Next daily brief uses new data

### When you want fresh brief NOW
- Actions tab → Daily Portfolio Brief → Run workflow

---

## Troubleshooting

**"No daily brief available yet"** on dashboard
- Workflow hasn't run yet. Trigger manually (Step 5).

**Workflow failed with "Missing GEMINI_API_KEY"**
- Secret not added. Repeat Step 3.

**Workflow failed with Finnhub errors**
- Rate limited OR invalid key. Wait 1 minute, retry.

**Prices look wrong for SUNMED (Malaysian stock)**
- Yahoo Finance may be delayed 15 min for Bursa. Normal.

**Gemini returns weird JSON**
- Script has fallback. Just re-run workflow.

---

## Costs confirmation

- **GitHub Actions:** Free (your repo is public + daily job uses <1 min of quota)
- **Finnhub API:** Free (free tier handles this easily)
- **Gemini API:** Free (free tier is 1,500 requests/day; you use ~1/day)
- **Total: RM 0/month, forever** ✓

---

## When ready: next phases

Once Phase 1 is working for a week, we can add:
- **Phase 2:** Trade Log form in dashboard (no more editing JSON)
- **Phase 3:** Email alert when HIGH priority action detected
- **Phase 4:** Chat panel in SIGNAL (ask Gemini questions directly)

But get Phase 1 working first. Don't rush to Phase 2.
