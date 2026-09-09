# NIM Atlas submission checklist

This is an owner checklist for the current NIM Atlas build. It does not mark a
portal field, device test, transaction, payout, or competition rule as done
without evidence from that system.

## Project details

```text
Name: NIM Atlas
Category: Games
Repository: https://github.com/Iziedking/sFace
Demo: https://sface.site
Price: Free
```

Suggested description:

```text
Walk through a living city, repair a payment route, and learn Nimiq by using
the right evidence at the right moment. Practice mode is free and wallet-free.
```

## Product proof

- [ ] Cold open the deployed URL in a plain browser.
- [ ] Start a run without a wallet or signup.
- [ ] Understand the first objective without reading a long text block.
- [ ] Reach Mara using the route marker and city map.
- [ ] Explain NIM and Lunas in your own words after the first mission.
- [ ] Complete both Explorer and Builder paths.
- [ ] Finish one Daily Atlas puzzle.
- [ ] Finish one Verified Core Run and see its local completion state.
- [ ] Check the mobile layout in portrait and landscape in the target host.
- [ ] Check keyboard and mouse camera controls in a desktop browser.
- [ ] Check sound on, sound off, and reduced motion.
- [ ] Confirm no unsupported language or placeholder voice appears.

## Wallet and chain gates

- [ ] Confirm the deployment uses practice mode unless the TestAlbatross
      recipient and RPC configuration are approved.
- [ ] On a real Nimiq Pay device, review the exact request before approving.
- [ ] Send one owner-approved 0.1 NIM TestAlbatross payment only after the
      recipient, network, amount, and confirmation runbook are recorded.
- [ ] Confirm the server observes the matching canonical record.
- [ ] Confirm a callback, lookup, or hash alone cannot unlock the mission.
- [ ] Confirm a failed, delayed, duplicated, or mismatched payment leaves a
      recoverable state and does not request a second payment by accident.

## Competitive and rewards gates

- [ ] Pin the season id, challenge id, seed, curriculum hash, campaign hash,
      and ruleset hash in the server environment.
- [ ] Verify a completed replay with the server and inspect the result state.
- [ ] Confirm Assisted runs are separated from prize-eligible runs.
- [ ] Confirm the daily best-delta rule for one actor wallet.
- [ ] Confirm reward status is `estimating`, `pending`, `verified-paid`, or
      `unawarded`, never an invented paid value.
- [ ] Approve the 50,000 NIM season allocation, payout schedule, treasury
      custody, recovery, and audit records separately.

## Required checks before submission

```bash
npm run check
npm run build
npm run verify:atlas:contrast
npm run verify:atlas:art
npm run verify:atlas:3d
```

Regenerate the evidence set from a production preview:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
npm run shoot:atlas
```

Read the official [competition rules](https://miniappscompetition.com/rules)
and [scoring rubric](https://miniappscompetition.com/scoring) again immediately
before submitting. Record the portal version, cutoff, required video, and
wallet requirements in the submission form itself.

## Demo path

1. Open the game in Nimiq Pay or the plain-browser fallback.
2. Choose Explorer and show the first objective.
3. Walk to Mara while the map and distance card guide the player.
4. Review the request and explain that Lunas are the smallest NIM units.
5. Switch to Builder and show the prediction-before-observation trial.
6. Finish the Core Run to show the replay-backed proof state.
7. If the owner-approved TestAlbatross path is enabled, show one real payment
   and the later canonical confirmation. Otherwise leave the honest practice
   state visible.

Do not promise live payments, rankings, rewards, physical-device support, or
multiplayer until the matching checklist item has been run and recorded.
