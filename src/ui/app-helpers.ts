import type { Challenge } from '../net/api';
import type { GhostFrame } from '../game/ghost';
import type { RunState } from '../game/state';

export function shortAddress(address: string | null): string | null {
  if (!address) return null;
  const blocks = address.replace(/^NQ/i, 'NQ').split(' ').filter(Boolean);
  if (blocks.length < 3) return address;
  return `${blocks[0]} ${blocks[1]} ... ${blocks[blocks.length - 1]}`;
}

export function poseOf(run: RunState): GhostFrame {
  return {
    x: run.player.x,
    y: run.player.y,
    angle: Math.atan2(run.player.aimY, run.player.aimX),
    firing: run.player.fireCooldown > 0,
    down: run.phase === 'died',
    carrying: run.carrying,
  };
}

export function winnerAddressOf(challenge: Challenge, meId: string): string | null {
  const creatorWon = (challenge.opponentScore ?? -1) < challenge.creatorScore;
  if (creatorWon) return challenge.creatorId === meId ? null : challenge.creatorAddress;
  return challenge.opponentId === meId ? null : challenge.opponentAddress;
}

