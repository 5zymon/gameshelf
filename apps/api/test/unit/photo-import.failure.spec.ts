import {
  VisionProviderError,
  VisionUnavailableError,
} from '../../src/settings/vision/vision.errors';
import { photoImportFailureReason } from '../../src/queue/photo-import.failure';

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
});
