// Run: node --test engine.test.js
const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');
const D = require('./demo.js');

test('odds conversion round-trips', () => {
  assert.strictEqual(E.americanToDecimal(150), 2.5);
  assert.strictEqual(E.fmtAmerican(2.5), '+150');
  assert.strictEqual(E.fmtAmerican(E.americanToDecimal(-120)), '-120');
});

test('vig is removed and best price is found', () => {
  const ev = { id: 'g1', sport_key: 'x', home_team: 'A', away_team: 'B', commence_time: '2030-01-01T00:00:00Z',
    bookmakers: [
      { key: 'b1', title: 'B1', markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 1.91 }, { name: 'B', price: 1.91 }] }] },
      { key: 'b2', title: 'B2', markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 2.05 }, { name: 'B', price: 1.80 }] }] },
    ] };
  const legs = E.buildLegs([ev]);
  const a = legs.find((l) => l.pick === 'A to win');
  assert.strictEqual(a.price, 2.05);
  assert.strictEqual(a.book, 'B2');
  const b = legs.find((l) => l.pick === 'B to win');
  assert.ok(Math.abs(a.prob + b.prob - 1) < 1e-9, 'fair probabilities sum to 1');
});

test('parlays land near the target with one pick per game', () => {
  const legs = E.buildLegs(D.generate(new Date('2026-11-18T12:00:00Z')));
  for (const t of [1.8, 3, 10, 60]) {
    const ps = E.findParlays(legs, t);
    assert.ok(ps.length > 0);
    for (const p of ps) {
      assert.ok(p.mult > t / 1.31 && p.mult < t * 1.26, `mult ${p.mult} near ${t}`);
      assert.strictEqual(new Set(p.legs.map((l) => l.eventId)).size, p.legs.length);
    }
  }
});

test('goal parsing', () => {
  assert.deepStrictEqual(E.parseGoal('I want to turn $10 into $100'), { stake: 10, target: 100, risk: null });
  assert.strictEqual(E.parseGoal('bet 20 to win 500').target, 520);
  assert.strictEqual(E.parseGoal('turn $5 into 1k').target, 1000);
  assert.strictEqual(E.parseGoal('safest bet for $25').risk, 1);
});

const R = require('./research.js');

test('research: match game, read injuries/predictor, block injured props', () => {
  const sb = { events: [{ id: '9', date: '2026-11-19T00:00Z', status: { type: { state: 'pre' } }, competitions: [{ competitors: [
    { homeAway: 'home', team: { id: '5', displayName: 'Cleveland Cavaliers', abbreviation: 'CLE' }, records: [{ name: 'overall', summary: '8-7' }],
      leaders: [{ name: 'pointsPerGame', shortDisplayName: 'PPG', leaders: [{ displayValue: '24.1', athlete: { displayName: 'Donovan Mitchell' } }] }] },
    { homeAway: 'away', team: { id: '29', displayName: 'Memphis Grizzlies', abbreviation: 'MEM' }, records: [] }] }] }] };
  const games = R.parseScoreboard(sb);
  const g = R.matchGame({ commence_time: '2026-11-19T00:00:00Z', home_team: 'Cleveland Cavaliers', away_team: 'Memphis Grizzlies' }, games);
  assert.strictEqual(g.espnId, '9');
  const r = R.parseSummary({
    injuries: [{ team: { id: '5' }, injuries: [{ athlete: { displayName: 'Donovan Mitchell' }, status: 'Questionable' }] },
      { team: { id: '29' }, injuries: [{ athlete: { displayName: 'Ty Jerome' }, status: 'Out', details: { type: 'Hip' } }] }],
    predictor: { homeTeam: { id: '5', gameProjection: '71' }, awayTeam: { id: '29', gameProjection: '29' } },
  }, g);
  assert.ok(Math.abs(r.predictor.home - 0.71) < 1e-9);
  const legs = R.applyResearch([
    { eventId: 'e', game: 'Memphis Grizzlies @ Cleveland Cavaliers', pick: 'Cleveland Cavaliers to win', market: 'h2h', prob: 0.6, price: 1.6, isProp: false },
    { eventId: 'e', game: 'Memphis Grizzlies @ Cleveland Cavaliers', pick: 'Ty Jerome Over 14.5 points', market: 'player_points', prob: 0.5, price: 1.9, isProp: true },
  ], { e: r });
  assert.ok(Math.abs(legs[0].prob - (0.8 * 0.6 + 0.2 * 0.71)) < 1e-9);
  assert.ok(legs[0].starQuestionable);
  assert.ok(legs[1].blocked);
  assert.strictEqual(E.findParlays(legs, 1.9, { avoidUncertain: true }).length, 0);
});

test('exact leg counts: lands on target, one pick per game, explains impossible sizes', () => {
  const legs = E.buildLegs(D.generate(new Date('2026-11-18T12:00:00Z')));
  const rows = E.findByLegCount(legs, 10, { maxLegs: 12 });
  assert.ok(rows.length >= 4, 'several parlay sizes reach 10x');
  for (const p of rows) {
    assert.ok(p.mult >= 10 / 1.051 && p.mult <= 10 * 1.251, `${p.legs.length} legs pays ${p.mult}`);
    assert.strictEqual(new Set(p.legs.map((l) => l.eventId)).size, p.legs.length);
  }
  const n = E.gameCount(legs);
  const big = E.findExact(legs, 1000, Math.min(n, 9));
  assert.ok(big && big.exact && big.legs.length === Math.min(n, 9), 'long parlays are built when the payout allows');
  assert.ok(E.minPayout(legs, 3) <= E.minPayout(legs, 4));
});

test('build around chosen legs', () => {
  const legs = E.buildLegs(D.generate(new Date('2026-11-18T12:00:00Z')));
  const favs = legs.filter((l) => l.market === 'h2h' && l.prob > 0.55);
  const locked = [favs[0], favs.find((l) => l.eventId !== favs[0].eventId)];
  const p = E.fillAround(legs, locked, 10);
  assert.ok(p && p.exact && p.mult >= 10 / 1.31 && p.mult <= 12.5);
  assert.ok(locked.every((l) => p.legs.includes(l)), 'keeps the chosen legs');
  assert.strictEqual(new Set(p.legs.map((l) => l.eventId)).size, p.legs.length);
  const six = E.fillAround(legs, locked, 10, { exactTotal: 6 });
  assert.ok(!six || six.legs.length === 6);
  assert.strictEqual(E.fillAround(legs, locked, 1.01), null, 'picks already pay more than the goal');
});
