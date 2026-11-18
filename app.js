/* Parlay Picker — UI, scanning and rendering. */
(function () {
  'use strict';
  const E = window.ParlayEngine;
  const R = window.ParlayResearch;
  const $ = (id) => document.getElementById(id);

  const SPORTS = [
    ['americanfootball_nfl', 'NFL'], ['basketball_nba', 'NBA'], ['icehockey_nhl', 'NHL'],
    ['baseball_mlb', 'MLB'], ['americanfootball_ncaaf', 'College FB'], ['basketball_ncaab', 'College BB'],
    ['soccer_epl', 'Premier League'], ['soccer_usa_mls', 'MLS'], ['basketball_wnba', 'WNBA'],
    ['mma_mixed_martial_arts', 'UFC / MMA'],
  ];
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
  const HOURS_AHEAD = 36;

  const DEFAULTS = {
    apiKey: '', sports: ['americanfootball_nfl', 'basketball_nba', 'icehockey_nhl', 'americanfootball_ncaaf'],
    regions: 'us,us2', props: false, propGames: 3, refresh: 15, fmt: 'american',
    research: true, avoidUncertain: true, researchMin: 60,
  };

  const state = {
    settings: load(), events: [], legs: [], scans: 0, lastScan: null, nextScan: null,
    remaining: null, error: null, filter: new Set(), selectedTier: null, scanning: false,
    research: {}, researchNote: '',
  };

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pp-settings') || '{}') }; }
    catch { return { ...DEFAULTS }; }
  }
  function save() {
    try { localStorage.setItem('pp-settings', JSON.stringify(state.settings)); } catch { /* private mode */ }
  }
  const live = () => !!state.settings.apiKey.trim();

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
  // Two ways to reach the odds feed:
  //  - opened as a normal web page: call the API directly from the browser;
  //  - inside a claude.ai private page (outside calls are blocked there):
  //    relay the request through the viewer's Firecrawl connector.
  let mcpPromise = null;
  function relay() {
    if (!mcpPromise) {
      mcpPromise = (window.claude && typeof window.claude.use === 'function')
        ? window.claude.use('mcp').catch(() => null)
        : Promise.resolve(null);
    }
    return mcpPromise;
  }

  const RELAY_HELP = {
    server_not_connected: 'Live odds here go through Firecrawl. Add the Firecrawl connector in claude.ai Settings → Connectors, then press Scan now.',
    selection_required: 'You have more than one Firecrawl connector. Choose one when claude.ai asks, then press Scan now.',
    needs_reauth: 'Firecrawl needs to be reconnected. Reconnect it in claude.ai Settings → Connectors, then press Scan now.',
    not_in_manifest: 'Firecrawl isn\'t allowed for this page. Allow it from the page\'s Permissions menu, then press Scan now.',
    approval_required: 'This page needs your OK to use Firecrawl. Press Scan now and choose Allow.',
    consent_required: 'This page needs your OK to use Firecrawl. Press Scan now and choose Allow.',
    blocked_by_policy: 'Your organization blocks Firecrawl for this page, so live odds can\'t load here. Open index.html from the repo instead.',
    server_unavailable: 'Firecrawl didn\'t answer. Wait a minute and press Scan now.',
  };

  async function getViaRelay(mcp, url) {
    let result;
    try {
      result = await mcp.callTool('Firecrawl', 'firecrawl_scrape', {
        url, formats: ['rawHtml'], maxAge: 0, storeInCache: false, proxy: 'basic',
        objective: 'Fetch current sportsbook odds JSON for a parlay picker page.',
      }, { cache: false });
    } catch (e) {
      throw new Error(RELAY_HELP[e && e.code] || ('Firecrawl error: ' + ((e && e.message) || 'unknown')));
    }
    let p = result.payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { /* keep text */ } }
    const raw = p && typeof p === 'object' ? (p.rawHtml ?? p.data?.rawHtml) : p;
    const status = p && (p.metadata?.statusCode ?? p.data?.metadata?.statusCode);
    let body;
    try { body = JSON.parse(String(raw).trim()); } catch { throw new Error('The odds feed sent back something unreadable. Press Scan now to try again.'); }
    if (status >= 400 || (body && body.error_code)) throw new Error(body.message || ('Odds feed error ' + status));
    return body;
  }

  async function getJSON(url) {
    const mcp = await relay();
    if (mcp) return getViaRelay(mcp, url);
    const res = await fetch(url);
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
    const now = new Date();
    const to = new Date(now.getTime() + HOURS_AHEAD * 3600000);

    // Free call: which sports are in season right now.
    const active = new Set((await getJSON(`${API}/sports?apiKey=${key}`)).filter((x) => x.active).map((x) => x.key));
    const keys = s.sports.filter((k) => active.has(k));
    if (!keys.length) throw new Error('None of your chosen sports are in season. Pick more in Settings.');

    const lists = await Promise.all(keys.map((k) =>
      getJSON(`${API}/sports/${k}/odds?apiKey=${key}&regions=${s.regions}&markets=h2h,spreads,totals` +
        `&oddsFormat=decimal&commenceTimeFrom=${isoNoMs(now)}&commenceTimeTo=${isoNoMs(to)}`)
        .catch((e) => { console.warn(k, e); return []; })));
    const events = lists.flat();

    if (s.props) {
      const jobs = [];
      for (const k of keys) {
        if (!PROP_MARKETS[k]) continue;
        events.filter((e) => e.sport_key === k)
          .sort((a, b) => a.commence_time.localeCompare(b.commence_time))
          .slice(0, s.propGames)
          .forEach((ev) => jobs.push(
            getJSON(`${API}/sports/${k}/events/${ev.id}/odds?apiKey=${key}&regions=${s.regions}` +
              `&markets=${PROP_MARKETS[k]}&oddsFormat=decimal`)
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
      const boards = await pool(R.scoreboardUrls(sport), 2, (u) => getJSON(u));
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
    const unsupported = events.filter((e) => !R.LEAGUES[e.sport_key]).length;
    state.researchNote = `research on ${matched}/${events.length - unsupported} games` + (failed ? ` (${failed} failed)` : '');
  }

  async function scan() {
    if (state.scanning) return;
    state.scanning = true;
    $('scanBtn').disabled = true;
    $('scanBtn').textContent = 'Scanning…';
    state.error = null;
    try {
      const events = live() ? await scanLive() : window.ParlayDemo.generate(new Date(), state.scans);
      const now = Date.now();
      state.events = events.filter((e) => new Date(e.commence_time).getTime() > now); // pre-game only
      let legs = E.buildLegs(state.events, { minBooks: live() ? 3 : 2 });
      if (state.settings.research) {
        if (live()) {
          try { await loadResearch(state.events); } catch (e) { state.researchNote = 'research unavailable'; console.warn(e); }
        } else {
          state.research = window.ParlayDemo.generateResearch(state.events);
          state.researchNote = 'sample research';
        }
        legs = R.applyResearch(legs, state.research);
      } else {
        state.researchNote = '';
      }
      state.legs = legs;
      state.scans++;
      state.lastScan = new Date();
    } catch (e) {
      state.error = e.message || String(e);
    } finally {
      state.scanning = false;
      $('scanBtn').disabled = false;
      $('scanBtn').textContent = 'Scan now';
      state.nextScan = Date.now() + Math.max(2, state.settings.refresh) * 60000;
      renderAll();
    }
  }

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
        <div class="o">${odds(l.price)}<small>${esc(l.book)} · ${pct(l.prob)}</small></div>
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
      </div>`;
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
    for (const w of l.warnings || []) bits.push(`<span class="warn">⚠ ${esc(w)}</span>`);
    return bits.length ? `<div class="g rn">${bits.join(' · ')}</div>` : '';
  }

  function renderGoal() {
    const box = $('results'), ans = $('answer');
    if (!state.legs.length) {
      ans.innerHTML = state.error ? '' : '<span class="note">No upcoming games found in the next 36 hours for your sports.</span>';
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
    const opts = { sports: sportsFilter(), count: 3, avoidUncertain: state.settings.avoidUncertain };
    if (mult > 2000) opts.maxLegs = 12;
    const ps = E.findParlays(state.legs, mult, opts);
    if (!ps.length) {
      ans.innerHTML = '<span class="bad">Not enough games right now to build that. Try a smaller goal or add sports.</span>';
      box.innerHTML = '';
      return;
    }
    const best = ps[0];
    const tier = best.risk;
    ans.innerHTML = `Goal: <b>${money(g.stake)} → ${money(target)}</b> (${mult.toFixed(1)}x).
      Best shot: <b>${pct(best.prob)}</b> — that's <b style="color:${tier.color}">${tier.short.toLowerCase()}</b>.
      ${best.exact ? '' : '<br><span class="warn">Couldn\'t hit your exact number with today\'s games — these are the closest.</span>'}`;
    box.innerHTML = `<h2>Your best plays</h2>
      <p class="sub">Ranked by chance of winning. Each pick shows the sportsbook paying the most right now.</p>
      <div class="grid">${ps.map((p, i) => parlayCard(p, g.stake, i === 0 ? '⭐ Top pick' : 'Option ' + (i + 1))).join('')}</div>`;
  }

  function renderSpectrum() {
    const g = E.parseGoal($('ask').value);
    const stake = g.stake || 10;
    $('specSub').textContent = `Best parlay at every risk level for a ${money(stake)} bet. Tap one to see the picks.`;
    if (!state.legs.length) { $('spectrum').innerHTML = '<div class="empty card" style="grid-column:1/-1">No games to scan.</div>'; return; }
    const tiers = E.RISK_TIERS.map((t) => ({ t, p: E.findParlays(state.legs, t.target, { sports: sportsFilter(), count: 1, avoidUncertain: state.settings.avoidUncertain })[0] }));
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
        <td><b>${esc(l.pick)}</b><div class="note">${esc(l.marketLabel)} · ${esc(l.sportTitle)}</div>${legNotes(l)}</td>
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
      return `<li>${esc(l.name)} <span class="note">${esc(l.value)} ${esc(l.stat)}</span>${inj ? ` <b class="${statusClass(inj.status)}">${esc(inj.status)}</b>` : ' <span class="good">Active</span>'}</li>`;
    }).join('');
    const inj = t.injuries.length
      ? t.injuries.map((i) => `<li>${esc(i.name)}${i.pos ? ' <span class="note">' + esc(i.pos) + '</span>' : ''} <b class="${statusClass(i.status)}">${esc(i.status)}</b>${i.detail ? ' <span class="note">' + esc(i.detail) + '</span>' : ''}</li>`).join('')
      : '<li class="note">No injuries reported</li>';
    return `<div class="team">
      <div class="tn">${esc(t.name)} <span class="note">${where}</span></div>
      <div class="note">${esc(t.record || '—')}${t.homeRecord ? ` · home ${esc(t.homeRecord)}` : ''}${t.awayRecord ? ` · away ${esc(t.awayRecord)}` : ''}</div>
      ${t.form.length ? `<div class="form">${t.form.map((f) => `<i class="${f.result === 'W' ? 'w' : f.result === 'L' ? 'l' : 'd'}" title="${esc(`${f.result} ${f.score} ${f.atVs} ${f.opp}`)}">${esc(f.result || '–')}</i>`).join('')}</div>` : ''}
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
      const pred = r.predictor ? `ESPN model: ${esc(r.home.abbr)} ${pct(r.predictor.home)} / ${esc(r.away.abbr)} ${pct(r.predictor.away)}` : '';
      const h2h = [r.h2h && r.h2h.summary ? esc(r.h2h.summary) : '', ...(r.h2h ? r.h2h.games : []).map((g) => esc(g.line)), ...r.older.map((g) => esc(g.line))].filter(Boolean);
      return `<details class="card game">
        <summary><b>${esc(e.away_team)} @ ${esc(e.home_team)}</b>
          <span class="note">${esc(e.sport_title || '')} · ${when(e.commence_time)}${pred ? ' · ' + pred : ''}</span>
          ${alerts ? `<span class="pill demo">⚠ ${alerts} star${alerts > 1 ? 's' : ''} questionable/out</span>` : ''}</summary>
        <div class="teams">${teamBlock(r.away, 'away')}${teamBlock(r.home, 'home')}</div>
        <div class="note"><b>Head-to-head:</b> ${h2h.length ? h2h.join(' · ') : 'No meetings listed'}</div>
      </details>`;
    }).join('');
  }

  function renderFilters() {
    const present = [...new Set(state.legs.map((l) => l.sport))];
    const name = (k) => (SPORTS.find((s) => s[0] === k) || [k, state.legs.find((l) => l.sport === k)?.sportTitle || k])[1];
    if (present.length < 2) { $('sportFilters').innerHTML = ''; return; }
    $('sportFilters').innerHTML = 'Only use: ' + present.map((k) =>
      `<button class="chip ${state.filter.has(k) ? 'on' : ''}" data-sport="${k}">${esc(name(k))}</button>`).join('') +
      (state.filter.size ? ' <button class="chip" data-sport="">All sports</button>' : '');
  }

  function renderStatus() {
    const m = $('mode');
    if (state.error) { m.className = 'pill err'; m.innerHTML = '<i class="dot"></i>Error'; }
    else if (live()) { m.className = 'pill live'; m.innerHTML = '<i class="dot"></i>Live odds'; }
    else { m.className = 'pill demo'; m.innerHTML = '<i class="dot"></i>Demo'; }
    $('demoNote').style.display = live() && !state.error ? 'none' : '';
    if (state.error) {
      $('demoNote').innerHTML = `<b>Scan failed.</b> ${esc(state.error)} <a href="#" id="openSet2">Open Settings</a>`;
    }
    updateClock();
  }

  function updateClock() {
    if (!state.lastScan) return;
    const games = new Set(state.legs.map((l) => l.eventId)).size;
    const books = new Set(state.legs.flatMap((l) => l.quotes.map((q) => q.book))).size;
    const mins = Math.max(0, Math.round((state.nextScan - Date.now()) / 60000));
    $('scanInfo').textContent = `${games} games · ${books} books · ${state.legs.length} picks · ` +
      `scanned ${state.lastScan.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · next in ${mins}m` +
      (state.researchNote ? ` · ${state.researchNote}` : '') +
      (state.remaining != null ? ` · ${state.remaining} credits left` : '');
  }

  function renderAll() {
    renderStatus();
    renderFilters();
    renderGoal();
    renderSpectrum();
    renderTopPicks();
    renderResearch();
  }

  /* ---------- settings ---------- */
  function openSettings(e) {
    if (e) e.preventDefault();
    const s = state.settings;
    $('apiKey').value = s.apiKey;
    $('sportChecks').innerHTML = SPORTS.map(([k, n]) =>
      `<label><input type="checkbox" value="${k}" ${s.sports.includes(k) ? 'checked' : ''}> ${n}</label>`).join('');
    $('regions').value = s.regions;
    $('props').checked = s.props;
    $('propGames').value = s.propGames;
    $('refresh').value = s.refresh;
    $('fmt').value = s.fmt;
    $('researchOn').checked = s.research;
    $('avoidUncertain').checked = s.avoidUncertain;
    $('researchMin').value = s.researchMin;
    estimate();
    $('settings').showModal();
  }

  function readForm() {
    return {
      apiKey: $('apiKey').value.trim(),
      sports: [...$('sportChecks').querySelectorAll('input:checked')].map((i) => i.value),
      regions: $('regions').value,
      props: $('props').checked,
      propGames: Math.min(15, Math.max(1, Number($('propGames').value) || 3)),
      refresh: Math.min(240, Math.max(2, Number($('refresh').value) || 15)),
      fmt: $('fmt').value,
      research: $('researchOn').checked,
      avoidUncertain: $('avoidUncertain').checked,
      researchMin: Math.min(720, Math.max(10, Number($('researchMin').value) || 60)),
    };
  }

  // The Odds API charges 1 credit per market per region per call.
  function estimate() {
    const f = readForm();
    const regions = f.regions.split(',').length;
    let per = f.sports.length * 3 * regions;
    if (f.props) per += f.sports.filter((k) => PROP_MARKETS[k]).length * f.propGames * 3 * regions;
    const calls = 1 + f.sports.length + (f.props ? f.sports.filter((k) => PROP_MARKETS[k]).length * f.propGames : 0);
    const perDay = Math.round(per * (16 * 60 / f.refresh)); // ~16 waking hours
    $('creditEst').textContent = `≈ ${per} credits per scan · ≈ ${perDay.toLocaleString()} per day at this refresh rate ` +
      `(free plan = 500/month — raise the refresh time or upgrade if that's too many).` +
      (window.claude ? ` On this claude.ai page each scan also uses about ${calls} Firecrawl credits` +
        (f.research ? `, plus about 1 per game (and 2 per sport) when research refreshes every ${f.researchMin} min.` : '.') : '');
  }

  /* ---------- events ---------- */
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
  setInterval(() => {
    if (document.hidden && live()) return; // don't spend API credits on a hidden tab
    if (state.nextScan && Date.now() >= state.nextScan) scan();
    else updateClock();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.nextScan && Date.now() >= state.nextScan) scan();
  });

  scan();
})();
