/*
 * Game research: injuries, recent form, head-to-head, records, team leaders
 * and ESPN's own matchup predictor, from ESPN's public JSON feeds.
 *
 * Parsing is pure (testable). Fetching is done by the caller through a
 * `get(url)` function, so the same code works with a direct fetch or the
 * claude.ai Firecrawl relay.
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
    soccer_epl: { path: 'soccer/eng.1' },
    soccer_usa_mls: { path: 'soccer/usa.1' },
  };

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

  function scoreboardUrls(sportKey, now = new Date(), hoursAhead = 36) {
    const L = LEAGUES[sportKey];
    if (!L) return [];
    const days = new Set([etDate(now), etDate(now.getTime() + hoursAhead * 3600000)]);
    return [...days].map((d) => `${BASE}${L.path}/scoreboard?dates=${d}${L.q || ''}`);
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
        home: home ? parseTeam(home) : null,
        away: away ? parseTeam(away) : null,
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
    starAlerts, applyResearch,
  };
});
