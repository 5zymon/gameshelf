import { isTerminalImportJobStatus } from '../../src/import-jobs/import-job-status';

describe('isTerminalImportJobStatus (unit)', () => {
  it.each(['done', 'needs_attention', 'failed', 'dismissed'])(
    'classifies "%s" as terminal',
    (status) => {
      expect(isTerminalImportJobStatus(status)).toBe(true);
    },
  );

  it.each(['queued', 'processing'])(
    'classifies "%s" as non-terminal',
    (status) => {
      expect(isTerminalImportJobStatus(status)).toBe(false);
    },
  );
});
