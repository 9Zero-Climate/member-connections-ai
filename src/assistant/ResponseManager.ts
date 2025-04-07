import type { SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from '../config';

// Define UpdateMessageParams here
export interface UpdateMessageParams {
  client: WebClient;
  say: SayFn;
  message: ChatPostMessageResponse | undefined;
  text: string;
}

/**
 * Manages streaming an LLM response to a Slack message.
 *
 * This class is responsible for updating the response to a message as the LLM streams the response.
 * It also handles the cooldown period between updates to avoid rate limiting.
 *
 */
export default class ResponseManager {
  private lastUpdateTime = 0;
  private currentResponseText = '';
  private inProgressMessage: ChatPostMessageResponse | undefined;

  // Use the locally defined UpdateMessageParams (omitting parts)
  constructor(private readonly params: Omit<UpdateMessageParams, 'text' | 'message'>) {}

  async updateMessage(text: string): Promise<void> {
    this.currentResponseText = text || '_thinking..._';

    const now = Date.now();
    const minTextLengthToStream = 10;

    // Only update if enough time has passed and we have enough text
    if (
      now - this.lastUpdateTime > config.chatEditIntervalMs &&
      this.currentResponseText.length > minTextLengthToStream
    ) {
      this.inProgressMessage = await this.createOrUpdateMessage();
      this.lastUpdateTime = now;
    }
  }

  async finalizeMessage(): Promise<void> {
    const cooldownTimeRemaining = config.chatEditIntervalMs - (Date.now() - this.lastUpdateTime);
    if (cooldownTimeRemaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, cooldownTimeRemaining));
    }

    this.inProgressMessage = await this.createOrUpdateMessage();
    // Reset for next use
    this.currentResponseText = '';
    this.inProgressMessage = undefined;
  }

  private async createOrUpdateMessage(): Promise<ChatPostMessageResponse> {
    const { client, say } = this.params;
    const messageText = this.currentResponseText || '_thinking..._';

    if (!this.inProgressMessage) {
      return await say({
        text: messageText,
        parse: 'full',
      });
    }

    if (!this.inProgressMessage.ts || !this.inProgressMessage.channel) {
      throw new Error(
        `Failed to get timestamp or channel from response message: ${JSON.stringify(this.inProgressMessage)}`,
      );
    }

    return await client.chat.update({
      channel: this.inProgressMessage.channel,
      ts: this.inProgressMessage.ts,
      text: messageText,
    });
  }
}
