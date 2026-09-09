# NIM Atlas architecture

## Design rule

The player can always practice locally. A server, wallet, or chain can add
authority, but it cannot be required to render the basic game. The shared rules
are deterministic so a completed replay can be rebuilt and checked by another
consumer.

## Layers

```text
                 player input
                      |
                      v
              src/atlas/app and input
                      |
          +-----------+------------+
          |                        |
          v                        v
 shared/atlas rules            src/atlas render, UI, audio
          |                        |
          |                        +------> Nimiq Pay provider seam
          |                        +------> Atlas HTTP API seam
          v
 server/atlas validation, replay grading, persistence,
 chain lookup, leaderboard, and reward state
```

`shared/atlas` has no DOM, canvas, fetch, storage, or wall-clock dependency.
The client and server can therefore consume the same state, action, campaign,
payment, and replay definitions.

`src/atlas` owns presentation and device interaction. The app controller chooses
screens and coordinates controllers. Renderers display state. They do not mark
a payment, score, reward, or wallet identity as true.

`server/atlas` validates external payloads, owns durable state, issues
competitive tickets, rebuilds replays, and checks canonical payment evidence.
The service has no wallet private key and does not custody player funds.

## Authority flow

```text
local practice
  -> shared state transition
  -> local fixture or replay result
  -> labelled local completion

live payment
  -> review exact network, recipient, and Luna amount
  -> explicit Nimiq Pay approval
  -> provider lookup treated as a lookup
  -> server chain lookup
  -> exact evidence match
  -> one-time mission unlock

competitive run
  -> deterministic local action trace
  -> wallet identity binding, if enabled
  -> server-issued ticket
  -> server rebuilds and grades replay
  -> verified result or explicit rejection/retry state
```

The client never skips from provider callback to fulfilled payment. The server
must match network, recipient, integer Luna value, success, and the configured
confirmation threshold.

## Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| `shared/atlas/step.ts` and state modules | Legal transitions and deterministic state | Browser APIs or network calls |
| `shared/atlas/replay.ts` | Trace shape, replay, and integrity checks | Payment truth or UI state |
| `shared/atlas/curriculum.ts` | Lesson definitions and sources | Live source fetching during play |
| `src/atlas/app/atlas-app.ts` | Screen lifecycle and composition | Server authority decisions |
| `src/atlas/city` | Input sampling, player/crowd state, and camera | Payment settlement |
| `src/atlas/render` | Scene presentation | Mutating game rules |
| `src/atlas/wallet.ts` | Nimiq provider adapter | Deciding that a payment settled |
| `src/atlas/api.ts` | HTTP client boundary | Rendering or storing secrets |
| `server/atlas/routes.ts` | Request validation and route dispatch | Client-only state |
| `server/atlas/chain.ts` | Chain lookup and confirmation evidence | Trusting a client claim |
| `server/atlas/persistence.ts` | Durable snapshots and recovery | Inventing reward outcomes |

## Failure states

Every external path keeps these states distinct:

- unavailable: the provider or service cannot be reached;
- pending: an operation exists but the result is not known;
- rejected: validation or authority checks refused the operation;
- retryable: the player can try again with the same safe intent;
- verified: the required authority and evidence checks passed;
- fulfilled: the verified world change was applied once.

An empty leaderboard is not an error. An unavailable chain is not a verified
payment. A local completion is not a competitive result.

## Data and persistence

Browser storage holds tutorial completion, daily completion, local mission
state, and payment recovery state. It is a convenience layer. Losing it must
not create payment authority.

The service stores validated Atlas snapshots, competitive tickets, replay
submissions, public progress, and payout evidence according to the deployment
policy. `DATA_DIR` identifies the durable directory. The historical legacy
snapshot is separate and read-only.

## Extension rules

1. Add new game rules to `shared/atlas` first and test legal transitions there.
2. Add a client controller only after the state and failure values exist.
3. Keep wallet and HTTP calls behind their existing seams.
4. Add an adversarial test for every payment, replay, ticket, or reward trap.
5. Add a capture hook and update `scripts/shoot-atlas.mjs` for every new public
   screen.
6. Update `docs/nim-atlas-current-state.md` when behavior changes. Do not edit
   a historical plan to erase an earlier decision.
