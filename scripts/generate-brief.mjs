// SIGNAL Daily Brief Generator
// Runs daily via GitHub Actions. Fetches live prices + news, calls Gemini,
// writes daily_brief.json for the dashboard to display.
//
// Supports both Finnhub (US stocks) and Yahoo Finance (Malaysian + fallback).

import fs from 'node:fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY secret');
if (!FINNHUB_API_KEY) throw new Error('Missing FINNHUB_API_KEY secret');

// --- 1. Load portfolio -------------------------------------------------
const portfolio = JSON.parse(await fs.readFile('./portfolio.json', 'utf8'));

// --- 2. Fetch current prices -----------------------------------------
// US stocks via Finnhub, Malaysian stocks via Yahoo Finance (free, no key)

async function fetchFromFinnhub(symbol) {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.c || data.c === 0) return null; // Finnhub returns 0 for unsupported
    return {
      current: data.c,
      prevClose: data.pc,
      change: data.d,
      changePct: data.dp,
      source: 'finnhub',
    };
  } catch { return null; }
}

async function fetchFromYahoo(symbol) {
  // Convert Bursa code to Yahoo format: "SUNMED" (ticker 5555) → "5555.KL"
  // For non-standard symbols, allow a yahooTicker override in position
  const yahooSymbol = symbol === 'SUNMED' ? '5555.KL' : symbol;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const current = result.meta?.regularMarketPrice;
    const prevClose = result.meta?.previousClose;
    if (!current) return null;
    return {
      current,
      prevClose,
      change: current - prevClose,
      changePct: prevClose > 0 ? ((current - prevClose) / prevClose) * 100 : 0,
      source: 'yahoo',
    };
  } catch { return null; }
}

async function fetchPrice(pos) {
  const symbol = pos.symbol;
  // Malaysian stocks (KLSE) → Yahoo
  if (pos.currency === 'MYR' || pos.exchange === 'KLSE') {
    const yh = await fetchFromYahoo(symbol);
    if (yh) return yh;
    return { current: null, prevClose: null, source: 'none', error: 'No MY data' };
  }
  // US stocks → Finnhub first, Yahoo as fallback
  const fh = await fetchFromFinnhub(symbol);
  if (fh) return fh;
  const yh = await fetchFromYahoo(symbol);
  if (yh) return yh;
  return { current: null, prevClose: null, source: 'none', error: 'No data' };
}

console.log('[1/4] Fetching live prices...');
const pricesBySymbol = {};
for (const pos of portfolio.positions) {
  pricesBySymbol[pos.symbol] = await fetchPrice(pos);
  await new Promise(r => setTimeout(r, 300)); // rate limit cushion
}

// --- 3. Fetch general market news -------------------------------------
console.log('[2/4] Fetching market news...');
async function fetchGeneralNews() {
  try {
    const url = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const sixHoursAgo = Date.now() / 1000 - 6 * 60 * 60;
    return data
      .filter(n => n.datetime > sixHoursAgo)
      .slice(0, 15)
      .map(n => ({ headline: n.headline, source: n.source, datetime: n.datetime }));
  } catch (err) {
    console.warn('News fetch failed:', err.message);
    return [];
  }
}
const recentNews = await fetchGeneralNews();

// --- 4. Compute portfolio snapshot ------------------------------------
console.log('[3/4] Computing portfolio snapshot...');
const snapshot = portfolio.positions.map(pos => {
  const price = pricesBySymbol[pos.symbol];
  const currentPrice = price?.current || pos.avgCost;
  const costNative = pos.shares * pos.avgCost;
  const valueNative = pos.shares * currentPrice;
  const pnlNative = valueNative - costNative;
  const pnlPct = costNative > 0 ? (pnlNative / costNative) * 100 : 0;

  return {
    symbol: pos.symbol,
    shares: pos.shares,
    avgCost: pos.avgCost,
    currentPrice,
    costNative: Number(costNative.toFixed(2)),
    valueNative: Number(valueNative.toFixed(2)),
    pnlNative: Number(pnlNative.toFixed(2)),
    pnlPct: Number(pnlPct.toFixed(2)),
    currency: pos.currency,
    dayChangePct: price?.changePct ?? null,
    priceSource: price?.source || 'none',
  };
});

