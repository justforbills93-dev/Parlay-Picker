# Parlay Picker

A simple web app that scans sportsbook odds and builds parlays for a goal you type in plain English,
like **"I want to turn $10 into $100"**.

## Run it
No install or build step. Either:
- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server -d parlay-picker 8000` and go to http://localhost:8000

It starts in **demo mode** with sample odds (not real games) so you can try it right away.

## Turn on live odds
1. Get a free API key at https://the-odds-api.com (500 credits/month free; paid plans give more).
2. Click **⚙ Settings**, paste the key, pick your sports, and press **Save & scan**.

The key is stored only in your browser. The odds feed covers DraftKings, FanDuel, BetMGM, Caesars,
BetRivers, Fanatics, ESPN BET, Bovada, BetOnline, Pinnacle and more, depending on the region you pick.
Settings shows roughly how many credits each scan uses. Raise the re-scan time to stay inside the free plan.

## What it does
- **Goal box**: understands "turn $10 into $100", "bet $20 to win $500", "safest bet for $25".
- **Risk spectrum**: the best parlay at 5 levels, from Safest (~1.8x) to Moonshot (~60x).
- **Best single picks**: the biggest gaps between the fair chance and the best price at any book, with every book's odds side by side.
- **Auto re-scan** on a timer (default 15 min) and when you come back to the tab. Only games that haven't started are used.

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
`node --test parlay-picker/engine.test.js`
