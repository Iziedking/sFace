# Deployment runbook

NIM Atlas has a static Vite client and an optional Node service. The client is
safe to deploy on its own. The service is required for authoritative payment,
competitive, durable, leaderboard, and reward paths.

## Client

Build with Node 20.19 or newer:

```bash
npm ci
npm run build
```

Deploy `dist` to the Vercel project. The build command is `npm run build` and
the output directory is `dist`. Set these public values only when their
matching server capability exists:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | Base URL for the Atlas service. Empty uses local practice behavior. |
| `VITE_APP_ORIGIN` | Origin used in shared challenge links. |
| `VITE_ATLAS_TESTNET_ENABLED` | Public switch for the TestAlbatross payment path. |
| `VITE_ATLAS_TESTNET_RECIPIENT` | The approved public payment recipient. |
| `VITE_ATLAS_TESTNET_PRICE_LUNA` | Exact integer Luna amount, normally 10000 for 0.1 NIM. |
| `VITE_ATLAS_COMPETITIVE_SEASON_ID` | Public season label used for wallet binding. |

Every `VITE_` value is visible in the built JavaScript. Never put a token,
private key, admin credential, or RPC secret in one.

## Service

Run the service only with a durable `DATA_DIR` and an operator-approved
environment. Do not point a new deployment at a protected legacy data file.

```bash
npm ci
npm run server
```

Important service variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Listening port. |
| `ALLOWED_ORIGINS` | Exact client origins allowed by CORS. Set it in production. |
| `TRUST_PROXY` | Set only when the reverse proxy is configured and trusted. |
| `DATA_DIR` | Durable directory for service state and backups. |
| `ATLAS_TESTNET_ENABLED` | Enables server-side payment handling. |
| `ATLAS_TESTNET_RECIPIENT` | Approved recipient. Must match the client value. |
| `ATLAS_TESTNET_PRICE_LUNA` | Approved integer amount. Must match the client value. |
| `ATLAS_TESTNET_RPC_URLS` | HTTPS RPC endpoints used for lookup and confirmation. |
| `ATLAS_TESTNET_MIN_CONFIRMATIONS` | Confirmation threshold for fulfillment. |
| `ATLAS_DURABLE_REPOSITORY_ENABLED` | Enables durable Atlas state. |
| `ATLAS_COMPETITIVE_ENABLED` | Enables server-issued competitive tickets. |
| `ATLAS_REWARDS_ENABLED` | Enables reward accounting only after the treasury gate. |
| `ADMIN_TOKEN` | Admin-only credential. Keep it server-side and rotate it if exposed. |

The competitive variables must be pinned together:
`ATLAS_COMPETITIVE_SEASON_ID`, `ATLAS_COMPETITIVE_CHALLENGE_ID`,
`ATLAS_COMPETITIVE_SEED`, `ATLAS_COMPETITIVE_CAMPAIGN_HASH`,
`ATLAS_COMPETITIVE_CURRICULUM_HASH`, and `ATLAS_COMPETITIVE_RULESET_HASH`.

## Safe rollout order

1. Deploy the client with practice mode.
2. Check the deployed URL, mobile layout, console, audio, route guidance, and
   the screenshots against the local preview.
3. Deploy the service with durable state but competitive and reward switches
   off.
4. Read the effective health response and service logs.
5. Run the owner-approved TestAlbatross payment on a real Nimiq Pay device.
6. Confirm canonical lookup, one-time fulfillment, retry behavior, and recovery.
7. Enable competitive tickets only after replay verification passes on the
   deployed service.
8. Enable rewards only after treasury, payout, and recovery checks pass.

Each step can be rolled back without changing the legacy archive. Do not turn
on multiple money-affecting switches in one deployment.

## Checks after a deploy

```bash
npm run verify:deployment
npm run verify:atlas:contrast
```

The deployment probe is read-only. It checks effective health, security
headers, origin handling, and admin authentication behavior. It does not send
NIM, create a payout, write a backup, or change game state.

## Backup and recovery

Back up the directory named by `DATA_DIR` before changing service code or
environment. Keep the backup outside the active data directory, record its
hash, and test restore in a separate directory. Never edit `.data/sface.json`
by hand. The legacy archive is read-only and must remain byte-preserved.

## Vercel note

Install the Vercel CLI on the owner's machine if needed:

```bash
npm i -g vercel
```

The owner should pull, inspect, and set project variables from the Vercel
project, then deploy after the local checks pass. This repository does not
store Vercel credentials.
