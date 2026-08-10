# my-website

A small launcher and two self-contained retro games. Each is a single HTML file — no build step, no dependencies, no server. Open one and play.

| File | What it is |
| --- | --- |
| `index.html` | **Nova Games** — the launcher: sign-in and the game library |
| `voidsignal.html` | **Void Signal** — an idle/clicker about a derelict deep-space listening station |
| `tetris.html` | **Tetris** — the classic, 10×20, plus helper pieces |
| `2048.html` | **2048** — slide and merge to the 2048 tile |

`index.html` is the landing page on purpose — it's the file a static host serves at `/`, so the launcher is what a visitor sees first. The games are reachable directly by URL too; the launcher is a front door, not a gate.

```sh
open ~/my-website/index.html       # the launcher
open ~/my-website/voidsignal.html  # Void Signal
open ~/my-website/tetris.html      # Tetris
open ~/my-website/2048.html        # 2048
```

---

## Nova Games (the launcher)

A sign-in screen and a library, in the spirit of a desktop game launcher: a sidebar with the account chip, a featured banner, and a card per game with when you last played it. Cover art is drawn with CSS gradients rather than image files so the launcher stays as self-contained as the games it launches.

**Accounts and scores live on a server.** A Supabase project backs both, so your name, your dev access and the leaderboards follow you between browsers, devices and the desktop app. `nova.js` is the shared client — the one deliberate exception to the single-file rule here, because four copies of an auth client is four places for them to drift apart. It is loaded as a classic script, not a module, so it still works over `file://` inside the Electron build.

The publishable key sits in public source, which is what that kind of key is for. **Every rule that matters is enforced in the database, not the browser** — see `supabase/schema.sql`:

- Scores are **append-only**. There is a select policy and an insert policy and deliberately no update or delete policy, so nobody can rewrite or quietly remove a run, including their own.
- The name on a score is **stamped from your profile by a trigger**, not taken from the request, so a hand-rolled POST cannot post under someone else's name.
- **The first profile ever created gets dev access**, decided by a `before insert` trigger that ignores whatever the client sent. Profiles have no update policy at all — with one, any signed-in user could simply PATCH themselves the dev flag.

Accounts are username + password, as they always were. Supabase Auth is email-based, so the username is mapped onto a synthetic address on a domain that receives no mail — which is why **"Confirm email" has to be off** in the project's auth settings; there is no inbox to confirm from.

**Everything degrades.** If the network is down, the project is paused, or the schema has not been applied, calls fail softly: a stored session still signs you in from cache, runs are always recorded locally first so one is never lost to a dropped connection, and a leaderboard that cannot reach the server falls back to this device's scores — with the panel label saying **This device** rather than **World**, so a device board never masquerades as a global one.

**Setting up a fresh project** — paste `supabase/schema.sql` into the SQL Editor and run it (it is written to be re-runnable), then turn off Authentication → Sign In / Providers → Email → Confirm email.

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

All 7 tetrominoes in their classic colors, plus three **helper pieces** — a single, a domino and a corner. The bag is still a shuffled 7-bag of tetrominoes; exactly one helper is injected into each bag at a random position, so help lands about once every 8 pieces, often enough to plan around without handing you the board.

**Winning.** Clearing **100 lines** wins the run. The win screen is a milestone, not a full stop — carrying on keeps the same board and score going.

**Leaderboard.** Global, shared with 2048 and filed under your account name; signed out, runs go down as Guest and stay on the device. Wins are starred, and the panel label says whether you are looking at the world board or this device's.

| Key | Action |
| --- | --- |
| ← → | Move (hold to repeat) |
| ↑ | Rotate |
| ↓ | Soft drop (+1 per row) |
| Space | Hard drop (+2 per row) |
| P / Esc | Pause |
| Enter | Restart after game over |

Line clears score 100 / 300 / 500 / 800 for 1–4 rows, times the level. Level rises every 10 lines and gravity speeds up with it, from 800 ms per row down to 30 ms. Pieces come from a shuffled 7-bag, a ghost shows the landing spot, and a short lock delay lets you slide a piece after it touches down.

## 2048

Slide the 4×4 grid with the arrows, WASD, or a swipe; equal tiles merge and the score is the sum of everything you make. Reaching **2048** wins, and carrying on keeps the same board — for most people the real game starts after the win. Standard 90/10 spawn split between 2s and 4s.

One direction is implemented — sliding a line toward index 0 — and the four directions are expressed as different ways of reading lines out of the grid, because four hand-written copies of merge logic is exactly where the bugs live. A freshly merged tile is inert for the rest of that slide, so `2 2 4` becomes `4 4` rather than `8`.

Same global leaderboard as Tetris.

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
