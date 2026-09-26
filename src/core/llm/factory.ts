import { EnvConfig } from '../../config/env.js';
import { GeminiLLMProvider } from './gemini-provider.js';
import { ILLMProvider, MockLLMProvider } from './interface.js';
import { OpenAILLMProvider } from './openai-provider.js';

export function createLLMProvider(env: EnvConfig): ILLMProvider {
  const provider = env.LLM_PROVIDER;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL && env.LLM_MODEL !== 'default-model' ? env.LLM_MODEL : undefined;

  switch (provider) {
    case 'gemini':
      return new GeminiLLMProvider({ apiKey, model });
    case 'openai':
      return new OpenAILLMProvider({ apiKey, model });
    case 'mock':
    default:
      return new MockLLMProvider();
  }
}
