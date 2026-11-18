// Run: node --test parlay-picker/engine.test.js
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
