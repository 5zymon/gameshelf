import { ConfigService } from '@nestjs/config';
import { LlmConfigService } from '../../src/import-jobs/llm-config.service';

function createService(
  values: Record<string, string | undefined>,
): LlmConfigService {
  const config = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService;
  return new LlmConfigService(config);
}

describe('LlmConfigService (unit)', () => {
  it('is configured when OPENAI_API_KEY is non-blank', () => {
    const service = createService({ OPENAI_API_KEY: 'sk-real' });
    expect(service.isConfigured()).toBe(true);
  });

  it('is configured when only ANTHROPIC_API_KEY is set', () => {
    const service = createService({ ANTHROPIC_API_KEY: 'sk-ant-real' });
    expect(service.isConfigured()).toBe(true);
  });

  it('is not configured when both keys are absent', () => {
    const service = createService({});
    expect(service.isConfigured()).toBe(false);
  });

  it.each([
    ['empty strings', { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }],
    ['whitespace only', { OPENAI_API_KEY: '   ', ANTHROPIC_API_KEY: '\t\n' }],
    ['one blank, one missing', { OPENAI_API_KEY: '  ' }],
  ])('is not configured when keys are %s', (_name, values) => {
    const service = createService(values);
    expect(service.isConfigured()).toBe(false);
  });
});
