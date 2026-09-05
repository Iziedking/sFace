import { activeHarborContract, harborContractTarget, type HarborContractProgress } from '../../../shared/atlas/harbor-contracts';
import type { PayHarborPhysicalMission } from '../../../shared/atlas/city/pay-harbor-mission';
import type { AtlasConversationDisplay } from '../conversations/conversation-controller';

export function projectHarborContractMission(progress: HarborContractProgress): PayHarborPhysicalMission {
  const contract = activeHarborContract(progress);
  const step = progress.active?.step ?? 0;
  return {
    phase: 'tower-lit', restoration: 'restored', complete: !contract,
    targetAnchorId: harborContractTarget(progress),
    objective: contract ? [ `COLLECT THE ${contract.cargo.toUpperCase()}`, 'CHECK THE PRACTICE ORDER', `DELIVER THE ${contract.cargo.toUpperCase()}` ][step]! : 'ASK MARA FOR A HARBOR JOB',
    detail: contract ? [contract.need, 'Bring the paperwork to the review desk. Choose the safe payment decision.', 'Order checked. Follow the marked destination to finish your delivery.'][step]! : 'Three free jobs are ready. Help the market, ferry crew, and workshop. Replay to improve your personal best.',
    status: `LOCAL PRACTICE / ${contract ? `STOP ${step + 1} OF 3` : `${progress.stocked.length}/3 SUPPLIES RESTORED`}`,
    actionLabel: contract ? ['Collect', 'Check order', 'Deliver'][step]! : 'Jobs',
  };
}

export function harborContractDialogue(subtitle: string, choices: readonly { id: string; label: string }[] = []): AtlasConversationDisplay {
  return {
    conversationId: 'harbor-contracts', nodeId: 'contract', speakerId: 'mara', mode: 'world', reasonId: 'harbor-supplies',
    subtitle, choices: choices.map((choice) => ({ ...choice, nextNodeId: 'contract' })),
    choiceActions: choices.map((choice) => ({ type: 'conversation-choice', choiceId: choice.id })),
    closeup: false, knowledgeFragmentId: null,
  };
}