const rate = portfolio.usdMyrRate;
let totalValueMYR = 0, totalCostMYR = 0;
for (const p of snapshot) {
  const mul = p.currency === 'MYR' ? 1 : rate;
  totalValueMYR += p.valueNative * mul;
  totalCostMYR += p.costNative * mul;
}
const totalPnlMYR = totalValueMYR - totalCostMYR;
const totalPnlPct = totalCostMYR > 0 ? (totalPnlMYR / totalCostMYR) * 100 : 0;

// Flag positions near mental stops
const triggerAlerts = [];
for (const [symbol, stop] of Object.entries(portfolio.rules?.mentalStops || {})) {
  const p = snapshot.find(x => x.symbol === symbol);
  if (!p || !p.currentPrice) continue;
  const distance = ((p.currentPrice - stop.price) / stop.price) * 100;
  if (distance < 15) {
    triggerAlerts.push({
      symbol, currentPrice: p.currentPrice, stopPrice: stop.price,
      distancePct: Number(distance.toFixed(1)),
      action: stop.action,
      hit: p.currentPrice <= stop.price,
    });
  }
}

// --- Compute DYNAMIC sell ladders -----------------------------------
// Base ladder × currentMode × market overlays × per-position overlays
console.log('[3b/4] Computing dynamic sell ladders...');
const dynRules = portfolio.rules?.dynamicAdjustments;
const dynamicLadders = {};

