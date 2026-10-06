import {
  isTerminalImportJobStatus,
  mergeImportJobStatus,
} from '../../src/import-jobs/import-job-status';

describe('mergeImportJobStatus (unit)', () => {
  it.each(['done', 'needs_attention', 'failed', 'dismissed'])(
    'keeps the durable terminal status "%s" regardless of queue state',
    (status) => {
      expect(mergeImportJobStatus(status, 'active')).toBe(status);
      expect(mergeImportJobStatus(status, 'waiting')).toBe(status);
      expect(mergeImportJobStatus(status, null)).toBe(status);
    },
  );

  it('maps an active queue state to processing', () => {
    expect(mergeImportJobStatus('queued', 'active')).toBe('processing');
    expect(mergeImportJobStatus('processing', 'active')).toBe('processing');
  });

  it.each(['waiting', 'delayed', 'prioritized', 'waiting-children'])(
    'maps the queued queue state "%s" to queued',
    (queueState) => {
      expect(mergeImportJobStatus('processing', queueState)).toBe('queued');
      expect(mergeImportJobStatus('queued', queueState)).toBe('queued');
    },
  );

  it('keeps the durable status when there is no queue state', () => {
    expect(mergeImportJobStatus('queued', null)).toBe('queued');
    expect(mergeImportJobStatus('processing', null)).toBe('processing');
  });

  it('keeps the durable status for an unknown queue state', () => {
    expect(mergeImportJobStatus('queued', 'stalled')).toBe('queued');
    expect(mergeImportJobStatus('processing', 'completed')).toBe('processing');
  });

  it('classifies the terminal vocabulary', () => {
    expect(isTerminalImportJobStatus('done')).toBe(true);
    expect(isTerminalImportJobStatus('needs_attention')).toBe(true);
    expect(isTerminalImportJobStatus('failed')).toBe(true);
    expect(isTerminalImportJobStatus('dismissed')).toBe(true);
    expect(isTerminalImportJobStatus('queued')).toBe(false);
    expect(isTerminalImportJobStatus('processing')).toBe(false);
  });
});
