/*
 * Blackjack edge engine.
 *
 * For a given rule set it computes, for every Hi-Lo true-count bucket (<=-1 ... >=+10):
 *   - how often that bucket occurs at the start of a round (shoe simulation), and
 *   - the player's expected value per unit bet in that bucket (exact enumeration).
 *
 * EV method: the remaining shoe is described by a (fractional) rank composition that
 * matches the true count and decks remaining. The initial 3 cards (2 player + dealer up)
 * are enumerated exactly with removal; later draws use the remaining composition as fixed
 * probabilities (the usual "effect of removal" approximation - error is tiny for >=2 decks).
 * Strategy is total-dependent (like real basic strategy / index play), never card-by-card.
 */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const NEG = -1e9;

  function normalizeRules(r) {
    return Object.assign({
      decks: 6, h17: true, das: true, bj: 1.5, surrender: false,
      doubleRule: 'any',          // 'any' | '9-11' | '10-11'
      resplitAces: false, hitSplitAces: false,
      maxHands: 4,                // total hands after resplitting (2..4)
      pen: 0.75,                  // fraction of shoe dealt before reshuffle
      others: 2,                  // other players at the table (only affects count distribution)
      boxes: 1,                   // boxes (spots) you play each round; each gets the same bet
      countSystem: 'hilo',        // 'hilo' true count | 'ub' unbalanced running count (single deck only) | 'ko' KO running count
      insThreshold: 3,            // insurance is taken when the count at the offer is >= this
      noMidEntry: false,          // single deck: no mid-shoe entry / re-entry; you must play each shoe's first hand
      autoPen: false,             // single deck only: shuffle after N rounds (by player count)
      strategy: 'index',          // 'basic' | 'basic-ins' (basic + insurance at TC>=+3) | 'index' (optimal at each count)
    }, r || {});
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Shoe composition (real-valued rank counts, index 1..10, 10 = all ten-valued cards)
  // with `R` decks remaining and Hi-Lo true count `tc`.
  function makeComposition(tc, R) {
    const k = tc * R;                       // running count of cards seen; remaining tag sum = -k
    const a = (52 * R + Math.abs(k)) / 52;
    const c = new Float64Array(11);
    for (let r = 1; r <= 9; r++) c[r] = 4 * a;
    c[10] = 16 * a;
    if (k > 0) { for (let r = 2; r <= 6; r++) c[r] -= k / 5; }
    else if (k < 0) { c[10] -= 0.8 * -k; c[1] -= 0.2 * -k; }
    for (let r = 1; r <= 10; r++) if (c[r] < 0.001) c[r] = 0.001;
    return c;
  }

  // Composition for the unbalanced (running-count) systems, with R of D decks remaining.
  //   'ub': A 0, 2-6 +1, 7-9 0, T -1 (single deck).   'ko': 2-7 +1, 8-9 0, T/A -1, initial count -4(D-1).
  // Both drift by +4 per 52 cards seen. A proportional seen set gives that drift; any excess d over it is
  // modelled as d/2 seen high cards swapped for seen low cards.
  function makeCompositionUnbal(rc, R, D, sys, irc) {
    const n = 52 * (D - R), d = (rc - irc) - 4 * n / 52;
    const c = new Float64Array(11);
    for (let r = 1; r <= 9; r++) c[r] = 4 * R;
    c[10] = 16 * R;
    const hi = sys === 'ko' ? 7 : 6;
    for (let r = 2; r <= hi; r++) c[r] -= d / 2 / (hi - 1);
    if (sys === 'ko') { c[10] += 0.8 * d / 2; c[1] += 0.2 * d / 2; } else c[10] += d / 2;
    for (let r = 1; r <= 10; r++) if (c[r] < 0.001) c[r] = 0.001;
    return c;
  }

  // state encoding: key = total*2 + soft
  function nextKey(t, s, r) {
    let nt, ns = s;
    if (r === 1) {
      if (s) nt = t + 1;
      else if (t + 11 <= 21) { nt = t + 11; ns = 1; }
      else nt = t + 1;
    } else nt = t + r;
    if (nt > 21 && ns) { nt -= 10; ns = 0; }
    return nt * 2 + ns;
  }

  // ---------- dealer ----------
  // Returns {d:[p17,p18,p19,p20,p21,pBust] (conditional on no dealer blackjack), pBJ}
  function dealerDist(q, up, h17) {
    const memo = [];
    function f(t, s) {
      const key = t * 2 + s;
      if (memo[key]) return memo[key];
      const out = new Float64Array(6);
      if (t >= 18 || (t === 17 && !(s && h17))) out[t - 17] = 1;
      else {
        for (let r = 1; r <= 10; r++) {
          const nk = nextKey(t, s, r), nt = nk >> 1;
          if (nt > 21) out[5] += q[r];
          else { const sub = f(nt, nk & 1); for (let i = 0; i < 6; i++) out[i] += q[r] * sub[i]; }
        }
      }
      return (memo[key] = out);
    }
    const st = up === 1 ? 11 : up, ss = up === 1 ? 1 : 0;
    if (up === 1 || up === 10) {
      const excl = up === 1 ? 10 : 1;
      const pBJ = q[excl], norm = 1 - pBJ;
      const out = new Float64Array(6);
      for (let r = 1; r <= 10; r++) {
        if (r === excl) continue;
        const nk = nextKey(st, ss, r), nt = nk >> 1;
        const w = q[r] / norm;
        if (nt > 21) out[5] += w;
        else { const sub = f(nt, nk & 1); for (let i = 0; i < 6; i++) out[i] += w * sub[i]; }
      }
      return { d: out, pBJ };
    }
    return { d: f(st, ss), pBJ: 0 };
  }

  // ---------- player ----------
  function canDouble(rules, t, s) {
    if (rules.doubleRule === 'any') return true;
    if (s) return false;
    if (rules.doubleRule === '9-11') return t >= 9 && t <= 11;
    return t >= 10 && t <= 11;
  }

  function newPolicy() { return { m: [[], []], ps: [[], []], init: {}, rs: {} }; }

  // Build value tables for one (composition q, dealer dist) pair.
  // pol: existing policy to follow, or null; rec: policy object to record optimal decisions into.
  function buildCtx(q, dd, rules, pol, rec) {
    const S = new Float64Array(22);
    const d = dd.d;
    for (let t = 0; t <= 21; t++) {
      let v = d[5];
      for (let i = 0; i < 5; i++) { const dv = 17 + i; v += d[i] * (t > dv ? 1 : (t < dv ? -1 : 0)); }
      S[t] = v;
    }
    const Vm = [new Float64Array(22), new Float64Array(22)];
    const Hv = [new Float64Array(22), new Float64Array(22)];

    function step(t, s) {
      let hit = 0;
      for (let r = 1; r <= 10; r++) {
        const nk = nextKey(t, s, r), nt = nk >> 1;
        hit += q[r] * (nt > 21 ? -1 : Vm[nk & 1][nt]);
      }
      const stand = S[t];
      let act = hit > stand ? 1 : 0;
      if (pol && pol.m[s][t] !== undefined) act = pol.m[s][t];
      if (rec) rec.m[s][t] = act;
      Hv[s][t] = hit;
      Vm[s][t] = act ? hit : stand;
    }
    for (let t = 21; t >= 11; t--) step(t, 0);
    for (let t = 21; t >= 12; t--) step(t, 1);
    for (let t = 10; t >= 4; t--) step(t, 0);

    function doubleEV(t, s) {
      let v = 0;
      for (let r = 1; r <= 10; r++) {
        const nk = nextKey(t, s, r), nt = nk >> 1;
        v += q[r] * (nt > 21 ? -1 : S[nt]);
      }
      return 2 * v;
    }

    // post-split single-hand value (no surrender, no split) for two-card total (t,s)
    function psValue(t, s) {
      const o = [S[t], Hv[s][t], (rules.das && canDouble(rules, t, s)) ? doubleEV(t, s) : NEG];
      let act = 0;
      if (pol && pol.ps[s][t] !== undefined) act = pol.ps[s][t];
      else { for (let i = 1; i < 3; i++) if (o[i] > o[act]) act = i; }
      if (rec) rec.ps[s][t] = act;
      return o[act];
    }

    const M = rules.maxHands;
    const splitCache = {};
    function splitEV(r) {
      if (splitCache[r] !== undefined) return splitCache[r];
      const T = new Array(M + 2).fill(0);
      for (let k = M; k >= 2; k--) {
        let v = 0;
        for (let x = 1; x <= 10; x++) {
          let t, s;
          if (r === 1 && x === 1) { t = 12; s = 1; }
          else if (r === 1 || x === 1) { t = (r + x - 1) + 11; s = 1; }
          else { t = r + x; s = 0; }
          const canResplit = x === r && k < M && (r !== 1 || rules.resplitAces);
          let base;
          if (r === 1 && !rules.hitSplitAces) base = S[t];
          else base = psValue(t, s);
          let w = base;
          if (canResplit) {
            const sp = 2 * T[k + 1];
            const key = r * 10 + k;
            let act = sp > base ? 1 : 0;
            if (pol && pol.rs[key] !== undefined) act = pol.rs[key];
            if (rec) rec.rs[key] = act;
            if (act) w = sp;
          }
          v += q[x] * w;
        }
        T[k] = v;
      }
      return (splitCache[r] = 2 * T[2]);
    }

    // conditional-on-no-dealer-BJ EV of an initial two-card hand
    function evInitial(p1, p2) {
      if ((p1 === 1 && p2 === 10) || (p1 === 10 && p2 === 1)) return rules.bj;
      let t, s;
      if (p1 === 1 && p2 === 1) { t = 12; s = 1; }
      else if (p1 === 1 || p2 === 1) { t = (p1 + p2 - 1) + 11; s = 1; }
      else { t = p1 + p2; s = 0; }
      const key = p1 <= p2 ? p1 * 11 + p2 : p2 * 11 + p1;
      // actions: 0 stand, 1 hit, 2 double, 3 split, 4 surrender
      if (pol && pol.init[key] !== undefined) {
        const a = pol.init[key];
        if (a === 0) return S[t];
        if (a === 1) return Hv[s][t];
        if (a === 2) return canDouble(rules, t, s) ? doubleEV(t, s) : Math.max(S[t], Hv[s][t]);
        if (a === 3) return p1 === p2 ? splitEV(p1) : Math.max(S[t], Hv[s][t]);
        return rules.surrender ? -0.5 : Math.max(S[t], Hv[s][t]);
      }
      const o = [S[t], Hv[s][t],
        canDouble(rules, t, s) ? doubleEV(t, s) : NEG,
        p1 === p2 ? splitEV(p1) : NEG,
        rules.surrender ? -0.5 : NEG];
      let act = 0;
      for (let i = 1; i < 5; i++) if (o[i] > o[act]) act = i;
      if (rec) rec.init[key] = act;
      return o[act];
    }
    return { evInitial };
  }

  function derivePolicy(c, rules, up) {
    let N = 0; for (let r = 1; r <= 10; r++) N += c[r];
    const q = new Float64Array(11);
    const cc = Float64Array.from(c); cc[up] -= 1; N -= 1;
    for (let r = 1; r <= 10; r++) q[r] = cc[r] / N;
    const dd = dealerDist(q, up, rules.h17);
    const pol = newPolicy();
    const ctx = buildCtx(q, dd, rules, null, pol);
    for (let p1 = 1; p1 <= 10; p1++) for (let p2 = p1; p2 <= 10; p2++) ctx.evInitial(p1, p2);
    return pol;
  }

  // Player EV per unit initial bet for a shoe with composition c.
  // pols: array (index=upcard) of fixed policies, or null to play optimally for this composition.
  function compositionEV(c, rules, pols) {
    let N = 0; for (let r = 1; r <= 10; r++) N += c[r];
    if (!pols) { pols = []; for (let u = 1; u <= 10; u++) pols[u] = derivePolicy(c, rules, u); }
    const cc = new Float64Array(11), q = new Float64Array(11);
    let total = 0;
    for (let up = 1; up <= 10; up++) {
      for (let p1 = 1; p1 <= 10; p1++) {
        for (let p2 = p1; p2 <= 10; p2++) {
          // ordered probability of (p1,p2,up)
          const rem = Float64Array.from(c);
          let w = 1, n = N;
          let ok = true;
          for (const card of [p1, p2, up]) {
            if (rem[card] < 0.999) { if (rem[card] <= 0) { ok = false; break; } }
            w *= rem[card] / n; rem[card] -= 1; n -= 1;
            if (rem[card] < 0) rem[card] = 0;
          }
          if (!ok || w <= 0) continue;
          if (p1 !== p2) w *= 2;
          for (let r = 1; r <= 10; r++) q[r] = rem[r] / n;
          const dd = dealerDist(q, up, rules.h17);
          const ctx = buildCtx(q, dd, rules, pols[up], null);
          const e = ctx.evInitial(p1, p2);
          const pbj = dd.pBJ;
          const pnat = (p1 === 1 && p2 === 10) || (p1 === 10 && p2 === 1);
          total += w * (pbj * (pnat ? 0 : -1) + (1 - pbj) * e);
        }
      }
    }
    return total;
  }

  // ---------- true-count distribution by simulation ----------
  // Rounds dealt per shuffle in single-deck games, by total players at the table.
  function roundsPerShuffle(players) { return players <= 1 ? 5 : players === 2 ? 4 : players === 3 ? 3 : 2; }

  function simulateCounts(rules, rounds) {
    const D = rules.decks, total = 52 * D;
    const auto = !!rules.autoPen && D === 1;
    const spots = rules.others + rules.boxes;   // every box is a hand dealt from the shoe
    const rps = roundsPerShuffle(spots);
    const maxCut = total - (6 + 3.6 * spots); // leave enough cards to finish a round
    const cut = Math.min(Math.floor(rules.pen * total), Math.max(10, Math.floor(maxCut)));
    const rng = mulberry32(20240919 + D * 131 + Math.round(rules.pen * 1000) + (auto ? 7 : 0) + (rules.countSystem === 'ub' ? 3 : 0));
    const shoe = new Uint8Array(total);
    const sys = rules.countSystem === 'ko' ? 'ko' : (rules.countSystem === 'ub' && D === 1 ? 'ub' : 'hilo');
    const ub = sys !== 'hilo';                       // unbalanced: bets/insurance use the raw running count
    const irc = sys === 'ko' ? -4 * (D - 1) : 0;     // KO initial running count
    const tag = sys === 'ko' ? [0, -1, 1, 1, 1, 1, 1, 1, 0, 0, -1]
      : sys === 'ub' ? [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, -1] : [0, -1, 1, 1, 1, 1, 1, 0, 0, 0, -1];
    let pos = 0, rc = 0, tensSeen = 0, sinceShuffle = 0, shuffles = 0, dealtAtShuffle = 0;
    // every player (and the card-consumption model) follows basic strategy
    const c0 = makeComposition(0, D);
    const pols = []; for (let u = 1; u <= 10; u++) pols[u] = derivePolicy(c0, rules, u);
    const M = rules.maxHands;

    function reshuffle() {
      let i = 0;
      for (let d = 0; d < D; d++) for (let r = 1; r <= 10; r++) {
        const n = r === 10 ? 16 : 4;
        for (let j = 0; j < n; j++) shoe[i++] = r;
      }
      for (let j = total - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        const t = shoe[j]; shoe[j] = shoe[k]; shoe[k] = t;
      }
      pos = 0; rc = irc; tensSeen = 0; sinceShuffle = 0;
    }
    function draw() {
      if (pos >= total) reshuffle();
      const r = shoe[pos++]; rc += tag[r]; if (r === 10) tensSeen++; return r;
    }
    const tot = (t, aces) => (aces && t + 10 <= 21) ? [t + 10, 1] : [t, 0];

    // Play out one hand under the policy; returns true if the hand is still live (not bust/surrendered).
    function playHand(pol, c1, c2, isSplit, a0) {
      let t = c1 + c2, aces = (c1 === 1) + (c2 === 1), first = true;
      for (;;) {
        const [T, s] = tot(t, aces);
        if (T > 21) return false;
        let act;
        if (first) act = isSplit ? pol.ps[s][T] : a0; else act = pol.m[s][T];
        first = false;
        if (act === undefined) act = 0;
        if (act === 2) { const r = draw(); t += r; if (r === 1) aces++; return tot(t, aces)[0] <= 21; }
        if (act === 1) { const r = draw(); t += r; if (r === 1) aces++; continue; }
        return true;
      }
    }
    function playSplit(pol, r) {
      const st = { count: 2 };
      const work = [r, r];
      let live = false;
      const locked = r === 1 && !rules.hitSplitAces;
      while (work.length) {
        work.pop();
        const x = draw();
        if (x === r && st.count < M && (r !== 1 || rules.resplitAces) && pol.rs[r * 10 + st.count]) {
          st.count++; work.push(r, r); continue;
        }
        if (locked) live = true;
        else if (playHand(pol, r, x, true, 0)) live = true;
      }
      return live;
    }

    const buckets = [];
    for (let i = 0; i < 12; i++) buckets.push({ n: 0, sumTC: 0, sumR: 0, aceN: 0, insN: 0, insSum: 0 });
    const first = { n: 0, sumTC: 0, sumR: 0, aceN: 0, insN: 0, insSum: 0 };   // first round after each shuffle only
    const seq = new Uint8Array(rounds), fl = new Uint8Array(rounds);          // per round: bucket index, first-round flag
    const insDetail = {};   // diagnostics: insurance value by round-since-shuffle and count at the offer
    reshuffle();
    for (let round = 0; round < rounds; round++) {
      if (auto ? sinceShuffle >= rps : pos >= cut) { dealtAtShuffle += pos; shuffles++; reshuffle(); }
      sinceShuffle++;
      const R = Math.max(0.25, (total - pos) / 52);
      const tc = ub ? rc : rc / R;   // 'ub': raw running count from the top of the shoe
      let b = Math.floor(tc);
      if (b < -1) b = -1; if (b > 10) b = 10;
      const B = buckets[b + 1], isFirst = sinceShuffle === 1;
      B.n++; B.sumTC += tc; B.sumR += R;
      seq[round] = b + 1; fl[round] = isFirst ? 1 : 0;
      if (isFirst) { first.n++; first.sumTC += tc; first.sumR += R; }

      const players = [];
      for (let p = 0; p < spots; p++) players.push([draw(), draw()]);
      const up = draw();
      // Insurance is decided when offered: after every initial card except the hole card is out
      // (this player's, the other players' and the dealer's ace), so the count includes them.
      const rcSnap = rc, unseen = total - pos, tensSnap = tensSeen;
      const hole = draw();
      if (up === 1 && unseen > 0) {
        B.aceN++; if (isFirst) first.aceN++;
        const cnt = ub ? rcSnap : rcSnap / Math.max(0.25, unseen / 52);
        const ev = 0.5 * (3 * (16 * D - tensSnap) / unseen - 1);
        const dk = sinceShuffle + '|' + Math.floor(cnt + 1e-9), dd = insDetail[dk] || (insDetail[dk] = { n: 0, sumEV: 0, sumSeen: 0 });
        dd.n++; dd.sumEV += ev; dd.sumSeen += total - unseen;
        if (cnt >= rules.insThreshold) {   // half-unit bet paying 2:1: EV = 0.5 * (3*P(ten) - 1), P(ten) from the true unseen cards
          const v = 0.5 * (3 * (16 * D - tensSnap) / unseen - 1);
          B.insN++; B.insSum += v;
          if (isFirst) { first.insN++; first.insSum += v; }
        }
      }
      const dBJ = (up === 1 && hole === 10) || (up === 10 && hole === 1);
      if (dBJ) continue; // dealer peeks: round ends, nobody draws
      const pol = pols[up];
      let anyLive = false;
      for (const [c1, c2] of players) {
        if ((c1 === 1 && c2 === 10) || (c1 === 10 && c2 === 1)) continue; // natural
        const key = c1 <= c2 ? c1 * 11 + c2 : c2 * 11 + c1;
        const a0 = pol.init[key];
        if (a0 === 4) continue; // surrender
        if (a0 === 3 && c1 === c2) { if (playSplit(pol, c1)) anyLive = true; }
        else if (playHand(pol, c1, c2, false, a0 === 3 ? 0 : a0)) anyLive = true;
      }
      if (anyLive) {
        let t = up + hole, aces = (up === 1) + (hole === 1);
        for (;;) {
          const [T, s] = tot(t, aces);
          if (T > 17 || (T === 17 && !(s && rules.h17))) break;
          const r = draw(); t += r; if (r === 1) aces++;
        }
      }
    }
    const avgPen = shuffles > 0 ? dealtAtShuffle / (shuffles * total) : rules.pen;
    return { rounds, buckets, first, seq, fl, insDetail, avgPen, roundsPerShuffle: auto ? rps : null, auto, ub, sys, irc };
  }

  // ---------- top-level ----------
  function analyze(rulesIn, opts) {
    const rules = normalizeRules(rulesIn);
    opts = opts || {};
    const sim = opts.sim || simulateCounts(rules, opts.rounds || 300000);
    const D = rules.decks;
    let basePols = null;
    if (rules.strategy === 'basic' || rules.strategy === 'basic-ins') {
      const c0 = makeComposition(0, D);
      basePols = [];
      for (let u = 1; u <= 10; u++) basePols[u] = derivePolicy(c0, rules, u);
    }
    const buckets = [];
    for (let tc = -1; tc <= 10; tc++) {
      const b = sim.buckets[tc + 1];
      let mtc, mR;
      if (b.n >= 30) { mtc = b.sumTC / b.n; mR = b.sumR / b.n; }
      else { mtc = sim.ub ? tc : (tc === -1 ? -1.5 : tc + 0.5); mR = Math.max(0.25, D * (1 - (sim.avgPen || rules.pen) / 2)); }
      const c = sim.ub ? makeCompositionUnbal(mtc, mR, D, sim.sys, sim.irc) : makeComposition(mtc, mR);
      let insFrac = 0, insEV = 0;
      if (rules.strategy === 'basic-ins' && b.n > 0) {
        insFrac = b.aceN > 0 ? b.insN / b.aceN : 0;   // share of dealer aces where the updated count said insure
        insEV = b.insSum / b.n;                        // insurance profit per round in this bucket
      }
      buckets.push({ tc, freq: b.n / sim.rounds, meanTC: mtc, meanR: mR, insFrac, insEV, edge: compositionEV(c, rules, basePols) + insEV });
    }
    // no mid-shoe entry: the first hand of every shoe is played from a fresh deck, and the later
    // rounds that share count 0 are a different (worse) mix, so give each its own edge
    let firstEdge = null, b0LateEdge = null;
    if (rules.noMidEntry && D === 1) {
      const f = sim.first, b0 = sim.buckets[1];
      const insOf = (n, sum) => (rules.strategy === 'basic-ins' && n > 0) ? sum / n : 0;
      firstEdge = compositionEV(makeComposition(0, 1), rules, basePols) + insOf(f.n, f.insSum);
      const nl = b0.n - f.n;
      if (nl >= 30) {
        const mtc = (b0.sumTC - f.sumTC) / nl, mR = (b0.sumR - f.sumR) / nl;
        const c = sim.ub ? makeCompositionUnbal(mtc, mR, D, sim.sys, sim.irc) : makeComposition(mtc, mR);
        b0LateEdge = compositionEV(c, rules, basePols) + insOf(nl, b0.insSum - f.insSum);
      } else b0LateEdge = buckets[1].edge;
    }
    // reference: fresh shoe basic strategy
    const c0 = makeComposition(0, D);
    const fresh = compositionEV(c0, rules, basePols || null);
    return { rules, sim, buckets, freshEdge: fresh, firstEdge, b0LateEdge };
  }

  const SIGMA2 = 1.32;  // variance of one box's result per unit bet (1.28-1.34 measured, test/corr.js)
  const COV_BOX = 0.49; // covariance between two boxes vs the same dealer hand (correlation ~0.37)

  // Combine analysis with a bet ramp. bets: array of 12 bet sizes for counts -1..+10.
  function evaluateBets(an, bets, params) {
    params = Object.assign({ roundsPerHour: 100, unit: 25, boxes: 1 }, params || {});
    const n = params.boxes;
    const rules = an.rules, N = an.sim.rounds;
    const noEntry = !!(rules.noMidEntry && rules.decks === 1 && an.firstEdge !== null);
    const Z = 1;   // index of the count-0 row (rows run from <= -1 at index 0)
    const m2 = (bet, e) => bet * bet * (n * SIGMA2 + n * (n - 1) * COV_BOX + n * n * e * e);   // E[X^2] of a round
    let fb = 0, fbe = 0, fb2 = 0, fPlayed = 0, fe = 0, f = 0;
    const rows = an.buckets.map(b => ({ freq: b.freq, edge: b.edge }));
    an.buckets.forEach((b, i) => { f += b.freq; fe += b.freq * b.edge; });
    if (!noEntry) {
      an.buckets.forEach((b, i) => {
        const bet = bets[i] || 0;
        if (bet > 0) fPlayed += b.freq;
        fb += b.freq * bet; fbe += b.freq * bet * b.edge; fb2 += b.freq * m2(bet, b.edge);
      });
    } else {
      // Walk the simulated shoes in order: you play each shoe's first hand, then keep playing until the
      // count says to sit out (bet 0), after which you cannot re-enter until the next shuffle.
      const seq = an.sim.seq, fl = an.sim.fl;
      const seated = new Float64Array(12), seatedFirst = { v: 0 };
      let inGame = false, played = 0, sumB = 0, sumBE = 0, sumB2 = 0;
      for (let r = 0; r < N; r++) {
        const bi = seq[r];   // row index (count + 1)
        let bet, e;
        if (fl[r]) { inGame = true; bet = bets[Z] > 0 ? bets[Z] : 1; e = an.firstEdge; seatedFirst.v++; }
        else {
          if (!inGame) continue;
          seated[bi]++;
          bet = bets[bi] || 0;
          if (bet <= 0) { inGame = false; continue; }
          e = bi === Z ? an.b0LateEdge : an.buckets[bi].edge;
        }
        played++; sumB += bet; sumBE += bet * e; sumB2 += m2(bet, e);
      }
      fPlayed = played / N; fb = sumB / N; fbe = sumBE / N; fb2 = sumB2 / N;
      rows.forEach((row, i) => {
        const late = seated[i], firstS = i === Z ? seatedFirst.v : 0;
        row.freq = (late + firstS) / N;
        if (i === Z && late + firstS > 0) row.edge = (late * an.b0LateEdge + firstS * an.firstEdge) / (late + firstS);
      });
    }
    const evRound = n * fbe;                         // in bet units, per round dealt, all boxes
    const varRound = fb2 - evRound * evRound;
    const overall = fb > 0 ? fbe / fb : 0;
    const flat = f > 0 ? fe / f : 0;
    return {
      overallEdge: overall, avgBet: fPlayed > 0 ? fb / fPlayed : 0, avgAction: fPlayed > 0 ? n * fb / fPlayed : 0, flatEdge: flat,
      handsPlayedPct: fPlayed, evPerRound: evRound, rows, noEntry,
      evPerHour: evRound * params.roundsPerHour, dollarsPerHour: evRound * params.roundsPerHour * params.unit,
      varPerRound: Math.max(varRound, 0),
      sdPerRound: Math.sqrt(Math.max(varRound, 0)),
      n0: evRound > 0 ? varRound / (evRound * evRound) : Infinity,
    };
  }

  // ---------- bankroll / risk of ruin ----------
  // Bankroll modelled as Brownian motion: mean mu and variance v (units, per round).
  function normCdf(x) {   // Numerical Recipes erfc, relative error ~1e-7
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
    const erfc = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc;
  }
  // Probability of hitting zero from bankroll B (units) within T rounds (T = Infinity for forever).
  function ruinProb(B, mu, v, T) {
    if (B <= 0) return 1;
    if (mu <= 0) return T === Infinity ? 1 : normCdf((-B - mu * T) / Math.sqrt(v * T));
    const inf = Math.exp(-2 * mu * B / v);
    if (T === Infinity) return Math.min(1, inf);
    const sd = Math.sqrt(v * T);
    return Math.min(1, normCdf((-B - mu * T) / sd) + inf * normCdf((-B + mu * T) / sd));
  }
  function requiredBankroll(mu, v, T, ror) {
    if (!(mu > 0) && T === Infinity) return Infinity;
    let hi = Math.max(v / Math.abs(mu || 1e-9), 10), lo = 0, k = 0;
    while (ruinProb(hi, mu, v, T) > ror && k++ < 80) hi *= 2;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (ruinProb(m, mu, v, T) > ror) lo = m; else hi = m; }
    return hi;
  }
  // res: result of evaluateBets. p: { ror (0-1), hours, roundsPerHour, unit ($), bankroll ($, optional) }
  function bankrollPlan(res, p) {
    const mu = res.evPerRound, v = res.varPerRound, T = p.hours * p.roundsPerHour;
    const out = { rounds: T, mu, v, expected: mu * T, sd: Math.sqrt(v * T) };
    out.fullKelly = mu > 0 ? v / mu : Infinity;                          // units; full Kelly => 13.5% ruin forever
    out.reqForever = mu > 0 ? v / (2 * mu) * Math.log(1 / p.ror) : Infinity;
    out.reqHours = requiredBankroll(mu, v, T, p.ror);
    if (p.bankroll > 0) {
      const B = p.bankroll / p.unit;
      out.given = { units: B, ruinHours: ruinProb(B, mu, v, T), ruinForever: ruinProb(B, mu, v, Infinity),
                    kellyFraction: mu > 0 ? out.fullKelly / B : Infinity };   // share of full-Kelly bet size
    }
    return out;
  }
  // Full-Kelly bet per box (units) at a count with per-unit edge `edge`, for bankroll B units.
  function kellyBet(edge, B, boxes) {
    return Math.max(0, B * edge / (SIGMA2 + (boxes - 1) * COV_BOX));
  }

  const api = { normCdf, ruinProb, requiredBankroll, bankrollPlan, kellyBet, normalizeRules, makeComposition, makeCompositionUnbal, dealerDist, derivePolicy, compositionEV, simulateCounts, roundsPerShuffle, analyze, evaluateBets, SIGMA2, COV_BOX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BJEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
