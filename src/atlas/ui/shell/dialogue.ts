import type { AtlasConversationDisplay } from '../../conversations/conversation-controller';

/*
 * A character speaking to the player.
 *
 * A playtester reported "no real conversation between me and Mara". The lines
 * had been written and AtlasConversationController could serve them, but
 * nothing ever rendered one: the controller that owns it, AtlasCampaignController,
 * is referenced by no other file in the project. This is the missing surface.
 *
 * It is a sheet rather than a panel because the city is the thing being taught,
 * and it names its speaker rather than relying on a portrait alone, because the
 * cast all share one model and a playtester could not tell them apart.
 */
export interface DialogueOptions {
  readonly display: AtlasConversationDisplay;
  /* Display name for the speaker id, since the id is not player-facing. */
  readonly speakerName: string;
  readonly onChoose: (choiceId: string) => void;
  /* Offered only when the node has no choices, so a line is never a dead end. */
  readonly onContinue: () => void;
  readonly continueLabel?: string;
}

export function dialogueSheet(options: DialogueOptions): HTMLElement {
  const { display } = options;
  const sheet = document.createElement('section');
  sheet.className = display.closeup ? 'atlas-dialogue atlas-dialogue-closeup' : 'atlas-dialogue';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-live', 'polite');
  sheet.setAttribute('aria-label', `${options.speakerName} says`);

  const speaker = document.createElement('p');
  speaker.className = 'atlas-dialogue-speaker';
  speaker.textContent = options.speakerName;

  const line = document.createElement('p');
  line.className = 'atlas-dialogue-line';
  line.textContent = display.subtitle;

  sheet.append(speaker, line);

  const actions = document.createElement('div');
  actions.className = 'atlas-dialogue-actions';

  if (display.choices.length > 0) {
    for (const choice of display.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atlas-pill atlas-pill-ghost atlas-dialogue-choice';
      button.textContent = choice.label;
      button.setAttribute('aria-label', choice.label);
      button.addEventListener('click', () => options.onChoose(choice.id));
      actions.append(button);
    }
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'atlas-pill atlas-dialogue-continue';
    button.textContent = options.continueLabel ?? 'Continue';
    button.setAttribute('aria-label', options.continueLabel ?? 'Continue');
    button.addEventListener('click', options.onContinue);
    actions.append(button);
  }

  sheet.append(actions);
  return sheet;
}
