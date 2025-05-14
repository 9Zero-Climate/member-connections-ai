export type ToolName = 'searchDocuments' | 'fetchLinkedInProfile' | 'createOnboardingThread';

export const isToolName = (name: string): name is ToolName => {
  return ['searchDocuments', 'fetchLinkedInProfile', 'createOnboardingThread'].includes(name);
};
