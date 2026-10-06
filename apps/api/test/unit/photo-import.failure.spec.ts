import {
  VisionProviderError,
  VisionUnavailableError,
} from '../../src/settings/vision/vision.errors';
import {
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
});
