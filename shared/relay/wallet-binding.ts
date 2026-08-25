export interface RelayWalletBindingMessageInput {
  domain: string;
  actorId: string;
  address: string;
  network: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  purpose: string;
}

export function canonicalRelayBindingMessage(input: RelayWalletBindingMessageInput): string {
  return [input.domain, input.purpose, input.actorId, input.address, input.network, input.nonce, String(input.issuedAt), String(input.expiresAt)].join('\n');
}

export function canonicalRelayBindingBytes(input: RelayWalletBindingMessageInput): Uint8Array {
  return new TextEncoder().encode(canonicalRelayBindingMessage(input));
}
