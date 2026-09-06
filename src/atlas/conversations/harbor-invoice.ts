import type { LanternPaymentRequest } from '../../../shared/atlas/adventures/last-lantern';
import type { AtlasConversationDisplay } from './conversation-controller';

// This lesson only reviews an order. It never approves or sends a payment.
export function harborInvoiceLesson(request: LanternPaymentRequest, retry = false): AtlasConversationDisplay {
  if (!Number.isSafeInteger(request.valueLuna) || request.valueLuna <= 0) throw new Error('The lantern amount must be positive integer Lunas.');
  const amount = `${request.valueLuna / 100_000} NIM (${request.valueLuna.toLocaleString()} Lunas)`;
  return {
    conversationId: 'harbor-invoice', nodeId: 'check-amount', speakerId: 'mara',
    mode: 'instruction', reasonId: 'check-before-approval',
    subtitle: retry
      ? `That would pay for two lanterns. We only need one: ${amount}. NIM is the currency; Lunas are its smaller units. Check the amount before opening your wallet.`
      : `My order is for one lantern at ${amount}. NIM is the currency; Lunas are its smaller units. The desk has a duplicate item on one bill. Which amount should we review?`,
    choices: [
      { id: 'duplicate', label: `Two lanterns: ${request.valueLuna / 100_000 * 2} NIM (${(request.valueLuna * 2).toLocaleString()} Lunas)`, nextNodeId: 'check-amount' },
      { id: 'correct', label: `One lantern: ${amount}`, nextNodeId: 'ready' },
    ],
    choiceActions: [
      { type: 'conversation-choice', choiceId: 'duplicate' },
      { type: 'conversation-choice', choiceId: 'correct' },
    ],
    closeup: false, knowledgeFragmentId: null,
  };
}
