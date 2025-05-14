import type { WebClient } from '@slack/web-api/dist/WebClient';
import type { ChatCompletionTool } from 'openai/resources/chat';
import { createNewOnboardingDmWithAdmins } from '../../assistant/createNewOnboardingDmWithAdmins';
import type { LLMToolConstructorOptions, LLMToolInstance } from '../LLMToolInterface';

export interface CreateOnboardingThreadParams {
  memberSlackId: string;
}

export type CreateOnboardingThreadResult = string;

const createOnboardingThreadSpec: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'createOnboardingThread',
    description:
      'Create an onboarding / welcome thread for a member. Use this when asked by an admin to onboard a member. They may ask you to do this multiple times for a member - just make sure that is what they intend. This will create a new thread with the appropriate location admins and the member, and populate it with welcome and introductory messages. On success, the tool will return the URL of the new thread, which you should provide to the user.',
    parameters: {
      type: 'object',
      properties: {
        memberSlackId: {
          type: 'string',
          description: 'The member\'s slack ID to onboard e.g. "U07BA4JA3HC"',
        },
      },
      required: ['memberSlackId'],
    },
  },
};

export class OnboardingThreadTool
  implements LLMToolInstance<CreateOnboardingThreadParams, CreateOnboardingThreadResult>
{
  private readonly slackClient: WebClient;

  static readonly toolName = 'createOnboardingThread';
  static readonly forAdminsOnly = true;
  static readonly specForLLM: ChatCompletionTool = createOnboardingThreadSpec;
  static readonly getShortDescription = (params: CreateOnboardingThreadParams) =>
    `Creating onboarding thread for <@${params.memberSlackId}>`;

  constructor(options?: LLMToolConstructorOptions) {
    if (!options?.slackClient) {
      throw new Error('OnboardingThreadTool requires slackClient in options');
    }
    this.slackClient = options.slackClient;
  }

  impl = async ({ memberSlackId }: CreateOnboardingThreadParams) =>
    await createNewOnboardingDmWithAdmins(this.slackClient, memberSlackId);
}
