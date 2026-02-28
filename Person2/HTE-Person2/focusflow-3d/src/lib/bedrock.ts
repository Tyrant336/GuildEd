/**
 * AWS Bedrock provider for EDU Oasis (Person 2)
 * Uses @ai-sdk/amazon-bedrock — supports AWS credentials or AWS_BEARER_TOKEN_BEDROCK
 */
import { bedrock } from '@ai-sdk/amazon-bedrock';

const modelId = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-haiku-20240307-v1:0';
const chatModelId = process.env.BEDROCK_CHAT_MODEL_ID ?? 'anthropic.claude-3-sonnet-20240229-v1:0';

export const bedrockModel = bedrock(modelId);
export const bedrockChatModel = bedrock(chatModelId);

export function getBedrockModel(useChatModel = false) {
  return useChatModel ? bedrockChatModel : bedrockModel;
}
