/*
 * Parlay Picker engine — pure functions, no DOM, no network.
 *
 * How the "prediction" works:
 *   Betting markets are the best public predictor of sports outcomes. Every
 *   price already prices in team/player stats, injuries, history and sharp
 *   money. So for every pick we:
 *     1. Collect the price at every sportsbook.
 *     2. Remove each book's built-in margin ("vig") to get its fair chance.
 *     3. Average those fair chances (sharp books like Pinnacle count 3x) to get
 *        a consensus "true chance".
 *     4. Find the single best price anywhere (line shopping).
 *     5. Value = true chance x best price - 1. Positive = the book is paying
 *        more than the pick is likely worth.
 *   Parlays are then searched to hit a payout target while keeping the
 *   highest possible chance of winning.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParlayEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHARP_BOOKS = new Set([
    'pinnacle', 'circasports', 'lowvig', 'betonlineag', 'matchbook',
    'betfair_ex_us', 'betfair_ex_eu', 'betfair_ex_uk', 'novig', 'prophetx',
  ]);

  // Assumed margin for one-sided markets (e.g. "anytime touchdown: Yes" only).
  const ONE_SIDED_VIG = 0.08;

  const MARKET_LABELS = {
    h2h: 'Moneyline', spreads: 'Spread', totals: 'Total',
    player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
    player_threes: '3-Pointers', player_pass_yds: 'Passing Yds',
    player_rush_yds: 'Rushing Yds', player_reception_yds: 'Receiving Yds',
    player_anytime_td: 'Anytime TD', player_shots_on_goal: 'Shots on Goal',
    batter_hits: 'Hits', pitcher_strikeouts: 'Strikeouts',
  };

  /* ---------- odds helpers ---------- */

  function americanToDecimal(a) {
    a = Number(a);
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }

  function decimalToAmerican(d) {
    if (d >= 2) return Math.round((d - 1) * 100);
    return Math.round(-100 / (d - 1));
  }

  function fmtAmerican(d) {
    const a = decimalToAmerican(d);
    return a > 0 ? '+' + a : String(a);
  }

  function isProp(marketKey) {
    return /^(player|batter|pitcher)_/.test(marketKey);
  }

  function fmtPoint(p) {
    return p > 0 ? '+' + p : String(p);
  }

  function pickLabel(ev, marketKey, o) {
    const unit = (MARKET_LABELS[marketKey] || marketKey).toLowerCase();
    if (marketKey === 'h2h') return o.name === 'Draw' ? 'Draw (tie)' : `${o.name} to win`;
    if (marketKey === 'spreads') return `${o.name} ${fmtPoint(o.point)}`;
    if (marketKey === 'totals') return `${o.name} ${o.point} total`;
    if (isProp(marketKey)) {
      const who = o.description || '';
      if (o.point == null) return `${who} — ${unit}: ${o.name}`;
      return `${who} ${o.name} ${o.point} ${unit}`;
    }
    return `${o.name}${o.point != null ? ' ' + o.point : ''}`;
  }

  /* ---------- legs: fair probability + best price for every outcome ---------- */

  /**
   * @param events Odds API shape:
   *   [{id, sport_key, sport_title, commence_time, home_team, away_team,
   *     bookmakers:[{key,title,markets:[{key,outcomes:[{name,price,point?,description?}]}]}]}]
   *   Prices must be decimal odds.
   */
  function buildLegs(events, opts = {}) {
    const minBooks = opts.minBooks ?? 2;
    const legs = [];

    for (const ev of events || []) {
      const groups = new Map();

      for (const bm of ev.bookmakers || []) {
        const weight = SHARP_BOOKS.has(bm.key) ? 3 : 1;
        for (const mk of bm.markets || []) {
          // Split the book's market into "sub-markets" whose outcomes are
          // mutually exclusive (e.g. Lakers -3.5 vs Celtics +3.5).
          const sub = new Map();
          for (const o of mk.outcomes || []) {
            if (!(o.price > 1)) continue;
            const sk = (o.description || '') + '|' + (o.point != null ? Math.abs(o.point) : '');
            if (!sub.has(sk)) sub.set(sk, []);
            sub.get(sk).push(o);
          }
          for (const outs of sub.values()) {
            const implied = outs.map((o) => 1 / o.price);
            const total = implied.reduce((a, b) => a + b, 0);
            outs.forEach((o, i) => {
              const fair = outs.length >= 2 ? implied[i] / total : implied[i] / (1 + ONE_SIDED_VIG);
              const key = [mk.key, o.name, o.description || '', o.point ?? ''].join('|');
              if (!groups.has(key)) {
                groups.set(key, { market: mk.key, outcome: o, quotes: [], wSum: 0, pSum: 0 });
              }
              const g = groups.get(key);
              g.quotes.push({ book: bm.key, bookTitle: bm.title || bm.key, price: o.price });
              const w = outs.length >= 2 ? weight : weight * 0.5;
              g.wSum += w;
              g.pSum += w * fair;
            });
          }
        }
      }

      for (const [key, g] of groups) {
        if (g.quotes.length < minBooks) continue;
        const prob = g.pSum / g.wSum;
        g.quotes.sort((a, b) => b.price - a.price);
        const best = g.quotes[0];
        legs.push({
          id: ev.id + '|' + key,
          eventId: ev.id,
          sport: ev.sport_key,
          sportTitle: ev.sport_title || ev.sport_key,
          game: `${ev.away_team} @ ${ev.home_team}`,
          commence: ev.commence_time,
          market: g.market,
          marketLabel: MARKET_LABELS[g.market] || g.market,
          isProp: isProp(g.market),
          pick: pickLabel(ev, g.market, g.outcome),
          price: best.price,
          book: best.bookTitle,
          prob,
          ev: prob * best.price - 1,
          books: g.quotes.length,
          quotes: g.quotes,
        });
      }
    }
    return legs;
  }

  /* ---------- parlay search ---------- */

  /**
   * Find parlays whose payout multiplier lands near `target` (e.g. 10 = 10x)
   * with the best chance of winning. Max one leg per game so legs stay
   * independent (same-game legs are correlated and books price them differently).
   */
  function legType(l) {
    return l.isProp ? 'prop' : l.market === 'h2h' ? 'ml' : l.market === 'spreads' ? 'spread' : l.market === 'totals' ? 'total' : 'other';
  }

  /**
   * o.legs = exact number of legs (search steers each step toward the target);
   * otherwise any count from 1 to o.maxLegs. o.types = Set of leg types to mix
   * ('ml', 'spread', 'total', 'prop').
   */
  function findParlays(legs, target, o = {}) {
    const exactN = o.legs || 0;
    const maxLegs = exactN || (o.maxLegs ?? 8);
    const W = o.beam ?? (exactN ? 250 : 300);
    const count = o.count ?? 3;
    const logT = Math.log(Math.max(target, 1.01));
    const lo = logT - Math.log(o.tolLow ?? 1.3);
    const hi = logT + Math.log(o.tolHigh ?? 1.25);

    const pool = legs
      .filter((l) => l.prob >= 0.05 && l.prob <= 0.97 && l.price > 1.04)
      .filter((l) => !o.sports || o.sports.has(l.sport))
      .filter((l) => o.props !== false || !l.isProp)
      .filter((l) => !l.blocked && !(o.avoidUncertain && (l.starOut || l.starQuestionable)))
      .filter((l) => !(o.avoidTired && l.fatigued))
      .filter((l) => !o.types || o.types.has(legType(l)))
      .filter((l) => Math.log(l.price) <= hi)
      .sort((a, b) => b.ev - a.ev)
      .slice(0, o.poolSize ?? (exactN ? 400 : 150))
      .map((l, idx) => ({ l, idx, lp: Math.log(l.price), lq: Math.log(l.prob) }));

    const finals = [];
    const all = [];
    let frontier = [{ legs: [], lp: 0, lq: 0, events: new Set(), last: -1 }];

    for (let depth = 1; depth <= maxLegs && frontier.length; depth++) {
      const next = [];
      for (const s of frontier) {
        for (const p of pool) {
          if (p.idx <= s.last || s.events.has(p.l.eventId)) continue;
          const lp = s.lp + p.lp;
          if (lp > hi) continue;
          const events = new Set(s.events);
          events.add(p.l.eventId);
          const ns = { legs: s.legs.concat(p.l), lp, lq: s.lq + p.lq, events, last: p.idx };
          next.push(ns);
          if (!exactN || depth === exactN) {
            all.push(ns);
            if (lp >= lo) finals.push(ns);
          }
        }
      }
      // Keep the most promising partial parlays: high value, and closer to target.
      next.sort((a, b) => score(b) - score(a));
      frontier = next.slice(0, W);
    }

    function score(s) {
      // Exact count: stay near the even-split path (each leg ≈ target^(1/n)).
      if (exactN) return s.lq + s.lp - Math.abs(s.lp - (logT * s.legs.length) / exactN);
      return s.lq + s.lp - 0.15 * Math.max(0, logT - s.lp) / Math.max(logT, 0.1);
    }
    function finalScore(s) {
      return s.lq + s.lp - 0.6 * Math.abs(s.lp - logT) - 0.015 * s.legs.length;
    }

    let ranked = finals.sort((a, b) => finalScore(b) - finalScore(a));
    let exact = true;
    if (!ranked.length) {
      exact = false;
      ranked = all.sort((a, b) => Math.abs(a.lp - logT) - Math.abs(b.lp - logT));
    }

    const picked = [];
    for (const s of ranked) {
      const ids = new Set(s.legs.map((l) => l.id));
      const tooSimilar = picked.some((p) => {
        const shared = p.legs.filter((l) => ids.has(l.id)).length;
        return shared > Math.min(p.legs.length, s.legs.length) / 2;
      });
      if (tooSimilar) continue;
      picked.push(s);
      if (picked.length >= count) break;
    }

    return picked.map((s) => summarize(s.legs, exact));
  }

  function eligible(legs, o) {
    return legs
      .filter((l) => l.prob >= 0.05 && l.prob <= 0.97 && l.price > 1.04)
      .filter((l) => !o.sports || o.sports.has(l.sport))
      .filter((l) => o.props !== false || !l.isProp)
      .filter((l) => !l.blocked && !(o.avoidUncertain && (l.starOut || l.starQuestionable)))
      .filter((l) => !(o.avoidTired && l.fatigued))
      .filter((l) => !o.types || o.types.has(legType(l)));
  }

  /**
   * Best parlay with exactly n legs (one per game) paying about `target`.
   * Maximises the chance of winning, sum(log p), subject to the payout,
   * sum(log price), landing in the target band. A multiplier `lam` trades
   * chance against price: each game contributes its best leg by
   * log p + lam·log price, the n best games are taken, and `lam` is
   * bisected until the payout hits the target. Swaps then polish the result.
   */
  function findExact(legs, target, n, o = {}) {
    const logT = Math.log(Math.max(target, 1.01));
    // Pay at least ~95% of the goal, at most 25% over it.
    const lo = logT - Math.log(o.tolLow ?? 1.05), hi = logT + Math.log(o.tolHigh ?? 1.25);
    const byEvent = new Map();
    for (const l of eligible(legs, o)) {
      const x = { l, lp: Math.log(l.price), lq: Math.log(l.prob) };
      if (!byEvent.has(l.eventId)) byEvent.set(l.eventId, []);
      byEvent.get(l.eventId).push(x);
    }
    const events = [...byEvent.values()];
    if (events.length < n) return null;

    const pickFor = (lam) => events
      .map((opts) => opts.reduce((b, x) => (x.lq + lam * x.lp > b.lq + lam * b.lp ? x : b)))
      .sort((a, b) => (b.lq + lam * b.lp) - (a.lq + lam * a.lp))
      .slice(0, n);
    const sumLp = (set) => set.reduce((a, x) => a + x.lp, 0);

    let a = -6, b = 6, best = null;
    for (let i = 0; i < 50; i++) {
      const mid = (a + b) / 2;
      const set = pickFor(mid);
      const lp = sumLp(set);
      if (lp >= lo && lp <= hi && (!best || set.reduce((s, x) => s + x.lq, 0) > best.lq)) {
        best = { set, lq: set.reduce((s, x) => s + x.lq, 0) };
      }
      if (lp < logT) a = mid; else b = mid;
    }
    let set = best ? best.set : pickFor((a + b) / 2);

    // Local search: repeatedly make the single swap (any leg for any leg from an
    // unused game, or another leg from the same game) that first gets the payout
    // into the band, then raises the chance of winning.
    const dist = (lp) => (lp < lo ? lo - lp : lp > hi ? lp - hi : 0);
    const all = events.flat();
    for (let move = 0; move < 60; move++) {
      const curLp = sumLp(set), curD = dist(curLp);
      const used = new Set(set.map((x) => x.l.eventId));
      let bestMove = null, bestD = curD, bestQ = 0;
      for (let i = 0; i < set.length; i++) {
        const base = curLp - set[i].lp;
        for (const x of all) {
          if (x === set[i] || (used.has(x.l.eventId) && x.l.eventId !== set[i].l.eventId)) continue;
          const d = dist(base + x.lp), dq = x.lq - set[i].lq;
          if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && dq > bestQ + 1e-9)) {
            bestMove = [i, x]; bestD = d; bestQ = Math.abs(d - bestD) <= 1e-9 ? dq : dq;
          }
        }
      }
      if (!bestMove) break;
      set = set.slice();
      set[bestMove[0]] = bestMove[1];
    }
    const lp = sumLp(set);
    return summarize(set.map((x) => x.l), lp >= lo && lp <= hi);
  }

  /** Smallest payout possible with n legs (the n shortest prices, one per game). */
  function minPayout(legs, n, o = {}) {
    const by = new Map();
    for (const l of eligible(legs, o)) if (!by.has(l.eventId) || l.price < by.get(l.eventId)) by.set(l.eventId, l.price);
    const prices = [...by.values()].sort((a, b) => a - b);
    if (prices.length < n) return null;
    return prices.slice(0, n).reduce((a, b) => a * b, 1);
  }
  function gameCount(legs, o = {}) {
    return new Set(eligible(legs, o).map((l) => l.eventId)).size;
  }

  /** Best parlay for every leg count that can reach the target. */
  function findByLegCount(legs, target, o = {}) {
    const out = [];
    for (let n = 1; n <= (o.maxLegs ?? 12); n++) {
      const p = findExact(legs, target, n, o);
      if (p && p.exact) out.push(p);
    }
    return out;
  }

  /**
   * Keep the user's chosen legs and add the best legs from other games so the
   * whole parlay pays about `target`. `exactTotal` = total leg count wanted.
   */
  function fillAround(legs, locked, target, o = {}) {
    const lockedMult = locked.reduce((a, l) => a * l.price, 1);
    const rest = target / lockedMult;
    const onTarget = rest <= 1.05 && rest >= 1 / 1.25;
    // Adding legs only raises the payout, so if the picks already reach the goal
    // (or a fixed size leaves no room), the picks alone are the answer.
    if (o.exactTotal && o.exactTotal <= locked.length) return onTarget && o.exactTotal === locked.length ? summarize(locked, true) : null;
    if (rest < 1.15) return onTarget && !o.exactTotal ? summarize(locked, true) : null;
    const used = new Set(locked.map((l) => l.eventId));
    const pool = legs.filter((l) => !used.has(l.eventId));
    let best = null;
    if (o.exactTotal) {
      best = findExact(pool, rest, o.exactTotal - locked.length, o);
    } else {
      const cands = findParlays(pool, rest, { ...o, count: 3 }).filter((p) => p.exact)
        .concat(findByLegCount(pool, rest, { ...o, maxLegs: o.maxLegs ?? 12 }));
      best = cands.sort((a, b) => b.prob - a.prob)[0] || null;
    }
    if (!best || !best.exact) return null;
    const out = summarize(locked.concat(best.legs), true);
    out.lockedCount = locked.length;
    return out;
  }

  /** Warnings for a hand-built slip: same-game and opposite-side picks. */
  function slipWarnings(slip) {
    const out = [];
    const byGame = new Map();
    for (const l of slip) { if (!byGame.has(l.eventId)) byGame.set(l.eventId, []); byGame.get(l.eventId).push(l); }
    for (const [, ls] of byGame) {
      if (ls.length < 2) continue;
      const markets = ls.map((l) => l.market + '|' + (l.pick.match(/^(.*?) (Over|Under) /)?.[1] || ''));
      if (new Set(markets).size < markets.length) out.push(`${ls[0].game}: two picks from the same bet can't both win.`);
      else out.push(`${ls[0].game}: ${ls.length} picks from one game. Results are linked, so the chance shown is rough, and books price these as same-game parlays.`);
    }
    return out;
  }

  function summarize(legs, exact = true) {
    const mult = legs.reduce((a, l) => a * l.price, 1);
    const prob = legs.reduce((a, l) => a * l.prob, 1);
    return { legs, mult, prob, ev: prob * mult - 1, exact, risk: riskLevel(prob) };
  }

  /* ---------- risk spectrum ---------- */

  const RISK_TIERS = [
    { key: 1, name: 'Safest', short: 'Very low risk', target: 1.8, color: '#16a34a' },
    { key: 2, name: 'Safe', short: 'Low risk', target: 3, color: '#65a30d' },
    { key: 3, name: 'Balanced', short: 'Medium risk', target: 6, color: '#ca8a04' },
    { key: 4, name: 'Bold', short: 'High risk', target: 15, color: '#ea580c' },
    { key: 5, name: 'Moonshot', short: 'Very high risk', target: 60, color: '#dc2626' },
  ];

  function riskLevel(prob) {
    if (prob >= 0.5) return RISK_TIERS[0];
    if (prob >= 0.3) return RISK_TIERS[1];
    if (prob >= 0.15) return RISK_TIERS[2];
    if (prob >= 0.05) return RISK_TIERS[3];
    return RISK_TIERS[4];
  }

  function oneIn(prob) {
    if (prob <= 0) return '∞';
    const n = 1 / prob;
    return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n));
  }

  /* ---------- natural language goal parsing ---------- */

  /**
   * "I want to turn $10 into $100"  -> {stake:10, target:100}
   * "bet 20 to win 500"            -> {stake:20, target:520}  (win = profit)
   * "safest bet for $25"           -> {stake:25, risk:1}
   */
  function parseGoal(text) {
    const t = String(text || '').toLowerCase().replace(/,/g, '');
    const nums = [];
    const re = /\$?\s*(\d+(?:\.\d+)?)\s*(k|grand)?\b/g;
    let m;
    while ((m = re.exec(t))) {
      let v = parseFloat(m[1]);
      if (m[2]) v *= 1000;
      if (v > 0) nums.push(v);
    }
    let risk = null;
    if (/(safest|very safe|lowest risk|lock)/.test(t)) risk = 1;
    else if (/(safe|low risk|conservative)/.test(t)) risk = 2;
    else if (/(medium|balanced|moderate)/.test(t)) risk = 3;
    else if (/(moonshot|lottery|longshot|crazy|huge)/.test(t)) risk = 5;
    else if (/(risky|high risk|aggressive|bold)/.test(t)) risk = 4;

    const out = { stake: null, target: null, risk };
    if (!nums.length) return out;
    out.stake = nums[0];
    if (nums.length >= 2) {
      const profitWords = /\b(win|profit|make|earn)\b/.test(t) && !/\b(into|turn|grow|get)\b/.test(t);
      out.target = profitWords || nums[1] <= nums[0] ? nums[0] + nums[1] : nums[1];
    } else if (risk) {
      out.target = nums[0] * RISK_TIERS[risk - 1].target;
    }
    return out;
  }

  return {
    SHARP_BOOKS, MARKET_LABELS, RISK_TIERS,
    americanToDecimal, decimalToAmerican, fmtAmerican,
    buildLegs, findParlays, findExact, findByLegCount, fillAround, slipWarnings, minPayout, gameCount, legType, summarize, riskLevel, oneIn, parseGoal,
  };
});
