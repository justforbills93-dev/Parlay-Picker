/*
 * Game research: injuries, recent form, head-to-head, records, team leaders
 * and ESPN's own matchup predictor, from ESPN's public JSON feeds.
 *
 * Parsing is pure (testable). Fetching is done by the caller through a
 * `get(url)` function, so the same code works with a direct fetch or
 * any other fetcher (used by tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParlayResearch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
  const LEAGUES = {
    basketball_nba: { path: 'basketball/nba' },
    basketball_wnba: { path: 'basketball/wnba' },
    basketball_ncaab: { path: 'basketball/mens-college-basketball', q: '&groups=50&limit=400' },
    americanfootball_nfl: { path: 'football/nfl' },
    americanfootball_ncaaf: { path: 'football/college-football', q: '&groups=80&limit=300' },
    icehockey_nhl: { path: 'hockey/nhl' },
    baseball_mlb: { path: 'baseball/mlb' },
    basketball_wncaab: { path: 'basketball/womens-college-basketball', q: '&groups=50&limit=400' },
    soccer_epl: { path: 'soccer/eng.1' },
    soccer_efl_champ: { path: 'soccer/eng.2' },
    soccer_spain_la_liga: { path: 'soccer/esp.1' },
    soccer_germany_bundesliga: { path: 'soccer/ger.1' },
    soccer_italy_serie_a: { path: 'soccer/ita.1' },
    soccer_france_ligue_one: { path: 'soccer/fra.1' },
    soccer_netherlands_eredivisie: { path: 'soccer/ned.1' },
    soccer_portugal_primeira_liga: { path: 'soccer/por.1' },
    soccer_mexico_ligamx: { path: 'soccer/mex.1' },
    soccer_uefa_champs_league: { path: 'soccer/uefa.champions' },
    soccer_uefa_europa_league: { path: 'soccer/uefa.europa' },
    soccer_usa_mls: { path: 'soccer/usa.1' },
  };

  // Heavy workload thresholds for minutes in the last game.
  const HEAVY = { basketball: 38, hockey: 24, soccer: 90 };

  // Statuses that mean a player might not play.
  const UNCERTAIN = /(out|doubt|question|day-to-day|game-time|suspen|injured reserve|^ir$|il\b)/i;
  const RULED_OUT = /(out|injured reserve|^ir$|suspen|il\b)/i;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function sameTeam(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const la = a.split(' ').pop(), lb = b.split(' ').pop();
    return la === lb && la.length > 3;
  }

  function samePlayer(a, b) {
    a = norm(a).replace(/\b(jr|sr|ii|iii|iv)\b/g, '').trim();
    b = norm(b).replace(/\b(jr|sr|ii|iii|iv)\b/g, '').trim();
    return !!a && a === b;
  }

  /* ---------- URLs ---------- */

  function etDate(d) {
    // ESPN days are US-Eastern.
    const s = new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return s.replace(/-/g, '');
  }

  // One scoreboard per (US-Eastern) day between `from` and `to`.
  function scoreboardUrls(sportKey, from = new Date(), to = new Date(Date.now() + 36 * 3600000)) {
    const L = LEAGUES[sportKey];
    if (!L) return [];
    const days = new Set();
    for (let t = new Date(from).getTime(); t <= new Date(to).getTime() + 3600000; t += 6 * 3600000) days.add(etDate(t));
    days.add(etDate(to));
    return [...days].sort().map((d) => `${BASE}${L.path}/scoreboard?dates=${d}${L.q || ''}`);
  }

  function summaryUrl(sportKey, espnId) {
    return `${BASE}${LEAGUES[sportKey].path}/summary?event=${espnId}`;
  }

  /* ---------- parsing ---------- */

  function parseTeam(c) {
    const recs = {};
    for (const r of c.records || []) recs[norm(r.name || r.type)] = r.summary;
    return {
      id: String(c.team?.id ?? c.id ?? ''),
      name: c.team?.displayName || '',
      abbr: c.team?.abbreviation || '',
      record: recs.overall || recs.total || recs.ytd || '',
      homeRecord: recs.home || '',
      awayRecord: recs.road || recs.away || '',
      leaders: (c.leaders || [])
        .filter((l) => l.name !== 'rating' && l.leaders && l.leaders[0])
        .map((l) => ({
          stat: l.shortDisplayName || l.abbreviation || l.name,
          name: l.leaders[0].athlete?.displayName || l.leaders[0].athlete?.shortName || '',
          value: l.leaders[0].displayValue || '',
        })),
    };
  }

  function parseScoreboard(json) {
    return (json.events || []).map((e) => {
      const comp = e.competitions?.[0] || {};
      const cs = comp.competitors || [];
      const home = cs.find((c) => c.homeAway === 'home') || cs[0];
      const away = cs.find((c) => c.homeAway === 'away') || cs[1];
      return {
        espnId: String(e.id),
        start: e.date,
        state: e.status?.type?.state || '',
        completed: !!e.status?.type?.completed,
        home: home ? { ...parseTeam(home), score: home.score != null ? Number(home.score) : null } : null,
        away: away ? { ...parseTeam(away), score: away.score != null ? Number(away.score) : null } : null,
      };
    }).filter((g) => g.home && g.away);
  }

  function matchGame(oddsEv, games) {
    const t = new Date(oddsEv.commence_time).getTime();
    const near = (g) => Math.abs(new Date(g.start).getTime() - t) < 6 * 3600000;
    return games.find((g) => near(g) && sameTeam(g.home.name, oddsEv.home_team) && sameTeam(g.away.name, oddsEv.away_team)) ||
      games.find((g) => near(g) && sameTeam(g.home.name, oddsEv.away_team) && sameTeam(g.away.name, oddsEv.home_team)) ||
      null;
  }

  function parseSummary(json, game) {
    const byId = (arr, id) => (arr || []).find((x) => String(x.team?.id) === String(id));
    const injuries = (id) => (byId(json.injuries, id)?.injuries || []).map((i) => ({
      name: i.athlete?.displayName || '',
      pos: i.athlete?.position?.abbreviation || '',
      status: i.status || i.type?.description || '',
      detail: i.details?.type || i.details?.detail || '',
      returns: i.details?.returnDate || '',
    }));
    const form = (id) => (byId(json.lastFiveGames, id)?.events || []).slice(0, 5).map((e) => ({
      result: e.gameResult || '', score: e.score || '', opp: e.opponent?.abbreviation || '', atVs: e.atVs || '',
      date: e.gameDate || '', id: e.id ? String(e.id) : '',
    }));

    const ss = (json.seasonseries || [])[0];
    const h2h = ss ? {
      summary: ss.summary || ss.shortSummary || '',
      games: (ss.events || []).filter((e) => e.statusType?.completed || e.status?.completed).map((e) => ({
        date: e.date,
        line: (e.competitors || []).map((c) => `${c.team?.abbreviation || ''} ${c.score ?? ''}`).join(' – '),
      })),
    } : null;

    // Soccer feeds carry older meetings too.
    const older = (json.headToHeadGames || []).flatMap((t) => t.events || []).slice(0, 5).map((e) => ({
      date: e.gameDate, line: `${e.score || ''} ${e.atVs || ''} ${e.opponent?.abbreviation || ''}`.trim(),
    }));

    let predictor = null;
    const p = json.predictor;
    if (p && p.homeTeam && p.awayTeam) {
      const hp = parseFloat(p.homeTeam.gameProjection), ap = parseFloat(p.awayTeam.gameProjection);
      if (hp > 0 && ap > 0) {
        const homeIsHome = String(p.homeTeam.id) === String(game.home.id) || !p.homeTeam.id;
        const h = homeIsHome ? hp : ap, a = homeIsHome ? ap : hp;
        predictor = { home: h / (h + a), away: a / (h + a) };
      }
    }

    return {
      espnId: game.espnId,
      home: { ...game.home, injuries: injuries(game.home.id), form: form(game.home.id) },
      away: { ...game.away, injuries: injuries(game.away.id), form: form(game.away.id) },
      h2h, older, predictor,
      updated: Date.now(),
    };
  }

  /* ---------- keyless live odds (DraftKings lines on ESPN's scoreboard) ---------- */

  function amToDec(a) {
    const v = parseFloat(String(a ?? '').replace('+', ''));
    if (!isFinite(v) || v === 0 || Math.abs(v) < 100) return null;
    return v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v);
  }
  function lineNum(x) {
    const v = parseFloat(String(x ?? '').replace(/^[ou]/i, ''));
    return isFinite(v) ? v : null;
  }
  const cur = (x) => (x && (x.close || x.current || x.open)) || {};

  // ESPN wraps the book's own betslip link in a tracking URL; keep the real one.
  function betLink(x) {
    const href = cur(x).link?.href;
    if (!href) return null;
    try {
      const pre = new URL(href).searchParams.get('preurl');
      if (pre && /^https:\/\//.test(pre)) return pre;
      return /__/.test(href) ? null : href;
    } catch { return null; }
  }

  // Turns ESPN scoreboard odds into the same shape The Odds API returns.
  function oddsFromScoreboard(json, sportKey) {
    const title = json.leagues?.[0]?.abbreviation || json.leagues?.[0]?.name || sportKey;
    return (json.events || []).flatMap((e) => {
      const comp = e.competitions?.[0];
      if (!comp || (e.status?.type?.state && e.status.type.state !== 'pre')) return [];
      const cs = comp.competitors || [];
      const home = cs.find((c) => c.homeAway === 'home'), away = cs.find((c) => c.homeAway === 'away');
      if (!home || !away) return [];
      const H = home.team?.displayName, A = away.team?.displayName;
      const bookmakers = (comp.odds || []).map((o) => {
        const markets = [];
        const ml = o.moneyline;
        if (ml) {
          const outs = [[H, ml.home], [A, ml.away], ['Draw', ml.draw]]
            .map(([name, x]) => ({ name, price: amToDec(cur(x).odds), link: betLink(x) })).filter((x) => x.price);
          if (outs.length >= 2) markets.push({ key: 'h2h', outcomes: outs });
        }
        const ps = o.pointSpread;
        if (ps) {
          const h = cur(ps.home), a = cur(ps.away);
          const hl = lineNum(h.line), al = lineNum(a.line), ho = amToDec(h.odds), ao = amToDec(a.odds);
          if (hl != null && al != null && ho && ao) {
            markets.push({ key: 'spreads', outcomes: [{ name: H, price: ho, point: hl, link: betLink(ps.home) }, { name: A, price: ao, point: al, link: betLink(ps.away) }] });
          }
        }
        const t = o.total;
        if (t) {
          const ov = cur(t.over), un = cur(t.under);
          const pt = lineNum(ov.line), oo = amToDec(ov.odds), uo = amToDec(un.odds);
          if (pt != null && oo && uo) {
            markets.push({ key: 'totals', outcomes: [{ name: 'Over', price: oo, point: pt, link: betLink(t.over) }, { name: 'Under', price: uo, point: pt, link: betLink(t.under) }] });
          }
        }
        const name = o.provider?.displayName || o.provider?.name || 'Sportsbook';
        return { key: norm(name).replace(/ /g, '') || 'espn', title: name, markets };
      }).filter((b) => b.markets.length);
      if (!bookmakers.length) return [];
      return [{
        id: 'espn-' + e.id, sport_key: sportKey, sport_title: title,
        commence_time: new Date(e.date).toISOString(), home_team: H, away_team: A, bookmakers,
      }];
    });
  }

  /* ---------- fatigue ---------- */

  // Team fatigue from the schedule: rest before this game, back-to-backs,
  // games in the last 7 days and road-trip length. `form` is oldest → newest.
  function teamFatigue(side, commence, sportKey, isAway) {
    const start = new Date(commence).getTime();
    const past = side.form.filter((f) => f.date && new Date(f.date).getTime() < start - 3600000);
    if (!past.length) return null;
    const lastT = Math.max(...past.map((f) => new Date(f.date).getTime()));
    const restH = (start - lastT) / 3600000;
    const last6 = past.filter((f) => start - new Date(f.date).getTime() < 6 * 86400000).length;
    let road = isAway ? 1 : 0;
    if (isAway) for (let i = past.length - 1; i >= 0 && past[i].atVs === '@'; i--) road++;
    const football = /football/.test(sportKey);
    const daysOff = Math.max(0, Math.round(restH / 24) - 1);
    const b2b = !football && restH < 30;
    const shortWeek = football && restH < 6 * 24;
    const crowded = !football && last6 >= 3; // this game makes 4 in 6 days
    const tired = b2b || shortWeek || crowded;
    const bits = [];
    if (b2b) bits.push('2nd night of a back-to-back');
    else if (shortWeek) bits.push(`short week (${Math.round(restH / 24)} days)`);
    else bits.push(`${daysOff} day${daysOff === 1 ? '' : 's'} rest`);
    if (crowded) bits.push(`${last6 + 1} games in 6 days`);
    if (road >= 3) bits.push(`game ${road} of a road trip`);
    return { restH, daysOff, b2b, shortWeek, last6, road, tired, label: bits.join(' · ') };
  }

  // A team's minutes and starters from its last game's box score.
  function parseLoad(json, teamId, sportKey) {
    const team = (json.boxscore?.players || []).find((t) => String(t.team?.id) === String(teamId));
    if (!team) return null;
    const st = team.statistics?.[0] || {};
    const labels = (st.labels || []).map((x) => String(x).toUpperCase());
    const mi = labels.indexOf('MIN') >= 0 ? labels.indexOf('MIN') : labels.indexOf('TOI');
    const heavyAt = HEAVY[Object.keys(HEAVY).find((k) => sportKey.includes(k))] || Infinity;
    const players = (st.athletes || []).filter((a) => !a.didNotPlay).map((a) => {
      let min = null;
      if (mi >= 0 && a.stats && a.stats[mi] != null) {
        const v = String(a.stats[mi]);
        min = v.includes(':') ? parseInt(v, 10) + parseInt(v.split(':')[1], 10) / 60 : parseFloat(v);
        if (!isFinite(min)) min = null;
      }
      return { name: a.athlete?.displayName || '', starter: !!a.starter, min };
    });
    return {
      starters: players.filter((p) => p.starter).map((p) => p.name),
      minutes: Object.fromEntries(players.filter((p) => p.min != null).map((p) => [p.name, Math.round(p.min)])),
      heavy: players.filter((p) => p.min != null && p.min >= heavyAt).map((p) => ({ name: p.name, min: Math.round(p.min) })),
    };
  }

  /* ---------- applying research to picks ---------- */

  function findInjury(r, player) {
    for (const side of [r.home, r.away]) {
      const hit = side.injuries.find((i) => samePlayer(i.name, player));
      if (hit) return hit;
    }
    return null;
  }

  // Star players (team leaders) whose status is uncertain or out.
  function starAlerts(side) {
    const out = [];
    for (const l of side.leaders) {
      const inj = side.injuries.find((i) => samePlayer(i.name, l.name));
      if (inj && UNCERTAIN.test(inj.status) && !out.some((o) => o.name === l.name)) {
        out.push({ name: l.name, status: inj.status, stat: `${l.value} ${l.stat}`.trim() });
      }
    }
    return out;
  }

  /**
   * Adjust legs with research. Returns new leg objects.
   * - Moneyline: blend the market's fair chance with ESPN's matchup predictor
   *   (modelWeight, default 20%). Markets stay the main signal.
   * - Player props: block any prop on a player listed out or questionable
   *   (they may sit, and the bet may be voided or lost).
   * - Team picks: warn when a team's star is questionable or out.
   */
  function applyResearch(legs, research, opts = {}) {
    const w = opts.modelWeight ?? 0.2;
    return legs.map((l) => {
      const r = research[l.eventId];
      if (!r) return l;
      const out = { ...l, research: true, warnings: [] };
      const [awayName, homeName] = l.game.split(' @ ');

      if (l.isProp) {
        const player = l.pick.split(/ (Over|Under) /)[0].split(' — ')[0];
        const inj = findInjury(r, player);
        if (inj && UNCERTAIN.test(inj.status)) {
          out.blocked = true;
          out.warnings.push(`${inj.name} is ${inj.status}${inj.detail ? ' (' + inj.detail + ')' : ''}`);
        }
        for (const side of [r.home, r.away]) {
          const heavy = side.load?.heavy.find((h) => samePlayer(h.name, player));
          if (heavy) {
            out.warnings.push(`${heavy.name} played ${heavy.min} min last game` + (side.fatigue?.b2b ? ' and plays again tonight' : ''));
            if (side.fatigue?.tired) out.fatigued = true;
          }
        }
        return out;
      }

      const homeAlerts = starAlerts(r.home), awayAlerts = starAlerts(r.away);
      const sideHome = l.pick.startsWith(homeName) || sameTeam(l.pick.replace(/ (to win|[+-][\d.]+)$/, ''), homeName);
      const sideAway = l.pick.startsWith(awayName) || sameTeam(l.pick.replace(/ (to win|[+-][\d.]+)$/, ''), awayName);
      const mine = sideHome ? homeAlerts : sideAway ? awayAlerts : homeAlerts.concat(awayAlerts);
      for (const a of mine) {
        out.warnings.push(`${a.name} (${a.stat}) is ${a.status}`);
        if (RULED_OUT.test(a.status)) out.starOut = true; else out.starQuestionable = true;
      }

      const fat = sideHome ? r.home.fatigue : sideAway ? r.away.fatigue : null;
      if (fat && fat.tired) { out.fatigued = true; out.warnings.push(`Tired: ${fat.label}`); }
      const opp = sideHome ? r.away.fatigue : sideAway ? r.home.fatigue : null;
      if (fat && opp && !fat.tired && opp.tired) out.notes = (out.notes || []).concat(`Rest edge: opponent on ${opp.label}`);

      if (l.market === 'h2h' && r.predictor && (sideHome || sideAway)) {
        const model = sideHome ? r.predictor.home : r.predictor.away;
        out.marketProb = l.prob;
        out.modelProb = model;
        out.prob = (1 - w) * l.prob + w * model;
        out.ev = out.prob * l.price - 1;
      }
      return out;
    });
  }

  return {
    LEAGUES, UNCERTAIN, norm, sameTeam, samePlayer, etDate,
    scoreboardUrls, summaryUrl, parseScoreboard, matchGame, parseSummary,
    starAlerts, applyResearch, teamFatigue, parseLoad, oddsFromScoreboard,
  };
});
