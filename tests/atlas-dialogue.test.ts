import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AtlasConversationController } from '../src/atlas/conversations/conversation-controller';

const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/atlas/ui/shell/dialogue.ts', import.meta.url), 'utf8');

describe('Mara actually speaks', () => {
  it('opens her conversation when the player reaches her', () => {
    /*
     * The lines and the controller both existed; nothing rendered them. The
     * class that owned conversations, AtlasCampaignController, was referenced
     * by no other file, so a playtester correctly reported "no real
     * conversation between me and Mara".
     */
    expect(app).toContain("this.conversations.start('mara-lantern', 'arrival')");
    expect(app).toContain('dialogueSheet({');
  });

  it('puts her in front of the payment panels rather than beside them', () => {
    // A person asking for help should be met before a form about the request.
    const start = app.indexOf('private renderLantern(');
    const body = app.slice(start, start + 900);
    expect(body).toContain('if (this.maraConversation)');
    expect(body).toMatch(/dialogueSheet[\s\S]*?return;/);
  });

  it('serves her written lines and real choices', () => {
    const conversations = new AtlasConversationController();
    const arrival = conversations.start('mara-lantern', 'arrival');
    expect(arrival.speakerId).toBe('mara');
    expect(arrival.subtitle.length).toBeGreaterThan(20);
    expect(arrival.choices.length).toBe(2);

    const answered = conversations.choose(arrival.choices[0]!.id);
    expect(answered.subtitle).not.toBe(arrival.subtitle);
  });

  it('never leaves a line without a way onward', () => {
    // A node with no choices still needs a continue, or the player is stuck
    // looking at a sheet with nothing to press.
    expect(sheet).toContain('options.continueLabel ?? ');
    expect(sheet).toMatch(/display\.choices\.length > 0[\s\S]*?else/);
  });

  it('names the speaker, because the cast share one model', () => {
    expect(sheet).toContain("speaker.className = 'atlas-dialogue-speaker'");
    expect(app).toContain("speakerName: 'Mara'");
  });
});
