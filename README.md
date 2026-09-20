# Blackjack Edge Calculator

A browser app that computes the long-run player (or house) edge of a blackjack game, given the
rules, the way you play, and how much you bet at each count.

Open `index.html` in a browser. There is nothing to install or build; it loads `engine.js` from the
same folder and recalculates within about 0.1 s of any change.

## What you can set

**Game rules**

| Setting | Options |
|---|---|
| Decks | 1–8 |
| Dealer on soft 17 | stands (S17) / hits (H17) |
| Blackjack pays | 3:2, 7:5, 6:5, 1:1, 2:1 |
| Doubling | any two cards, 9–11, 10–11 |
| Double after split | on / off |
| Late surrender | on / off |
| Splitting | up to 2, 3 or 4 hands; resplit aces; hit split aces |

The dealer peeks for blackjack (US rules). No-hole-card games are not modelled.

**Play conditions**

- **Penetration** (% of the shoe dealt before the reshuffle).
- **Single-deck shuffle: Auto.** For one deck the shoe can instead be reshuffled after a fixed number
  of rounds by number of spots at the table: 1 → 5 rounds, 2 → 4, 3 → 3, 4–7 → 2. Everyone is assumed
  to play basic strategy, and the app reports the resulting average penetration.
- **No mid-shoe entry / re-entry (single deck; on by default).** You can't join a single-deck game
  mid-shoe, so you must play the first hand after every shuffle, and once you sit out (bet 0) you can't
  come back until the next shuffle. See *How it works* for how this is modelled.
- **Boxes you play** (1–5) and **other players at the table**. Each of your boxes gets the same bet.
- **Playing strategy**
  - *Basic + count indices* – you play optimally for the current count (what a perfect set of index
    deviations achieves). No insurance.
  - *Basic + insurance at a count threshold* – fixed basic strategy plus insurance when the count at the
    moment insurance is offered reaches your threshold (default +3).
  - *Basic strategy only.*
- **Bet by:** Hi-Lo true count; the **KO** running count at any number of decks (2–7 +1, 8–9 0, T–A −1,
  starting at −4 × (decks − 1)); or, for single deck only, an unbalanced count
  (A 0, 2–6 +1, 7–9 0, T–K −1, starting at 0). The two running counts are not divided by decks
  remaining, and the bet rows are the actual running count.
- **Table minimum and maximum ($).** 1 unit = the table minimum, and every bet is kept between it and the
  maximum.
- Rounds per hour, for the hourly figures.

**Bets.** One bet (in units, per box) for each count from ≤ −1 through ≥ +10. The first row applies to
every count at or below −1 and the last to every count at or above +10. Hi-Lo true count is floored to
an integer.

- **Default spread:** the table minimum at every count where you have no edge, and the table maximum at
  every count where you have one (a count "has an edge" when its player edge, including insurance
  profit if selected, is above zero).
- **Custom ramp:** type your own bets (0 sits out), or start from a preset (flat, 1–4, 1–8, 1–12, Wong-out). With no
  mid-shoe entry the Wong-out preset bets 1 unit at count 0, because the first hand must be played.
  Bets are limited to the table maximum, and a bet under 1 unit is raised to 1.

## What you get

- Overall player or house edge per unit wagered for your bet ramp.
- The flat-bet edge and the fresh-shoe basic-strategy edge of the same game, for comparison.
- Average bet, expected profit per round and per hour, standard deviation per round, and N0
  (rounds for the edge to equal one standard deviation).
- A table and chart of each count's frequency, edge and share of profit.
- **Bankroll (Kelly criterion).** Give a target risk of ruin and the hours you will play, and it shows
  the bankroll needed, the bankroll needed if you never quit, and the full-Kelly bankroll. Optionally
  enter your own bankroll to see its risk of ruin over those hours and forever, and how your ramp
  compares with full Kelly. A "Full-Kelly bet" column shows the Kelly bet at each count for that bankroll
  (capped at the table maximum).

## How it works

1. **Edge at each count.** For each count bucket, the remaining shoe is rebuilt from the count and the
   average number of decks left in that bucket. Every player two-card hand against every dealer upcard is
   enumerated with card removal, and each hand's play (hit, stand, double, split, surrender, resplits,
   the peek) is solved exactly. Later draws use the remaining composition as fixed probabilities.
2. **Frequency of each count.** A seeded 300,000-round shoe simulation deals from a real shuffled shoe
   with your deck count, penetration and table size. Every player follows basic strategy, including
   doubles and splits, so cards per round are realistic.
3. **Combine.** Overall edge = Σ(frequency × bet × edge) / Σ(frequency × bet).

Details that matter:

