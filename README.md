# my-website

A small launcher and two self-contained retro games. Each is a single HTML file — no build step, no dependencies, no server. Open one and play.

| File | What it is |
| --- | --- |
| `index.html` | **Nova Games** — the launcher: sign-in and the game library |
| `voidsignal.html` | **Void Signal** — an idle/clicker about a derelict deep-space listening station |
| `tetris.html` | **Tetris** — the classic, 10×20 |

`index.html` is the landing page on purpose — it's the file a static host serves at `/`, so the launcher is what a visitor sees first. The games are reachable directly by URL too; the launcher is a front door, not a gate.

```sh
open ~/my-website/index.html       # the launcher
open ~/my-website/voidsignal.html  # Void Signal
open ~/my-website/tetris.html      # Tetris
```

---

## Nova Games (the launcher)

A sign-in screen and a library, in the spirit of a desktop game launcher: a sidebar with the account chip, a featured banner, and a card per game with when you last played it. Cover art is drawn with CSS gradients rather than image files so the launcher stays as self-contained as the games it launches.

**Accounts are local to the browser.** There is no server behind any of this — accounts live in `localStorage` under `arcade.accounts.v1`, and the current session under `arcade.session.v1`. Passwords are salted with 16 random bytes and stretched through 4,000 rounds of SHA-256 (hand-rolled, because `crypto.subtle` only exists in secure contexts and the Electron wrapper loads these pages over `file://`), so a glance at storage doesn't hand over the plaintext.

What that means in practice:

- Accounts **do not sync** between devices, browsers, or private windows. Each browser starts with an empty account list.
- **The first account created on a device gets DEV ACCESS**, and no account created after it does. Since the list starts empty per browser, this makes the owner account the dev account on the owner's machine — it does not stop someone from being "first" in their own browser.
- Anyone who can open the developer console on their own machine can edit what's stored there, and this repo is public, so the source is readable too. Dev access is a convenience switch, not a security boundary. Don't reuse a real password.

**Continue as guest** skips sign-in entirely and goes straight to the library, with no dev access and no play tracking.

### Downloads

The **Downloads** view offers the launcher itself two ways, on the Epic model — you install the launcher, and every game comes with it.

- **Web app** — installs this page as its own windowed app with its own icon, no installer and no signing warnings, and it keeps working offline after the first load. Chromium browsers get a real **Install** button (via `beforeinstallprompt`); Safari and the rest get the menu path for their browser, since there's no API to trigger it.
- **Desktop app** — the Electron build in `electron/`, which bundles `index.html`, `voidsignal.html` and `tetris.html` together, so inside the app there is nothing left to download and the cards read **Installed** rather than "Play in browser". The launcher looks up the latest GitHub release at runtime and points the button at the right asset for the visitor's OS, reading the URL off the API response rather than assembling it — `productName` has a space in it, so electron-builder emits names like `Nova Games Setup 1.0.0.exe`. With no release published it says so plainly instead of linking to an empty page, and if GitHub can't be reached it falls back to the releases page. The answer is cached for the life of the page so switching views doesn't burn the unauthenticated rate limit.

**Publishing a desktop build** (nothing is published yet):

1. `.github/workflows/build-desktop.yml` has to exist **on the remote**. Pushing it needs the `workflow` OAuth scope, which the current token doesn't have — either `gh auth refresh -s workflow` or paste the file into GitHub's web editor.
2. Run it once via **workflow_dispatch** first. It has never run, so expect to debug it from the Actions logs.
3. `git pull` (the workflow commit only exists on the remote), then tag: `git tag v1.0.0 && git push origin v1.0.0`. Actions resolves the workflow from the ref being pushed, so tagging a local commit that predates it silently triggers nothing. Keep the tag in step with `version` in `electron/package.json` or the installers come out mislabelled.

The builds are unsigned — macOS will call it an unidentified developer and Windows SmartScreen will warn — which the Downloads view says on the page.

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

Only visible when the launcher's owner account is signed in — `devBuild()` checks the stored session against `arcade.accounts.v1` and, for anyone else (another account, a guest, or someone who opened `voidsignal.html` directly), removes the tab button and its panel instead of building them. A purple **DEV** tab with toggles (infinite signal, no horror, infinite dark, no events, no travellers, god mode, free GO DARK, no chests, no watcher) and buttons to grant signal from +1K up to +1Vg, jump to level 10/25/50 and print the current dark cost, jump dread, force Contact, spawn either kind of wave, spawn a chest forced to loot or to ruin, spawn the Watcher, fire any specific traveller or any event by kind, and unlock everything. Every toggle defaults to off. It's fenced with `DEV PANEL START` / `DEV PANEL END` comments in four places (CSS, two markup blocks, and the JS block); the `DEV` state object itself sits nearby, unfenced but flagged with a comment, since leaving its all-`false` defaults in place is harmless even without the panel that toggles them.

---

## Notes

Everything here is tested headlessly with macOS's built-in JavaScriptCore (`jsc`):

- **Nova Games** — the launcher's real script is evaluated against a DOM stub and driven end to end: the SHA-256 implementation is checked against known vectors (including a multi-byte UTF-8 one), then account creation, the first-account-is-dev rule, every validation and wrong-password path, guest sessions, launch tracking, and a reboot with a stored session. The same suite evaluates `devAccess()` straight out of `voidsignal.html` against the storage the launcher just wrote, covering owner / second account / guest / signed-out / corrupt-storage.
- **Tetris** — driving its real key handlers and reading the board back from its own draw calls.
- **Void Signal** — running its real economy through a 40-day simulated playthrough, plus a horror suite that executes every event branch, all 46 traveller options, all 20 chest outcomes, and the Watcher's click-resolution *and* ignored-timeout paths, against both empty and wealthy stations, asserting no NaN, negative or out-of-range state comes out of any of them, and checking that level thresholds and the GO DARK price stay consistent from level 1 to 120. The Store's purchase/cooldown logic is checked separately, and a DOM-aware pass confirms the upgrades and store lists update their existing rows in place on repaint rather than rebuilding the list from scratch (the fix for a hover-flicker bug).
