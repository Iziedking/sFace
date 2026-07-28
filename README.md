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

## The market builds the level. Crypto X casts it.

Two live reads, once a day, and between them the mission is a story rather
than a chart.

**The market** picks the ticker, the terrain and the difficulty. The worst
performer in the top 100 becomes the level, its 24-hour chart becomes the
ground, the Fear and Greed index sets the spawn rate, and the chart's own
volatility decides where the attackers are.

**Crypto X picks the cast.** Once a day the service asks Grok to search X and
report what crypto is actually arguing about, how the timeline actually feels,
and which five accounts were genuinely at the centre of it. Those five become
the people trapped in the wreck, each with one dry line about what actually
happened to them today and a rescue quirk that suits them. Ansem has a day, so
you are flying out to get Ansem.

Both reads are optional and both degrade honestly. No `XAI_API_KEY` and the
roster falls back to five fictional archetypes, with no headline shown at all
rather than a headline with nothing behind it. No service at all and the whole
mission falls back to a practice run generated from the date, labelled as
practice everywhere it appears.

**On real people.** The roster carries real handles and real public context,
because that is a fact about the day. It does not carry photographs: KOL
characters are drawn as generated figures derived deterministically from the
handle, so the same person looks the same on every device without anyone's
likeness being used. The one place a real profile picture appears is on your
own character, from your own connected account. That distinction is deliberate
and the code says so in `server/xsense.ts`.

## Connect X

Optional, and worth it: your own profile picture rides on your character's
head, your handle replaces the generated pilot name on the leaderboard and on
your score card, and squadmates see it too.

OAuth 2.0 with PKCE. The token exchange happens on the service because a
client secret in a browser bundle is not a secret. **Nothing is stored**: no
user table, no session, no refresh token. The access token is used once, in the
request that exchanges the code, and dropped. What comes back to the browser is
a handle, a display name and a picture URL, all public. If the service were
fully compromised there would be no X account it could act on behalf of.

## Flying with other people, without netcode

Everyone on a given day flies the same seeded level. That one fact is what the
whole social layer is built on, and it is why none of it can desync.

**Ghost squadmates.** Every run is recorded as a compact position trace, about
6 bytes per frame at 20Hz. Open the game and the best recent runs on today's
seed fly beside you, named, towing their own rescued faces, firing their own
shots. The first player of the day flies alone and everyone after them flies
with whoever came before, so there is no lobby, no matchmaking, and no waiting
for a second human.

**Live co-op.** If someone else is playing right now, their ship appears too.
The server relays positions and nothing else: there is no authoritative state
and no simulation on it, because the terrain, the attackers and the faces
already match on every client without a byte crossing the wire. A ghost and a
live squadmate are the same struct behind the same render path, which is why
live co-op cost about a hundred lines on top of ghosts.

Squadmates are deliberately non-interacting. They cannot shoot you, cannot be
shot, and cannot take a face you were going for. That is a design choice, not
a shortcut: the moment one player's actions change another player's level, the
shared seed stops guaranteeing a fair challenge, and the fair challenge is what
the NIM is riding on. They are drawn translucent so the screen says so.

Traces record positions rather than inputs. Inputs would be smaller and would
let the server verify a score, but any drift at all, a quantised aim angle or a
float rounding differently on another device, compounds over a hundred and ten
seconds into a ghost flying through a hill. Ghosts are cosmetic, so a correct
picture beats a compact file.

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

## The campaign

Seven stages, each one restoring a piece of what 2026 cost: market panic,
project shutdowns, exploits, regulatory limbo, institutional doubt, broken
narratives, and finally the lot. A stage sets its own clock, enemy density,
cache count, incoming volley, and how much of the day's chart you fly, and it
carries an objective that has to be met before it counts as cleared. Clearing
one opens exactly the next one.

**A stage is the same engine with different numbers and a different thing to
achieve.** That is stated plainly at the top of `src/data/campaign.ts` rather
than dressed up: the escalation is in parameters and objectives, not in seven
separate games. The stage number is folded into the seed, so Stage 1 and Stage
3 on the same day are genuinely different levels and two players comparing
Stage 3 scores flew the same Stage 3. Every stage has its own sky, ground and
hatching, so seven stages read as seven places.

