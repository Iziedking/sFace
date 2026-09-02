import type { AtlasAction } from '../../../shared/atlas/state';
import { AtlasConversationController, type AtlasConversationDisplay } from '../conversations/conversation-controller';
import { AtlasInputController, type AtlasWorldPoint } from '../input';
import { AtlasCamera, type AtlasCameraResize, type AtlasCameraView } from '../render/camera';

export class AtlasCampaignController {
  constructor(
    readonly input = new AtlasInputController(),
    readonly camera = new AtlasCamera({ reducedMotion: false }),
    readonly conversations = new AtlasConversationController(),
  ) {}

  resize(size: AtlasCameraResize): void {
    this.camera.resize(size);
  }

  setDestination(point: AtlasWorldPoint): void {
    this.input.setDestination(point);
  }

  cancelDestination(): void {
    this.input.cancelDestination();
  }

  sample(player: AtlasWorldPoint): AtlasAction {
    this.camera.follow(player);
    this.camera.update();
    return this.input.sampleFor(player);
  }

  get view(): AtlasCameraView {
    return this.camera.view;
  }

  startConversation(conversationId: string, nodeId: string): AtlasConversationDisplay {
    return this.conversations.start(conversationId, nodeId);
  }

  chooseConversation(choiceId: string): AtlasConversationDisplay {
    return this.conversations.choose(choiceId);
  }
}
