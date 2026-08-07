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
- **GO DARK** kills the lights for 20 seconds: no production, no pings, but dread drains fast. It's the main tool for staying alive, so it is not free — below level 5 it costs nothing, and from there it costs **4% of your next level's threshold** (around 900 signal the first time it's charged), which keeps it a real decision without being a wall at the level a new operator first hits it. Two upgrades (Cheap Darkness, Standing Blackout) cut the price by 40% and then half again.
- At high dread some carrier waves are **hollow** — touching one costs you badly.
- An unknown contact appears on the radar and closes on the centre as dread rises. When it arrives, **Contact** takes half your array and all your signal, and leaves a **scar** worth a permanent +5%.
- The station gets visibly worse as it goes: vignette, static, flicker, a drone that rises with the dread, whispers in the log, and a couple of things that only show up past 50.

**Events, travellers and chests**

- **Events** every 6–8 minutes: eight fortunate, eight ruinous, four that make you choose. Calm stations get lucky; loud ones do not.
- **Travellers** arrive every few minutes and knock. Twenty-three of them, each with two options that are deliberately balanced — both good, or both bad, so the pick is a genuine trade-off rather than an obvious right answer. Eight only come when the dread is already high. You have 25 seconds to answer. If you don't, something else does.
- **Unmarked cases** wash up every 85–165 seconds once the station has been noticed. Opening one is a **coin flip**: ten ways it's salvage, ten ways it was bait. Three upgrades tilt the odds (+15% and +15%) and triple the payouts, but it never stops being a gamble.

Click the dish or hold **Space**. Progress is saved in your browser's local storage; **WIPE SAVE** clears it.

**DEV tab** (temporary, for testing)

A purple **DEV** tab with toggles (infinite signal, no horror, infinite dark, no events, no travellers, god mode, free GO DARK, no chests) and buttons to grant signal from +1K up to +1Vg, jump to level 10/25/50 and print the current dark cost, jump dread, force Contact, spawn either kind of wave, spawn a chest forced to loot or to ruin, fire any specific traveller or any event by kind, and unlock everything. Every toggle defaults to off. It's fenced with `DEV PANEL START` / `DEV PANEL END` comments in five places (CSS, two markup blocks, the `DEV` object, and the JS block) so it can be stripped out cleanly on request.

---

## Notes

Both games were tested headlessly with macOS's built-in JavaScriptCore (`jsc`):

- **Tetris** — driving its real key handlers and reading the board back from its own draw calls.
- **Void Signal** — running its real economy through a 40-day simulated playthrough, plus a horror suite that executes every event branch, all 46 traveller options and all 20 chest outcomes against both empty and wealthy stations, asserting no NaN, negative or out-of-range state comes out of any of them, and checking that level thresholds and the GO DARK price stay consistent from level 1 to 120.
