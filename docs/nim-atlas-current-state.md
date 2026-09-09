# NIM Atlas current state

Status date: 2026-09-09.

This document is the short handoff for the current repository. It is written
from the code and local validation records, not from the retired Cycle I
description.

## Product state

NIM Atlas is a playable Nimiq Pay Mini App game with a local-first campaign.
The player chooses Explorer or Builder, enters a procedural 3D city, follows a
route, and learns Nimiq payment ideas through actions and evidence.

Practice mode is the default. It needs no wallet and sends no NIM. The optional
TestAlbatross route is a separate deployment capability. Competitive tickets,
server replay verification, durable public state, and rewards are separate
gates, not assumptions made by the client.

## Game surfaces

| Surface | Player purpose | Authority |
| --- | --- | --- |
| Welcome | Pick Explorer or Builder and choose the next activity. | Local client. |
| Beacon Commons | Walk, turn the camera, follow the map, meet residents, and reach Mara. | Local deterministic city state. |
| Pay Harbor / Last Lantern | Review a payment request and repair the harbor route. | Practice fixture locally; server and chain evidence for live mode. |
| Daily Atlas | Solve the current date's field puzzle. | Local completion; server controls any reward or board status. |
| District Atlas | Replay the curriculum across seven Nimiq systems. | Shared curriculum definitions. |
| Living Knowledge Book | Read a short explanation and answer a teach-back. | Committed knowledge definitions. |
| Verified Core Run | Complete a fixed action sequence and produce a replay. | Shared replay locally; server verification when configured. |

The current 3D environment is Beacon Commons. Pay Harbor's mission renderer
and payment state machine are functional, but the broader curriculum is not
represented by seven separate 3D worlds yet.

## Nimiq lesson

The first mission makes the payment path visible:

```text
Ask -> Check -> Approve -> Confirm -> Unlock
```

NIM is represented in integer Lunas. One NIM is 100,000 Lunas. The practice
lantern request is 10,000 Lunas, or 0.1 NIM. The UI explains that a provider
callback or transaction hash is not canonical payment proof.

## Code map

```text
shared/atlas/
  state, step, replay, world, campaign, story, curriculum, economy
  city, districts, adventures, daily, mastery, rewards

src/atlas/
  app/       screen router and controllers
  city/      player, crowd, interaction, and quality state
  render/    Three.js and fallback renderers
  scenes/    Beacon Commons and district scene adapters
  input.ts   keyboard, pointer, joystick, and camera input
  audio/     local cues and optional browser narration
  ui/        semantic controls, HUD, maps, book, trials, and shell
  wallet.ts  Nimiq provider seam
  api.ts     client HTTP seam

server/atlas/
  routes, config, tickets, submissions, leaderboard, beacon, echoes
  daily, rewards, payouts, orders, chain, persistence, admin

scripts/
  build and verify Atlas art and 3D manifests
  shoot-atlas.mjs for generated browser evidence
  measure-atlas.mjs and verify-atlas-contrast.mjs for release checks
```

## Local evidence

On 2026-09-09, the local release pass completed with 660 formatted files, 234
test files, and 1,751 passing tests. Atlas art and 3D manifest checks passed.
The Vite build transformed 907 modules. Its main JavaScript bundle was 352.59
kB raw and 105.04 kB gzip; the scene graph chunk was 960.59 kB raw and 265.60
kB gzip. These are local bundle measurements, not a mobile performance claim.

The contrast audit passed seven screens at 390x844. The capture recipe produced
16 current mobile screenshots across 320x700, 390x844, and 430x932, with the
additional Beacon Commons, Daily Atlas, District Atlas, and Core Run captures
at 390x844.

```bash
npm run check
npm run build
npm run verify:atlas:contrast
```

The screenshot recipe is `scripts/shoot-atlas.mjs`. It uses a real browser,
resets local mission state, opens named capture hooks, and writes matching
files to `docs/shots` and `public/atlas/screenshots`.

## Known boundaries

- No physical-device matrix has been completed in this repository.
- No claim of smooth performance on every mobile device is made.
- No live TestAlbatross payment or reward payout is claimed by local practice.
- No payout is enabled by the declared 50,000 NIM planning allocation.
- The seven curriculum entries share the same learning model, but they are not
  seven finished 3D production districts.
- Browser speech synthesis is a platform fallback. A final recorded guide
  voice still needs an owner-approved asset and language decision.
- Service state, reward eligibility, and canonical chain evidence cannot be
  proven from a client screenshot.

## Owner gates

The owner still controls:

1. Physical Nimiq Pay testing in landscape and portrait.
2. The exact TestAlbatross recipient, RPC endpoints, and confirmation rule.
3. One supervised 0.1 NIM test payment and its reconciliation record.
4. Competitive season values and server deployment.
5. The 50,000 NIM reward treasury, payout rules, and recovery procedure.
6. The final competition portal review, video, and submission.
