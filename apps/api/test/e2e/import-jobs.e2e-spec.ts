import type { Server } from 'node:http';
import { ConflictException, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { MISSING_ID, testId } from '../helpers/ids';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import { QueueControlService } from '../../src/queue/queue-control.service';

interface UnrecognizedItemBody {
  id: string;
  importJobId: string;
  rawTitle: string;
  rawPlatform: string | null;
  reason: string | null;
  createdAt: string;
  dismissedAt: string | null;
}

interface ImportJobBody {
  id: string;
  status: string;
  declaredCount: number | null;
  photoRef: string | null;
  batchId: string | null;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  openFlaggedCount: number;
  pendingCount: number;
  needsAttention: boolean;
  declaredCountMismatch: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ImportBatchProgressBody {
  batchId: string;
  total: number;
  queued: number;
  processing: number;
  done: number;
  needsAttention: number;
  failed: number;
  dismissed: number;
  completedCount: number;
  pendingCount: number;
  allCompleted: boolean;
  paused: boolean;
  pauseReason: string | null;
  pauseSource: string | null;
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
  let queueControl: QueueControlService;

  beforeAll(async () => {
    test = await createTestApp();
    importJobs = test.app.get(ImportJobsService);
    queueControl = test.app.get(QueueControlService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    await test.login();
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
      // Sequential creation: parallel inserts would make the UUIDv7 ids land
      // out of array order.
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
        .patch(`/import-jobs/${job.id}/unrecognized/${item1.id}`)
        .send({ dismissed: true });
      expect(dismiss.status).toBe(200);

      const res = await test.request.get(`/import-jobs/${job.id}`);

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
      const res = await test.request.get(`/import-jobs/${MISSING_ID}`);

      expect(res.status).toBe(404);
    });

    it.each(['abc', '0'])('returns 400 for id "%s"', async (id) => {
      const res = await test.request.get(`/import-jobs/${id}`);

      expect(res.status).toBe(400);
    });

    it('rejects a non-UUID id with 400', async () => {
      const res = await test.request.get('/import-jobs/not-a-uuid');

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
        .patch(`/import-jobs/${job.id}/unrecognized/${dismissed.id}`)
        .send({ dismissed: true });
      expect(dismiss.status).toBe(200);

      const res = await test.request.get(`/import-jobs/${job.id}/unrecognized`);

      expect(res.status).toBe(200);
      const body = res.body as UnrecognizedItemBody[];
      expect(body.map((i) => i.id)).toEqual([open.id]);
    });

    it('returns 404 for an unknown job', async () => {
      const res = await test.request.get(
        `/import-jobs/${MISSING_ID}/unrecognized`,
      );

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
        .patch(`/import-jobs/${job.id}`)
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
        .patch(`/import-jobs/${job.id}`)
        .send({ status: 'dismissed' });

      const res = await test.request
        .patch(`/import-jobs/${job.id}`)
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
          .patch(`/import-jobs/${job.id}`)
          .send({ status: 'dismissed' });

        expect(res.status).toBe(409);
      },
    );

    it('returns 404 for an unknown job', async () => {
      const res = await test.request
        .patch(`/import-jobs/${MISSING_ID}`)
        .send({ status: 'dismissed' });

      expect(res.status).toBe(404);
    });

    it.each([
      ['missing status', {}],
      ['status other than dismissed', { status: 'done' }],
      ['non-whitelisted field', { status: 'dismissed', extra: true }],
    ])('rejects %s with 400', async (_name, body) => {
      const job = await importJobs.createJob({});

      const res = await test.request.patch(`/import-jobs/${job.id}`).send(body);

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
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });

      expect(res.status).toBe(200);
      const body = res.body as UnrecognizedItemBody;
      expect(body.id).toBe(item.id);
      expect(body.importJobId).toBe(job.id);
      expect(body.dismissedAt).not.toBeNull();

      // The review queue no longer lists it.
      const queue = (
        await test.request.get(`/import-jobs/${job.id}/unrecognized`)
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
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });
      expect(first.status).toBe(200);

      const second = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });

      expect(second.status).toBe(200);
      const body = second.body as UnrecognizedItemBody;
      expect(body.dismissedAt).toBe(
        (first.body as UnrecognizedItemBody).dismissedAt,
      );
    });

    it('returns 404 for an unknown job', async () => {
      const res = await test.request
        .patch(`/import-jobs/${MISSING_ID}/unrecognized/${testId(1)}`)
        .send({ dismissed: true });

      expect(res.status).toBe(404);
    });

    it('returns 404 for an unknown item', async () => {
      const job = await importJobs.createJob({});

      const res = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${MISSING_ID}`)
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
        .patch(`/import-jobs/${job1.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });

      expect(res.status).toBe(404);
    });

    it('rejects a malformed itemId with 400', async () => {
      const job = await importJobs.createJob({});

      const res = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/not-a-uuid`)
        .send({ dismissed: true });

      expect(res.status).toBe(400);
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
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send(body);

      expect(res.status).toBe(400);
    });
  });

  describe('computed progress fields (ticket 3.6)', () => {
    it('detail: a declared mismatch surfaces needsAttention + declaredCountMismatch', async () => {
      const job = await importJobs.createJob({ declaredCount: 5 });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 3,
        importedCount: 3,
        unrecognizedCount: 0,
      });

      const res = await test.request.get(`/import-jobs/${job.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        needsAttention: true,
        declaredCountMismatch: true,
        pendingCount: 0,
        batchId: null,
      });
      // AC5: the removed queue-state fields must not resurface on the wire.
      expect(res.body).not.toHaveProperty('queueState');
      expect(res.body).not.toHaveProperty('bullJobId');
    });

    it('detail: a clean done job has both flags false', async () => {
      const job = await importJobs.createJob({ declaredCount: 2 });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 2,
        importedCount: 2,
        unrecognizedCount: 0,
      });

      const res = await test.request.get(`/import-jobs/${job.id}`);

      expect(res.body).toMatchObject({
        status: 'done',
        needsAttention: false,
        declaredCountMismatch: false,
        pendingCount: 0,
      });
    });

    it('detail: a failed job exposes its reason and unresolved count', async () => {
      const job = await importJobs.createJob({ declaredCount: 12 });
      await importJobs.markFailed(job.id, 'LLM request timed out', {
        recognizedCount: 12,
        importedCount: 10,
        unrecognizedCount: 0,
      });

      const res = await test.request.get(`/import-jobs/${job.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'failed',
        errorMessage: 'LLM request timed out',
        pendingCount: 2,
        needsAttention: false,
      });
    });
  });

  describe('review settles the job (open flagged items)', () => {
    it('settles a needs_attention job once the last flagged item is reviewed', async () => {
      const job = await importJobs.createJob({ batchId: 'batch-settle' });
      const item1 = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'One',
      });
      const item2 = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'Two',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 3,
        importedCount: 1,
        unrecognizedCount: 2,
      });

      const first = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item1.id}`)
        .send({ dismissed: true });
      expect(first.status).toBe(200);

      const detailBefore = await test.request.get(`/import-jobs/${job.id}`);
      expect(detailBefore.body).toMatchObject({
        status: 'needs_attention',
        needsAttention: true,
        unrecognizedCount: 2,
        openFlaggedCount: 1,
      });
      const batchBefore = await test.request.get(
        '/import-jobs/batches/batch-settle',
      );
      expect(batchBefore.body).toMatchObject({ needsAttention: 1, done: 0 });

      const second = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item2.id}`)
        .send({ dismissed: true });
      expect(second.status).toBe(200);

      const detailAfter = await test.request.get(`/import-jobs/${job.id}`);
      expect(detailAfter.body).toMatchObject({
        status: 'done',
        needsAttention: false,
        unrecognizedCount: 2,
        openFlaggedCount: 0,
        declaredCountMismatch: false,
      });
      const batchAfter = await test.request.get(
        '/import-jobs/batches/batch-settle',
      );
      expect(batchAfter.body).toMatchObject({
        needsAttention: 0,
        done: 1,
        allCompleted: true,
      });

      const list = (
        await test.request
          .get('/import-jobs')
          .query({ batchId: 'batch-settle' })
      ).body as ImportJobsListBody;
      expect(list.items[0]?.openFlaggedCount).toBe(0);
    });

    it('keeps needs_attention when the declared count still differs', async () => {
      const job = await importJobs.createJob({ declaredCount: 5 });
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'One',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 3,
        importedCount: 2,
        unrecognizedCount: 1,
      });

      const res = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });
      expect(res.status).toBe(200);

      const detail = await test.request.get(`/import-jobs/${job.id}`);
      expect(detail.body).toMatchObject({
        status: 'needs_attention',
        openFlaggedCount: 0,
        declaredCountMismatch: true,
      });
    });

    it('keeps needs_attention when nothing was recognized', async () => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'One',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 1,
      });

      const res = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });
      expect(res.status).toBe(200);

      const detail = await test.request.get(`/import-jobs/${job.id}`);
      expect(detail.body).toMatchObject({ status: 'needs_attention' });
    });

    it('leaves a failed job failed but reports no open items', async () => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'One',
      });
      await importJobs.markFailed(job.id, 'boom', {
        recognizedCount: 2,
        importedCount: 1,
        unrecognizedCount: 1,
      });

      const res = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });
      expect(res.status).toBe(200);

      const detail = await test.request.get(`/import-jobs/${job.id}`);
      expect(detail.body).toMatchObject({
        status: 'failed',
        openFlaggedCount: 0,
      });
    });

    it('self-heals an already-settled needs_attention row on a re-dismiss', async () => {
      const job = await importJobs.createJob({});
      const item = await importJobs.addUnrecognizedItem(job.id, {
        rawTitle: 'One',
      });
      await importJobs.markCompleted(job.id, {
        recognizedCount: 2,
        importedCount: 1,
        unrecognizedCount: 1,
      });
      // A pre-fix review: the item was dismissed but the job was never settled.
      await test.prisma.unrecognizedItem.update({
        where: { id: item.id },
        data: { dismissedAt: new Date() },
      });

      const before = await test.request.get(`/import-jobs/${job.id}`);
      expect(before.body).toMatchObject({
        status: 'needs_attention',
        openFlaggedCount: 0,
      });

      const again = await test.request
        .patch(`/import-jobs/${job.id}/unrecognized/${item.id}`)
        .send({ dismissed: true });
      expect(again.status).toBe(200);

      const after = await test.request.get(`/import-jobs/${job.id}`);
      expect(after.body).toMatchObject({ status: 'done' });
    });
  });

  describe('GET /import-jobs?batchId=', () => {
    it('returns only jobs from the requested batch', async () => {
      const a1 = await importJobs.createJob({ batchId: 'batch-a' });
      const a2 = await importJobs.createJob({ batchId: 'batch-a' });
      await importJobs.createJob({ batchId: 'batch-b' });

      const res = await test.request
        .get('/import-jobs')
        .query({ batchId: 'batch-a' });

      expect(res.status).toBe(200);
      const body = res.body as ImportJobsListBody;
      expect(body.items.map((j) => j.id).sort()).toEqual([a1.id, a2.id].sort());
      expect(body.meta.total).toBe(2);
    });

    it('rejects a batchId longer than 64 chars with 400', async () => {
      const res = await test.request
        .get('/import-jobs')
        .query({ batchId: 'x'.repeat(65) });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /import-jobs/batches/:batchId', () => {
    it('aggregates the batch into an X-of-Y model', async () => {
      await importJobs.createJob({ batchId: 'batch-x' });
      const processing = await importJobs.createJob({ batchId: 'batch-x' });
      await importJobs.markProcessing(processing.id);
      const done = await importJobs.createJob({ batchId: 'batch-x' });
      await importJobs.markCompleted(done.id, {
        recognizedCount: 1,
        importedCount: 1,
        unrecognizedCount: 0,
      });
      const attention = await importJobs.createJob({ batchId: 'batch-x' });
      await importJobs.markCompleted(attention.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });
      const failed = await importJobs.createJob({ batchId: 'batch-x' });
      await importJobs.markFailed(failed.id, 'boom');
      const dismissed = await importJobs.createJob({ batchId: 'batch-x' });
      await importJobs.markCompleted(dismissed.id, {
        recognizedCount: 0,
        importedCount: 0,
        unrecognizedCount: 0,
      });
      await importJobs.dismissJob(dismissed.id);

      const res = await test.request.get('/import-jobs/batches/batch-x');

      expect(res.status).toBe(200);
      const body = res.body as ImportBatchProgressBody;
      expect(body).toEqual({
        batchId: 'batch-x',
        total: 6,
        queued: 1,
        processing: 1,
        done: 1,
        needsAttention: 1,
        failed: 1,
        dismissed: 1,
        completedCount: 4,
        pendingCount: 2,
        allCompleted: false,
        paused: false,
        pauseReason: null,
        pauseSource: null,
      });
    });

    it('reports the paused state and its reason', async () => {
      await importJobs.createJob({ batchId: 'batch-paused' });
      try {
        await queueControl.pauseForConfig(
          'igdb',
          'IGDB rejected the credentials',
        );

        const res = await test.request.get('/import-jobs/batches/batch-paused');

        expect(res.status).toBe(200);
        const body = res.body as ImportBatchProgressBody;
        expect(body).toMatchObject({
          paused: true,
          pauseReason: 'IGDB rejected the credentials',
          pauseSource: 'igdb',
        });
      } finally {
        await queueControl.resume();
      }
    });

    it('returns 404 for an unknown batch', async () => {
      const res = await test.request.get('/import-jobs/batches/nope');

      expect(res.status).toBe(404);
    });

    it('returns 400 for a batchId longer than 64 chars', async () => {
      const res = await test.request.get(
        `/import-jobs/batches/${'x'.repeat(65)}`,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('POST /import-jobs/:id/retry (validation only)', () => {
    it('returns 404 for an unknown job', async () => {
      const res = await test.request.post(`/import-jobs/${MISSING_ID}/retry`);

      expect(res.status).toBe(404);
    });

    it.each(['queued', 'processing', 'done', 'dismissed'] as const)(
      'returns 409 for a %s job without enqueueing',
      async (status) => {
        const job = await importJobs.createJob({ photoRef: 'p.png' });
        if (status === 'processing') {
          await importJobs.markProcessing(job.id);
        } else if (status === 'done') {
          await importJobs.markCompleted(job.id, {
            recognizedCount: 1,
            importedCount: 1,
            unrecognizedCount: 0,
          });
        } else if (status === 'dismissed') {
          await importJobs.markCompleted(job.id, {
            recognizedCount: 0,
            importedCount: 0,
            unrecognizedCount: 0,
          });
          await importJobs.dismissJob(job.id);
        }

        const res = await test.request.post(`/import-jobs/${job.id}/retry`);

        expect(res.status).toBe(409);
        const row = await test.prisma.importJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(row.status).toBe(status);
        // A refused retry must not have made the row runnable.
        expect(row.nextRunAt).toBeNull();
      },
    );

    it('returns 409 for a failed job with no stored photo', async () => {
      const job = await importJobs.createJob({});
      await importJobs.markFailed(job.id, 'boom');

      const res = await test.request.post(`/import-jobs/${job.id}/retry`);

      expect(res.status).toBe(409);
      const row = await test.prisma.importJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.status).toBe('failed');
    });
  });

  describe('POST /import-jobs/resume', () => {
    it('resumes a paused queue and is idempotent', async () => {
      await queueControl.pauseForConfig(
        'igdb',
        'IGDB rejected the credentials',
      );
      expect(await queueControl.isPaused()).toBe(true);

      const res = await test.request.post('/import-jobs/resume');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        paused: false,
        reason: null,
        source: null,
      });
      expect(await queueControl.isPaused()).toBe(false);

      const again = await test.request.post('/import-jobs/resume');
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ paused: false });
    });

    it('requires authentication (401)', async () => {
      const server = test.app.getHttpServer() as Server;
      await request.agent(server).post('/import-jobs/resume').expect(401);
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

      // Idempotent: a worker retry re-enters without clobbering state.
      await expect(importJobs.markProcessing(job.id)).resolves.toBeUndefined();

      await importJobs.markCompleted(job.id, {
        recognizedCount: 1,
        importedCount: 1,
        unrecognizedCount: 0,
      });
      await expect(importJobs.markProcessing(job.id)).rejects.toThrow(
        `Import job ${job.id} is already done; refusing to overwrite a terminal result`,
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
        importJobs.addUnrecognizedItem(MISSING_ID, { rawTitle: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
