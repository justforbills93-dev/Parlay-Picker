/* Parlay Picker — UI, scanning and rendering. */
(function () {
  'use strict';
  const E = window.ParlayEngine;
  const R = window.ParlayResearch;
  const $ = (id) => document.getElementById(id);

  // Starter list until the live list loads. With an API key, the full live list of every
  // sport the odds feed covers replaces it (it changes with the seasons).
  const FALLBACK_SPORTS = [
    ['American Football', 'americanfootball_nfl', 'NFL'], ['American Football', 'americanfootball_ncaaf', 'NCAAF'],
    ['American Football', 'americanfootball_cfl', 'CFL'], ['American Football', 'americanfootball_ufl', 'UFL'],
    ['Basketball', 'basketball_nba', 'NBA'], ['Basketball', 'basketball_ncaab', 'NCAAB'], ['Basketball', 'basketball_wncaab', 'NCAAW'],
    ['Basketball', 'basketball_wnba', 'WNBA'], ['Basketball', 'basketball_euroleague', 'Euroleague'], ['Basketball', 'basketball_nbl', 'NBL (Australia)'],
    ['Ice Hockey', 'icehockey_nhl', 'NHL'], ['Ice Hockey', 'icehockey_ahl', 'AHL'], ['Ice Hockey', 'icehockey_sweden_hockey_league', 'SHL'],
    ['Ice Hockey', 'icehockey_liiga', 'Liiga'],
    ['Baseball', 'baseball_mlb', 'MLB'], ['Baseball', 'baseball_ncaa', 'NCAA Baseball'], ['Baseball', 'baseball_npb', 'NPB (Japan)'], ['Baseball', 'baseball_kbo', 'KBO (Korea)'],
    ['Soccer', 'soccer_epl', 'EPL'], ['Soccer', 'soccer_efl_champ', 'Championship'], ['Soccer', 'soccer_spain_la_liga', 'La Liga'],
    ['Soccer', 'soccer_germany_bundesliga', 'Bundesliga'], ['Soccer', 'soccer_italy_serie_a', 'Serie A'], ['Soccer', 'soccer_france_ligue_one', 'Ligue 1'],
    ['Soccer', 'soccer_uefa_champs_league', 'Champions League'], ['Soccer', 'soccer_uefa_europa_league', 'Europa League'],
    ['Soccer', 'soccer_usa_mls', 'MLS'], ['Soccer', 'soccer_mexico_ligamx', 'Liga MX'], ['Soccer', 'soccer_netherlands_eredivisie', 'Eredivisie'],
    ['Soccer', 'soccer_portugal_primeira_liga', 'Primeira Liga'], ['Soccer', 'soccer_brazil_campeonato', 'Brazil Série A'],
    ['Mixed Martial Arts', 'mma_mixed_martial_arts', 'MMA / UFC'], ['Boxing', 'boxing_boxing', 'Boxing'],
    ['Tennis', 'tennis_atp_finals', 'ATP'], ['Tennis', 'tennis_wta_finals', 'WTA'],
    ['Cricket', 'cricket_ipl', 'IPL'], ['Cricket', 'cricket_big_bash', 'Big Bash'], ['Cricket', 'cricket_test_match', 'Test Matches'],
    ['Cricket', 'cricket_odi', 'One Day Internationals'], ['Cricket', 'cricket_international_t20', 'International T20'],
    ['Rugby League', 'rugbyleague_nrl', 'NRL'], ['Rugby Union', 'rugbyunion_six_nations', 'Six Nations'],
    ['Aussie Rules', 'aussierules_afl', 'AFL'], ['Lacrosse', 'lacrosse_pll', 'PLL'], ['Handball', 'handball_germany_bundesliga', 'Handball Bundesliga'],
    ['Golf', 'golf_masters_tournament_winner', 'Masters (futures)', true], ['Politics', 'politics_us_presidential_election_winner', 'US Election (futures)', true],
  ].map(([group, key, title, outrights]) => ({ group, key, title, active: true, has_outrights: !!outrights }));
  const PROP_MARKETS = {
    basketball_nba: 'player_points,player_rebounds,player_assists,player_threes',
    basketball_ncaab: 'player_points,player_rebounds,player_assists',
    basketball_wnba: 'player_points,player_rebounds,player_assists',
    americanfootball_nfl: 'player_pass_yds,player_rush_yds,player_reception_yds,player_anytime_td',
    americanfootball_ncaaf: 'player_pass_yds,player_rush_yds,player_reception_yds',
    icehockey_nhl: 'player_points,player_shots_on_goal',
    baseball_mlb: 'batter_hits,pitcher_strikeouts',
  };
  const API = 'https://api.the-odds-api.com/v4';
  const WINDOWS = { today: 'Today', tomorrow: 'Tomorrow', 2: 'Today & tomorrow', 3: 'Next 3 days', 5: 'Next 5 days', 7: 'Next 7 days' };

  // Which games to scan: from/to times for the chosen day range (local days).
  function gameWindow(now = new Date()) {
    const w = String(state.settings.window || '2');
    const dayEnd = (offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(23, 59, 59, 0); return d; };
    if (w === 'today') return { from: now, to: dayEnd(0) };
    if (w === 'tomorrow') { const f = dayEnd(0); f.setTime(f.getTime() + 1000); return { from: f, to: dayEnd(1) }; }
    return { from: now, to: dayEnd(Math.max(1, Number(w) || 2) - 1) };
  }
  const windowLabel = () => (WINDOWS[state.settings.window] || WINDOWS[2]).toLowerCase();

  const DEFAULTS = {
    apiKey: '', sports: ['americanfootball_nfl', 'basketball_nba', 'icehockey_nhl', 'americanfootball_ncaaf'],
    regions: 'us,us2', props: false, propGames: 3, refresh: 15, fmt: 'american',
    research: true, avoidUncertain: true, researchMin: 60, fatigue: true, avoidTired: false, window: '2',
    autoScan: true,
  };

  const state = {
    settings: load(), events: [], legs: [], scans: 0, lastScan: null, nextScan: null,
    remaining: null, error: null, filter: new Set(), selectedTier: null, scanning: false,
    research: {}, researchNote: '', catalog: loadCatalog(), loads: loadBox(),
    mode: '', error: null, memo: new Map(), base: new Map(), bets: loadBets(), lastSettle: 0,

    legCount: 0, openRow: 0, types: new Set(['ml', 'spread', 'total', 'prop']),
    slip: loadSlip(), lockSlip: false, slipOpen: false, legById: new Map(), byoQuery: '',
  };
  function loadSlip() { try { return JSON.parse(localStorage.getItem('pp-slip') || '[]'); } catch { return []; } }
  function saveSlip() { try { localStorage.setItem('pp-slip', JSON.stringify(state.slip)); } catch { /* ignore */ } }
  const inSlip = (id) => state.slip.includes(id);
  const addBtn = (l) => `<button type="button" class="add ${inSlip(l.id) ? 'on' : ''}" data-add="${esc(l.id)}" aria-label="${inSlip(l.id) ? 'Remove from' : 'Add to'} my parlay">${inSlip(l.id) ? '✓' : '+'}</button>`;
  const MAX_LEGS = 15;

  // Where to send people to place a bet. A pick's own betslip link (from the
  // odds feed) is used when we have one; otherwise the league page.
  const BOOKS = {
    draftkings: {
      name: 'DraftKings', home: 'https://sportsbook.draftkings.com/',
      league: { basketball_nba: 'leagues/basketball/nba', americanfootball_nfl: 'leagues/football/nfl', icehockey_nhl: 'leagues/hockey/nhl',
        baseball_mlb: 'leagues/baseball/mlb', americanfootball_ncaaf: 'leagues/football/ncaaf', basketball_ncaab: 'leagues/basketball/ncaab',
        basketball_wnba: 'leagues/basketball/wnba', soccer_epl: 'leagues/soccer/england---premier-league', mma_mixed_martial_arts: 'leagues/mma/ufc' },
    },
    fanduel: {
      name: 'FanDuel', home: 'https://sportsbook.fanduel.com/',
      league: { basketball_nba: 'navigation/nba', americanfootball_nfl: 'navigation/nfl', icehockey_nhl: 'navigation/nhl',
        baseball_mlb: 'navigation/mlb', americanfootball_ncaaf: 'navigation/ncaaf', basketball_ncaab: 'navigation/ncaab',
        mma_mixed_martial_arts: 'navigation/ufc' },
    },
    betmgm: {
      name: 'BetMGM', home: 'https://sports.betmgm.com/en/sports',
      league: { basketball_nba: 'en/sports/basketball-7/betting/usa-9/nba-6004', americanfootball_nfl: 'en/sports/football-11/betting/usa-9/nfl-35',
        icehockey_nhl: 'en/sports/ice-hockey-12/betting/usa-9/nhl-34', baseball_mlb: 'en/sports/baseball-23/betting/usa-9/mlb-75' },
      base: 'https://sports.betmgm.com/',
    },
  };
  const bookUrl = (bk, sport) => {
    const b = BOOKS[bk];
    const path = b.league[sport];
    return path ? (b.base || b.home) + path : b.home;
  };
  const quoteAt = (l, bk) => l.quotes.find((q) => q.book === bk || (bk === 'betmgm' && /mgm/.test(q.book)));
  const TYPE_NAMES = { ml: 'Moneylines', spread: 'Spreads', total: 'Totals', prop: 'Player props' };

  function loadCatalog() {
    try {
      const c = JSON.parse(localStorage.getItem('pp-catalog') || 'null');
      if (c && Date.now() - c.at < 86400000 && c.list.length) return c.list;
    } catch { /* ignore */ }
    return FALLBACK_SPORTS;
  }
  function loadBox() {
    try {
      const b = JSON.parse(localStorage.getItem('pp-box') || '{}');
      for (const k of Object.keys(b)) if (Date.now() - b[k].at > 4 * 86400000) delete b[k];
      return b;
    } catch { return {}; }
  }
  function saveBox() { try { localStorage.setItem('pp-box', JSON.stringify(state.loads)); } catch { /* full or blocked */ } }
  // "all:<group>" (e.g. all:Tennis) means every event in that group the feed has
  // right now. Tennis and other tours list each tournament separately and they
  // change week to week, so this keeps the selection current.
  function chosenKeys() {
    const sel = state.settings.sports;
    const out = new Set(sel.filter((k) => !k.startsWith('all:')));
    for (const k of sel) {
      if (!k.startsWith('all:')) continue;
      const g = k.slice(4);
      for (const c of state.catalog) if (c.group === g && c.active && !c.has_outrights) out.add(c.key);
    }
    return [...out];
  }
  const groupOf = (k) => state.catalog.find((c) => c.key === k)?.group || FALLBACK_SPORTS.find((c) => c.key === k)?.group ||
    (k.startsWith('tennis_') ? 'Tennis' : k.split('_')[0]);
  // Sports chosen that the free (no key) mode can't price: ESPN posts no odds for them.
  function keyNeededGroups() {
    return [...new Set(chosenKeys().filter((k) => !R.LEAGUES[k]).map(groupOf))];
  }
  const sportName = (k) => (k.startsWith('all:') ? 'All ' + k.slice(4) : null) || state.catalog.find((c) => c.key === k)?.title ||
    FALLBACK_SPORTS.find((c) => c.key === k)?.title || state.legs.find((l) => l.sport === k)?.sportTitle || k;

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pp-settings') || '{}') }; }
    catch { return { ...DEFAULTS }; }
  }
  function save() {
    try { localStorage.setItem('pp-settings', JSON.stringify(state.settings)); } catch { /* private mode */ }
  }
  // Modes: 'odds' = Odds API key (10+ books), 'espn' = free live DraftKings lines
  // from ESPN's scoreboard. There is no sample-data mode: if nothing loads, we say so.
  const hasKey = () => !!state.settings.apiKey.trim();

  /* ---------- formatting ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => '$' + (v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2).replace(/\.00$/, ''));
  const odds = (d) => (state.settings.fmt === 'decimal' ? d.toFixed(2) : E.fmtAmerican(d));
  const pct = (p) => (p * 100 >= 10 ? Math.round(p * 100) : (p * 100).toFixed(1)) + '%';

  function when(iso) {
    const d = new Date(iso), now = new Date();
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Today ' + t;
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow ' + t;
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
  }

  function valueWord(ev) {
    if (ev >= 0.02) return '<span class="good">Great value</span>';
    if (ev >= 0) return '<span class="good">Good value</span>';
    if (ev >= -0.03) return '<span class="warn">Fair price</span>';
    return '<span class="bad">Pricey</span>';
  }

  /* ---------- scanning ---------- */
  // All data is fetched straight from the browser: ESPN's free feeds, and The
  // Odds API when a key is set. No connector or paid relay is involved.
  // claude.ai pages block outside requests, so there the app points to the live site.
  const LIVE_SITE = 'https://justforbills93-dev.github.io/Parlay-Picker/';
  const IN_CLAUDE = !!(window.claude && typeof window.claude.use === 'function');

  // ESPN's free feed is retried (and tried on its second host) before we call it a failure.
  async function fetchRetry(url) {
    if (!/^https:\/\/site\.api\.espn\.com\//.test(url)) return fetch(url);
    const alt = url.replace('site.api.espn.com', 'site.web.api.espn.com');
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(i === 1 ? alt : url, { cache: 'no-store' });
        if (res.ok || (res.status < 500 && res.status !== 429)) return res;
        last = new Error(res.status + ' ' + res.statusText);
      } catch (e) { last = e; }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    throw last;
  }

  async function getJSON(url) {
    const res = await fetchRetry(url);
    const rem = res.headers.get('x-requests-remaining');
    if (rem != null) state.remaining = Number(rem);
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j.message) msg = j.message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  const isoNoMs = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

  async function scanLive() {
    const s = state.settings;
    const key = encodeURIComponent(s.apiKey.trim());
    const { from: now, to } = gameWindow();

    // Free call: which sports are in season right now.
    const all = await getJSON(`${API}/sports?apiKey=${key}`);
    if (Array.isArray(all) && all.length) {
      state.catalog = all.map((x) => ({ key: x.key, group: x.group, title: x.title, active: x.active, has_outrights: x.has_outrights }));
      try { localStorage.setItem('pp-catalog', JSON.stringify({ at: Date.now(), list: state.catalog })); } catch { /* ignore */ }
    }
    const playable = new Set(state.catalog.filter((x) => x.active && !x.has_outrights).map((x) => x.key));
    const keys = chosenKeys().filter((k) => playable.has(k));
    if (!keys.length) throw new Error('None of your chosen sports have games right now. Tap "Choose sports" to add more.');

    // Spreads/totals don't exist for every sport (tennis, MMA...), so ask for
    // moneylines alone if the full request is refused.
    const odds = (k, markets) => getJSON(`${API}/sports/${k}/odds?apiKey=${key}&regions=${s.regions}&markets=${markets}` +
      `&oddsFormat=decimal&includeLinks=true&commenceTimeFrom=${isoNoMs(now)}&commenceTimeTo=${isoNoMs(to)}`);
    // Remember sports that only offer moneylines (most tennis), so later scans ask once.
    state.h2hOnly = state.h2hOnly || new Set();
    const lists = await pool(keys, 6, (k) => (state.h2hOnly.has(k) ? odds(k, 'h2h')
      : odds(k, 'h2h,spreads,totals').catch(() => { state.h2hOnly.add(k); return odds(k, 'h2h'); })));
    const events = lists.filter(Boolean).flat();

    if (s.props) {
      const jobs = [];
      for (const k of keys) {
        if (!PROP_MARKETS[k]) continue;
        events.filter((e) => e.sport_key === k)
          .sort((a, b) => a.commence_time.localeCompare(b.commence_time))
          .slice(0, s.propGames)
          .forEach((ev) => jobs.push(
            getJSON(`${API}/sports/${k}/events/${ev.id}/odds?apiKey=${key}&regions=${s.regions}` +
              `&markets=${PROP_MARKETS[k]}&oddsFormat=decimal&includeLinks=true`)
              .then((p) => mergeProps(ev, p)).catch((e) => console.warn('props', ev.id, e))));
      }
      await Promise.all(jobs);
    }
    return events;
  }

  function mergeProps(ev, propEv) {
    for (const pb of propEv.bookmakers || []) {
      let bm = ev.bookmakers.find((b) => b.key === pb.key);
      if (!bm) { bm = { key: pb.key, title: pb.title, markets: [] }; ev.bookmakers.push(bm); }
      bm.markets.push(...pb.markets);
    }
  }

  async function pool(items, n, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => { console.warn(e); return null; }); }
    }));
    return out;
  }

  // Injuries, form, head-to-head, team leaders and ESPN's predictor for each game.
  async function loadResearch(events) {
    const maxAge = Math.max(10, state.settings.researchMin) * 60000;
    const now = Date.now();
    const sports = [...new Set(events.map((e) => e.sport_key))].filter((k) => R.LEAGUES[k]);
    let matched = 0, failed = 0;
    for (const sport of sports) {
      const evs = events.filter((e) => e.sport_key === sport);
      const stale = evs.filter((e) => !state.research[e.id] || now - state.research[e.id].updated > maxAge);
      if (!stale.length) { matched += evs.length; continue; }
      const { from, to } = gameWindow();
      const boards = await pool(R.scoreboardUrls(sport, from, to), 2, (u) => memoJSON(u, 5 * 60000));
      const games = boards.filter(Boolean).flatMap((b) => R.parseScoreboard(b));
      const jobs = stale.map((e) => ({ e, g: R.matchGame(e, games) })).filter((j) => j.g);
      matched += evs.length - stale.length;
      await pool(jobs, 4, async ({ e, g }) => {
        try {
          state.research[e.id] = R.parseSummary(await getJSON(R.summaryUrl(sport, g.espnId)), g);
          matched++;
        } catch (err) { failed++; throw err; }
      });
    }
    addFatigue(events);
    if (state.settings.fatigue) await loadPlayerLoads(events);
    const unsupported = events.filter((e) => !R.LEAGUES[e.sport_key]).length;
    const covered = events.length - unsupported;
    state.researchNote = covered ? `research on ${matched}/${covered} games` + (failed ? ` (${failed} failed)` : '') : '';
  }

  // Fatigue counts finished games plus any games the team plays before this one
  // inside the scanned days (e.g. a game tomorrow makes the next day a back-to-back).
  function addFatigue(events) {
    const withSchedule = (side, e) => {
      const t = new Date(e.commence_time).getTime();
      const extra = events.filter((x) => x.sport_key === e.sport_key && x.id !== e.id && new Date(x.commence_time).getTime() < t &&
        (R.sameTeam(x.home_team, side.name) || R.sameTeam(x.away_team, side.name)))
        .map((x) => ({ result: '', score: '', opp: '', atVs: R.sameTeam(x.away_team, side.name) ? '@' : 'vs', date: x.commence_time, id: '' }));
      const seen = new Set(side.form.map((f) => (f.date || '').slice(0, 10)));
      const form = side.form.concat(extra.filter((f) => !seen.has(f.date.slice(0, 10))))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return { ...side, form };
    };
    for (const e of events) {
      const r = state.research[e.id];
      if (!r) continue;
      r.home.fatigue = state.settings.fatigue ? R.teamFatigue(withSchedule(r.home, e), e.commence_time, e.sport_key, false) : null;
      r.away.fatigue = state.settings.fatigue ? R.teamFatigue(withSchedule(r.away, e), e.commence_time, e.sport_key, true) : null;
      if (!state.settings.fatigue) { r.home.load = null; r.away.load = null; }
    }
  }

  // Minutes and starters from each team's last game (basketball, hockey, soccer).
  // A finished game never changes, so each box score is fetched once.
  async function loadPlayerLoads(events) {
    const jobs = [];
    for (const e of events) {
      const r = state.research[e.id];
      if (!r || !/basketball|hockey|soccer/.test(e.sport_key)) continue;
      for (const side of [r.home, r.away]) {
        const last = side.form[side.form.length - 1];
        if (!last || !last.id) continue;
        const ck = last.id + ':' + side.id;
        if (state.loads[ck]) { side.load = state.loads[ck].load; continue; }
        jobs.push({ side, ck, url: R.summaryUrl(e.sport_key, last.id), sport: e.sport_key });
      }
    }
    // Both teams' entries share one box score when they played each other last.
    const byUrl = new Map();
    for (const j of jobs) { if (!byUrl.has(j.url)) byUrl.set(j.url, []); byUrl.get(j.url).push(j); }
    await pool([...byUrl.entries()], 4, async ([url, js]) => {
      const json = await getJSON(url);
      for (const j of js) {
        const load = R.parseLoad(json, j.side.id, j.sport);
        if (load) { j.side.load = load; state.loads[j.ck] = { at: Date.now(), load }; }
      }
    });
    saveBox();
  }

  // Same URL within `ttl` ms reuses the response (scoreboards serve both odds and research).
  function memoJSON(url, ttl) {
    const hit = state.memo.get(url);
    if (hit && Date.now() - hit.at < ttl) return hit.p;
    const p = getJSON(url);
    state.memo.set(url, { at: Date.now(), p });
    p.catch(() => state.memo.delete(url));
    return p;
  }

  async function scanEspn() {
    const win = gameWindow();
    const keys = chosenKeys().filter((k) => R.LEAGUES[k]);
    if (!keys.length) {
      const g = keyNeededGroups();
      throw new Error(`${g.length ? g.join(', ') : 'your chosen sports'} need${g.length === 1 ? 's' : ''} a free Odds API key: ESPN shows these matches but posts no odds for them. Add the key in Settings.`);
    }
    const failed = [];
    const lists = await pool(keys, 4, async (k) => {
      let ok = 0, err = null;
      const boards = await Promise.all(R.scoreboardUrls(k, win.from, win.to).map((u) =>
        memoJSON(u, 60000).then((b) => { ok++; return b; }).catch((e) => { err = err || e; return null; })));
      if (!ok) {
        // Couldn't reach ESPN for this sport: keep its earlier games rather than dropping them.
        failed.push({ k, msg: (err && err.message) || 'request failed' });
        return state.events.filter((e) => e.sport_key === k);
      }
      return boards.filter(Boolean).flatMap((b) => R.oddsFromScoreboard(b, k));
    });
    state.partial = failed.map((f) => sportName(f.k)).join(', ');
    const events = lists.filter(Boolean).flat().filter((e) => {
      const t = new Date(e.commence_time).getTime();
      return t >= win.from.getTime() && t <= win.to.getTime();
    });
    if (!events.length && failed.length) {
      throw new Error(`Couldn't reach ESPN for ${state.partial} (${failed[0].msg}). Check your connection or turn off ad/content blockers for this site.`);
    }
    const seen = new Set();
    return events.filter((e) => !seen.has(e.id) && seen.add(e.id));
  }

  async function scan() {
    if (state.scanning) return;
    state.scanning = true;
    $('scanBtn').disabled = true;
    $('scanBtn').textContent = 'Scanning…';
    state.error = null;
    try {
      if (IN_CLAUDE) throw new Error(`claude.ai previews can't load outside data. Open the live site: ${LIVE_SITE}`);
      let events = null, keyErr = null;
      if (hasKey()) {
        try { events = await scanLive(); state.mode = 'odds'; } catch (e) { keyErr = e.message || String(e); }
      }
      if (!events) {
        events = await scanEspn();
        state.mode = 'espn';
        state.keyNote = keyErr ? `Your Odds API key didn't work (${keyErr}), so this scan used the free DraftKings feed.` : '';
      } else state.keyNote = '';
      if (!events.length) throw new Error(`No games with posted lines ${windowLabel()} for ${keysChecked()}. Try a longer day range or more sports.`);
      const now = Date.now();
      const evs = events.filter((e) => new Date(e.commence_time).getTime() > now); // pre-game only
      if (!evs.length) throw new Error(`Every game in ${windowLabel()} has already started. Try a longer day range.`);
      state.events = evs;
      let legs = E.buildLegs(state.events, { minBooks: state.mode === 'odds' ? 3 : 1 });
      if (state.settings.research) {
        try { await loadResearch(state.events); } catch (e) { state.researchNote = 'research unavailable'; console.warn(e); }
        legs = R.applyResearch(legs, state.research);
      } else {
        state.researchNote = '';
      }
      // Line movement vs the first price we saw for each pick this session.
      const seen = new Set();
      for (const l of legs) {
        seen.add(l.id);
        if (!state.base.has(l.id)) state.base.set(l.id, l.price);
        const b0 = state.base.get(l.id);
        if (Math.abs(b0 - l.price) > 1e-9) l.moved = { from: b0, to: l.price };
      }
      for (const id of [...state.base.keys()]) if (!seen.has(id)) state.base.delete(id);
      state.legs = legs;
      state.legById = new Map(legs.map((l) => [l.id, l]));
      state.scans++;
      state.lastScan = new Date();
    } catch (e) {
      state.error = e.message || String(e); // keep the last good data on screen, marked stale
    } finally {
      state.scanning = false;
      $('scanBtn').disabled = false;
      $('scanBtn').textContent = 'Scan now';
      state.nextScan = Date.now() + (state.error ? 30000 : refreshMs());
      renderAll();
      settleBets();
    }
  }
  // Free ESPN data refreshes every minute. With an Odds API key the timer follows
  // Settings so the free 500 credits/month last.
  const keysChecked = () => { const k = chosenKeys().map(sportName); return k.length ? k.join(', ') : 'your chosen sports'; };
  const refreshMs = () => (state.mode === 'odds' ? Math.max(2, state.settings.refresh) : 1) * 60000;


  /* ---------- bet tracker ---------- */
  function loadBets() { try { return JSON.parse(localStorage.getItem('pp-bets') || '[]'); } catch { return []; } }
  function saveBets() { try { localStorage.setItem('pp-bets', JSON.stringify(state.bets)); } catch { /* ignore */ } }

  function trackBet(ids) {
    const legs = ids.map((id) => state.legById.get(id)).filter(Boolean);
    if (!legs.length) return false;
    const sig = legs.map((l) => l.id).sort().join('~');
    if (state.bets.some((b) => b.status === 'pending' && b.sig === sig)) return 'dup';
    const stake = E.parseGoal($('ask').value).stake || 10;
    state.bets.unshift({
      id: 'b' + Date.now(), sig, at: Date.now(), stake, status: 'pending', payout: null,
      legs: legs.map((l) => ({ id: l.id, pick: l.pick, game: l.game, sport: l.sport, sportTitle: l.sportTitle, commence: l.commence,
        price: l.price, prob: l.prob, book: l.book, market: l.market, outcome: l.outcome, point: l.point,
        home: l.home, away: l.away, isProp: l.isProp, result: null })),
    });
    saveBets(); renderTracker(); updateCounts();
    settleBets();
    return true;
  }

  function resolveBet(b) {
    const r = E.settleBet(b.legs.map((l) => l.result), b.legs, b.stake);
    b.status = r.status; b.payout = r.payout;
  }

  // Look up final scores for any started games in pending bets and settle what we can.
  async function settleBets(force) {
    if (IN_CLAUDE || state.settling) return;
    const pending = state.bets.filter((b) => b.status === 'pending');
    const now = Date.now();
    if (!pending.length || (!force && now - state.lastSettle < 3 * 60000)) return;
    const need = pending.flatMap((b) => b.legs.filter((l) => !l.result && !l.isProp && R.LEAGUES[l.sport] && new Date(l.commence).getTime() < now - 30 * 60000));
    if (!need.length) { return; }
    state.settling = true; state.lastSettle = now;
    try {
      const bySport = new Map();
      for (const l of need) { if (!bySport.has(l.sport)) bySport.set(l.sport, []); bySport.get(l.sport).push(l); }
      let changed = false;
      for (const [sport, legs] of bySport) {
        const ts = legs.map((l) => new Date(l.commence).getTime());
        const urls = R.scoreboardUrls(sport, new Date(Math.min(...ts) - 3 * 3600000), new Date(Math.max(...ts) + 14 * 3600000));
        const boards = await pool(urls, 3, (u) => memoJSON(u, 2 * 60000));
        const games = boards.filter(Boolean).flatMap((b) => R.parseScoreboard(b));
        for (const l of legs) {
          const g = R.matchGame({ commence_time: l.commence, home_team: l.home, away_team: l.away }, games);
          if (!g) continue;
          const flip = !R.sameTeam(g.home.name, l.home);
          const res = E.settleLeg(l, { completed: g.completed, home: flip ? g.away : g.home, away: flip ? g.home : g.away });
          if (res) {
            for (const b of pending) for (const bl of b.legs) if (bl.id === l.id && !bl.result) { bl.result = res; changed = true; }
          }
        }
      }
      if (changed) { pending.forEach(resolveBet); saveBets(); renderTracker(); updateCounts(); }
    } catch (e) { console.warn('settle', e); } finally { state.settling = false; }
  }

  function renderTracker() {
    const stats = $('trackStats'), list = $('trackList');
    if (!stats) return;
    const done = state.bets.filter((b) => b.status !== 'pending');
    const staked = done.reduce((a, b) => a + b.stake, 0);
    const back = done.reduce((a, b) => a + (b.payout || 0), 0);
    const won = done.filter((b) => b.status === 'won').length, lost = done.filter((b) => b.status === 'lost').length;
    // Calibration: did legs we rated at X% win about X% of the time?
    const legsDone = state.bets.flatMap((b) => b.legs).filter((l) => l.result === 'won' || l.result === 'lost');
    const buckets = [[0, .3], [.3, .5], [.5, .7], [.7, 1.01]].map(([lo, hi]) => {
      const ls = legsDone.filter((l) => l.prob >= lo && l.prob < hi);
      return { lo, hi, n: ls.length, pred: ls.reduce((a, l) => a + l.prob, 0) / (ls.length || 1), act: ls.filter((l) => l.result === 'won').length / (ls.length || 1) };
    }).filter((b) => b.n);
    stats.innerHTML = state.bets.length ? `
      <b>${won}-${lost}</b> settled${done.length - won - lost ? ` (${done.length - won - lost} push)` : ''} ·
      staked ${money(staked)} · returned ${money(back)} ·
      <b class="${back - staked >= 0 ? 'good' : 'bad'}">${back - staked >= 0 ? '+' : '-'}${money(Math.abs(back - staked))}${staked ? ` (${((back - staked) / staked * 100).toFixed(1)}% ROI)` : ''}</b>
      ${buckets.length ? `<div style="margin-top:8px"><b>Does the chance we show match reality?</b> (single legs)<table><thead><tr><th>We said</th><th style="text-align:right">Legs</th><th style="text-align:right">Avg chance</th><th style="text-align:right">Actually won</th></tr></thead><tbody>
        ${buckets.map((b) => `<tr><td>${Math.round(b.lo * 100)}–${Math.min(100, Math.round(b.hi * 100))}%</td><td class="num">${b.n}</td><td class="num">${pct(b.pred)}</td><td class="num">${pct(b.act)}</td></tr>`).join('')}</tbody></table>
        <span class="note">Needs a few hundred legs before it means much.</span></div>` : ''}`
      : 'No tracked bets yet. Tap <b>Track this bet</b> under any parlay.';
    list.innerHTML = state.bets.map((b) => {
      const mult = b.legs.reduce((a, l) => a * l.price, 1);
      const sym = { won: '✓', lost: '✗', push: '–' };
      return `<div class="card parlay">
        <div class="top"><div class="payout">${money(b.stake)} <small>→ ${money(b.stake * mult)} if it hits</small></div>
          <span class="tag ${b.status}">${b.status === 'won' ? 'Won ' + money(b.payout) : b.status === 'lost' ? 'Lost' : b.status === 'push' ? 'Push' : 'Pending'}</span></div>
        <ul class="legs">${b.legs.map((l, i) => `<li><div><div class="p"><span class="res ${l.result || ''}">${sym[l.result] || '·'}</span>${esc(l.pick)}</div>
            <div class="g">${esc(l.sportTitle)} · ${esc(l.game)} · ${when(l.commence)}</div></div>
          <div class="o">${odds(l.price)}${!l.result && new Date(l.commence) < Date.now() ? `<small><button class="mini" data-mark="${b.id}|${i}|won">Won</button> <button class="mini" data-mark="${b.id}|${i}|lost">Lost</button> <button class="mini" data-mark="${b.id}|${i}|push">Push</button></small>` : ''}</div></li>`).join('')}</ul>
        <div class="note">Tracked ${new Date(b.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · wins about ${pct(b.legs.reduce((a, l) => a * l.prob, 1))}
          <button class="link" data-delbet="${b.id}">Delete</button></div></div>`;
    }).join('');
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-track]');
    if (t) {
      const r = trackBet(JSON.parse(t.dataset.track));
      t.textContent = r === true ? 'Tracked ✓' : r === 'dup' ? 'Already tracked' : 'Pick no longer available';
      return;
    }
    const m = e.target.closest('[data-mark]');
    if (m) {
      const [id, i, res] = m.dataset.mark.split('|');
      const b = state.bets.find((x) => x.id === id);
      if (b) { b.legs[+i].result = res; resolveBet(b); saveBets(); renderTracker(); updateCounts(); }
      return;
    }
    const d = e.target.closest('[data-delbet]');
    if (d && confirm('Delete this tracked bet?')) { state.bets = state.bets.filter((x) => x.id !== d.dataset.delbet); saveBets(); renderTracker(); updateCounts(); }
  });

  /* ---------- rendering ---------- */
  function sportsFilter() {
    return state.filter.size ? state.filter : null;
  }

  function parlayCard(p, stake, title) {
    const payout = stake * p.mult;
    const r = p.risk;
    const legs = p.legs.map((l) => `
      <li>
        <div><div class="p">${esc(l.pick)}</div>
          <div class="g">${esc(l.sportTitle)} · ${esc(l.game)} · ${when(l.commence)}</div>${legNotes(l)}</div>
        <div class="o">${odds(l.price)}<small>${esc(l.book)} · ${pct(l.prob)}</small>${addBtn(l)}</div>
      </li>`).join('');
    return `
      <div class="card parlay">
        ${title ? `<div class="note"><b>${esc(title)}</b></div>` : ''}
        <div class="top">
          <div class="payout">${money(payout)} <small>back on ${money(stake)}</small></div>
          <span class="tag" style="background:${r.color}">${r.short}</span>
        </div>
        <div class="chance">Wins about <b>1 in ${E.oneIn(p.prob)}</b> times (${pct(p.prob)})</div>
        <div class="meter"><i style="width:${Math.max(2, p.prob * 100)}%;background:${r.color}"></i></div>
        <div class="odds-line">${p.legs.length}-leg parlay · ${odds(p.mult)} · ${valueWord(p.ev)}
          <span title="Average result per bet if you made it many times">(${p.ev >= 0 ? '+' : ''}${(p.ev * 100).toFixed(1)}% long-run)</span></div>
        <ul class="legs">${legs}</ul>
        ${placeRow(p.legs)}
      </div>`;
  }

  function placeRow(legs) {
    const ids = esc(JSON.stringify(legs.map((l) => l.id)));
    return `<div class="place"><span class="note">Place this bet:</span>
      ${Object.entries(BOOKS).map(([k, b]) => `<button type="button" class="bookbtn" data-place="${ids}" data-book="${k}">${b.name}</button>`).join('')}
      <button type="button" class="bookbtn" data-track="${ids}">Track this bet</button></div>`;
  }

  function openPlace(ids, book) {
    state.place = { ids, book };
    renderPlace();
    $('placeDlg').showModal();
  }

  function renderPlace() {
    const { ids, book } = state.place;
    const legs = ids.map((id) => state.legById.get(id)).filter(Boolean);
    const b = BOOKS[book];
    const stake = E.parseGoal($('ask').value).stake || 10;
    const rows = legs.map((l) => ({ l, q: quoteAt(l, book) }));
    const priced = rows.every((r) => r.q);
    const mult = priced ? rows.reduce((a, r) => a * r.q.price, 1) : null;
    const best = legs.reduce((a, l) => a * l.price, 1);
    const direct = rows.filter((r) => r.q && r.q.link).length;
    $('placeBody').innerHTML = `
      <div class="filters" style="margin:0 0 10px">${Object.entries(BOOKS).map(([k, x]) =>
        `<button type="button" class="chip ${k === book ? 'on' : ''}" data-pbook="${k}">${x.name}</button>`).join('')}</div>
      <p style="margin:0 0 8px">${legs.length}-leg parlay at <b>${b.name}</b>:
        ${mult ? `<b>${odds(mult)}</b> · ${money(stake)} pays <b>${money(stake * mult)}</b>` : `<span class="note">we don't have ${b.name}'s price for every leg, so check the total in their app.</span>`}
        ${mult && best > mult * 1.005 ? `<br><span class="note">Best prices across all books pay ${money(stake * best)}. The difference is what line shopping is worth.</span>` : ''}</p>
      <ol class="placelist">${rows.map(({ l, q }) => `<li>
        <div><b>${esc(l.pick)}</b><div class="note">${esc(l.game)} · ${when(l.commence)}</div></div>
        <div class="o">${q ? odds(q.price) : '<span class="note">no price in feed</span>'}
          <a class="bookbtn" href="${esc(q && q.link ? q.link : bookUrl(book, l.sport))}" target="_blank" rel="noopener">${q && q.link ? 'Add to slip' : 'Find it'}</a></div>
      </li>`).join('')}</ol>
      <p class="note">${direct ? `"Add to slip" opens ${b.name} with that pick already in your betslip. ` : ''}${direct < legs.length ? `"Find it" opens the league page, where you tap the pick yourself. ` : ''}
        Add every leg, then choose <b>Parlay</b> in the betslip and enter your stake. Odds can move before you place it.
        ${book === 'betmgm' ? ' BetMGM asks which state you\'re in the first time, then opens the right page.' : ''}</p>
      <div class="row-end" style="justify-content:flex-start;flex-wrap:wrap">
        <a class="bookbtn big" href="${esc(bookUrl(book, legs[0] ? legs[0].sport : ''))}" target="_blank" rel="noopener">Open ${b.name}</a>
        <button type="button" id="copyPicks">Copy picks</button>
        <span class="note" id="copyMsg"></span>
      </div>
      <p class="note">You place the bet in ${b.name}'s own app or site, with your own account. 21+ and in a state where it's legal. Help: 1-800-GAMBLER.</p>
      <textarea id="copyText" readonly hidden>${esc(rows.map(({ l, q }) => `${l.pick} (${odds(q ? q.price : l.price)}) — ${l.game}, ${when(l.commence)}`).join('\n'))}</textarea>`;
  }

  function legNotes(l) {
    const bits = [];
    if (l.modelProb != null) bits.push(`<span>Odds ${pct(l.marketProb)} · ESPN model ${pct(l.modelProb)}</span>`);
    const r = state.research[l.eventId];
    if (r && !l.isProp) {
      const [awayName] = l.game.split(' @ ');
      const side = l.pick.startsWith(awayName) ? r.away : l.pick.startsWith(l.game.split(' @ ')[1]) ? r.home : null;
      if (side && side.form.length) bits.push(`<span>Last 5: ${side.form.map((f) => f.result).join('')}</span>`);
    }
    if (l.moved) bits.push(`<span class="${l.moved.to > l.moved.from ? 'good' : 'bad'}">Line moved ${odds(l.moved.from)} → ${odds(l.moved.to)}</span>`);
    for (const n of l.notes || []) bits.push(`<span class="good">${esc(n)}</span>`);
    for (const w of l.warnings || []) bits.push(`<span class="warn">⚠ ${esc(w)}</span>`);
    return bits.length ? `<div class="g rn">${bits.join(' · ')}</div>` : '';
  }

  function renderGoal() {
    const box = $('results'), ans = $('answer');
    if (!state.legs.length) {
      ans.innerHTML = state.error ? '' : `<span class="note">No games found ${esc(windowLabel())} for your sports. Try a longer day range or more sports.</span>`;
      box.innerHTML = '';
      return;
    }
    const g = E.parseGoal($('ask').value);
    if (!g.stake) {
      ans.innerHTML = '<span class="bad">Tell me an amount, like "turn $10 into $100".</span>';
      box.innerHTML = '';
      return;
    }
    let target = g.target;
    if (!target) target = g.stake * E.RISK_TIERS[(g.risk || 3) - 1].target;
    const mult = target / g.stake;
    if (mult < 1.05) {
      ans.innerHTML = '<span class="bad">Your goal needs to be bigger than your bet.</span>';
      box.innerHTML = '';
      return;
    }
    const opts = baseOpts();
    const games = E.gameCount(state.legs, opts);
    const rows = [];
    for (let n = 1; n <= Math.min(MAX_LEGS, Math.max(games, 2)); n++) {
      const p = n <= games ? E.findExact(state.legs, mult, n, opts) : null;
      rows.push({ n, p: p && p.exact ? p : null, min: E.minPayout(state.legs, n, opts) });
    }
    state.rows = rows;

    let ps;
    const slipLegs = state.slip.map((id) => state.legById.get(id)).filter(Boolean);
    if (state.lockSlip && slipLegs.length) {
      const filled = E.fillAround(state.legs, slipLegs, mult, { ...opts, exactTotal: state.legCount || 0 });
      ans.innerHTML = filled
        ? `Goal: <b>${money(g.stake)} → ${money(target)}</b> (${mult.toFixed(1)}x). Built around your ${slipLegs.length} pick${slipLegs.length > 1 ? 's' : ''}: <b>${pct(filled.prob)}</b> chance — <b style="color:${filled.risk.color}">${filled.risk.short.toLowerCase()}</b>.`
        : (() => {
          const pays = slipLegs.reduce((a, l) => a * l.price, 1);
          const why = pays > mult * 1.25
            ? `Your ${slipLegs.length} pick${slipLegs.length > 1 ? 's' : ''} already pay ${pays.toFixed(1)}x (${money(g.stake * pays)}), more than your goal. Adding legs only raises the payout. Remove a pick or raise your goal.`
            : state.legCount && state.legCount <= slipLegs.length
              ? `You picked ${slipLegs.length} legs, so a ${state.legCount}-leg parlay has no room to add more. Choose a bigger number of legs or "Best # of legs".`
              : `No legs from other games fit around your picks to reach ${mult.toFixed(1)}x${state.legCount ? ` with exactly ${state.legCount} legs` : ''}. Try another leg count or goal.`;
          return `Goal: <b>${money(g.stake)} → ${money(target)}</b> (${mult.toFixed(1)}x).<br><span class="warn">${esc(why)}</span>`;
        })();
      box.innerHTML = `<h2>Your best plays</h2>${filled ? `<div class="grid">${parlayCard(filled, g.stake, `Your ${slipLegs.length} pick${slipLegs.length > 1 ? 's' : ''} + ${filled.legs.length - slipLegs.length} added`)}</div>` : ''}
        <p class="note"><button type="button" class="chip" id="unlock">Stop building around my picks</button></p>`;
      $('legSelect').value = String(state.legCount);
      return;
    }
    if (state.legCount) {
      const row = rows.find((r) => r.n === state.legCount);
      ps = row && row.p ? [row.p] : [];
    } else {
      // Best overall: free search across any length plus the best at each
      // exact length, ranked by chance of winning.
      const pool = E.findParlays(state.legs, mult, { ...opts, count: 3, maxLegs: 8 }).filter((p) => p.exact)
        .concat(rows.filter((r) => r.p).map((r) => r.p))
        .sort((a, b) => b.prob - a.prob);
      ps = [];
      for (const p of pool) {
        const ids = new Set(p.legs.map((l) => l.id));
        if (ps.some((q) => q.legs.length === p.legs.length && q.legs.every((l) => ids.has(l.id)))) continue;
        ps.push(p);
        if (ps.length >= 3) break;
      }
      if (!ps.length) ps = E.findParlays(state.legs, mult, { ...opts, count: 3, maxLegs: 12 });
    }

    const legChips = `<div class="filters" id="legPick"><span>Legs:</span>
      <button type="button" class="chip ${state.legCount ? '' : 'on'}" data-legs="0">Best</button>
      ${rows.map((r) => `<button type="button" class="chip ${state.legCount === r.n ? 'on' : ''} ${r.p ? '' : 'dim'}" data-legs="${r.n}">${r.n}</button>`).join('')}</div>
      <div class="filters" id="typePick"><span>Mix:</span>
      ${Object.entries(TYPE_NAMES).map(([k, v]) => `<button type="button" class="chip ${state.types.has(k) ? 'on' : ''}" data-type="${k}">${v}</button>`).join('')}</div>`;

    if (!ps.length) {
      const row = rows.find((r) => r.n === state.legCount);
      ans.innerHTML = `Goal: <b>${money(g.stake)} → ${money(target)}</b> (${mult.toFixed(1)}x).<br><span class="warn">${esc(whyNot(row, mult, games))}</span>`;
      box.innerHTML = `<h2>Your best plays</h2>${legChips}${legTable(rows, g.stake, mult, games)}`;
      return;
    }
    $('legSelect').value = String(state.legCount);
    const best = ps[0];
    const tier = best.risk;
    ans.innerHTML = `Goal: <b>${money(g.stake)} → ${money(target)}</b> (${mult.toFixed(1)}x).
      Best shot: <b>${pct(best.prob)}</b> with ${best.legs.length} leg${best.legs.length > 1 ? 's' : ''} — that's <b style="color:${tier.color}">${tier.short.toLowerCase()}</b>.
      ${best.exact ? '' : '<br><span class="warn">Couldn\'t hit your exact number with today\'s games — these are the closest.</span>'}`;
    box.innerHTML = `<h2>Your best plays</h2>
      <p class="sub">Ranked by chance of winning. Mixes moneylines, spreads, totals and props, one pick per game. Tap a leg count to see the best parlay of that size.</p>
      ${legChips}
      <div class="grid">${ps.map((p, i) => parlayCard(p, g.stake, state.legCount ? `Best ${p.legs.length}-leg parlay` : i === 0 ? '⭐ Top pick' : 'Option ' + (i + 1))).join('')}</div>
      ${legTable(rows, g.stake, mult, games)}`;
  }

  function baseOpts() {
    return {
      sports: sportsFilter(), avoidUncertain: state.settings.avoidUncertain, avoidTired: state.settings.avoidTired,
      types: state.types.size === 4 ? null : state.types,
    };
  }

  function whyNot(row, mult, games) {
    if (!row) return 'Pick a leg count.';
    if (row.n > games) return `${row.n} legs needs ${row.n} different games, and only ${games} have lines right now. Add more sports.`;
    if (row.min != null && row.min > mult * 1.25) {
      return `A ${row.n}-leg parlay can't pay as little as ${mult.toFixed(1)}x today: even the ${row.n} safest picks together pay ${row.min.toFixed(1)}x. Add more sports for more heavy favorites, or raise your goal.`;
    }
    return `No ${row.n}-leg combination lands on ${mult.toFixed(1)}x with today's lines.`;
  }

  function legTable(rows, stake, mult, games) {
    const best = Math.max(...rows.filter((r) => r.p).map((r) => r.p.prob), 0);
    return `<h2>Every parlay size</h2>
      <p class="sub">The best parlay for each number of legs that pays your goal. More legs means stacking more sportsbook fees, so the chance usually drops as legs go up. Tap a row.</p>
      <div class="card" style="padding:6px 12px"><div class="tablewrap"><table>
      <thead><tr><th>Legs</th><th style="text-align:right">Pays</th><th style="text-align:right">Win chance</th><th class="hide-sm">Mix</th><th>Risk</th></tr></thead>
      <tbody>${rows.map((r) => r.p ? `
        <tr class="row ${state.openRow === r.n ? 'open' : ''}" data-row="${r.n}">
          <td><b>${r.n}</b>${r.p.prob === best ? ' <span class="good">★ best chance</span>' : ''}</td>
          <td class="num">${money(stake * r.p.mult)}</td>
          <td class="num">${pct(r.p.prob)} <span class="note">(1 in ${E.oneIn(r.p.prob)})</span></td>
          <td class="hide-sm note">${[...new Set(r.p.legs.map((l) => TYPE_NAMES[E.legType(l)] || 'Other'))].join(', ')}</td>
          <td><span class="tag" style="background:${r.p.risk.color}">${r.p.risk.short}</span></td>
        </tr>
        ${state.openRow === r.n ? `<tr><td colspan="5">${parlayCard(r.p, stake, `Best ${r.n}-leg parlay`)}</td></tr>` : ''}` : `
        <tr><td><b>${r.n}</b></td><td colspan="4" class="note">${esc(whyNot(r, mult, games))}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  function renderSpectrum() {
    const g = E.parseGoal($('ask').value);
    const stake = g.stake || 10;
    $('specSub').textContent = `Best parlay at every risk level for a ${money(stake)} bet. Tap one to see the picks.`;
    if (!state.legs.length) { $('spectrum').innerHTML = '<div class="empty card" style="grid-column:1/-1">No games to scan.</div>'; return; }
    const tiers = E.RISK_TIERS.map((t) => ({ t, p: E.findParlays(state.legs, t.target, { ...baseOpts(), count: 1 })[0] }));
    let html = '<div class="bar"></div>';
    html += tiers.map(({ t, p }) => `
      <button class="card tier ${state.selectedTier === t.key ? 'sel' : ''}" data-tier="${t.key}">
        <div class="n" style="color:${t.color}">${t.name}</div>
        <div class="c">${t.short}</div>
        ${p ? `<div class="x">${money(stake * p.mult)}</div>
          <div class="c">${p.legs.length} pick${p.legs.length > 1 ? 's' : ''} · hits ${pct(p.prob)}</div>` : '<div class="c">Not available</div>'}
      </button>`).join('');
    const sel = tiers.find((x) => x.t.key === state.selectedTier);
    if (sel && sel.p) html += `<div style="grid-column:1/-1">${parlayCard(sel.p, stake, sel.t.name + ' parlay')}</div>`;
    $('spectrum').innerHTML = html;
  }

  function renderTopPicks() {
    const f = sportsFilter();
    const rows = state.legs
      .filter((l) => (!f || f.has(l.sport)) && !l.blocked && l.prob >= 0.08 && l.prob <= 0.95)
      .sort((a, b) => b.ev - a.ev)
      .slice(0, 15);
    if (!rows.length) { $('topPicks').innerHTML = '<tr><td colspan="5" class="empty">No picks yet.</td></tr>'; return; }
    $('topPicks').innerHTML = rows.map((l, i) => `
      <tr class="row" data-i="${i}">
        <td><div class="pickcell">${addBtn(l)}<div><b>${esc(l.pick)}</b><div class="note">${esc(l.marketLabel)} · ${esc(l.sportTitle)}</div>${legNotes(l)}</div></div></td>
        <td class="hide-sm">${esc(l.game)}<div class="note">${when(l.commence)}</div></td>
        <td class="num"><b>${odds(l.price)}</b><div class="note">${esc(l.book)}</div></td>
        <td class="num">${pct(l.prob)}</td>
        <td class="num value">${valueWord(l.ev)}<div class="note">${l.ev >= 0 ? '+' : ''}${(l.ev * 100).toFixed(1)}%</div></td>
      </tr>
      <tr hidden data-books="${i}"><td colspan="5"><div class="note" style="margin-bottom:4px">Odds at all ${l.books} books:</div>
        <div class="books">${l.quotes.map((q, j) => `<span class="${j === 0 ? 'best' : ''}">${esc(q.bookTitle)} ${odds(q.price)}</span>`).join('')}</div></td></tr>`).join('');
  }

  const statusClass = (s) => (/out|injured reserve|suspen/i.test(s) ? 'bad' : /question|doubt|day-to-day/i.test(s) ? 'warn' : '');

  function teamBlock(t, where) {
    const stars = t.leaders.map((l) => {
      const inj = t.injuries.find((i) => R.samePlayer(i.name, l.name));
      const min = t.load && t.load.minutes[l.name];
      return `<li>${esc(l.name)} <span class="note">${esc(l.value)} ${esc(l.stat)}${min != null ? ` · ${min} min last game` : ''}</span>${inj ? ` <b class="${statusClass(inj.status)}">${esc(inj.status)}</b>` : ' <span class="good">Active</span>'}</li>`;
    }).join('');
    const fat = t.fatigue ? `<div class="lbl">Fatigue</div><div class="${t.fatigue.tired ? 'warn' : 'good'}" style="font-size:14px">${t.fatigue.tired ? '⚠ ' : ''}${esc(t.fatigue.label)}</div>` : '';
    const load = t.load ? `${t.load.heavy.length ? `<div style="font-size:14px" class="warn">Heavy minutes last game: ${t.load.heavy.map((h) => esc(h.name) + ' ' + h.min).join(', ')}</div>` : ''}
      ${t.load.starters.length ? `<div class="lbl">Started last game</div><div style="font-size:14px">${t.load.starters.map(esc).join(', ')}</div>` : ''}` : '';
    const inj = t.injuries.length
      ? t.injuries.map((i) => `<li>${esc(i.name)}${i.pos ? ' <span class="note">' + esc(i.pos) + '</span>' : ''} <b class="${statusClass(i.status)}">${esc(i.status)}</b>${i.detail ? ' <span class="note">' + esc(i.detail) + '</span>' : ''}</li>`).join('')
      : '<li class="note">No injuries reported</li>';
    return `<div class="team">
      <div class="tn">${esc(t.name)} <span class="note">${where}</span></div>
      <div class="note">${esc(t.record || '—')}${t.homeRecord ? ` · home ${esc(t.homeRecord)}` : ''}${t.awayRecord ? ` · away ${esc(t.awayRecord)}` : ''}</div>
      ${t.form.length ? `<div class="form">${t.form.map((f) => `<i class="${f.result === 'W' ? 'w' : f.result === 'L' ? 'l' : 'd'}" title="${esc(`${f.result} ${f.score} ${f.atVs} ${f.opp}`)}">${esc(f.result || '–')}</i>`).join('')}</div>` : ''}
      ${fat}${load}
      ${stars ? `<div class="lbl">Key players</div><ul>${stars}</ul>` : ''}
      <div class="lbl">Injury report</div><ul>${inj}</ul>
    </div>`;
  }

  function renderResearch() {
    const box = $('research');
    if (!state.settings.research) { box.innerHTML = '<div class="card empty">Game research is off. Turn it on in Settings.</div>'; return; }
    const f = sportsFilter();
    const evs = state.events.filter((e) => state.research[e.id] && (!f || f.has(e.sport_key)))
      .sort((a, b) => a.commence_time.localeCompare(b.commence_time));
    if (!evs.length) { box.innerHTML = '<div class="card empty">No game research yet.</div>'; return; }
    box.innerHTML = evs.map((e) => {
      const r = state.research[e.id];
      const alerts = R.starAlerts(r.home).length + R.starAlerts(r.away).length;
      const tired = [r.away, r.home].filter((t) => t.fatigue && t.fatigue.tired).map((t) => t.abbr);
      const pred = r.predictor ? `ESPN model: ${esc(r.home.abbr)} ${pct(r.predictor.home)} / ${esc(r.away.abbr)} ${pct(r.predictor.away)}` : '';
      const h2h = [r.h2h && r.h2h.summary ? esc(r.h2h.summary) : '', ...(r.h2h ? r.h2h.games : []).map((g) => esc(g.line)), ...r.older.map((g) => esc(g.line))].filter(Boolean);
      return `<details class="card game">
        <summary><b>${esc(e.away_team)} @ ${esc(e.home_team)}</b>
          <span class="note">${esc(e.sport_title || '')} · ${when(e.commence_time)}${pred ? ' · ' + pred : ''}</span>
          ${alerts ? `<span class="pill caution">⚠ ${alerts} star${alerts > 1 ? 's' : ''} questionable/out</span>` : ''}
          ${tired.length ? `<span class="pill caution">😮‍💨 ${esc(tired.join(', '))} tired</span>` : ''}</summary>
        <div class="teams">${teamBlock(r.away, 'away')}${teamBlock(r.home, 'home')}</div>
        <div class="note"><b>Head-to-head:</b> ${h2h.length ? h2h.join(' · ') : 'No meetings listed'}</div>
      </details>`;
    }).join('');
  }

  function renderByo() {
    const box = $('byo');
    const f = sportsFilter();
    const q = state.byoQuery.trim().toLowerCase();
    const byGame = new Map();
    for (const l of state.legs) {
      if (l.blocked || (f && !f.has(l.sport))) continue;
      if (q && !(l.pick + ' ' + l.game + ' ' + l.sportTitle).toLowerCase().includes(q)) continue;
      if (!byGame.has(l.eventId)) byGame.set(l.eventId, []);
      byGame.get(l.eventId).push(l);
    }
    if (!byGame.size) { box.innerHTML = `<div class="card empty">${q ? 'No picks match your search.' : 'No picks yet.'}</div>`; return; }
    const games = [...byGame.values()].sort((a, b) => a[0].commence.localeCompare(b[0].commence));
    box.innerHTML = games.map((ls) => {
      const groups = {};
      for (const l of ls) (groups[l.marketLabel] = groups[l.marketLabel] || []).push(l);
      const chosen = ls.filter((l) => inSlip(l.id)).length;
      return `<details class="card game" ${q || chosen ? 'open' : ''}>
        <summary><b>${esc(ls[0].game)}</b> <span class="note">${esc(ls[0].sportTitle)} · ${when(ls[0].commence)}</span>
          ${chosen ? `<span class="pill live">${chosen} in my parlay</span>` : ''}</summary>
        ${Object.entries(groups).map(([m, arr]) => `<div class="lbl">${esc(m)}</div><div class="picks">${arr.map((l) => `
          <button type="button" class="pickbtn ${inSlip(l.id) ? 'on' : ''}" data-add="${esc(l.id)}">
            <span>${esc(l.pick)}</span><b>${odds(l.price)}</b><small>${pct(l.prob)}${(l.warnings || []).length ? ' ⚠' : ''}</small></button>`).join('')}</div>`).join('')}
      </details>`;
    }).join('');
  }

  function renderSlip() {
    const bar = $('slip');
    const legs = state.slip.map((id) => state.legById.get(id));
    if (!state.slip.length) { bar.hidden = true; document.body.classList.remove('has-slip'); return; }
    bar.hidden = false; document.body.classList.add('has-slip');
    const ok = legs.filter(Boolean);
    const p = ok.length ? E.summarize(ok) : null;
    const stake = E.parseGoal($('ask').value).stake || 10;
    const warns = E.slipWarnings(ok).concat(ok.flatMap((l) => (l.warnings || []).map((w) => `${l.pick}: ${w}`)));
    const gone = legs.length - ok.length;
    bar.innerHTML = `<div class="slipwrap">
      <button type="button" class="sliphead" id="slipToggle" aria-expanded="${state.slipOpen}">
        <b>My parlay</b> <span>${state.slip.length} leg${state.slip.length > 1 ? 's' : ''}</span>
        ${p ? `<span>${odds(p.mult)}</span><span>wins ${pct(p.prob)}</span><span><b>${money(stake)} → ${money(stake * p.mult)}</b></span>
        <span class="tag" style="background:${p.risk.color}">${p.risk.short}</span>` : ''}
        <span class="note" style="margin-left:auto">${state.slipOpen ? 'Hide ▾' : 'View ▴'}</span>
      </button>
      ${state.slipOpen ? `<div class="slipbody">
        <ul class="legs">${state.slip.map((id) => {
          const l = state.legById.get(id);
          if (!l) return `<li><div class="note">A pick from an earlier scan is gone (game started or line moved).</div><div class="o">${`<button type="button" class="add on" data-add="${esc(id)}" aria-label="Remove">✕</button>`}</div></li>`;
          return `<li><div><div class="p">${esc(l.pick)}</div><div class="g">${esc(l.sportTitle)} · ${esc(l.game)} · ${when(l.commence)}</div></div>
            <div class="o">${odds(l.price)}<small>${esc(l.book)} · ${pct(l.prob)}</small><button type="button" class="add on" data-add="${esc(l.id)}" aria-label="Remove">✕</button></div></li>`;
        }).join('')}</ul>
        ${gone ? `<p class="note">${gone} pick${gone > 1 ? 's are' : ' is'} no longer available.</p>` : ''}
        ${warns.map((w) => `<p class="warn note" style="margin:6px 0">⚠ ${esc(w)}</p>`).join('')}
        ${ok.length ? placeRow(ok) : ''}
        <div class="row-end" style="justify-content:flex-start;flex-wrap:wrap">
          <button type="button" class="primary" id="fillSlip">Fill the rest to reach my goal</button>
          <button type="button" id="clearSlip">Clear</button>
        </div>
        <p class="note" style="margin:6px 0 0">"Fill the rest" keeps your picks and adds the best legs from other games to hit the goal in the box above. Use the Legs menu to set the total size.</p>
      </div>` : ''}</div>`;
  }

  function refreshPicks() {
    renderGoal(); renderTopPicks(); renderByo(); renderSlip(); updateCounts();
    const sel = state.selectedTier; if (sel) renderSpectrum();
  }

  function renderFilters() {
    const present = [...new Set(state.legs.map((l) => l.sport))];
    const name = sportName;
    if (present.length < 2) { $('sportFilters').innerHTML = ''; return; }
    $('sportFilters').innerHTML = 'Only use: ' + present.map((k) =>
      `<button class="chip ${state.filter.has(k) ? 'on' : ''}" data-sport="${k}">${esc(name(k))}</button>`).join('') +
      (state.filter.size ? ' <button class="chip" data-sport="">All sports</button>' : '');
  }

  function renderStatus() {
    const m = $('mode');
    const have = state.legs.length > 0;
    if (state.error) { m.className = 'pill err'; m.innerHTML = `<i class="dot"></i>${have ? 'Stale' : 'No data'}`; }
    else if (state.mode === 'odds') { m.className = 'pill live'; m.innerHTML = '<i class="dot"></i>Live odds'; }
    else if (state.mode === 'espn') { m.className = 'pill live'; m.innerHTML = '<i class="dot"></i>Live · DraftKings'; }
    else { m.className = 'pill'; m.innerHTML = '<i class="dot"></i>Loading'; }
    const n = $('statusNote');
    n.style.display = state.mode === 'odds' && !state.error && !state.keyNote ? 'none' : '';
    const keyLink = 'get a free key at <a href="https://the-odds-api.com/" target="_blank" rel="noopener">the-odds-api.com</a> and paste it in <a href="#" id="openSet2">Settings</a>';
    if (state.error) {
      n.innerHTML = `<b>${have ? 'Couldn\'t refresh, showing the last good scan.' : 'Couldn\'t load odds.'}</b> ${esc(state.error)} ` +
        `Retrying automatically. <a href="#" id="openSet2">Open Settings</a> · <a href="#" id="resetSet">Reset my settings to defaults</a>`;
    } else if (state.mode === 'espn') {
      const need = keyNeededGroups();
      n.innerHTML = `<b>Live:</b> real games with DraftKings lines, refreshed every minute. ` +
        (state.partial ? `<b class="warn">Couldn't refresh ${esc(state.partial)} this time, so earlier lines are shown for it.</b> ` : '') + (state.keyNote ? esc(state.keyNote) + ' ' : '') +
        (need.length ? `<b>${esc(need.join(', '))}</b> ${need.length === 1 ? 'isn\'t' : 'aren\'t'} included: ESPN posts no odds for ${need.length === 1 ? 'it' : 'them'}. ` : '') +
        `To ${need.length ? 'add ' + esc(need.join(', ')) + ', ' : ''}compare 10+ sportsbooks and add player props, ${keyLink}.`;
    } else if (state.keyNote) {
      n.innerHTML = esc(state.keyNote);
    }
    updateClock();
  }

  function updateClock() {
    if (!state.lastScan) return;
    const games = new Set(state.legs.map((l) => l.eventId)).size;
    const books = new Set(state.legs.flatMap((l) => l.quotes.map((q) => q.book))).size;
    const secs = Math.max(0, Math.round((state.nextScan - Date.now()) / 1000));
    const mins = secs >= 90 ? Math.round(secs / 60) + 'm' : secs + 's';
    $('scanInfo').textContent = `${games} games · ${books} books · ${state.legs.length} picks · ` +
      `scanned ${state.lastScan.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ` +
      (state.settings.autoScan ? `next in ${mins}` : 'auto-scan off') +
      (state.researchNote ? ` · ${state.researchNote}` : '') +
      (state.remaining != null ? ` · ${state.remaining} Odds API credits left` : '');
    $('saverBtn').textContent = state.settings.autoScan ? 'Auto-scan: on' : 'Auto-scan: off';
    $('saverBtn').setAttribute('aria-pressed', String(!state.settings.autoScan));
  }

  function renderAll() {
    renderStatus();
    renderSportBar();
    renderFilters();
    renderGoal();
    renderSpectrum();
    renderTopPicks();
    renderByo();
    renderSlip();
    renderResearch();
    renderTracker();
    updateCounts();
  }

  /* ---------- settings ---------- */
  function openSettings(e) {
    if (e) e.preventDefault();
    const s = state.settings;
    $('apiKey').value = s.apiKey;
    $('regions').value = s.regions;
    $('props').checked = s.props;
    $('propGames').value = s.propGames;
    $('refresh').value = s.refresh;
    $('fmt').value = s.fmt;
    $('researchOn').checked = s.research;
    $('avoidUncertain').checked = s.avoidUncertain;
    $('researchMin').value = s.researchMin;
    $('fatigueOn').checked = s.fatigue;
    $('avoidTired').checked = s.avoidTired;
    estimate();
    $('settings').showModal();
  }

  function readForm() {
    return {
      apiKey: $('apiKey').value.trim(),
      sports: state.settings.sports,
      regions: $('regions').value,
      props: $('props').checked,
      propGames: Math.min(15, Math.max(1, Number($('propGames').value) || 3)),
      refresh: Math.min(240, Math.max(2, Number($('refresh').value) || 15)),
      fmt: $('fmt').value,
      research: $('researchOn').checked,
      avoidUncertain: $('avoidUncertain').checked,
      researchMin: Math.min(720, Math.max(10, Number($('researchMin').value) || 60)),
      fatigue: $('fatigueOn').checked,
      avoidTired: $('avoidTired').checked,
    };
  }

  // The Odds API charges 1 credit per market per region per call.
  function estimate() {
    const f = readForm();
    const regions = f.regions.split(',').length;
    const keys = chosenKeys();
    let per = keys.length * 3 * regions;
    if (f.props) per += keys.filter((k) => PROP_MARKETS[k]).length * f.propGames * 3 * regions;
    const perDay = Math.round(per * (16 * 60 / f.refresh)); // ~16 waking hours
    $('creditEst').textContent = `Longer day ranges scan more games and use more credits. ≈ ${per} credits per scan · ≈ ${perDay.toLocaleString()} per day at this refresh rate ` +
      `(free plan = 500/month — raise the refresh time or upgrade if that's too many). ESPN data is free and uses no credits.`;
  }

  /* ---------- sports picker ---------- */
  function renderSportBar() {
    const sel = state.settings.sports;
    const shown = sel.slice(0, 8).map((k) => `<span class="chip on">${esc(sportName(k))}</span>`).join('');
    $('sportBar').innerHTML = `<span>Scanning ${sel.length} sport${sel.length === 1 ? '' : 's'}:</span> ${shown}` +
      (sel.length > 8 ? ` <span class="note">+${sel.length - 8} more</span>` : '') +
      ` <button class="chip pick" id="openSports" type="button">Choose sports</button>`;
  }

  function openSports() {
    const sel = new Set(state.settings.sports);
    const groups = {};
    for (const c of state.catalog) (groups[c.group] = groups[c.group] || []).push(c);
    const order = ['American Football', 'Basketball', 'Baseball', 'Ice Hockey', 'Soccer'];
    const names = Object.keys(groups).sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99) || a.localeCompare(b));
    $('sportList').innerHTML = names.map((g) => `
      <fieldset class="sg"><legend>${esc(g)} <button type="button" class="link" data-all="${esc(g)}">all</button> <button type="button" class="link" data-none="${esc(g)}">none</button></legend>
        <div class="checks">${groups[g].some((c) => c.active && !c.has_outrights) ? `<label class="allrow"><input type="checkbox" value="all:${esc(g)}" data-group="${esc(g)}" ${sel.has('all:' + g) ? 'checked' : ''}>
          <span><b>All ${esc(g)}</b> <span class="note">every ${g === 'Tennis' ? 'tournament' : 'league'} with games, updated each scan</span>${state.mode !== 'odds' && groups[g].every((c) => !R.LEAGUES[c.key]) ? ' <span class="note">(needs key)</span>' : ''}</span></label>` : ''}
        ${groups[g].sort((a, b) => a.title.localeCompare(b.title)).map((c) => {
          const off = c.has_outrights || !c.active;
          const why = c.has_outrights ? ' <span class="note">(futures only)</span>' : !c.active ? ' <span class="note">(off-season)</span>'
            : state.mode !== 'odds' && !R.LEAGUES[c.key] ? ' <span class="note">(needs key)</span>' : '';
          return `<label title="${esc(c.key)}"><input type="checkbox" value="${esc(c.key)}" data-group="${esc(g)}" ${sel.has(c.key) && !off ? 'checked' : ''} ${off ? 'disabled' : ''}> ${esc(c.title)}${why}</label>`;
        }).join('')}</div></fieldset>`).join('');
    $('sportsNote').textContent = state.mode !== 'odds'
      ? 'Without a key, live odds cover the leagues ESPN posts lines for (NFL, NBA, NHL, MLB, college, WNBA, major soccer). Sports marked "needs key" (tennis, MMA, cricket and others) need a free Odds API key in Settings.'
      : state.mode === 'odds'
      ? 'This list comes live from the odds feed: every sport with betting lines right now.'
      : 'Add a free Odds API key in Settings to load the full live list of every sport.';
    sportCount();
    $('sportsDlg').showModal();
  }

  function sportCount() {
    const n = [...$('sportList').querySelectorAll('input:checked')].reduce((a, i) =>
      a + (i.value.startsWith('all:') ? state.catalog.filter((c) => c.group === i.value.slice(4) && c.active && !c.has_outrights).length : 1), 0);
    const regions = state.settings.regions.split(',').length;
    $('sportCount').textContent = `${n} selected · ≈ ${n * 3 * regions} odds credits per scan`;
  }

  /* ---------- pages ---------- */
  const PAGES = ['picks', 'risk', 'top', 'build', 'games', 'track', 'help'];
  function showPage(name, push = true) {
    if (!PAGES.includes(name)) name = 'picks';
    for (const p of PAGES) $('page-' + p).hidden = p !== name;
    document.querySelectorAll('[data-page]').forEach((a) => a.classList.toggle('on', a.dataset.page === name));
    if (push && location.hash !== '#' + name) {
      try { history.replaceState(null, '', '#' + name); } catch { location.hash = name; }
    }
    window.scrollTo(0, 0);
    if (name === 'track') settleBets(true);
  }
  function updateCounts() {
    const set = (k, n) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = n ? String(n) : ''; };
    set('build', state.slip.length);
    set('track', state.bets.filter((b) => b.status === 'pending').length);
    set('games', Object.keys(state.research).filter((id) => state.events.some((e) => e.id === id)).length);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (!a) return;
    e.preventDefault();
    showPage(a.dataset.page);
  });
  window.addEventListener('hashchange', () => showPage(location.hash.slice(1), false));
  showPage(location.hash.slice(1) || 'picks', false);

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => { if (e.target.id === 'openSports' || e.target.id === 'openSports2') openSports(); });
  $('sportList').addEventListener('click', (e) => {
    const g = e.target.dataset.all ?? e.target.dataset.none;
    if (g == null) return;
    $('sportList').querySelectorAll(`input[data-group="${CSS.escape(g)}"]:not(:disabled)`).forEach((i) => { i.checked = e.target.dataset.all != null; });
    sportCount();
  });
  $('sportList').addEventListener('change', sportCount);
  $('sportsAll').addEventListener('click', () => { $('sportList').querySelectorAll('input:not(:disabled)').forEach((i) => { i.checked = true; }); sportCount(); });
  $('sportsNone').addEventListener('click', () => { $('sportList').querySelectorAll('input').forEach((i) => { i.checked = false; }); sportCount(); });
  $('sportsDlg').addEventListener('close', () => {
    if ($('sportsDlg').returnValue !== 'save') return;
    const picked = [...$('sportList').querySelectorAll('input:checked')].map((i) => i.value);
    if (!picked.length) return;
    state.settings.sports = picked;
    state.filter.clear();
    save();
    renderSportBar();
    scan();
  });
  $('askForm').addEventListener('submit', (e) => { e.preventDefault(); renderGoal(); renderSpectrum(); });
  $('examples').addEventListener('click', (e) => {
    if (!e.target.matches('.chip')) return;
    $('ask').value = e.target.textContent;
    renderGoal(); renderSpectrum();
  });
  $('sportFilters').addEventListener('click', (e) => {
    const k = e.target.dataset.sport;
    if (k === undefined) return;
    if (k === '') state.filter.clear();
    else if (state.filter.has(k)) state.filter.delete(k);
    else state.filter.add(k);
    renderFilters(); renderGoal(); renderSpectrum(); renderTopPicks(); renderResearch();
  });
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault(); e.stopPropagation();
      const id = add.dataset.add;
      state.slip = inSlip(id) ? state.slip.filter((x) => x !== id) : state.slip.concat(id);
      if (!state.slip.length) state.lockSlip = false;
      saveSlip(); refreshPicks();
      return;
    }
    const pl = e.target.closest('[data-place]');
    if (pl) { e.preventDefault(); e.stopPropagation(); openPlace(JSON.parse(pl.dataset.place), pl.dataset.book); return; }
    const pb = e.target.closest('[data-pbook]');
    if (pb) { state.place.book = pb.dataset.pbook; renderPlace(); return; }
    if (e.target.closest('#copyPicks')) {
      const t = $('copyText').value;
      const done = (ok) => { $('copyMsg').textContent = ok ? 'Copied.' : 'Copy blocked here: press and hold to select the list below.'; if (!ok) { $('copyText').hidden = false; $('copyText').select(); } };
      try { navigator.clipboard.writeText(t).then(() => done(true), () => done(false)); } catch { done(false); }
      return;
    }
    if (e.target.closest('#slipToggle')) { state.slipOpen = !state.slipOpen; renderSlip(); return; }
    if (e.target.closest('#clearSlip')) { state.slip = []; state.lockSlip = false; saveSlip(); refreshPicks(); return; }
    if (e.target.closest('#fillSlip')) { state.lockSlip = true; state.slipOpen = false; refreshPicks(); showPage('picks'); $('results').scrollIntoView({ block: 'start' }); return; }
    if (e.target.closest('#unlock')) { state.lockSlip = false; refreshPicks(); }
  }, true);
  $('byoSearch').addEventListener('input', (e) => { state.byoQuery = e.target.value; renderByo(); });
  $('legSelect').addEventListener('change', (e) => { state.legCount = Number(e.target.value); renderGoal(); });
  $('daySelect').value = String(state.settings.window || '2');
  $('daySelect').addEventListener('change', (e) => {
    state.settings.window = e.target.value;
    save();
    state.memo.clear();
    scan();
  });
  $('results').addEventListener('click', (e) => {
    const lc = e.target.closest('[data-legs]');
    if (lc) { state.legCount = Number(lc.dataset.legs); renderGoal(); return; }
    const ty = e.target.closest('[data-type]');
    if (ty) {
      const k = ty.dataset.type;
      if (state.types.has(k) && state.types.size > 1) state.types.delete(k); else state.types.add(k);
      renderGoal(); renderSpectrum();
      return;
    }
    const row = e.target.closest('tr[data-row]');
    if (row) { const n = Number(row.dataset.row); state.openRow = state.openRow === n ? 0 : n; renderGoal(); }
  });
  $('spectrum').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tier]');
    if (!b) return;
    const k = Number(b.dataset.tier);
    state.selectedTier = state.selectedTier === k ? null : k;
    renderSpectrum();
  });
  $('topPicks').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    const d = $('topPicks').querySelector(`[data-books="${tr.dataset.i}"]`);
    d.hidden = !d.hidden;
  });
  $('scanBtn').addEventListener('click', scan);
  $('setBtn').addEventListener('click', openSettings);
  document.addEventListener('click', (e) => { if (e.target.id === 'openSet2') openSettings(e); });
  $('setForm').addEventListener('input', estimate);
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue !== 'save') return;
    state.settings = readForm();
    save();
    scan();
  });

  // Real-time loop: re-scan on schedule, and immediately when the tab comes back.
  $('saverBtn').addEventListener('click', () => {
    state.settings.autoScan = !state.settings.autoScan;
    save();
    if (state.settings.autoScan) state.nextScan = Date.now() + refreshMs();
    updateClock();
  });

  setInterval(() => {
    if (!state.settings.autoScan || IN_CLAUDE) return updateClock(); // only scan when asked / nothing live to fetch
    if (document.hidden) return; // don't scan a hidden tab
    if (state.nextScan && Date.now() >= state.nextScan) scan();
    else updateClock();
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (state.settings.autoScan && !document.hidden && state.nextScan && Date.now() >= state.nextScan) scan();
  });

  scan();
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'resetSet') return;
    e.preventDefault();
    try { localStorage.removeItem('pp-settings'); } catch { /* ignore */ }
    location.reload();
  });
})();
