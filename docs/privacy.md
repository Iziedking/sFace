# Privacy notes

NIM Atlas is playable without an account. Practice progress stays in the
browser when storage is available. The client does not need a wallet to start
the game.

## Data the app may process

- Local mission progress, tutorial completion, daily completion date, and
  payment recovery state.
- A session actor id used to keep a local run together.
- A wallet address only after the player chooses a wallet-binding or payment
  action. Public views may mask it.
- Competitive run ids, replay traces, scores, season identifiers, and server
  verification results when those features are enabled.
- Payment request data needed to match network, recipient, integer Luna value,
  success, and confirmation state.
- Operational logs with route, event, timestamp, and bounded failure context.

The backend must not store private keys or wallet credentials. The browser
keeps provider responses only for the recovery path that needs them. A wallet
callback or transaction hash is not treated as proof of payment.

## Public and restricted data

Public surfaces may show verified scores, masked wallet labels, public names
chosen by the player, aggregate progress, and explicit payment status.

Full addresses, wallet-binding credentials, replay traces, admin logs, and
payout evidence belong to restricted service storage. Retention follows the
operator's deployment policy and the competition's verification requirements.

## Player requests

For a data access or removal request, provide the affected public player id and
contact the project operator. Removing local browser data is available through
the browser controls. Removing a server record cannot rewrite a chain record or
an immutable competition result; the operator must record any visibility or
retention decision.

## Contact

The repository does not embed a private support address. The competition
submission and the live site should name the current project contact before
public release.
