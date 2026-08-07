# my-website

Two self-contained retro games. Each is a single HTML file — no build step, no dependencies, no server. Open one and play.

| File | Game |
| --- | --- |
| `index.html` | **Void Signal** — an idle/clicker about a derelict deep-space listening station |
| `tetris.html` | **Tetris** — the classic, 10×20 |

`index.html` is the landing page on purpose — it's the file a static host serves at `/`, so Void Signal is what a visitor sees first.

```sh
open ~/my-website/index.html   # Void Signal
open ~/my-website/tetris.html  # Tetris
```

---

## Tetris

All 7 tetrominoes in their classic colors, next-piece preview, score / level / lines.

| Key | Action |
| --- | --- |
| ← → | Move (hold to repeat) |
| ↑ | Rotate |
| ↓ | Soft drop (+1 per row) |
| Space | Hard drop (+2 per row) |
| P / Esc | Pause |
| Enter | Restart after game over |

Line clears score 100 / 300 / 500 / 800 for 1–4 rows, times the level. Level rises every 10 lines and gravity speeds up with it, from 800 ms per row down to 30 ms. Pieces come from a shuffled 7-bag, a ghost shows the landing spot, and a short lock delay lets you slide a piece after it touches down.

## Void Signal

A horror idle game. You've inherited a listening station pointed at the dark. Click the dish to pull signal out of the noise, then buy antennas that listen for you — and try not to be heard back.

**The economy**

- **20 antennas**, from a bent coat hanger past The Listener Itself to Yourself
- **113 upgrades** — three output multipliers per antenna (at 5 / 25 / 50 owned), plus 11 click, 13 station-wide, 6 carrier-wave, 18 dread/dark and 5 chest upgrades
- **68 discoveries** to log, each permanently worth +1% production
- **Carrier waves** drift across the screen every couple of minutes — click for a lump payout or a ×7 frenzy
- **Transmit** (prestige) trades a run for **Echoes**, each permanently worth +2% production
- Numbers run up a 35-suffix ladder, K through Ttg (10¹⁰²), and past that fall back to exponential — so there is a very long way to go beyond your first Sp

**Levels**

Your **station level** is derived from lifetime signal — 500 for level 2, ×2.6 per level after — so it can never desync from progress and old saves level up correctly on load. Every level past the first is worth **+2% production**, and the level sets the price of going dark.

**The opening**

The station starts **UNNOTICED**: no dread, no events, nobody at the door, until you've collected 2,500 total signal. After that dread accrues at half speed until your first million, and events stay fortunate until you're past 25,000. Your first Contact takes a quarter of the array instead of half.

**The dread**

- A **dread meter** fills the whole time you're listening — faster the louder you are. It runs CALM → UNEASY → HAUNTED → CRITICAL → THRESHOLD, costing production from 50 up.
- **GO DARK** kills the lights for 20 seconds: no production, no pings, but dread drains fast. It's the main tool for staying alive, so it always costs signal — **4% of your next level's threshold**, floored at 125 so it's never trivial even in the first minute, and scaling up fast from there (~135 at level 3, ~900 at level 5, ~2,400 at level 6). Two upgrades (Cheap Darkness, Standing Blackout) cut the price by 40% and then half again.
- At high dread some carrier waves are **hollow** — touching one costs you badly.
- **The Watcher** shows up somewhere on screen and gives you eight seconds to look back at it — click it for a payout and a little relief, ignore it and it costs you dread and a production dip. A second thing to keep an eye on besides the radar.
- An unknown contact appears on the radar and closes on the centre as dread rises. When it arrives, **Contact** takes half your array and all your signal, and leaves a **scar** worth a permanent +5%.
- The station gets visibly worse as it goes: vignette, static, flicker, a drone that rises with the dread, whispers in the log, and a couple of things that only show up past 50.
- A live **Signal Trace** oscilloscope scrolls under the dish — amplitude tracks production, jitter tracks dread, the line shifts from calm teal toward dread red, and every ping sends a pulse through it.

**Events, travellers and chests**

- **Events** every 6–8 minutes: eight fortunate, eight ruinous, four that make you choose. Calm stations get lucky; loud ones do not.
- **Travellers** arrive every few minutes and knock. Twenty-three of them, each with two options that are deliberately balanced — both good, or both bad, so the pick is a genuine trade-off rather than an obvious right answer. Eight only come when the dread is already high. You have 25 seconds to answer. If you don't, something else does.
- **Unmarked cases** wash up every 85–165 seconds once the station has been noticed. Opening one is a **coin flip**: ten ways it's salvage, ten ways it was bait. Three upgrades tilt the odds (+15% and +15%) and triple the payouts, but it never stops being a gamble.

**The Store**

A black-market tab of five temporary, repeatable buys — unlike upgrades these never run out and never get cheaper on their own, since cost scales off your *current* output rather than a fixed number. Each has its own cooldown so a single buy can't stack with itself: **Overclock** (production ×3, 90s), **Steady Hands** (ping yield ×4, 90s), **Vent The Pressure** (instantly −30 dread), **Push It** (production ×6 for 60s, but +20 dread), and **Bad Trade** (production ×10 for 45s, but it takes 10% of what's left when it's done).

Click the dish or hold **Space**. Progress is saved in your browser's local storage; **WIPE SAVE** clears it.

**DEV tab** (temporary, for testing)

A purple **DEV** tab with toggles (infinite signal, no horror, infinite dark, no events, no travellers, god mode, free GO DARK, no chests, no watcher) and buttons to grant signal from +1K up to +1Vg, jump to level 10/25/50 and print the current dark cost, jump dread, force Contact, spawn either kind of wave, spawn a chest forced to loot or to ruin, spawn the Watcher, fire any specific traveller or any event by kind, and unlock everything. Every toggle defaults to off. It's fenced with `DEV PANEL START` / `DEV PANEL END` comments in four places (CSS, two markup blocks, and the JS block); the `DEV` state object itself sits nearby, unfenced but flagged with a comment, since leaving its all-`false` defaults in place is harmless even without the panel that toggles them.

---

## Notes

Both games were tested headlessly with macOS's built-in JavaScriptCore (`jsc`):

- **Tetris** — driving its real key handlers and reading the board back from its own draw calls.
- **Void Signal** — running its real economy through a 40-day simulated playthrough, plus a horror suite that executes every event branch, all 46 traveller options, all 20 chest outcomes, and the Watcher's click-resolution *and* ignored-timeout paths, against both empty and wealthy stations, asserting no NaN, negative or out-of-range state comes out of any of them, and checking that level thresholds and the GO DARK price stay consistent from level 1 to 120. The Store's purchase/cooldown logic is checked separately, and a DOM-aware pass confirms the upgrades and store lists update their existing rows in place on repaint rather than rebuilding the list from scratch (the fix for a hover-flicker bug).
