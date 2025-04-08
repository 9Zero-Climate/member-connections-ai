import type { SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from '../config';
import { logger } from '../services/logger';

export interface UpdateMessageParams {
  client: WebClient;
  say: SayFn;
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

  private resetMessageState(): void {
    this.currentResponseText = '';
    this.inProgressMessage = undefined;
  }

  constructor(private readonly params: UpdateMessageParams) {
    this.resetMessageState();
  }

  async startNewMessageWithPlaceholder(placeholder: string): Promise<void> {
    if (this.inProgressMessage || this.currentResponseText) {
      const msg = 'Cannot start a new message while there is an in-progress message.';
      logger.error({
        msg,
        inProgressMessage: this.inProgressMessage,
        currentResponseText: this.currentResponseText,
        requestedPlaceholder: placeholder,
      });
      throw new Error(msg);
    }

    this.inProgressMessage = await this.params.say({
      text: placeholder,
      // parse: 'full',
    });
    // Don't set the placeholder as the current response text, because it will be replaced with the actual response
    this.currentResponseText = '';
    // Initialize lastUpdateTime when message starts
    this.lastUpdateTime = Date.now();
  }

  async appendToMessage(text: string): Promise<void> {
    this.currentResponseText += text;

    const now = Date.now();
    const minTextLengthToStream = 10;

    // Only update if enough time has passed and we have enough text
    if (
      now - this.lastUpdateTime > config.chatEditIntervalMs &&
      this.currentResponseText.length > minTextLengthToStream
    ) {
      await this.updateMessage();
      this.lastUpdateTime = now;
    }
  }

  async finalizeMessage(): Promise<string> {
    const finalMessageText = this.currentResponseText;
    const cooldownTimeRemaining = config.chatEditIntervalMs - (Date.now() - this.lastUpdateTime);
    if (cooldownTimeRemaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, cooldownTimeRemaining));
    }

    await this.updateMessage();
    this.resetMessageState();
    return finalMessageText;
  }

  /**
   * Updates the in-progress message with the current response text.
   *
   * @throws {Error} If no in-progress message is found.
   */
  private async updateMessage(): Promise<void> {
    if (!this.inProgressMessage) {
      throw new Error(
        'No in progress message found. ResponseManager.startNewMessage() must be called before updateMessage().',
      );
    }
    if (!this.currentResponseText) {
      throw new Error('No response text to update message with.');
    }

    if (!this.inProgressMessage.ts || !this.inProgressMessage.channel) {
      throw new Error(
        `Failed to get timestamp or channel from response message: ${JSON.stringify(this.inProgressMessage)}`,
      );
    }

    this.inProgressMessage = await this.params.client.chat.update({
      channel: this.inProgressMessage.channel,
      ts: this.inProgressMessage.ts,
      text: this.currentResponseText,
    });
  }
}
