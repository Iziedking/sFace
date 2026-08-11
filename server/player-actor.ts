import type { PlayerAuth } from './player-auth';
import { bodyDigest, type AuthAction, type DeviceProof } from '../src/net/player-auth-protocol';

export function createActorVerifier(authority: PlayerAuth) {
  return async (
    proof: DeviceProof,
    action: AuthAction,
    actorId: string,
    signedBody: unknown,
  ): Promise<boolean> => {
    const verified = await authority.verify({
      proof,
      action,
      bodyDigest: await bodyDigest(signedBody),
    });
    return verified.ok && verified.value.playerId === actorId;
  };
}
