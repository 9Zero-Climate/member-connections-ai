import type { SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from '../config';
import { logger } from '../services/logger';

// Slack API docs say to "limit text to 4000 characters for best results".
// In reality, we have experienced API errors at ~3700 characters.
// Play it safe.
const SLACK_MAX_MESSAGE_LENGTH = 3000;

export interface UpdateMessageParams {
  client: WebClient;
  say: SayFn;
  channelOrThreadTs: string;
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
      logger.warn({
        msg,
        inProgressMessage: this.inProgressMessage,
        currentResponseText: this.currentResponseText,
        requestedPlaceholder: placeholder,
      });
      throw new Error(msg);
    }

    this.inProgressMessage = await this.params.say({
      text: placeholder,
      thread_ts: this.params.channelOrThreadTs,
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

  async finalizeMessage(): Promise<{ text: string; ts?: string; channel?: string }> {
    const finalMessageText = this.currentResponseText;
    let finalTs: string | undefined;
    let finalChannel: string | undefined;

    const cooldownTimeRemaining = config.chatEditIntervalMs - (Date.now() - this.lastUpdateTime);
    if (cooldownTimeRemaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, cooldownTimeRemaining));
    }

    if (this.currentResponseText && this.inProgressMessage?.ts && this.inProgressMessage?.channel) {
      try {
        // Ensure the final update happens
        await this.updateMessage();
        // Capture ts/channel from the potentially updated inProgressMessage
        finalTs = this.inProgressMessage?.ts;
        finalChannel = this.inProgressMessage?.channel;
      } catch (error) {
        logger.error(
          { err: error, inProgressMessage: this.inProgressMessage },
          'Failed to update message during finalization',
        );
        // Ensure we don't return potentially stale ts/channel on error
        finalTs = undefined;
        finalChannel = undefined;
      }
    } else if (!this.currentResponseText && this.inProgressMessage?.ts && this.inProgressMessage?.channel) {
      // If there was no text, but we had a placeholder message, we don't treat it as a final message to react to.
      // Optionally, we could delete the placeholder here, but let's leave it for now.
      logger.debug('Finalizing message with no text content, placeholder was likely used.');
      // Capture the placeholder's ts/channel just in case, though it shouldn't be used for reactions
      finalTs = this.inProgressMessage.ts;
      finalChannel = this.inProgressMessage.channel;
    }

    this.resetMessageState();
    return { text: finalMessageText, ts: finalTs, channel: finalChannel };
  }

  /**
   * Updates the in-progress message with the current response text.
   *
   * @throws {Error} If no in-progress message is found or update fails.
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

    if (this.currentResponseText.length > SLACK_MAX_MESSAGE_LENGTH) {
      // Dealing with long messages:
      // 1. Split the message on the last newline before the limit
      // 2. send the first part immediately
      // 3. send the second part in a new message, which becomes our in-progress message
      const { prefix, suffix } = splitMessageThatIsTooLong(this.currentResponseText, SLACK_MAX_MESSAGE_LENGTH);
      logger.info(
        {
          currentResponseText: this.currentResponseText,
          prefix,
          suffix,
          length: this.currentResponseText.length,
        },
        'Response text may be too long for Slack. Splitting into multiple messages.',
      );

      this.inProgressMessage = await this.params.client.chat.update({
        channel: this.inProgressMessage.channel,
        ts: this.inProgressMessage.ts,
        text: prefix,
      });

      this.currentResponseText = prefix;
      await this.finalizeMessage();

      await this.startNewMessageWithPlaceholder('_takes deep breath_');
      this.currentResponseText = suffix;
    } else {
      // Normal case: just update the message with the current response text
      this.inProgressMessage = await this.params.client.chat.update({
        channel: this.inProgressMessage.channel,
        ts: this.inProgressMessage.ts,
        text: this.currentResponseText,
      });
    }
  }
}

export const findNewlineIndexToSplitMessage = (message: string, limit: number): number | null => {
  const lastNewlineBeforeLimitIndex = message.lastIndexOf('\n', limit);
  const firstNewlineAfterLimitIndex = message.indexOf('\n', limit);
  // Doesn't make any sense to use a newline that is the first character.
  // Also indexOf returns -1 if no newline is found
  const canUseEarlyNewline = lastNewlineBeforeLimitIndex > 0;
  const canUseLaterNewline = firstNewlineAfterLimitIndex > 0;

  if (!canUseEarlyNewline && !canUseLaterNewline) {
    return null;
  }

  return canUseEarlyNewline ? lastNewlineBeforeLimitIndex : firstNewlineAfterLimitIndex;
};

export const splitMessageThatIsTooLong = (message: string, limit: number): { prefix: string; suffix: string } => {
  const newlineIndex = findNewlineIndexToSplitMessage(message, limit);
  if (newlineIndex === null) {
    logger.warn(
      {
        message,
        limit,
        newlineIndex,
      },
      "No suitable newline found. Returning the original message; we'll just have to take our chances that the slack API doesn't blow up on us",
    );
    return { prefix: message, suffix: '' };
  }

  return { prefix: message.slice(0, newlineIndex), suffix: message.slice(newlineIndex + 1) };
};
