/*
 * DEMO DATA ONLY. Generates realistic-looking sample odds across several
 * sportsbooks so the app can be tried without an API key. These are NOT real
 * games or real prices. Output matches The Odds API v4 response shape.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParlayDemo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BOOKS = [
    ['draftkings', 'DraftKings'], ['fanduel', 'FanDuel'], ['betmgm', 'BetMGM'],
    ['williamhill_us', 'Caesars'], ['betrivers', 'BetRivers'], ['fanatics', 'Fanatics'],
    ['espnbet', 'ESPN BET'], ['bovada', 'Bovada'], ['pinnacle', 'Pinnacle'],
  ];

  const SPORTS = {
    basketball_nba: {
      title: 'NBA', sd: 12, total: [212, 242], props: ['player_points', 'player_rebounds', 'player_assists'],
      teams: ['Lakers', 'Celtics', 'Warriors', 'Bucks', 'Nuggets', 'Suns', 'Heat', 'Knicks',
        '76ers', 'Mavericks', 'Thunder', 'Timberwolves', 'Cavaliers', 'Kings', 'Pacers', 'Magic'],
    },
    americanfootball_nfl: {
      title: 'NFL', sd: 13.5, total: [37, 53], props: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'],
      teams: ['Chiefs', 'Bills', 'Eagles', '49ers', 'Ravens', 'Lions', 'Cowboys', 'Packers',
        'Bengals', 'Dolphins', 'Texans', 'Rams'],
    },
    icehockey_nhl: {
      title: 'NHL', sd: 2.2, total: [5.5, 6.5], props: [],
      teams: ['Bruins', 'Rangers', 'Oilers', 'Avalanche', 'Panthers', 'Stars', 'Maple Leafs',
        'Golden Knights', 'Hurricanes', 'Devils'],
    },
    soccer_epl: {
      title: 'EPL', sd: 1.4, total: [2.5, 2.5], props: [], threeWay: true,
      teams: ['Arsenal', 'Man City', 'Liverpool', 'Chelsea', 'Spurs', 'Newcastle', 'Aston Villa', 'Brighton'],
    },
  };

  const PROP_LINES = {
    player_points: [14.5, 31.5], player_rebounds: [4.5, 12.5], player_assists: [3.5, 10.5],
    player_pass_yds: [205.5, 285.5], player_rush_yds: [45.5, 95.5], player_reception_yds: [40.5, 85.5],
  };
  const FIRST = ['J.', 'M.', 'D.', 'T.', 'A.', 'K.', 'C.', 'R.'];
  const LAST = ['Carter', 'Mitchell', 'Brooks', 'Hayes', 'Reed', 'Coleman', 'Price', 'Bennett', 'Foster', 'Grant', 'Wallace', 'Hughes'];

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Inverse normal CDF (Acklam approximation) — turns a win chance into a spread.
  function invNorm(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const q = p < 0.5 ? p : 1 - p;
    let x;
    if (q < 0.02425) {
      const r = Math.sqrt(-2 * Math.log(q));
      x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    } else {
      const r = q - 0.5, s = r * r;
      x = (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
    }
    return p < 0.5 ? x : -x;
  }

  function roundAmerican(dec) {
    let a = dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1);
    a = Math.round(a / 5) * 5;
    if (a > -100 && a < 100) a = a < 0 ? -100 : 100;
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }

  // Price a set of fair probabilities the way a book would (noise + margin).
  function price(fairs, r, vig) {
    const noisy = fairs.map((p) => Math.max(0.02, p * (1 + (r() - 0.5) * 0.08)));
    const s = noisy.reduce((a, b) => a + b, 0);
    return noisy.map((p) => roundAmerican(1 / ((p / s) * (1 + vig))));
  }

  function generate(now = new Date(), scan = 0) {
    const day = Math.floor(now.getTime() / 86400000);
    const r = rng(day * 7919);
    const drift = rng(day * 31 + scan * 101);
    const events = [];
    let id = 0;

    for (const [key, s] of Object.entries(SPORTS)) {
      const teams = s.teams.slice().sort(() => r() - 0.5);
      for (let i = 0; i + 1 < teams.length; i += 2) {
        const home = teams[i], away = teams[i + 1];
        const start = new Date(now.getTime() + (1 + Math.floor(r() * 30)) * 3600000);
        start.setMinutes([0, 30, 0, 15][i % 4], 0, 0);
        const pHome = 0.25 + r() * 0.5;
        const pDraw = s.threeWay ? 0.22 + r() * 0.06 : 0;
        const spread = Math.floor(invNorm(pHome) * s.sd) + 0.5; // .5 lines = no ties
        const total = s.total[0] + Math.round(r() * (s.total[1] - s.total[0]) * 2) / 2;
        const players = s.props.length
          ? [0, 1, 2, 3].map(() => FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)])
          : [];
        const propLines = players.map(() => s.props.map((m) => {
          const [lo, hi] = PROP_LINES[m];
          return Math.round(lo + r() * (hi - lo)) + 0.5;
        }));
        const evId = 'demo-' + key + '-' + id++;

        const bookmakers = BOOKS.map(([bk, title]) => {
          const br = rng(day * 13 + id * 977 + bk.length * 31 + Math.floor(drift() * 3));
          const vig = bk === 'pinnacle' ? 0.025 : 0.04 + br() * 0.02;
          const markets = [];
          const ph = Math.min(0.95, Math.max(0.05, pHome + (drift() - 0.5) * 0.02));
          if (s.threeWay) {
            const fair = [ph * (1 - pDraw), Math.max(0.1, 1 - ph * (1 - pDraw) - pDraw), pDraw];
            const pr = price(fair, br, vig);
            markets.push({ key: 'h2h', outcomes: [
              { name: home, price: pr[0] }, { name: away, price: pr[1] }, { name: 'Draw', price: pr[2] }] });
          } else {
            const pr = price([ph, 1 - ph], br, vig);
            markets.push({ key: 'h2h', outcomes: [{ name: home, price: pr[0] }, { name: away, price: pr[1] }] });
            const line = br() < 0.2 ? spread + (br() < 0.5 ? -0.5 : 0.5) : spread;
            const sp = price([0.5, 0.5], br, vig);
            markets.push({ key: 'spreads', outcomes: [
              { name: home, price: sp[0], point: -line }, { name: away, price: sp[1], point: line }] });
          }
          const tp = price([0.5, 0.5], br, vig);
          markets.push({ key: 'totals', outcomes: [
            { name: 'Over', price: tp[0], point: total }, { name: 'Under', price: tp[1], point: total }] });

          players.forEach((pl, pi) => s.props.forEach((m, mi) => {
            const pp = price([0.5, 0.5], br, vig + 0.02);
            markets.push({ key: m, outcomes: [
              { name: 'Over', description: pl, price: pp[0], point: propLines[pi][mi] },
              { name: 'Under', description: pl, price: pp[1], point: propLines[pi][mi] }] });
          }));
          return { key: bk, title, markets };
        });

        events.push({
          id: evId, sport_key: key, sport_title: s.title,
          commence_time: start.toISOString(), home_team: home, away_team: away, bookmakers,
        });
      }
    }
    return events;
  }

  return { generate, BOOKS };
});
