import { Queue, Worker } from 'bullmq';
import {
  photoImportDefaultJobOptions,
  photoImportWorkerOptions,
} from '../../src/queue/queue.options';
import { PHOTO_IMPORT_QUEUE } from '../../src/queue/queue.constants';

/**
 * The connection and key prefix used by this suite's raw producer/worker pair.
 * The `bull-e2e` prefix (test/setup-env.ts) keeps it in its own Redis keyspace,
 * matching the other queue e2e specs.
 */
const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
};
const queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'bull-e2e';

function rawQueue(): Queue {
  return new Queue(PHOTO_IMPORT_QUEUE, {
    connection,
    prefix: queuePrefix,
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(50);
  }
  throw new Error(`condition not met within ${String(timeoutMs)}ms`);
}

describe('Photo import worker (e2e)', () => {
  const openWorkers: Worker[] = [];
  const openQueues: Queue[] = [];
  let releaseGate: () => void = () => undefined;

  function trackWorker(worker: Worker): Worker {
    openWorkers.push(worker);
    return worker;
  }

  function trackQueue(queue: Queue): Queue {
    openQueues.push(queue);
    return queue;
  }

  beforeEach(async () => {
    releaseGate = () => undefined;
    const queue = new Queue(PHOTO_IMPORT_QUEUE, {
      connection,
      prefix: queuePrefix,
    });
    await queue.obliterate({ force: true });
    await queue.close();
  }, 30_000);

  afterEach(async () => {
    // Unblock any processor still awaiting the gate before closing.
    releaseGate();
    while (openWorkers.length > 0) {
      const worker = openWorkers.pop();
      if (worker) {
        await worker.close(true);
      }
    }
    while (openQueues.length > 0) {
      const queue = openQueues.pop();
      if (queue) {
        await queue.close();
      }
    }
  }, 30_000);

  it('backs off exponentially between retries rather than firing immediately', async () => {
    const queue = trackQueue(rawQueue());
    const starts: number[] = [];
    const worker = trackWorker(
      new Worker(
        PHOTO_IMPORT_QUEUE,
        () => {
          starts.push(Date.now());
          if (starts.length < 3) {
            return Promise.reject(new Error('transient failure'));
          }
          return Promise.resolve({ ok: true });
        },
        { connection, prefix: queuePrefix },
      ),
    );
    await worker.waitUntilReady();

    await queue.add(
      'photo',
      { photoRef: 'backoff' },
      {
        ...photoImportDefaultJobOptions(),
        backoff: { type: 'exponential', delay: 150 },
      },
    );

    await waitFor(() => starts.length >= 3, 15_000);

    expect(starts).toHaveLength(3);
    const [first, second, third] = starts;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected three worker starts');
    }
    const gap1 = second - first;
    const gap2 = third - second;
    // Exponential: delay·2^(attemptsMade−1) → ~150 ms then ~300 ms.
    expect(gap1).toBeGreaterThanOrEqual(130);
    expect(gap2).toBeGreaterThanOrEqual(280);
    expect(gap2).toBeGreaterThan(gap1);
  }, 30_000);

  it('recovers a killed worker\u2019s job instead of leaving it active', async () => {
    const queue = trackQueue(rawQueue());
    const workerOptions = photoImportWorkerOptions({
      lockDuration: 300,
      lockRenewTime: 150,
      stalledInterval: 50,
      maxStalledCount: 2,
    });

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    releaseGate = release;

    // Worker A picks up the job and blocks forever; its lock stops renewing as
    // soon as it is force-closed.
    const workerA = trackWorker(
      new Worker(
        PHOTO_IMPORT_QUEUE,
        async () => {
          await gate;
          return { ok: true };
        },
        { connection, prefix: queuePrefix, ...workerOptions },
      ),
    );
    await workerA.waitUntilReady();

    const job = await queue.add('photo', { photoRef: 'killed' });
    await waitFor(async () => (await job.getState()) === 'active', 10_000);

    // Force close skips `whenCurrentJobsFinished` and stops the lock manager, so
    // the lock is not renewed and expires after `lockDuration`.
    await workerA.close(true);

    // Worker B starts, notices the stalled job and re-runs it to completion.
    let processedByB = 0;
    const workerB = trackWorker(
      new Worker(
        PHOTO_IMPORT_QUEUE,
        () => {
          processedByB += 1;
          return Promise.resolve({ ok: true });
        },
        { connection, prefix: queuePrefix, ...workerOptions },
      ),
    );
    await workerB.waitUntilReady();

    await waitFor(async () => (await job.getState()) === 'completed', 20_000);

    expect(processedByB).toBe(1);
    expect(await job.getState()).not.toBe('active');
  }, 30_000);
});
