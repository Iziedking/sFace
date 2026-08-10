import {
  encodeChallenge,
  publicKeyId,
  type Challenge,
  type DeviceProof,
  type PublicKeyJwk,
} from './player-auth-protocol';

export interface PlayerCredentialStore {
  load(): Promise<CryptoKeyPair | null>;
  save(pair: CryptoKeyPair): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryPlayerCredentialStore implements PlayerCredentialStore {
  private pair: CryptoKeyPair | null = null;

  async load(): Promise<CryptoKeyPair | null> {
    return this.pair;
  }

  async save(pair: CryptoKeyPair): Promise<void> {
    this.pair = pair;
  }

  async clear(): Promise<void> {
    this.pair = null;
  }
}

class IndexedDbPlayerCredentialStore implements PlayerCredentialStore {
  private readonly database = 'sface-player-auth';
  private readonly store = 'credentials';

  async load(): Promise<CryptoKeyPair | null> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(this.store, 'readonly').objectStore(this.store).get('current');
      request.onsuccess = () => resolve((request.result as CryptoKeyPair | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async save(pair: CryptoKeyPair): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(this.store, 'readwrite')
        .objectStore(this.store)
        .put(pair, 'current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(this.store, 'readwrite').objectStore(this.store).delete('current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

let fallbackStore: MemoryPlayerCredentialStore | null = null;

export function defaultPlayerCredentialStore(): PlayerCredentialStore {
  if (typeof indexedDB !== 'undefined') return new IndexedDbPlayerCredentialStore();
  fallbackStore ??= new MemoryPlayerCredentialStore();
  return fallbackStore;
}

export async function getOrCreateCredential(
  store: PlayerCredentialStore = defaultPlayerCredentialStore(),
): Promise<{ pair: CryptoKeyPair; publicKeyJwk: PublicKeyJwk; playerId: string }> {
  const existing = await store.load();
  const pair =
    existing ??
    (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    ));
  if (!existing) await store.save(pair);
  const publicKeyJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as PublicKeyJwk;
  return { pair, publicKeyJwk, playerId: await publicKeyId(publicKeyJwk) };
}

export async function signChallenge(pair: CryptoKeyPair, challenge: Challenge): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    Uint8Array.from(encodeChallenge(challenge)).buffer,
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function deviceProof(
  challenge: Challenge,
  publicKeyJwk: PublicKeyJwk,
  signature: string,
): DeviceProof {
  return { challengeId: challenge.id, publicKeyJwk, signature };
}
