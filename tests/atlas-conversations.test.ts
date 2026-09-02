import { describe, expect, it } from 'vitest';

import {
  AtlasConversationController,
  nextConversation,
  type AtlasConversationChoice,
} from '../src/atlas/conversations/conversation-controller';
import { LAST_LANTERN_CONVERSATION_MILESTONES } from '../shared/atlas/adventures/last-lantern';

describe('NIM Atlas living conversations', () => {
  it('starts with Mara’s human reason before any technology explanation', () => {
    const next = nextConversation('mara-lantern', 'arrival');
    expect(next).toMatchObject({
      speakerId: 'mara',
      mode: 'world',
      reasonId: 'market-cannot-open',
    });
    expect(next.subtitle.length).toBeGreaterThan(0);
    expect(next.subtitle.length).toBeLessThanOrEqual(180);
    expect(next.subtitle).not.toMatch(/rpc|api|blockchain|wallet/i);
  });

  it('offers optional choices with stable speaker IDs and an inspectable dialogue log', () => {
    const controller = new AtlasConversationController();
    const arrival = controller.start('mara-lantern', 'arrival');
    expect(arrival.choices.length).toBeGreaterThanOrEqual(2);
    expect(arrival.choices.every((choice: AtlasConversationChoice) => choice.id && choice.label)).toBe(true);

    const inspected = controller.choose(arrival.choices[0]!.id);
    expect(inspected.speakerId).toBe('mara');
    expect(controller.log()).toHaveLength(2);
    expect(controller.log().every((entry) => entry.speakerId === 'mara')).toBe(true);
  });

  it('only exposes a Book fragment after the matching world milestone', () => {
    const controller = new AtlasConversationController();
    controller.start('mara-lantern', 'arrival');
    expect(controller.availableKnowledgeFragment()).toBeNull();
    controller.markWorldEvent(LAST_LANTERN_CONVERSATION_MILESTONES.arrival);
    expect(controller.availableKnowledgeFragment()).toBe('ask');
  });

  it('emits a selective milestone closeup without changing gameplay state', () => {
    const next = nextConversation('mara-lantern', 'tower-lit');
    expect(next.closeup).toBe(true);
    expect(next.reasonId).toBe('harbor-restored');
    expect(next.choiceActions).toEqual([]);
  });
});
