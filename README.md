<div align="center">

# sFace

**Crypto's down. Somebody has to save face.**

A rescue game that runs inside Nimiq Pay. Every day the worst-performing coin in
the top 100 becomes the level. Its real 24-hour chart is the ground you fly over,
the Fear and Greed index sets the odds, and the people trapped in the wreck are
whoever crypto X spent that day arguing about.

Nobody draws the level. The market does, every morning, at midnight UTC.

[Play](https://sface.site) · [What you are flying](#what-you-are-actually-flying) · [The seven stages](#seven-stages-seven-different-games) · [How it is built](#how-it-is-built) · [Run it](#run-it)

</div>

---

<div align="center">
  <img src="docs/shots/opening.png" width="820" alt="The sFace opening screen, reading save face, tap to begin">
  <p><em>Every visit opens here. The tap starts the story and is what unlocks the voice.</em></p>
</div>

<div align="center">
  <img src="docs/shots/home.png" width="820" alt="The sFace home screen showing today's coin and its 24 hour move">
  <p><em>Then the front door: today's coin, its move, and the ways in.</em></p>
</div>

## What you are actually flying

Three things in this game are not invented, and every one of them can be checked
from inside a single run.

| | |
|---|---|
| **The map** | Today's worst performer in the top 100 becomes the stage. Its real 24-hour chart is the ground. A violent morning is a wall you have to climb; a slow bleed is a long drop with nowhere to stand. |
| **The odds** | Fear and Greed decides how many attackers there are and how fast they fire. Everyone who plays that day gets the same one. |
| **The cast** | The accounts trapped in the wreck are whoever crypto X spent the day on, read fresh each morning. Every post the game shows carries a link back to the original. |

The rule behind the third one is absolute: **no statement is ever attributed to a
real person without a link to the post it came from.** An early build generated
plausible quotes and it was removed entirely. The model returns indices into real
posts and never writes a URL.

<div align="center">
  <img src="docs/shots/chart-run.png" width="820" alt="Stage one, flying over the day's real price chart">
  <p><em>Stage one. That ridge is a real price move from the last 24 hours.</em></p>
</div>

## Seven stages, seven different games

The complaint that shaped the second half of this project was that the stages felt
like one run with a different background. They no longer are. Each asks something
the others do not.

| Stage | The world | What it asks of you |
|---|---|---|
| **1–3** | The chart | Fly it. Free people. Reach the pad before the clock. |
| **4** | The chart, watched | Do not be seen. Sight cones, and the level wakes if you cross one. |
| **5** | A city | Drive, or walk. The car is twice as fast and heard from twice as far. |
| **6** | A downtown | Read. Four posts that genuinely went out today, one explains it. |
| **7** | A ring city | Work it out. No weapon opens a gate. |

### Stages five and six: the city

Two stages leave the heightmap entirely. A price line drawn as **bars** is already
a skyline, so the streets between the buildings are the gaps between the bars.
Same seed, same numbers, projected differently. A violent day gives a jagged city
full of cover; a flat day gives long open avenues with nowhere to hide.

<div align="center">
  <img src="docs/shots/city.png" width="820" alt="The city stage, built from the day's price bars">
  <p><em>Streets built from the day's own price bars. Some buildings open, and the doorway fits a person but not the car.</em></p>
</div>

### Stage seven: the ring city

The finale is a third geometry. Concentric walls around a core, worked inward
rather than crossed, with one gap in each wall to find.

**No weapon opens a gate.** Reaching a project hands you its intel: where it sits
by size, and how it is holding up today. The wall then asks a question about the
projects behind it and shows only their tickers, so the answer is only knowable if
you went and looked. Fly past a project and you can still reach the wall. You
simply cannot answer it.

<div align="center">
  <img src="docs/shots/rings.png" width="820" alt="Stage seven, a ring city with a gate question showing two projects marked never asked">
  <p><em>Both options marked <code>never asked</code>. The answer was out there, and this player did not go and get it.</em></p>
</div>

The allies are the largest projects by market capitalisation on the day you play,
off the same market call that picks the day's wreck. Not a curated list of what
anyone thinks deserves to be there. Stablecoins are filtered out on the data,
because a peg is engineered not to move and so has not survived anything.

## The ending

Clearing the campaign pulls the camera back. The chart you just spent seven stages
inside is redrawn smaller, and smaller, until the catastrophe is a notch on a long
climb.

<div align="center">
  <img src="docs/shots/ending.png" width="820" alt="The campaign ending, showing the day's chart as a small notch on a long climb with live market figures">
  <p><em>Every figure is fetched. The closing line makes a claim about size, never a forecast.</em></p>
</div>

## Built for Nimiq Pay

sFace is a Mini App. It opens inside the wallet somebody already has, with their
identity and their clan already there. No download, no extension, no seed phrase in
the middle of a run.

- **Face is rank.** Every run banks it, and rank opens stages, weapons and a
  steadier gun. It compounds across days.
- **Challenges settle on-chain.** Stake a friend on your exact seed and the better
  run takes it. A fee small enough that a wager can be worth a coffee is what makes
  that a feature rather than a demo.
- **sFace never holds funds.** Stakes are ordinary transactions signed in Nimiq Pay
  against your own wallet.
- **Scores are signed and re-checked.** Your wallet signs the score; the service
  rebuilds the level from the same seed and refuses a run that could not have
  happened.

Outside the wallet, every stage is a 25-second preview: the day's real chart and
real cast, no score at the end. Enough to see what the game is, not enough to be
the game.

<div align="center">
  <img src="docs/shots/home-phone.png" width="270" alt="sFace on a phone">
  &nbsp;&nbsp;
  <img src="docs/shots/how-to-play.png" width="270" alt="The how to play guide on a phone">
  <p><em>Phone first. Both thumbs, a fixed-pad option in settings, and a guide written for a thumb.</em></p>
</div>

## MAIN and TEST

A chip in the top right says which network the app is on, because it changes what
every NIM figure on screen is worth. Mainnet is the default and always will be:
an app that quietly starts on a test chain will eventually take somebody's real
intent and put it somewhere it does not count.

| | |
|---|---|
| **MAIN** | Real NIM. Scores go to the daily board, challenges settle for money that counts, and CT Signals reads live X. |
| **TEST** | The same game, played for nothing. NIM has no value, scores are verified but kept off the mainnet board, and CT Signals is off because it reads live X. Settings links the Nimiq faucet. |

Testnet also never triggers a metered X call. Declaring it can only ever make the
service spend less or keep a row off the board, never unlock anything, which is
why the client is allowed to declare it at all.

## How it is built

**Client.** TypeScript, Vite, canvas 2D. No game engine and no framework. Every
character on screen is drawn by one function, which is what makes a crowd read as a
crowd rather than as a set of shapes.

**Service.** Node, Express, zod at every boundary. It composes the day's mission
from CoinGecko and Fear and Greed, reads crypto X for the story, and verifies
scores.

**Chain.** Nimiq Pay Mini App SDK. Ed25519 signatures over the Nimiq signed-message
envelope, verified server-side with `@nimiq/core`.

### The rules the code holds itself to

<details>
<summary><strong>Two random streams, and the distinction is load-bearing</strong></summary>

<br>

`levelRng` is consumed once at construction to lay out the entire level. `runRng`
is everything reactive during play. If enemy fire timing drew from `levelRng`, one
player killing an enemy early would shift every later draw and two players on one
seed would quietly stop playing the same level. That bug is invisible until a
challenge settles wrong.
</details>

<details>
<summary><strong>Scores are bounded by rebuilding the level</strong></summary>

<br>

The service reconstructs the run from the seed using the client's own parser, so it
checks against precisely the level the client was given rather than a near copy
that could drift apart from it. A claim of more kills than the level contains is
refused. The signing address is derived from the public key; there is deliberately
no address field in the request.
</details>

<details>
<summary><strong>A staked challenge is levelled</strong></summary>

<br>

Aim assist is free at a baseline for everyone and rises with progress, but a
challenge pins both sides to the baseline. The camera already refuses to show a
desktop more of the world than a phone for the same reason. A bet settles on who
played better today, not on who has played longer.
</details>

<details>
<summary><strong>No purchasable advantage</strong></summary>

<br>

Scrip is earned in-run and cannot be bought. Pay-to-win would break the fair-bet
guarantee the whole challenge system rests on.
</details>

<details>
<summary><strong>Testnet never spends</strong></summary>

<br>

A testnet session serves cached reads and never triggers a metered X call, and its
scores are verified but kept off the mainnet board. Declaring testnet can only ever
make the service spend less, so trusting the client with it is safe in the one
direction that matters.
</details>

## Repository

```
src/
  core/       loop, input, pads, network, audio, speech
  game/       the simulation. no DOM, no canvas, no fetch
    terrain     the chart, as ground
    city        stages 5 and 6: blocks and streets
    rings       stage 7: concentric walls and a core
    node        stage 6: reading the day's posts
    ally        stage 7: intel, and the gates it opens
    assist      aim help, and why a staked run is levelled
  render/     canvas only. reads state, never writes it
  ui/         DOM screens
  net/        anything that talks to the service
server/
  oracle      composes the day from CoinGecko and Fear and Greed
  xsense      reads crypto X for the story and the cast
  verify      rebuilds a level to bound a submitted score
  attest      Nimiq signature verification
  challenges  stakes, acceptance and settlement
scripts/
  shoot.mjs   regenerates every screenshot in this file
```

## Run it

```bash
npm install
npm run dev          # client on 5173
npm run server:dev   # service on 8790
```

The client works with no service at all: it falls back to a practice mission and
every stage is playable. The service is what makes it today's real market.

```bash
npm run check            # three tsconfigs and the whole suite
npm test                 # 483 tests
node scripts/shoot.mjs   # re-shoot the screenshots above
```

Copy `.env.example` to `.env`. Every key is optional, and each one degrades a
feature rather than breaking the app.

## Deploy

The client is static and builds to `dist`. The service ships as a container: CI
runs the suite, publishes to GHCR, and rolls out to the VPS, where the deploy key
is pinned to a single root-owned script that accepts nothing but a commit sha.

Screenshots here are generated rather than taken by hand. `node scripts/shoot.mjs`
drives a real browser against the dev server and puts the game into each state
deliberately, so the showcase cannot drift from the build it sits beside.

---

<div align="center">
  <img src="docs/shots/docs.png" width="820" alt="The in-app documentation page">
  <p><em>The same explanation ships inside the app, reachable from the footer on every screen.</em></p>
</div>

<div align="center">
  <sub><strong>The market builds the level.</strong></sub>
</div>
