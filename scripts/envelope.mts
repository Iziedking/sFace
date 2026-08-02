/**
 * What did the wallet actually sign?
 *
 * ## Why this exists
 *
 * Not one row in production has ever carried a signature. The server side is
 * proven against `@nimiq/core` and the client sends the same string the server
 * rebuilds, so the only untested hop is what Nimiq Pay puts through its own
 * signer. Headless browsers have no wallet, so that hop cannot be tested from
 * here at all.
 *
 * What it can be is diagnosed. Once one real refusal is logged, run this
 * against it. Every plausible thing a wallet might sign is tried, and if any of
 * them verifies then the answer is exactly which envelope it used, and the fix
 * is a two-line change in server/attest.ts.
 *
 * If none verify, the signature was over something else entirely and the log
 * line has the message we expected next to the key that signed. That is still a
 * far shorter conversation with Nimiq than "signing does not work".
 *
 * ## Use
 *
 *   npx tsx scripts/envelope.mts \
 *     --message "sface:2026-08-02:seed:s1:900" \
 *     --key <64 hex> --sig <128 hex>
 *
 * The three values come straight out of the `[sface] signature refused` line.
 */

import { PublicKey, Signature } from '@nimiq/core';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error(`Missing --${name}. See the header of this file.`);
    process.exit(1);
  }
  return value;
}

const message = arg('message');
const keyHex = arg('key');
const sigHex = arg('sig');

const encoder = new TextEncoder();

function join(prefix: string, body: Uint8Array): Uint8Array {
  const head = encoder.encode(prefix);
  const out = new Uint8Array(head.byteLength + body.byteLength);
  out.set(head);
  out.set(body, head.byteLength);
  return out;
}

const body = encoder.encode(message);

/**
 * Everything a wallet might reasonably have signed.
 *
 * The first is what this service verifies against today. The rest are the
 * shapes other implementations use, in rough order of how likely they are:
 * a length prefix in characters rather than bytes, no length at all, the bare
 * message, and the Ethereum-style prefix that gets copied between projects.
 */
const CANDIDATES: Array<[string, Uint8Array]> = [
  ['Nimiq envelope, byte length (what we verify)', join(`\x16Nimiq Signed Message:\n${body.byteLength}`, body)],
  ['Nimiq envelope, character length', join(`\x16Nimiq Signed Message:\n${message.length}`, body)],
  ['Nimiq envelope, no length', join('\x16Nimiq Signed Message:\n', body)],
  ['Nimiq envelope, no 0x16 prefix byte', join(`Nimiq Signed Message:\n${body.byteLength}`, body)],
  ['the bare message', body],
  ['Ethereum style prefix', join(`\x19Ethereum Signed Message:\n${body.byteLength}`, body)],
];

console.log(`message  ${JSON.stringify(message)}`);
console.log(`key      ${keyHex}`);
console.log(`sig      ${sigHex}`);
console.log('');

let matched = false;

for (const [name, bytes] of CANDIDATES) {
  let ok = false;
  try {
    const key = PublicKey.fromHex(keyHex);
    const signature = Signature.fromHex(sigHex);
    // The key verifies the signature, not the other way round. Written
    // backwards first and it reported no match for a signature known to be
    // good, which is the one failure a diagnostic must never have.
    ok = key.verify(signature, bytes);
  } catch {
    // A malformed key or signature fails every candidate, which is itself an
    // answer: the wallet returned something that is not an Ed25519 pair.
    ok = false;
  }

  console.log(`${ok ? 'MATCH  ' : '  no   '} ${name}`);
  if (ok) matched = true;
}

console.log('');
if (matched) {
  console.log('The wallet signs one of the shapes above. Make encodeSignedMessage');
  console.log('in server/attest.ts produce that one and signing starts working.');
} else {
  console.log('None of them. The signature is over something this script did not');
  console.log('guess, or the key and signature are not a matching Ed25519 pair.');
  console.log('Worth taking to Nimiq with the message and key above.');
}
