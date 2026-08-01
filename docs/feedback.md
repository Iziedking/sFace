# Product feedback: Nimiq Pay Mini App SDK

Written while building sFace against `@nimiq/mini-app-sdk@0.1.0`. Everything
below is a thing we hit, with the exact surface involved and what we did
instead, because a feedback note without a reproduction is just an opinion.

The SDK is genuinely pleasant to build on. `init()` resolving to a provider,
the error envelope instead of throws, and the fact that the wallet owns the
approval dialog rather than us are all the right calls. The notes here are
about the edges we ran into, in the order they cost us the most.

---

## 1. There is no way to create a contract, so escrow is impossible

**The most consequential one for us.**

sFace lets people stake NIM on a contest: two to six pilots fly the same seeded
stages, and the best average wins. We wanted the stake held while it is flown
and released to the winner. Nimiq supports HTLCs natively as a transaction type
in Albatross, so the protocol is not the blocker.

The provider is. `NimiqProvider.WALLET_METHODS` is a closed set of ten:

```js
listAccounts, sign,
sendBasicTransaction, sendBasicTransactionWithData,
sendNewStakerTransaction, sendStakeTransaction,
sendSetActiveStakeTransaction, sendUpdateStakerTransaction,
sendRetireStakeTransaction, sendRemoveStakeTransaction
```

`request()` routes anything outside that set to the JSON-RPC node instead of the
wallet:

```js
async request(e) {
  if (E.WALLET_METHODS.has(e.method)) return /* wallet */;
  if (!rpcUrl) throw new Error(`No RPC URL configured...`);
  return rpc.call({ jsonrpc: '2.0', method: e.method, params: e.params });
}
```

The node holds no keys, so there is no way to get a contract-creation
transaction signed from inside a Mini App. `sendBasicTransactionWithData` does
not substitute: an HTLC needs a contract-creation transaction with the HTLC
recipient type and creation flag, and that method sends a basic transaction with
a data field attached. The data rides along and the contract never exists.

**What we shipped instead.** Stakes are recorded, not held. The loser is shown
exactly who to pay and how much, pays in one tap with
`sendBasicTransactionWithData`, and reports the hash, which we publish beside the
debt so the winner can check it. That is witnessing, not enforcement, and the UI
says so in those words. We also made free contests the default, because a
contest with no stake cannot be defaulted on.

**What would fix it:** `sendHtlcCreationTransaction` and a redeem counterpart,
or any allowlisted route to a contract-creation transaction. Even HTLC alone
would cover two-party wagers, atomic swaps and any escrow-shaped Mini App.

---

## 2. No balance method

There is no way to read an account balance. `listAccounts()` returns addresses,
and nothing returns what is in them.

We wanted a balance on the profile so somebody can see whether they can cover a
stake before agreeing to one. We got there through `getRPC()` and a
`getAccountByAddress` call, which works, but it means a Mini App that wants to
show a balance has to know about JSON-RPC and handle `getRPC()` returning
`undefined` when the host has not configured one.

Every failure in that path has to degrade to "not known" rather than zero,
because showing `0 NIM` to somebody with funds, because a node was unreachable,
is the kind of wrong number that makes a player distrust every other figure on
the screen.

**What would fix it:** `getBalance(address)` on the provider, resolving from
whatever the host already uses. The wallet knows this number; the Mini App is
reconstructing it.

---

## 3. `init()` and `listAccounts()` is the right split, and it deserves to be
   documented louder

We got this wrong for a while and it was our fault, but it is worth flagging
because the failure is invisible.

`init()` opens the bridge and prompts nobody. `listAccounts()` is what raises
the native approval dialog. We called `listAccounts()` during boot, so opening
the game inside Nimiq Pay threw an account-approval dialog at somebody who had
not yet touched anything. Testers reported it as "the wallet connects itself",
which is exactly what it looked like.

The split is correct. The provider carrying `connect`, `disconnect` and a
`connected` getter is a strong hint. But nothing fails when you get it wrong:
you get a working app with an unexplained permission prompt at the worst
possible moment, and onboarding time is a judging criterion.

**What would help:** a line in the quickstart saying which call prompts, and
`connected` being the thing a Mini App is expected to branch on before asking
for anything.

---

## 4. `sign()` needs an approved account, and says so unhelpfully

Related to the above. After splitting `init()` from `listAccounts()`, we called
`sign()` when a wallet was merely present rather than connected, and it failed
every time with nothing that pointed at the cause.

A distinct error for "no account approved" would have saved an hour. As it
stands, an ordinary refusal and a not-connected state look the same from the
Mini App side.

---

## 5. No PoS block explorer to link to

Not the SDK, but it affected what we could build. sFace publishes the signature
behind every score so a stranger can verify it, and we wanted the wallet address
on each row to open on chain.

There is no official Proof-of-Stake explorer UI, and `nimiq.watch` is
Proof-of-Work era. We ended up on the community-run `nimiqscan`, whose route we
read out of its own bundle rather than guessing:

```
/account/:address
nimiqscan.com          -> Mainnet
testnet.nimiqscan.com  -> Testnet
```

That works and we are grateful it exists, but a Mini App linking users to a
community explorer for on-chain verification is a slightly awkward place for
the ecosystem to be. An official explorer, or a documented canonical link
format, would let apps point at something first-party.

---

## 6. Testnet faucet page renders blank

`https://faucet.pos.nimiq-testnet.com` serves a twelve-byte body and renders
nothing in a browser. Linking a tester to it and having them find an empty page
is worse than not offering the link, so we call the faucet's API directly from
our own settings screen and show what it pays and how many claims are left.

The API is fine. It is only the page that is broken.

---

## What we would build with this fixed

Contract creation is the one that unlocks something we cannot do at all today.
With an HTLC we could hold a two-party stake and release it against a signed
result, which turns the fair-bet guarantee sFace already has, same seed, pinned
assist, signed scores, published signatures, into something that settles itself
rather than relying on the loser being honest.

Everything else on this list is a workaround we already have. That one is a
wall.
