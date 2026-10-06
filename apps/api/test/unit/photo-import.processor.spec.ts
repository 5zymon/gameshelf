import { PhotoImportHandler } from '../../src/queue/photo-import.handler';
import { PhotoImportProcessor } from '../../src/queue/photo-import.processor';

/**
 * Regression guard for the Redis-down shutdown hang: BullExplorer closes
 * workers with a non-forced `worker.close()`, which never settles while the
 * blocking Redis connection is reconnecting. `beforeApplicationShutdown` must
 * force-close instead.
 */
describe('PhotoImportProcessor shutdown (unit)', () => {
  it('force-closes the worker in beforeApplicationShutdown', async () => {
    const processor = new PhotoImportProcessor(new PhotoImportHandler());
    const close = jest.fn().mockResolvedValue(undefined);
    (processor as unknown as { _worker: { close: jest.Mock } })._worker = {
      close,
    };

    await processor.beforeApplicationShutdown();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('does not throw when the worker was never initialized', async () => {
    const processor = new PhotoImportProcessor(new PhotoImportHandler());

    await expect(
      processor.beforeApplicationShutdown(),
    ).resolves.toBeUndefined();
  });
});