- **Insurance is decided after the round's cards are out; bets are sized before.** The insurance count
  includes your cards, the other players' cards and the dealer's ace. It is taken when that count
  reaches your threshold, default +3 (Hi-Lo true count with the decks left at that moment, or the running
  count for KO/unbalanced; the best threshold in tests was about +2 to +3 for KO too). Its value
  (0.5 × (3 × P(ten) − 1) from the cards actually unseen) is added to the starting bucket's edge. So a
  starting bucket can be insured on only some dealer aces (◐ in the table; ⚑ = nearly always).
- **KO and unbalanced counts.** Both drift by +4 per 52 cards seen. The shoe for each running-count
  bucket is rebuilt from its average cards dealt and running count, treating the count's excess over
  that drift as extra low cards seen in place of high cards. At 6–8 decks the KO rows start at about
  −20, so the ≤ −1 row is most rounds and the ≥ +10 row is a wide range of strongly positive counts.
- **No mid-shoe entry.** With this rule the rounds you play depend on your own bets, so every simulated
  shoe is replayed in order against your ramp: the first hand is always played (at least 1 unit), you keep
  playing until the count says to sit out, and after that you get none of the shoe's remaining rounds.
  The first hand is a fresh deck at count 0 and is valued on its own; the later rounds that reach the same
  count are worse for the player (fewer lows would have been dealt than the count's natural drift), so
  they get a separate edge. The count table's "Frequency" then means the share of rounds you are seated at
  that count. Flat betting is essentially unaffected; ramps that sit out lose the later rounds.
- **Multiple boxes.** Edge per unit wagered is unchanged, and profit per round is multiplied by the
  number of boxes. Boxes share one dealer hand, so their results are correlated (measured correlation
  about 0.37, in `test/corr.js`); this is included in the standard deviation and N0. Your boxes also use
  cards, which shifts the count distribution. Rounds per hour is left as you enter it, so lower it when
  you play more boxes.
- **Bankroll model.** Your bankroll is treated as Brownian motion with your ramp's expected profit (μ)
  and variance (σ²) per round. Ruin means losing the whole bankroll with the ramp held fixed (no resizing).
  Ruin forever is exp(−2μB/σ²), so full-Kelly bankroll σ²/μ has a 13.5% chance of ruin, and the required
  bankroll for risk r is σ²/(2μ)·ln(1/r). For a finite number of hours the exact first-passage
  probability is used. It slightly overstates ruin because it monitors continuously rather than round by
  round. The Kelly bet at a count is bankroll × edge / (σ² + (boxes − 1) × covariance).
- **Variance.** One box's result has variance 1.32 per unit bet (measured 1.28–1.34 across rule sets).

## Accuracy

- Fresh-shoe basic-strategy house edges (`node test/known.js`) match published figures: for example
  8D S17 DAS 0.431% (published ≈ 0.43%) and 8D H17 DAS 0.649% (≈ 0.65%).
- A real-shoe Monte Carlo (`node test/mc.js 20000000`) plays the engine's own strategy with true card
  removal. In tests at 1, 2 and 6 decks, the analytic edge agreed with it to within about one standard
  error (about ±0.03%).
- The main approximation is that draws after the first three cards ignore later removal. It matters
  little at 2+ decks and slightly more at single deck.
- The insurance and count-frequency results come from simulation and carry sampling noise, most visible
  in rarely reached buckets (for example ≥ +10 at low penetration).

## Not modelled

Side bets, no-hole-card (European) games, early surrender, cut-card effects, resizing bets as the
bankroll changes, and the extra cards other players' hits remove from the shoe. When a bet is 0 you
still count as sitting out a dealt round, and your cards are still counted as consumed.

## Files

| File | Purpose |
|---|---|
| `index.html` | The user interface. |
| `engine.js` | The calculation engine; also usable from Node (`require('./engine.js')`). |
| `test/known.js` | Fresh-shoe house edges vs published figures. |
| `test/mc.js` | Real-shoe Monte Carlo cross-check of the analytic edge. |
| `test/corr.js` | Measures per-box variance and covariance between boxes. |

To serve the folder locally instead of opening the file: `python3 -m http.server 8765` and visit
`http://localhost:8765/index.html`.

Using the engine directly:

```js
const E = require('./engine.js');
const an = E.analyze({ decks: 6, h17: true, das: true, pen: 0.8, others: 2, boxes: 1,
                       strategy: 'index', countSystem: 'ko' });   // 'hilo' | 'ko' | 'ub' (1 deck)
const bets = an.buckets.map(b => b.edge > 0 ? 20 : 1);           // 1 unit, or 20 units with an edge
const res = E.evaluateBets(an, bets, { roundsPerHour: 100, unit: 25, boxes: 1 });
console.log(res);
console.log(E.bankrollPlan(res, { ror: 0.05, hours: 200, roundsPerHour: 100, unit: 25, bankroll: 30000 }));
```