// Estimate VIX by fetching from Finnhub (symbol ^VIX)
let vixLevel = null;
try {
  const vixRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=%5EVIX&token=${FINNHUB_API_KEY}`);
  if (vixRes.ok) {
    const vd = await vixRes.json();
    vixLevel = vd.c || null;
  }
} catch { /* ignore */ }

if (dynRules?.enabled) {
  const modeMultiplier = dynRules.availableModes[dynRules.currentMode]?.multiplier || 1.0;
  const activeOverlays = [];

  // Market VIX overlay
  let vixMultiplier = 1.0;
  if (vixLevel) {
    if (vixLevel > 30 && dynRules.marketOverlays.vix_above_30) {
      vixMultiplier = dynRules.marketOverlays.vix_above_30.multiplier;
      activeOverlays.push(`VIX ${vixLevel.toFixed(1)} → panic mode`);
    } else if (vixLevel > 25 && dynRules.marketOverlays.vix_above_25) {
      vixMultiplier = dynRules.marketOverlays.vix_above_25.multiplier;
      activeOverlays.push(`VIX ${vixLevel.toFixed(1)} → fear elevated`);
    } else if (vixLevel < 14 && dynRules.marketOverlays.vix_below_14) {
      vixMultiplier = dynRules.marketOverlays.vix_below_14.multiplier;
      activeOverlays.push(`VIX ${vixLevel.toFixed(1)} → complacency`);
    }
  }

  for (const [symbol, baseLadder] of Object.entries(portfolio.rules?.sellLadders || {})) {
    const p = snapshot.find(x => x.symbol === symbol);
    if (!p) continue;

    // Per-position overlays
    let posMultiplier = 1.0;
    const posActive = [];

    const posValueMYR = p.currency === 'MYR' ? p.valueNative : p.valueNative * rate;
    const concentrationPct = (posValueMYR / totalValueMYR) * 100;

    if (concentrationPct > 15 && dynRules.positionOverlays.concentration_above_15pct) {
      posMultiplier *= dynRules.positionOverlays.concentration_above_15pct.multiplier;
      posActive.push(`${concentrationPct.toFixed(0)}% concentration`);
    }
    if (p.pnlPct > 200 && dynRules.positionOverlays.gain_above_200pct) {
      posMultiplier *= dynRules.positionOverlays.gain_above_200pct.multiplier;
      posActive.push(`gain +${p.pnlPct.toFixed(0)}% (massive winner)`);
    } else if (p.pnlPct > 100 && dynRules.positionOverlays.gain_above_100pct) {
      posMultiplier *= dynRules.positionOverlays.gain_above_100pct.multiplier;
      posActive.push(`gain +${p.pnlPct.toFixed(0)}%`);
    }

    const combinedMult = modeMultiplier * vixMultiplier * posMultiplier;

    dynamicLadders[symbol] = {
      mode: dynRules.currentMode,
      modeMultiplier,
      vixMultiplier,
      posMultiplier: Number(posMultiplier.toFixed(3)),
      combinedMultiplier: Number(combinedMult.toFixed(3)),
      activeOverlays: [...activeOverlays, ...posActive],
      tranches: baseLadder.map(t => ({
        base: t.atPrice,
        adjusted: Number((t.atPrice * combinedMult).toFixed(2)),
        sellShares: t.sellShares,
        currentPrice: p.currentPrice,
        distanceToAdjustedPct: p.currentPrice > 0 ? Number((((t.atPrice * combinedMult) - p.currentPrice) / p.currentPrice * 100).toFixed(1)) : null,
        hit: p.currentPrice >= (t.atPrice * combinedMult),
      })),
    };
  }
}

// --- 5. Call Gemini for narrative analysis -----------------------------
console.log('[4/4] Calling Gemini for analysis...');

const prompt = `You are a professional quantitative trader and risk manager reviewing ${portfolio.profile.name}'s retail portfolio.

CORE PRINCIPLES (NON-NEGOTIABLE):
- Be objective, critical, and avoid confirmation bias
- Be strict, NOT optimistic
- Do NOT assume current positions are good just because they are profitable
- Prioritize capital preservation over opportunity
- Never recommend selling at a loss unless the thesis clearly broke
- Never override his pre-set sell ladders or mental stops
- Monthly VOO DCA is non-negotiable even in scary markets
- Do NOT fabricate price levels — if data is unclear, say so

HIS STRATEGY: ${portfolio.profile.strategy}
RISK TOLERANCE: ${portfolio.profile.riskTolerance}
HORIZON: ${portfolio.profile.horizon}

TODAY'S PORTFOLIO (${new Date().toISOString()}):
Total value: RM ${totalValueMYR.toFixed(2)} | Total P&L: RM ${totalPnlMYR.toFixed(2)} (${totalPnlPct.toFixed(2)}%)

POSITIONS:
${snapshot.map(p => `- ${p.symbol}: ${p.shares} shares @ ${p.currency === 'MYR' ? 'RM' : '$'}${p.avgCost} (now ${p.currency === 'MYR' ? 'RM' : '$'}${p.currentPrice?.toFixed(2) || '?'}) · P&L ${p.pnlPct}%${p.dayChangePct != null ? ` · Today ${p.dayChangePct.toFixed(2)}%` : ''}`).join('\n')}

PENDING IPO APPLICATIONS:
${JSON.stringify(portfolio.pending_ipos, null, 2)}

HIS RULES:
Mental stops: ${JSON.stringify(portfolio.rules?.mentalStops)}
Sell ladders (BASE): ${JSON.stringify(portfolio.rules?.sellLadders)}
DCA: ${JSON.stringify(portfolio.rules?.dcaTargets)}

DYNAMIC SELL LADDER ADJUSTMENTS (currentMode: ${dynRules?.currentMode || 'none'}, VIX: ${vixLevel?.toFixed(1) || 'unknown'}):
${JSON.stringify(dynamicLadders, null, 2)}
INSTRUCTION: When flagging sell actions, use the ADJUSTED trigger prices, not the base. Explain if an adjustment overlay changed the trigger meaningfully.

TRIGGER ALERTS (positions within 15% of stops):
${triggerAlerts.length === 0 ? 'None — all positions above stops' : JSON.stringify(triggerAlerts, null, 2)}

UPCOMING EVENTS:
${JSON.stringify(portfolio.watchlist?.macroEvents || [])}
Earnings: ${JSON.stringify(portfolio.watchlist?.upcomingEarnings || [])}

RECENT MARKET NEWS (last 6 hours):
${recentNews.map(n => `- ${n.headline} (${n.source})`).join('\n') || 'No major news'}

TASK: Produce a daily brief as STRICT JSON (no markdown, no code fences). Keep concise, honest, actionable:

{
  "generated_at": "ISO timestamp",
  "market_regime": "risk-on|constructive|neutral|cautious|risk-off",
  "regime_reasoning": "one short sentence",
  "portfolio_health": "healthy|mixed|concerning",
  "top_actions": [
    {
      "priority": "high|medium|low",
      "ticker": "SYMBOL or N/A",
      "action": "concise action verb (HOLD, TRIM, ADD, WATCH, DCA, etc.)",
      "reason": "one sentence on WHY now",
      "specific_steps": "exact Moomoo-executable step or null"
    }
  ],
  "watchlist_notes": [
    { "ticker": "SYMBOL", "note": "brief context" }
  ],
  "written_summary": "A 3-4 sentence narrative — what matters today, what to ignore, what to watch tomorrow. Direct and honest, not corporate.",
  "do_nothing_recommendation": true | false,
  "disclaimer": "Not financial advice. Review before executing."
}

RULES:
- Prefer "HOLD" / "do nothing" over forcing trades
- Only flag HIGH priority if a trigger genuinely hit or news is material
- Respect his mental stops and sell ladders strictly — never override them
- Never recommend selling at a loss unless thesis clearly broke
- Max 5 top_actions. Fewer is better.
- If portfolio_health is "concerning", explain exactly why
- For EACH action, briefly consider: what would prove this recommendation WRONG?
- Capital preservation > opportunity capture
- "Risk/reward" thinking — only act when asymmetric upside
- If no action is justified, say "do_nothing_recommendation": true and keep brief minimal

Return ONLY the JSON object. Nothing else.`;

const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;

const geminiRes = await fetch(geminiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  }),
});

if (!geminiRes.ok) {
  const errText = await geminiRes.text();
  throw new Error(`Gemini API failed ${geminiRes.status}: ${errText}`);
}

const geminiData = await geminiRes.json();
const geminiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
if (!geminiText) throw new Error('Gemini returned empty response');

let brief;
try {
  brief = JSON.parse(geminiText);
} catch (err) {
  console.error('Failed to parse Gemini JSON:', geminiText);
  brief = {
    generated_at: new Date().toISOString(),
    market_regime: 'neutral',
    portfolio_health: 'mixed',
    top_actions: [{ priority: 'low', ticker: 'N/A', action: 'HOLD', reason: 'Gemini parse failed, defaulting to no-action', specific_steps: null }],
    written_summary: 'Automated brief failed to parse. Check logs. No action recommended.',
    do_nothing_recommendation: true,
    disclaimer: 'Not financial advice.',
  };
}

// --- 6. Attach snapshot data ----------------------------------------
const output = {
  ...brief,
  generated_at: brief.generated_at || new Date().toISOString(),
  snapshot_data: {
    total_value_myr: Number(totalValueMYR.toFixed(2)),
    total_cost_myr: Number(totalCostMYR.toFixed(2)),
    total_pnl_myr: Number(totalPnlMYR.toFixed(2)),
    total_pnl_pct: Number(totalPnlPct.toFixed(2)),
    positions: snapshot,
    trigger_alerts: triggerAlerts,
    news_count: recentNews.length,
    dynamic_ladders: dynamicLadders,
    vix_level: vixLevel,
    current_mode: dynRules?.currentMode || 'normal',
  },
  _meta: {
    model: 'gemini-3.8-flash',
    prices_source: 'finnhub + yahoo',
    cost: 'free tier',
  },
};

await fs.writeFile('./daily_brief.json', JSON.stringify(output, null, 2));
console.log('✓ daily_brief.json written');
console.log(`Portfolio total: RM ${totalValueMYR.toFixed(2)} · P&L: ${totalPnlPct.toFixed(2)}%`);
console.log(`Trigger alerts: ${triggerAlerts.length} · Top actions: ${brief.top_actions?.length || 0}`);
