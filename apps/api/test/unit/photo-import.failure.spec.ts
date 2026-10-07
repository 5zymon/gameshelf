import { IgdbConfigError } from '../../src/game-catalog/igdb.errors';
import { MobygamesConfigError } from '../../src/game-catalog/mobygames.errors';
import {
  VisionProviderError,
  VisionUnavailableError,
} from '../../src/settings/vision/vision.errors';
import {
  ConfigurationImportError,
  configErrorSource,
  isRetryableImportError,
  photoImportFailureReason,
  RetryableImportError,
} from '../../src/queue/photo-import.failure';

describe('photoImportFailureReason (unit)', () => {
  it('uses the provider error message for a VisionProviderError', () => {
    expect(
      photoImportFailureReason(
        new VisionProviderError(
          'bad_response',
          'The model returned malformed JSON',
        ),
      ),
    ).toBe('The model returned malformed JSON');
  });

  it('uses the default provider message when none is supplied', () => {
    expect(photoImportFailureReason(new VisionProviderError('timeout'))).toBe(
      'The provider did not respond in time',
    );
  });

  it('maps VisionUnavailableError to the no-key reason', () => {
    expect(photoImportFailureReason(new VisionUnavailableError())).toBe(
      'Photo import is unavailable: no LLM provider API key is configured',
    );
  });

  it('falls back to a generic reason for an unknown Error', () => {
    expect(photoImportFailureReason(new Error('boom'))).toBe(
      'Photo recognition failed unexpectedly',
    );
  });

  it('falls back to a generic reason for a non-Error value', () => {
    expect(photoImportFailureReason('nope')).toBe(
      'Photo recognition failed unexpectedly',
    );
  });

  it('uses the message of a RetryableImportError', () => {
    expect(
      photoImportFailureReason(new RetryableImportError('temporarily down')),
    ).toBe('temporarily down');
  });

  it('uses the message of a ConfigurationImportError', () => {
    expect(
      photoImportFailureReason(
        new ConfigurationImportError('igdb', 'IGDB rejected the credentials'),
      ),
    ).toBe('IGDB rejected the credentials');
  });

  it('uses the message of an IgdbConfigError', () => {
    expect(
      photoImportFailureReason(
        new IgdbConfigError('IGDB rejected the credentials'),
      ),
    ).toBe('IGDB rejected the credentials');
  });

  it('returns the message of a MobygamesConfigError', () => {
    expect(
      photoImportFailureReason(
        new MobygamesConfigError('MobyGames rejected the credentials'),
      ),
    ).toBe('MobyGames rejected the credentials');
  });
});

describe('configErrorSource (unit)', () => {
  it('classifies an unauthorized VisionProviderError as an LLM config error', () => {
    expect(configErrorSource(new VisionProviderError('unauthorized'))).toBe(
      'llm',
    );
  });

  it('classifies VisionUnavailableError as an LLM config error', () => {
    expect(configErrorSource(new VisionUnavailableError())).toBe('llm');
  });

  it('classifies IgdbConfigError as an IGDB config error', () => {
    expect(
      configErrorSource(new IgdbConfigError('IGDB rejected the credentials')),
    ).toBe('igdb');
  });

  it('classifies MobygamesConfigError as a mobygames config error', () => {
    expect(
      configErrorSource(
        new MobygamesConfigError('MobyGames rejected the credentials'),
      ),
    ).toBe('mobygames');
  });

  it('classifies a ConfigurationImportError by its source', () => {
    expect(configErrorSource(new ConfigurationImportError('igdb', 'x'))).toBe(
      'igdb',
    );
    expect(configErrorSource(new ConfigurationImportError('llm', 'x'))).toBe(
      'llm',
    );
  });

  it('returns null for a permanent non-config vision error', () => {
    expect(
      configErrorSource(new VisionProviderError('bad_response')),
    ).toBeNull();
  });

  it('returns null for an ordinary error', () => {
    expect(configErrorSource(new Error('boom'))).toBeNull();
    expect(configErrorSource('nope')).toBeNull();
  });
});

describe('isRetryableImportError (unit)', () => {
  it('treats a RetryableImportError as retryable', () => {
    expect(isRetryableImportError(new RetryableImportError('x'))).toBe(true);
  });

  it.each(['rate_limited', 'timeout', 'network', 'server_error'] as const)(
    'treats a transient VisionProviderError (%s) as retryable',
    (code) => {
      expect(isRetryableImportError(new VisionProviderError(code))).toBe(true);
    },
  );

  it.each(['unauthorized', 'model_not_found', 'bad_response'] as const)(
    'treats a permanent VisionProviderError (%s) as non-retryable',
    (code) => {
      expect(isRetryableImportError(new VisionProviderError(code))).toBe(false);
    },
  );

  it('treats an unknown error as non-retryable', () => {
    expect(isRetryableImportError(new Error('boom'))).toBe(false);
    expect(isRetryableImportError('nope')).toBe(false);
  });

  it('treats a configuration error as non-retryable', () => {
    expect(
      isRetryableImportError(
        new ConfigurationImportError('igdb', 'IGDB rejected the credentials'),
      ),
    ).toBe(false);
    expect(
      isRetryableImportError(
        new IgdbConfigError('IGDB rejected the credentials'),
      ),
    ).toBe(false);
    expect(
      isRetryableImportError(
        new MobygamesConfigError('MobyGames rejected the credentials'),
      ),
    ).toBe(false);
    expect(
      isRetryableImportError(new VisionProviderError('unauthorized')),
    ).toBe(false);
  });
});
