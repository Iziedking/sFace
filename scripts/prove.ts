/**
 * The two honesty claims, run in front of you.
 *
 * The README says a score is bounded by rebuilding the level, and that a row on
 * the board is attributable to a Nimiq address. Both are true and both are
 * tested, but a test suite that says PASS is a claim about a claim. This runs
 * the real functions the service runs and prints what they return, including the
 * cases that are refused, so the property can be watched rather than believed.
 *
 *   npx tsx scripts/prove.ts
 *
 * Nothing here is a mock. `levelFacts` and `refuse` are what POST /board calls,
 * `verifyClaim` is what checks a signature, and the keypair is a real Ed25519
 * keypair from @nimiq/core. The only thing that is not real is the wallet: this
 * signs locally instead of asking Nimiq Pay, because a script cannot hold your
 * keys and should not want to.
 */

import { KeyPair, PrivateKey, PublicKey, Signature } from '@nimiq/core';

import { claimMessage, encodeSignedMessage, verifyClaim } from '../server/attest';
import { levelFacts, refuse, type ClaimedRun } from '../server/verify';
import { practiceMission } from '../src/game/mission';

const say = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

const mission = practiceMission(new Date().toISOString().slice(0, 10));
const payload: unknown = JSON.parse(JSON.stringify(mission));

say();
say('1. THE LEVEL IS THE CEILING');
say('   The seed is public and the level is deterministic, so the service does');
say('   not judge whether a number looks high. It builds the level and reads');
say('   off what that level can physically pay.');
say();

for (const stage of [1, 5, 7]) {
  const facts = levelFacts(payload, stage);
  if (!facts) continue;
  say(
    `   stage ${stage}  ${String(facts.enemies).padStart(3)} attackers  ` +
      `${String(facts.caches).padStart(2)} caches  ` +
      `${String(facts.faces).padStart(2)} people  ` +
      `${String(facts.seconds).padStart(3)}s   ceiling ${facts.maxScore.toLocaleString()}`,
  );
}

const facts = levelFacts(payload, 1);
if (!facts) throw new Error('could not build the level');

const honest: ClaimedRun = {
  seed: mission.seed,
  stage: 1,
  score: 4_200,
  facesExtracted: 3,
  attackersCleared: 6,
  cachesTaken: 2,
  duration: 88,
  extracted: true,
};

say();
say('   claims against stage 1:');
say();

const claims: Array<[string, ClaimedRun]> = [
  ['an ordinary run', honest],
  ['one more kill than the level holds', { ...honest, attackersCleared: facts.enemies + 1 }],
  ['one point more than it can pay', { ...honest, score: facts.maxScore + 1 }],
  ['thirty seconds longer than the stage', { ...honest, duration: facts.seconds + 30 }],
  ['rescued people without ever extracting', { ...honest, extracted: false }],
];

for (const [label, claim] of claims) {
  const why = refuse(claim, facts);
  say(`   ${why ? 'refused ' : 'accepted'}  ${label}`);
  if (why) say(`             ${why}`);
}

say();
say('   Note the ceiling is per seed, not a fixed number. A quiet day builds a');
say('   smaller level and the ceiling drops with it.');

say();
say('2. WHO SAID IT');
say('   A device id is a value the client makes up and can throw away. A');
say('   signature is not. The player signs one string naming the day, the seed,');
say('   the stage and the score, and the service derives the signer from it.');
say();

const keys = KeyPair.derive(PrivateKey.generate());
const publicKey = keys.publicKey.toHex();
const address = PublicKey.fromHex(publicKey).toAddress().toUserFriendlyAddress();

const claim = { date: mission.date, seed: mission.seed, stage: 1, score: 4_200 };
const message = claimMessage(claim);

say(`   wallet     ${address}`);
say(`   signs      ${message}`);
say(`   wrapped in \\x16Nimiq Signed Message:\\n${message.length}`);
say();

const signature = Signature.create(
  keys.privateKey,
  keys.publicKey,
  encodeSignedMessage(message),
).toHex();

const verified = verifyClaim({ claim, publicKey, signature });
say(`   verified   ${verified ? verified.address : 'REJECTED'}`);
say('              derived from the public key, never read from the request:');
say('              an address sent alongside a signature is only a claim about it');
say();

/*
 * Every field that could be swapped for a better one is inside the signed
 * string, so none of them can be edited after the fact.
 */
const swaps: Array<[string, typeof claim]> = [
  ['score raised to 99,000', { ...claim, score: 99_000 }],
  ['presented as a stage 7 result', { ...claim, stage: 7 }],
  ['replayed tomorrow', { ...claim, date: '2099-01-01' }],
  ['replayed against another seed', { ...claim, seed: 'another:seed:entirely' }],
];

say('   the same signature, with one field edited:');
say();
for (const [label, tampered] of swaps) {
  const result = verifyClaim({ claim: tampered, publicKey, signature });
  say(`   ${result ? 'ACCEPTED - BUG' : 'rejected      '}  ${label}`);
}

// A signature over the bare message is what an attacker would produce by
// signing with a raw Ed25519 library. A Nimiq wallet never produces this.
const bare = Signature.create(
  keys.privateKey,
  keys.publicKey,
  new TextEncoder().encode(message),
).toHex();
const bareResult = verifyClaim({ claim, publicKey, signature: bare });
say(`   ${bareResult ? 'ACCEPTED - BUG' : 'rejected      '}  signed without the Nimiq envelope`);

// And somebody else's key against this signature.
const other = KeyPair.derive(PrivateKey.generate());
const stolen = verifyClaim({ claim, publicKey: other.publicKey.toHex(), signature });
say(`   ${stolen ? 'ACCEPTED - BUG' : 'rejected      '}  another wallet claiming this signature`);

say();
say('   Proves : this address said this score, on this seed, on this day, and');
say('            cannot later deny it.');
say('   Does not prove : that the run happened. A player can sign a score they');
say('            did not earn. What changed is that it is no longer anonymous.');
say('            See server/attest.ts. Do not call it anti-cheat.');
say();
