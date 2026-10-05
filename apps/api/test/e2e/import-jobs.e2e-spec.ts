import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';

interface UnrecognizedItemBody {
  id: number;
  importJobId: number;
  rawTitle: string;
  rawPlatform: string | null;
  reason: string | null;
  createdAt: string;
  dismissedAt: string | null;
}

interface ImportJobBody {
  id: number;
  status: string;
  declaredCount: number | null;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ImportJobDetailBody extends ImportJobBody {
  unrecognizedItems: UnrecognizedItemBody[];
}

interface ImportJobsListBody {
  items: ImportJobBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

describe('ImportJobs API (e2e)', () => {
  let test: TestApp;
  let importJobs: ImportJobsService;

  beforeAll(async () => {
    test = await createTestApp();
    importJobs = test.app.get(ImportJobsService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterAll(async () => {
    await test.app.close();
  });

  describe('GET /import-jobs', () => {
    it('returns an empty page', async () => {
      const res = await test.request.get('/import-jobs');

      expect(res.status).toBe(200);
      expect(res.body as ImportJobsListBody).toEqual({
        items: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('orders newest first (createdAt DESC, id DESC tiebreaker)', async () => {
      const j1 = await test.prisma.importJob.create({
        data: {
          status: 'queued',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      const j2 = await test.prisma.importJob.create({
        data: {
          status: 'queued',
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      });
      const j3 = await test.prisma.importJob.create({
        data: {
          status: 'queued',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      });
      // Same createdAt as j1 — the larger id must sort first.
      const j4 = await test.prisma.importJob.create({
        data: {
          status: 'queued',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });

      const res = await test.request.get('/import-jobs');

      expect(res.status).toBe(200);
      expect((res.body as ImportJobsListBody).items.map((j) => j.id)).toEqual([
        j2.id,
        j3.id,
        j4.id,
        j1.id,
      ]);
    });

    it('filters by status', async () => {
      const done = await importJobs.createJob({ declaredCount: 1 });
      await importJobs.markCompleted(done.id, {
        recognizedCount: 1,
        importedCount: 1,
        unrecognizedCount: 0,
      });
      const needsAttention = await importJobs.createJob({});
      await importJobs.markCompleted(needsAttention.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });
      const queued = await importJobs.createJob({});

      const byDone = (
        await test.request.get('/import-jobs').query({ status: 'done' })
      ).body as ImportJobsListBody;
      expect(byDone.items.map((j) => j.id)).toEqual([done.id]);
      expect(byDone.meta.total).toBe(1);

      const byNeedsAttention = (
        await test.request
          .get('/import-jobs')
          .query({ status: 'needs_attention' })
      ).body as ImportJobsListBody;
      expect(byNeedsAttention.items.map((j) => j.id)).toEqual([
        needsAttention.id,
      ]);

      const byQueued = (
        await test.request.get('/import-jobs').query({ status: 'queued' })
      ).body as ImportJobsListBody;
      expect(byQueued.items.map((j) => j.id)).toEqual([queued.id]);
    });

    it('paginates', async () => {
      // Sequential creation: parallel inserts would make the auto-increment
      // ids land out of array order.
      const jobs = [];
      for (let i = 0; i < 5; i += 1) {
        jobs.push(await importJobs.createJob({}));
      }

      const page1 = (
        await test.request.get('/import-jobs').query({ limit: 2, page: 1 })
      ).body as ImportJobsListBody;
      expect(page1.items).toHaveLength(2);
      expect(page1.meta).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });

      const page3 = (
        await test.request.get('/import-jobs').query({ limit: 2, page: 3 })
      ).body as ImportJobsListBody;
      expect(page3.items).toHaveLength(1);
      // Newest first: the first-created (oldest) job is on the last page.
      expect(page3.items[0]?.id).toBe(jobs[0]?.id);
    });

    it.each(['page=0', 'limit=0', 'limit=101', 'status=bogus', 'bogus=1'])(
      'rejects %s with 400',
      async (query) => {
        const res = await test.request.get(`/import-jobs?${query}`);

        expect(res.status).toBe(400);
      },
    );
  });

  describe('GET /import-jobs/:id', () => {
    it('returns the job with ALL unrecognized items (dismissed included, id asc)', async () => {
      const job = await importJobs.createJob({ declaredCount: 2 });
      const item1 = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'PlayStaton 5',
        rawPlatform: 'PS4',
        reason: 'no candidate passed acceptance',
      });
      const item2 = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: '???',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 1,
        importedCount: 1,
        unrecognizedCount: 2,
      });
      // Dismiss one item — the trace must still include it.
      const dismiss = await test.request
        .patch(
          `/import-jobs/${String(job.id)}/unrecognized/${String(item1.id)}`,
        )
        .send({ dismissed: true });
      expect(dismiss.status).toBe(200);

      const res = await test.request.get(`/import-jobs/${String(job.id)}`);

      expect(res.status).toBe(200);
      const body = res.body as ImportJobDetailBody;
      expect(body.id).toBe(job.id);
      expect(body.status).toBe('needs_attention');
      expect(body.declaredCount).toBe(2);
      expect(body.recognizedCount).toBe(1);
      expect(body.importedCount).toBe(1);
      expect(body.unrecognizedCount).toBe(2);
      expect(body.errorMessage).toBeNull();
      expect(typeof body.completedAt).toBe('string');
      expect(body.unrecognizedItems.map((i) => i.id)).toEqual([
        item1.id,
        item2.id,
      ]);
      expect(body.unrecognizedItems[0]?.dismissedAt).not.toBeNull();
      expect(body.unrecognizedItems[1]?.dismissedAt).toBeNull();
      expect(body.unrecognizedItems[0]).toMatchObject({
        rawTitle: 'PlayStaton 5',
        rawPlatform: 'PS4',
        reason: 'no candidate passed acceptance',
      });
    });

    it('returns 404 for an unknown job', async () => {
      const res = await test.request.get('/import-jobs/999999');

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0'])('returns 400 for id "%s"', async (id) => {
      const res = await test.request.get(`/import-jobs/${id}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /import-jobs/:id/unrecognized', () => {
    it('returns only non-dismissed items (the review queue)', async () => {
      const job = await importJobs.createJob({});
      const open = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'Open',
      });
      const dismissed = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'Gone',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 2,
      });
      const dismiss = await test.request
        .patch(
          `/import-jobs/${String(job.id)}/unrecognized/${String(dismissed.id)}`,
        )
        .send({ dismissed: true });
      expect(dismiss.status).toBe(200);

      const res = await test.request.get(
        `/import-jobs/${String(job.id)}/unrecognized`,
      );

      expect(res.status).toBe(200);
      const body = res.body as UnrecognizedItemBody[];
      expect(body.map((i) => i.id)).toEqual([open.id]);
    });

    it('returns 404 for an unknown job', async () => {
      const res = await test.request.get('/import-jobs/999999/unrecognized');

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0'])('returns 400 for job id "%s"', async (id) => {
      const res = await test.request.get(`/import-jobs/${id}/unrecognized`);

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /import-jobs/:id (dismiss job)', () => {
    it('dismisses a needs_attention job', async () => {
      const job = await importJobs.createJob({});
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });

      const res = await test.request
        .patch(`/import-jobs/${String(job.id)}`)
        .send({ status: 'dismissed' });

      expect(res.status).toBe(200);
      const body = res.body as ImportJobDetailBody;
      expect(body.status).toBe('dismissed');
      expect(body.unrecognizedItems).toEqual([]);
    });

    it('is idempotent for an already-dismissed job', async () => {
      const job = await importJobs.createJob({});
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });
      await test.request
        .patch(`/import-jobs/${String(job.id)}`)
        .send({ status: 'dismissed' });

      const res = await test.request
        .patch(`/import-jobs/${String(job.id)}`)
        .send({ status: 'dismissed' });

      expect(res.status).toBe(200);
      expect((res.body as ImportJobDetailBody).status).toBe('dismissed');
    });

    it.each(['queued', 'processing', 'done'] as const)(
      'refuses to dismiss a %s job with 409',
      async (status) => {
        const job = await importJobs.createJob({});
        if (status === 'processing') {
          await importJobs.markProcessing(job.id);
        } else if (status === 'done') {
          await importJobs.markCompleted(job.id, {
            recognizedCount: 1,
            importedCount: 1,
            unrecognizedCount: 0,
          });
        }

        const res = await test.request
          .patch(`/import-jobs/${String(job.id)}`)
          .send({ status: 'dismissed' });

        expect(res.status).toBe(409);
      },
    );

    it('returns 404 for an unknown job', async () => {
      const res = await test.request
        .patch('/import-jobs/999999')
        .send({ status: 'dismissed' });

      expect(res.status).toBe(404);
    });

    it.each([
      ['missing status', {}],
      ['status other than dismissed', { status: 'done' }],
      ['non-whitelisted field', { status: 'dismissed', extra: true }],
    ])('rejects %s with 400', async (_name, body) => {
      const job = await importJobs.createJob({});

      const res = await test.request
        .patch(`/import-jobs/${String(job.id)}`)
        .send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /import-jobs/:id/unrecognized/:itemId', () => {
    it('stamps dismissedAt on the item', async () => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'Foo',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 1,
      });

      const res = await test.request
        .patch(`/import-jobs/${String(job.id)}/unrecognized/${String(item.id)}`)
        .send({ dismissed: true });

      expect(res.status).toBe(200);
      const body = res.body as UnrecognizedItemBody;
      expect(body.id).toBe(item.id);
      expect(body.importJobId).toBe(job.id);
      expect(body.dismissedAt).not.toBeNull();

      // The review queue no longer lists it.
      const queue = (
        await test.request.get(`/import-jobs/${String(job.id)}/unrecognized`)
      ).body as UnrecognizedItemBody[];
      expect(queue).toEqual([]);
    });

    it('is idempotent for an already-dismissed item', async () => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'Foo',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 1,
      });
      const first = await test.request
        .patch(`/import-jobs/${String(job.id)}/unrecognized/${String(item.id)}`)
        .send({ dismissed: true });
      expect(first.status).toBe(200);

      const second = await test.request
        .patch(`/import-jobs/${String(job.id)}/unrecognized/${String(item.id)}`)
        .send({ dismissed: true });

      expect(second.status).toBe(200);
      const body = second.body as UnrecognizedItemBody;
      expect(body.dismissedAt).toBe(
        (first.body as UnrecognizedItemBody).dismissedAt,
      );
    });

    it('returns 404 for an unknown job', async () => {
      const res = await test.request
        .patch('/import-jobs/999999/unrecognized/1')
        .send({ dismissed: true });

      expect(res.status).toBe(404);
    });

    it('returns 404 for an unknown item', async () => {
      const job = await importJobs.createJob({});

      const res = await test.request
        .patch(`/import-jobs/${String(job.id)}/unrecognized/999999`)
        .send({ dismissed: true });

      expect(res.status).toBe(404);
    });

    it('returns 404 when the item belongs to another job', async () => {
      const job1 = await importJobs.createJob({});
      const job2 = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job2.id, {
        rawTitle: 'Foo',
      });

      const res = await test.request
        .patch(
          `/import-jobs/${String(job1.id)}/unrecognized/${String(item.id)}`,
        )
        .send({ dismissed: true });

      expect(res.status).toBe(404);
    });

    it.each([
      ['dismissed false', { dismissed: false }],
      ['missing dismissed', {}],
      ['non-boolean dismissed', { dismissed: 'yes' }],
      ['non-whitelisted field', { dismissed: true, extra: 1 }],
    ])('rejects %s with 400', async (_name, body) => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'Foo',
      });

      const res = await test.request
        .patch(`/import-jobs/${String(job.id)}/unrecognized/${String(item.id)}`)
        .send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('pipeline surface (service-level, real database)', () => {
    it('createJob: queued by default, declaredCount persisted', async () => {
      const bare = await importJobs.createJob({});
      expect(bare.status).toBe('queued');
      expect(bare.declaredCount).toBeNull();
      expect(bare.recognizedCount).toBe(0);
      expect(bare.completedAt).toBeNull();

      const declared = await importJobs.createJob({ declaredCount: 12 });
      expect(declared.declaredCount).toBe(12);
    });

    it('markProcessing: queued -> processing, idempotent, 409 on terminal', async () => {
      const job = await importJobs.createJob({});
      await expect(importJobs.markProcessing(job.id)).resolves.toBeUndefined();
      expect(
        (
          await test.prisma.importJob.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).status,
      ).toBe('processing');

      // Idempotent: a BullMQ retry re-enters without clobbering state.
      await expect(importJobs.markProcessing(job.id)).resolves.toBeUndefined();

      await importJobs.markCompleted(job.id, {
        recognizedCount: 1,
        importedCount: 1,
        unrecognizedCount: 0,
      });
      await expect(importJobs.markProcessing(job.id)).rejects.toThrow(
        `Import job ${String(job.id)} is already done; refusing to overwrite a terminal result`,
      );
    });

    it('markCompleted: done when recognized, declared and unflagged all match', async () => {
      const job = await importJobs.createJob({ declaredCount: 2 });
      const updated = await importJobs.markCompleted(job.id, {
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });

      expect(updated.status).toBe('done');
      expect(updated.recognizedCount).toBe(2);
      expect(updated.importedCount).toBe(2);
      expect(updated.unrecognizedCount).toBe(0);
      expect(updated.completedAt).not.toBeNull();
    });

    it('markCompleted: needs_attention on zero recognized, mismatch, or flags', async () => {
      const zero = await importJobs.createJob({});
      const zeroResult = await importJobs.markCompleted(zero.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });
      expect(zeroResult.status).toBe('needs_attention');

      const mismatch = await importJobs.createJob({ declaredCount: 5 });
      const mismatchResult = await importJobs.markCompleted(mismatch.id, {
        recognizedCount: 3,
        importedCount: 3,
        unrecognizedCount: 0,
      });
      expect(mismatchResult.status).toBe('needs_attention');

      const flagged = await importJobs.createJob({});
      const flaggedResult = await importJobs.markCompleted(flagged.id, {
        recognizedCount: 3,
        importedCount: 2,
        unrecognizedCount: 1,
      });
      expect(flaggedResult.status).toBe('needs_attention');
    });

    it('markCompleted: 409 on a terminal job (stays dismissed)', async () => {
      const job = await importJobs.createJob({});
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });
      await importJobs.dismissJob(job.id);

      await expect(
        importJobs.markCompleted(job.id, {
          recognizedCount: 1,
          importedCount: 1,
          unrecognizedCount: 0,
        }),
      ).rejects.toThrow(ConflictException);
      expect(
        (
          await test.prisma.importJob.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).status,
      ).toBe('dismissed');
    });

    it('markFailed: stores the reason and stamps completedAt; 409 on terminal', async () => {
      const job = await importJobs.createJob({});
      const failed = await importJobs.markFailed(
        job.id,
        'LLM request timed out',
      );

      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toBe('LLM request timed out');
      expect(failed.completedAt).not.toBeNull();

      await expect(importJobs.markFailed(job.id, 'again')).rejects.toThrow(
        ConflictException,
      );
    });

    it('addUnrecognizedItem: links the trace row to the job; 404 for unknown job', async () => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'PlayStaton 5',
        rawPlatform: 'PS4',
        reason: 'no candidate passed acceptance',
      });

      expect(item.importJobId).toBe(job.id);
      expect(item.rawTitle).toBe('PlayStaton 5');
      expect(item.rawPlatform).toBe('PS4');
      expect(item.reason).toBe('no candidate passed acceptance');
      expect(item.dismissedAt).toBeNull();

      const bare = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: '???',
      });
      expect(bare.rawPlatform).toBeNull();
      expect(bare.reason).toBeNull();

      await expect(
        importJobs.addUnrecognizedItem(999999, { rawTitle: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
