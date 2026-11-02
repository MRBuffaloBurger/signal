# Dynamic Sell Ladders — How It Works

## The problem with static ladders

Static ladders (e.g. "trim MRVL at $275") don't adapt to:
- Changing market conditions (VIX spike, regime shift)
- Changing position health (concentration growing, gain exploding)
- Your personal mood/stance (confident vs scared)

**Result:** Trigger misses, late exits, giving back gains.

## The dynamic system

Your sell ladders now auto-adjust using **three layers of multipliers**:

### Layer 1: Your mode (manual — you set this)

In `portfolio.json` → `rules.dynamicAdjustments.currentMode`:

| Mode | Multiplier | When to use |
|---|---|---|
| `defensive` | 0.85 | Scared / want to lock gains early |
| `normal` | 1.00 | Default, calm conditions |
| `opportunistic` | 1.10 | Confident / let runners run |

**Switch anytime** by editing one word in portfolio.json and committing.

### Layer 2: Market VIX overlay (automatic — script reads VIX)

| VIX level | Multiplier | Why |
|---|---|---|
| > 30 | 0.80 | Panic mode — tighten 20% |
| > 25 | 0.90 | Fear elevated — tighten 10% |
| < 14 | 1.05 | Complacency — slightly looser |

### Layer 3: Per-position overlay (automatic — script reads your portfolio)

| Condition | Multiplier | Why |
|---|---|---|
| Position > 15% of portfolio | 0.90 | Over-concentrated |
| Gain > 200% | 0.92 | Massive winner — lock big win |
| Gain > 100% | 0.96 | Big winner — slight tightening |

## Example: MRVL in current market

**Base ladder:** Trim 2 shares at $275

**Current conditions (Nov 2, 2026):**
- Your mode: `defensive` (you're nervous after Alphabet selloff) → 0.85
- VIX ~22 (elevated but not fear-level) → 1.00
- MRVL is +211% gain → 0.92
- MRVL is ~10% of portfolio → 1.00

**Combined multiplier:** 0.85 × 1.00 × 0.92 × 1.00 = **0.782**

**Adjusted trigger:** $275 × 0.782 = **$215**

**So instead of waiting for $275, you trim MRVL at $215** — which is actually where it's close to right now. Immediate action instead of waiting.

## How to use

### Change your mode
Edit `portfolio.json`:

```json
"currentMode": "defensive"   // Options: defensive | normal | opportunistic
```

Commit → next daily brief uses new mode.

### See adjusted triggers in dashboard
The Daily Brief panel now shows:

```
◆ DYNAMIC SELL LADDERS · MODE: DEFENSIVE · VIX 22.1

MRVL · ×0.782 combined
  Overlays: gain +211% (massive winner)
  Base $275 → $215 sell 2 sh · ● HIT
  Base $290 → $227 sell 2 sh · +5% away

NBIS · ×0.782 combined
  Overlays: gain +95%
  Base $240 → $188 sell 0.5 sh · +12% away
```

### Change the multipliers themselves (advanced)
Edit `portfolio.json` → `rules.dynamicAdjustments`:

- Mode multipliers (defensive/normal/opportunistic)
- VIX thresholds and multipliers
- Position overlay thresholds

All multipliers compound: `combined = mode × vix × position`.

## Decision guide: Which mode?

### Switch to DEFENSIVE when:
- VIX > 20 for 3+ consecutive days
- Portfolio total P&L drops 5% in a week
- Major news event looming (election, earnings, Fed)
- You feel scared

### Switch to NORMAL when:
- Markets calm, VIX < 18
- No major events in next 2 weeks
- Portfolio tracking expected

### Switch to OPPORTUNISTIC when:
- Strong momentum confirmed (SPX up 5%+ in month)
- VIX < 14
- Portfolio winning positions all above entry
- You feel confident

**Default: stay NORMAL. Only switch when the data genuinely says to.**

## Why this isn't gambling

Each adjustment is:
1. **Pre-committed** (you set the rules upfront)
2. **Transparent** (you see every multiplier)
3. **Formula-based** (not AI feeling-based)
4. **Reversible** (change mode anytime)

**This is systematic rebalancing, not panic trading.**

## The 5-second check

Open SIGNAL → scroll to Daily Brief → look at "◆ DYNAMIC SELL LADDERS" section.

If any trigger shows **● HIT** → execute the trim on Moomoo today.

That's it.
