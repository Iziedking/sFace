# sFace

**Crypto's down. Somebody has to save face.**

A rescue shooter that runs inside Nimiq Pay. Every day the worst-performing
coin in the top 100 becomes the level: its real 24-hour chart is the ground you
fly over, the Fear and Greed index decides how hard the day is, and the chart's
own volatility decides where the attackers are. Trapped in the wreck are the
faces of the industry. Get as many out as you can before the clock runs down.

Today's level is not a theme. It is the actual chart, pulled at midnight UTC,
and the mission brief names the real ticker and the real percentage.

## Run it

```bash
npm install
npm run dev          # client on 5173
npm run server:dev   # oracle and challenge service on 8790
```

Copy `.env.example` to `.env` first. Nothing secret goes in the client half:
Vite exposes everything prefixed `VITE_`.

```bash
npm run check        # typecheck all three projects, then the tests
npm run build        # check, then bundle
npm run icons        # regenerate the PNG icons from the vector mark
```

Test it inside Nimiq Pay early. A WebView is not a browser:

```
nimiqpay://miniapp?url=your-deployed-url
```

## How a level is generated

The server reads the market once a day and publishes one payload: the ticker,
the normalised chart, the fear reading, a difficulty, and a seed string. The
seed is built from the day and the data, so anyone can check that today's level
came from today's market:

```
2026-07-28:beat:-19.10:fng29
```

Every client feeds that seed into `src/core/rng.ts` and lays out an identical
level. Same attackers, same places, same faces. Two players anywhere in the
world get the same run without exchanging a packet, which is what makes a
challenge a fair bet.

**Two random streams, and the difference matters.** One is consumed once, at
construction, to lay out the level. The other drives everything reactive during
play. If they were merged, one player killing an attacker early would shift
every later draw and the two levels would quietly stop matching partway
through. That failure is invisible until a challenge settles wrong, so it is
pinned by a test in `tests/determinism.test.ts`.

Never use `Math.random` for anything that affects the level.

## The wallet

Read accounts through the SDK, take a per-device identifier for the daily
leaderboard, and request a payment when a challenge resolves. That is all.

The wallet is never a toll gate. The mission loads and the brief appears while
the provider is still being probed, the device identifier is only requested
after a finished run, and every wallet call degrades to solo play rather than
blanking the screen. Opened in a plain browser with no provider at all, the
game is fully playable.

## The money, honestly

The app never holds funds. Two players run the same seeded mission, the scores
resolve, and the loser sends the winner NIM directly from their own wallet with
the on-chain transaction as the receipt. No pot, no escrow, no house, and no
key anywhere in this repo.

The honest consequence: **a loser can decline to pay.** There is nothing here
that can force a settlement, and the challenge screen says so rather than
implying an enforcement that does not exist.

## What this build does not verify

Two things, stated plainly because dressing them up would be worse than the
gaps themselves.

**Settlements are reported, not verified.** When a payment goes through, the
client sends the serialized transaction to the service and it is stored and
displayed as *reported by the payer*. There is no Nimiq node in this build to
check it against.

**Leaderboard scores are bounded, not proven.** A client can lie about its
score. Input-trace replay was scoped out, so what the service does instead is
refuse scores above the game's actual maximum, refuse durations a run cannot
have, refuse a high score claimed against an impossibly short run, and keep one
entry per device per day. That is a speed bump, not a lock.

## What is in here

- `src/core/` the fixed-timestep loop, the seeded RNG, input, audio
- `src/game/` the run: state, one step of update, player, attackers, faces,
  terrain, collision, and the daily mission with its validator and fallback
- `src/render/` canvas drawing, camera, HUD, effects, and the palette
- `src/nimiq/` every call that touches the wallet, each one guarded
- `src/ui/` the screens either side of a run, plus the score card
- `server/` the daily oracle, leaderboard, challenges, and a JSON snapshot
- `tests/` 67 tests, weighted toward the seed invariant and the payment path

## Stack

Vite and TypeScript, Canvas 2D, no game engine. A side-scroller this size is a
few hundred lines of loop and collision, and a dependency you have to learn is
a dependency that eats hours. The client ships one runtime dependency,
`@nimiq/mini-app-sdk`, and the whole bundle is around 18 kB gzipped.

The service is Express with zod at every boundary and per-endpoint rate limits,
since every endpoint is unauthenticated by design.

## Deploy

Static client on Vercel, since a mini app only needs an HTTPS URL. The service
on a VPS behind Caddy. Set `VITE_API_BASE` on the client, and `ALLOWED_ORIGINS`
and `TRUST_PROXY=true` on the service. If the service is unreachable the client
falls back to a practice mission generated from the date, labelled as practice
everywhere it appears, so a judge opening a cold URL still gets a playable game
rather than a spinner.

## Credits

Faces are fictional archetypes. No real person is named or depicted.

Market data from CoinGecko. Fear and Greed index from alternative.me.