**Not built, and named here rather than half-built:** PvP arenas, boss
entities, escort AI, and maps that reshape mid-run from live X. Those need new
systems rather than new numbers.

## Progression that cannot become pay-to-win

Every run adds to a lifetime Face total, and that total is the only currency in
the game. It moves you up an eight-tier ladder and it opens the rack: four
weapons, at 0, 5,000, 20,000 and 50,000 Face.

**None of them is for sale.** NIM does exactly one thing in sFace, which is
back your own run against somebody else's. A gun you could buy would make that
bet unfair, so the guns cost the one thing you can only get by playing.

**None of them is stronger, either**, and that is the harder half. Two players
on the same seed have to be playing the same game, so a full rack is more ways
to fly rather than more damage:

| | Damage/s | Reach | What it gives up |
|---|---|---|---|
| Sidearm | 96 | 836 | Best at nothing in particular |
| Scattergun | 104 | 260 | A third of the reach |
| Lance | 81 | 1500 | Slow, and it shoves you backwards |
| Stream | 91 | 480 | Five damage a round, so you must stay on target |

The rule is written at the top of `src/data/weapons.ts` and pinned by two tests
in `tests/weapons.test.ts`: every weapon must lay out an identical level, and
nothing may out-damage the sidearm while also out-ranging it. If either fails,
the correct response is to fix the weapon.

Rank itself unlocks nothing else. A tier eight pilot flies the identical
mission to a tier one, so somebody who plays twenty runs a day has earned a
bigger number and no advantage at all.

## Clans

A clan is a four character tag and a pooled total. There is no clan record, no
owner, no roster table, no invite list and no approval step: the tag is written
on a profile, and everything a board shows about a clan is folded out of the
profiles carrying that tag. A clan therefore cannot go out of sync with its own
members, because there is nothing separate to go out of sync.

Invites are a link. Tapping it opens the app with the tag already in the field,
so an invited player joins in one tap, and the link goes out through the same X
compose intent the score cards use.

**Anyone can join any tag, and that is not an oversight.** Authentication here
is a device identifier anybody can regenerate by clearing their site data, so an
ownership model would be ceremony around a lock with no key in it. It also has
nothing to protect: joining a clan adds your Face to its total and can never
remove anyone else's, so a squatter donates. The clan screen says this on the
screen rather than implying a security model that is not there.

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
entry per pilot per day. That is a speed bump, not a lock.

**Pilot identity is pseudonymous, and outside Nimiq Pay it is local.** Inside
Nimiq Pay we ask for the real device identifier after your first run, which is
stable across reinstalls and cannot be correlated with other mini apps. Outside
it, or if you decline, the game generates one and keeps it in local storage, so
squadmates and the board work in any browser. A local identifier can be reset
by clearing site data, which makes it an anti-spam bucket rather than proof of
anything. Nothing that moves NIM depends on it: a settlement is authorised in
the wallet, against an address shown on the payer's own screen.

## What is in here

- `src/core/` the fixed-timestep loop, the seeded RNG, input, audio
- `src/game/` the run: state, one step of update, player, attackers, faces,
  terrain, collision, the daily mission with its validator and fallback, and
  the ghost codec and squad
- `src/render/` canvas drawing, camera, HUD, effects, and the palette
- `src/nimiq/` every call that touches the wallet, each one guarded
- `src/net/` the service client, the live socket, and pilot identity
- `src/ui/` the screens either side of a run, plus the score card
- `server/` the daily oracle, leaderboard, challenges, ghost traces, the live
  relay, and a JSON snapshot that survives a restart
- `tests/` 201 tests, weighted toward the seed invariant, the payment path, and
  the trace decoder, which is the one place network data reaches the renderer

## Stack

Vite and TypeScript, Canvas 2D, no game engine. A side-scroller this size is a
few hundred lines of loop and collision, and a dependency you have to learn is
a dependency that eats hours. The client ships one runtime dependency,
`@nimiq/mini-app-sdk`, and the whole bundle is around 41 kB gzipped.

The service is Express with zod at every boundary and per-endpoint rate limits,
since every endpoint is unauthenticated by design. Live co-op shares the same
http server on `/live`, so it is one port and one proxy rule.

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
