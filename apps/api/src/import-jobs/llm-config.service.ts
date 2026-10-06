import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const LLM_API_KEY_VARS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

/**
 * Whether any LLM provider key is configured. The upload API refuses with a
 * 503 before storing or enqueuing anything when none is (the recognition
 * pipeline cannot run without a model).
 */
@Injectable()
export class LlmConfigService {
  constructor(private readonly config: ConfigService) {}

  /** Configured when at least one LLM provider key is non-blank. */
  isConfigured(): boolean {
    return LLM_API_KEY_VARS.some((key) => {
      const value = this.config.get<string>(key);
      return value !== undefined && value.trim() !== '';
    });
  }
}
