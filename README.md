# Parlay Picker

A simple web app that scans sportsbook odds and builds parlays for a goal you type in plain English,
like **"I want to turn $10 into $100"**.

## Run it
No install or build step. Either:
- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server 8000` and go to http://localhost:8000

With no key it runs **live** on real games using the current DraftKings lines ESPN publishes (moneyline, spread,
total) for the leagues ESPN covers. If that can't load, it falls back to **demo mode** with sample odds and says why.

## Compare every sportsbook (optional key)
1. Get a free API key at https://the-odds-api.com (500 credits/month free; paid plans give more).
2. Click **⚙ Settings**, paste the key, pick your sports, and press **Save & scan**.

The key is stored only in your browser.

Inside a claude.ai private page, browsers block direct calls to outside sites, so the app sends each odds
request through your Firecrawl connector instead (about 1 Firecrawl credit per request). Your Odds API key
travels inside that request URL to Firecrawl. Opened as a normal file or website, the app calls the odds API directly. The odds feed covers DraftKings, FanDuel, BetMGM, Caesars,
BetRivers, Fanatics, ESPN BET, Bovada, BetOnline, Pinnacle and more, depending on the region you pick.
Settings shows roughly how many credits each scan uses. Raise the re-scan time to stay inside the free plan.

## Days
The menu next to the goal box picks which games to scan: Today, Tomorrow, Today & tomorrow, or the next 3, 5 or
7 days. Longer ranges scan more games and use more credits. Fatigue also counts games a team plays earlier in the
range, so a game tomorrow makes the next night a back-to-back. Sportsbooks post some lines only a day or two ahead,
so far-off days can have fewer games.

## Parlay sizes
Parlays mix moneylines, spreads, totals and player props (one pick per game). The **Mix** chips limit which types are used.
The **Legs** chips (Best, 1–15) show the best parlay of exactly that size, and **Every parlay size** lists the best
parlay at each size that pays your goal, with its chance of winning. When a size can't work, it says why, e.g.
"even the 9 safest picks together pay 14.1x". More games (more sports selected) make longer parlays possible.
At the same payout, more legs almost always means a lower chance, because each leg adds the sportsbook's fee.

## Pick your own legs
- Tap **+** on any pick (in a parlay, the best-picks table, or **Build your own parlay**, which lists every pick for
  every game with a search box) to add it to **My parlay** at the bottom of the screen.
- My parlay shows the combined odds, chance of winning and payout for the bet in the goal box, and warns about
  picks from the same game.
- **Fill the rest to reach my goal** keeps your picks and adds the best legs from other games. The **legs menu**
  next to Find picks sets the total size (or "Best # of legs").

## Place this bet
Every parlay (and My parlay) has **Place this bet** buttons for DraftKings, FanDuel and BetMGM. The panel shows each
leg's price at that book, the parlay's total there, and a link per leg:
- **Add to slip** opens the book with that pick already in your betslip (DraftKings links come with the free ESPN
  feed; with an Odds API key, links for other books are included when the feed has them).
- **Find it** opens that league's page at the book when there's no direct link.
Then choose Parlay in the betslip and enter your stake. **Copy picks** copies the list. The bet is placed in the
sportsbook's own app with your account; this app never handles money.

## Sports
Tap **Choose sports** under the goal box. With an API key the list is loaded live from the odds feed, so it covers
every sport and league that has betting lines right now (NFL, NBA, NHL, MLB, college, dozens of soccer leagues,
tennis, MMA, boxing, cricket, rugby, AFL and more). Futures-only markets (golf winners, elections) are listed but
can't go in daily parlays. Game research covers the US leagues and the major soccer leagues ESPN tracks.

## What it does
- **Goal box**: understands "turn $10 into $100", "bet $20 to win $500", "safest bet for $25".
- **Risk spectrum**: the best parlay at 5 levels, from Safest (~1.8x) to Moonshot (~60x).
- **Best single picks**: the biggest gaps between the fair chance and the best price at any book, with every book's odds side by side.
- **Auto re-scan** on a timer (default 15 min) and when you come back to the tab. Only games that haven't started are used.

## Game research
On every scan (refreshed every 60 minutes by default) the app reads ESPN's public data for each game:
- injury report for both teams (Out, Questionable, Day-To-Day, IR), with the injury type
- key players (team leaders) and whether each one is active or hurt
- last 5 results, overall, home and away records
- this season's head-to-head (soccer also lists older meetings)
- ESPN's stats-based matchup predictor

- fatigue: days of rest, 2nd night of a back-to-back, short weeks in football, 4 games in 6 days, road-trip length
- player load (basketball, hockey, soccer): who started last game and who played heavy minutes (38+ basketball, 24+ hockey, 90 soccer)

How it changes the picks:
- Moneyline chances blend the market (80%) with ESPN's model (20%).
- Player props on anyone listed Out, Doubtful, Questionable or Day-To-Day are left out of parlays.
- "Skip games where a star player is questionable or out" (on by default) keeps those games out of parlays.
- Tired teams and heavy-minute players get a warning. "Skip tired teams and players" (off by default) removes them.

Not covered: confirmed starting lineups and coach-vs-coach records aren't in the free feeds, so key-player
injury status is the lineup check. Older head-to-head (previous seasons) isn't pulled for US leagues because
each team's full-season schedule is about 1.6 MB per request.

## How picks are chosen
Betting markets already price in team and player stats, history, injuries and sharp money, which makes
them the most accurate public predictor. For every outcome the engine (`engine.js`):
1. removes each book's margin (vig) to get its fair chance,
2. averages the fair chances across books (sharp books like Pinnacle count 3x),
3. finds the best price at any book,
4. computes value = fair chance × best price − 1.

Parlays are found with a beam search over thousands of combinations: one pick per game (so picks are
independent), landing near your payout target, ranked by chance of winning and value.

## Limits
- This does not predict the future. A "1 in 10" parlay loses about 9 times out of 10, and books keep a
  margin on every leg. Bet only what you can afford to lose. 21+ (18+ in some places), legal states only.
  Help: 1-800-GAMBLER.
- It doesn't use a separate historical stats database. It relies on market prices, which already
  include that information. Adding your own model would mean changing `prob` in `buildLegs`.
- Player props cost extra credits per game, so they're off by default.
- Some books' terms forbid automated scraping. This app reads a licensed odds feed and doesn't scrape anyone.

## Tests
`node --test engine.test.js`
