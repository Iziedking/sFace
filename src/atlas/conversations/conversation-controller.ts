import {
  LAST_LANTERN_CONVERSATION_MILESTONES,
  type LastLanternConversationMilestone,
} from '../../../shared/atlas/adventures/last-lantern';

export type AtlasConversationMode = 'world' | 'instruction' | 'milestone';

export interface AtlasConversationChoice {
  id: string;
  label: string;
  nextNodeId: string;
}

export interface AtlasConversationDisplay {
  conversationId: string;
  nodeId: string;
  speakerId: string;
  mode: AtlasConversationMode;
  reasonId: string;
  subtitle: string;
  choices: readonly AtlasConversationChoice[];
  choiceActions: readonly { type: 'conversation-choice'; choiceId: string }[];
  closeup: boolean;
  knowledgeFragmentId: string | null;
}

export interface AtlasConversationLogEntry {
  conversationId: string;
  nodeId: string;
  speakerId: string;
  subtitle: string;
}

interface ConversationNode {
  conversationId: string;
  nodeId: string;
  speakerId: string;
  mode: AtlasConversationMode;
  reasonId: string;
  subtitle: string;
  choices: readonly AtlasConversationChoice[];
  closeup: boolean;
  knowledgeFragmentId: string | null;
  worldMilestone?: LastLanternConversationMilestone;
}

const MARA_LANTERN = Object.freeze({
  arrival: Object.freeze({
    conversationId: 'mara-lantern', nodeId: 'arrival', speakerId: 'mara', mode: 'world', reasonId: 'market-cannot-open',
    subtitle: 'The bakers are ready. The ferry crew is waiting. But our tower is still dark. Help me collect the last lantern so we can open the night market.',
    choices: Object.freeze([
      Object.freeze({ id: 'ask-why', label: 'How can I help?', nextNodeId: 'route-reason' }),
      Object.freeze({ id: 'look-around', label: 'Look at the closed market', nextNodeId: 'market-reason' }),
    ]), closeup: false, knowledgeFragmentId: 'ask', worldMilestone: LAST_LANTERN_CONVERSATION_MILESTONES.arrival,
  }),
  'route-reason': Object.freeze({
    conversationId: 'mara-lantern', nodeId: 'route-reason', speakerId: 'mara', mode: 'world', reasonId: 'safe-route-needed',
    subtitle: 'Inspect the lantern at my counter. Then check the bill at the desk: one lantern, the right shop, the right amount. Bring it to the tower after payment is confirmed.',
    choices: Object.freeze([]), closeup: false, knowledgeFragmentId: 'address', worldMilestone: LAST_LANTERN_CONVERSATION_MILESTONES.shop,
  }),
  'market-reason': Object.freeze({
    conversationId: 'mara-lantern', nodeId: 'market-reason', speakerId: 'mara', mode: 'world', reasonId: 'neighbors-are-waiting',
    subtitle: 'The fishers, bakers, and ferry crew are waiting for one safe delivery before they can welcome everyone back.',
    choices: Object.freeze([]), closeup: false, knowledgeFragmentId: null, worldMilestone: LAST_LANTERN_CONVERSATION_MILESTONES.arrival,
  }),
  'tower-lit': Object.freeze({
    conversationId: 'mara-lantern', nodeId: 'tower-lit', speakerId: 'mara', mode: 'milestone', reasonId: 'harbor-restored',
    subtitle: 'Look at the tower! You checked the bill, waited for confirmation, and brought the lantern home. The night market is open. We could use someone like you here.',
    choices: Object.freeze([]), closeup: true, knowledgeFragmentId: 'unlock', worldMilestone: LAST_LANTERN_CONVERSATION_MILESTONES.restoration,
  }),
});

const CONVERSATIONS = Object.freeze({ 'mara-lantern': MARA_LANTERN });

export function nextConversation(conversationId: string, nodeId: string): AtlasConversationDisplay {
  const node = CONVERSATIONS[conversationId as keyof typeof CONVERSATIONS]?.[nodeId as keyof typeof MARA_LANTERN];
  if (!node) throw new Error(`Unknown Atlas conversation node: ${conversationId}/${nodeId}`);
  return toDisplay(node);
}

export class AtlasConversationController {
  private current: AtlasConversationDisplay | null = null;
  private entries: AtlasConversationLogEntry[] = [];
  private worldEvents = new Set<LastLanternConversationMilestone>();

  start(conversationId: string, nodeId: string): AtlasConversationDisplay {
    this.current = nextConversation(conversationId, nodeId);
    this.entries = [toLogEntry(this.current)];
    return this.current;
  }

  choose(choiceId: string): AtlasConversationDisplay {
    if (!this.current) throw new Error('Atlas conversation has not started.');
    const choice = this.current.choices.find((item) => item.id === choiceId);
    if (!choice) throw new Error(`Unknown Atlas conversation choice: ${choiceId}`);
    this.current = nextConversation(this.current.conversationId, choice.nextNodeId);
    this.entries.push(toLogEntry(this.current));
    return this.current;
  }

  markWorldEvent(event: LastLanternConversationMilestone): void {
    this.worldEvents.add(event);
  }

  availableKnowledgeFragment(): string | null {
    if (!this.current || !this.current.knowledgeFragmentId) return null;
    const node = CONVERSATIONS[this.current.conversationId as keyof typeof CONVERSATIONS]?.[this.current.nodeId as keyof typeof MARA_LANTERN];
    if (!node?.worldMilestone || !this.worldEvents.has(node.worldMilestone)) return null;
    return this.current.knowledgeFragmentId;
  }

  log(): readonly AtlasConversationLogEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

function toDisplay(node: ConversationNode): AtlasConversationDisplay {
  const choices = node.choices.map((choice) => ({ ...choice }));
  return {
    conversationId: node.conversationId,
    nodeId: node.nodeId,
    speakerId: node.speakerId,
    mode: node.mode,
    reasonId: node.reasonId,
    subtitle: node.subtitle,
    choices,
    choiceActions: choices.map((choice) => ({ type: 'conversation-choice', choiceId: choice.id })),
    closeup: node.closeup,
    knowledgeFragmentId: node.knowledgeFragmentId,
  };
}

function toLogEntry(display: AtlasConversationDisplay): AtlasConversationLogEntry {
  return { conversationId: display.conversationId, nodeId: display.nodeId, speakerId: display.speakerId, subtitle: display.subtitle };
}
