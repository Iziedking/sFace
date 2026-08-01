# Product feedback: Nimiq Pay Mini App SDK

Written while building sFace against `@nimiq/mini-app-sdk@0.1.0`. Each item below
is something we ran into, with the exact SDK surface involved and what we did
instead. They are ordered by how much they cost us.

The SDK is good to build on. `init()` returning a provider, errors coming back as
a response instead of a thrown exception, and the wallet owning the approval
dialog rather than the Mini App are all the right decisions. The notes here are
about the edges.

---

## 1. There is no way to create a contract, so escrow is impossible

This is the one that changed our product.

sFace lets people stake NIM on a contest. Two to six players fly the same seeded
stages and the best average wins. We wanted the stake held while the contest runs
and released to the winner at the end. Nimiq supports HTLCs as a native transaction
type in Albatross, so the protocol can do this.

The provider cannot. `NimiqProvider.WALLET_METHODS` is a closed set of ten:

```js
listAccounts, sign,
sendBasicTransaction, sendBasicTransactionWithData,
sendNewStakerTransaction, sendStakeTransaction,
sendSetActiveStakeTransaction, sendUpdateStakerTransaction,
sendRetireStakeTransaction, sendRemoveStakeTransaction
```

`request()` sends anything outside that set to the JSON-RPC node instead of the
wallet:

```js
async request(e) {
  if (E.WALLET_METHODS.has(e.method)) return /* wallet */;
  if (!rpcUrl) throw new Error(`No RPC URL configured...`);
  return rpc.call({ jsonrpc: '2.0', method: e.method, params: e.params });
}
```

The node holds no keys, so a Mini App has no way to get a contract-creation
transaction signed. `sendBasicTransactionWithData` does not work as a substitute.
An HTLC needs a contract-creation transaction with the HTLC recipient type and the
creation flag set. That method sends a basic transaction with a data field
attached, so the data goes through and no contract is created.

**What we shipped instead.** Stakes are recorded, not held. The loser sees who to
pay and how much, pays in one tap with `sendBasicTransactionWithData`, and reports
the transaction hash, which we publish next to the debt so the winner can check it.
The app records the debt and cannot collect it, and the UI says exactly that. We
also made free contests the default, since a contest with no stake cannot be
defaulted on.

**What would fix it:** `sendHtlcCreationTransaction` and a redeem counterpart, or
any allowlisted route to a contract-creation transaction. HTLC alone would cover
two-party wagers, atomic swaps, and any Mini App that needs escrow.

---

## 2. No balance method

There is no way to read an account balance. `listAccounts()` returns addresses and
nothing returns what is in them.

We wanted a balance on the profile so a player can see whether they can cover a
stake before agreeing to one. We got there through `getRPC()` and a
`getAccountByAddress` call. That works, but it means any Mini App wanting to show a
balance has to know about JSON-RPC and handle `getRPC()` returning `undefined` when
the host has not configured one.

Every failure in that path has to show "not known" rather than zero. Showing `0 NIM`
to somebody who has funds, because a node was unreachable, would make them distrust
every other number on the screen.

**What would fix it:** `getBalance(address)` on the provider, resolved from whatever
the host already uses. The wallet knows this number and the Mini App is
reconstructing it.

---

## 3. The `init()` and `listAccounts()` split deserves louder documentation

We got this wrong for a while. It was our mistake, but the failure is invisible, so
it is worth flagging.

`init()` opens the bridge and prompts nobody. `listAccounts()` is what raises the
native approval dialog. We called `listAccounts()` during boot, so opening the game
inside Nimiq Pay threw an account-approval dialog at someone who had not touched
anything yet. Testers reported it as "the wallet connects itself", which is what it
looked like.

The split is correct, and the provider carrying `connect`, `disconnect` and a
`connected` getter is a strong hint. But nothing fails when you get it wrong. You
get a working app with an unexplained permission prompt at the worst possible
moment, and onboarding time is a judging criterion.

**What would help:** a line in the quickstart saying which call prompts, and
`connected` documented as the thing to check before asking for anything.

---

## 4. `sign()` needs an approved account and does not say so

Related to the above. After splitting `init()` from `listAccounts()`, we called
`sign()` whenever a wallet was present rather than connected. It failed every time
with nothing pointing at the cause.

This one cost a real player a real score. Our score route refused the whole
submission when a signature failed to verify, so a finished run signed in good faith
came back as an error and the player lost the run. We have since changed the route
so a failed signature only costs the signature. But a distinct error for "no account
approved" would have saved an hour of debugging, and right now an ordinary refusal
and a not-connected state look identical from the Mini App side.

---

## 5. No Proof-of-Stake block explorer to link to

Not the SDK, but it affected what we could build. sFace publishes the signature
behind every score so anyone can verify it, and we wanted the wallet address on each
row to open on chain.

There is no official Proof-of-Stake explorer UI, and `nimiq.watch` is from the
Proof-of-Work era. We ended up using the community-run nimiqscan, and we read its
route out of its own bundle rather than guessing:

```
/account/:address
nimiqscan.com          -> Mainnet
testnet.nimiqscan.com  -> Testnet
```

That works and we are glad it exists. But a Mini App pointing users at a
community explorer for on-chain verification is an awkward place for the ecosystem
to be. An official explorer, or a documented canonical link format, would let apps
point at something first-party.

---

## 6. The testnet faucet page renders blank

`https://faucet.pos.nimiq-testnet.com` returns a twelve-byte body and renders
nothing in a browser. Sending a tester there and having them find an empty page is
worse than not linking it, so we call the faucet's API directly from our own
settings screen and show what it pays and how many claims are left.

The API is fine. Only the page is broken.

---

## What we would build if this were fixed

Contract creation is the only item here that blocks something we cannot do at all
today. With an HTLC we could hold a two-party stake and release it against a signed
result. sFace already has the pieces that make a fair bet: same seed, pinned aim
assist, signed scores, published signatures. An escrow would let it settle itself
instead of depending on the loser being honest.

Everything else on this list is a workaround we already have. That one is a wall.
