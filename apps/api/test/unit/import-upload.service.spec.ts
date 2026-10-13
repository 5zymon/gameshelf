import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ImportJobsService } from '../../src/import-jobs/import-jobs.service';
import {
  ImportUploadService,
  parseDeclaredCounts,
} from '../../src/import-jobs/import-upload.service';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { LlmSettingsService } from '../../src/settings/llm-settings.service';
import { testId } from '../helpers/ids';

function uploadedFile(name: string): Express.Multer.File {
  return {
    originalname: name,
    mimetype: 'image/png',
    buffer: Buffer.from(name),
  } as Express.Multer.File;
}

interface Mocks {
  jobs: {
    createJob: jest.Mock;
  };
  storage: { store: jest.Mock };
  llm: { isConfigured: jest.Mock };
}

function createService(): { service: ImportUploadService; mocks: Mocks } {
  const mocks: Mocks = {
    jobs: {
      createJob: jest.fn(),
    },
    storage: { store: jest.fn() },
    llm: { isConfigured: jest.fn().mockResolvedValue(true) },
  };
  const service = new ImportUploadService(
    mocks.jobs as unknown as ImportJobsService,
    mocks.storage as unknown as PhotoStorageService,
    mocks.llm as unknown as LlmSettingsService,
  );
  return { service, mocks };
}

/** store/createJob return distinct, incrementing identities. */
function stubHappyPath(mocks: Mocks): void {
  let rowId = 0;
  mocks.storage.store.mockImplementation((file: Express.Multer.File) =>
    Promise.resolve(`${file.originalname}.stored`),
  );
  mocks.jobs.createJob.mockImplementation(() => {
    rowId += 1;
    return Promise.resolve({
      id: testId(rowId),
      status: 'queued',
      declaredCount: null,
      photoRef: null,
    });
  });
}

describe('ImportUploadService (unit)', () => {
  let service: ImportUploadService;
  let mocks: Mocks;

  beforeEach(() => {
    ({ service, mocks } = createService());
  });

  it('stores and creates one runnable queued row per file', async () => {
    stubHappyPath(mocks);
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) =>
      uploadedFile(`${n}.png`),
    );

    const result = await service.startUpload(files, undefined);

    expect(mocks.storage.store).toHaveBeenCalledTimes(5);
    expect(mocks.jobs.createJob).toHaveBeenCalledTimes(5);
    expect(mocks.jobs.createJob).toHaveBeenNthCalledWith(1, {
      declaredCount: null,
      photoRef: 'a.png.stored',
      batchId: expect.any(String) as string,
      enqueue: true,
    });
    expect(result.jobs).toHaveLength(5);
    expect(result.jobs.every((job) => job.status === 'queued')).toBe(true);
    // The row is the queue entry: jobId equals id (ADR-005, ADR-006).
    expect(result.jobs.map((job) => job.jobId)).toEqual(
      result.jobs.map((job) => job.id),
    );
    expect(result.batchId).toEqual(expect.any(String));
    expect(result.batchId).not.toBe('');
    // Every photo shares the one batch id from this request.
    const createCalls = mocks.jobs.createJob.mock.calls as [
      { batchId: string },
    ][];
    expect(
      createCalls.every((call) => call[0].batchId === result.batchId),
    ).toBe(true);
  });

  it('treats an omitted declared count as all-null', async () => {
    stubHappyPath(mocks);

    await service.startUpload([uploadedFile('a.png')], undefined);

    expect(mocks.jobs.createJob).toHaveBeenCalledWith({
      declaredCount: null,
      photoRef: 'a.png.stored',
      batchId: expect.any(String) as string,
      enqueue: true,
    });
  });

  it('leaves trailing photos undeclared when fewer counts than files are sent', async () => {
    stubHappyPath(mocks);
    const files = ['a', 'b', 'c'].map((n) => uploadedFile(`${n}.png`));

    await service.startUpload(files, ['7']);

    expect(mocks.jobs.createJob).toHaveBeenNthCalledWith(1, {
      declaredCount: 7,
      photoRef: 'a.png.stored',
      batchId: expect.any(String) as string,
      enqueue: true,
    });
    expect(mocks.jobs.createJob).toHaveBeenNthCalledWith(2, {
      declaredCount: null,
      photoRef: 'b.png.stored',
      batchId: expect.any(String) as string,
      enqueue: true,
    });
    expect(mocks.jobs.createJob).toHaveBeenNthCalledWith(3, {
      declaredCount: null,
      photoRef: 'c.png.stored',
      batchId: expect.any(String) as string,
      enqueue: true,
    });
  });

  it('persists a provided declared count', async () => {
    stubHappyPath(mocks);

    await service.startUpload([uploadedFile('a.png')], ['3']);

    expect(mocks.jobs.createJob).toHaveBeenCalledWith({
      declaredCount: 3,
      photoRef: 'a.png.stored',
      batchId: expect.any(String) as string,
      enqueue: true,
    });
  });

  it('rejects more counts than files with 400 before storing anything', async () => {
    const files = ['a', 'b'].map((n) => uploadedFile(`${n}.png`));

    await expect(service.startUpload(files, ['1', '2', '3'])).rejects.toThrow(
      BadRequestException,
    );
    expect(mocks.storage.store).not.toHaveBeenCalled();
    expect(mocks.jobs.createJob).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'abc', '1.5'])(
    'rejects declared count "%s" with 400',
    async (value) => {
      await expect(
        service.startUpload([uploadedFile('a.png')], [value]),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.jobs.createJob).not.toHaveBeenCalled();
    },
  );

  it('refuses with 503 and touches nothing when no LLM is configured', async () => {
    mocks.llm.isConfigured.mockResolvedValue(false);

    await expect(
      service.startUpload([uploadedFile('a.png')], undefined),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(mocks.storage.store).not.toHaveBeenCalled();
    expect(mocks.jobs.createJob).not.toHaveBeenCalled();
  });

  it('rejects an empty upload with 400', async () => {
    await expect(service.startUpload([], undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(mocks.storage.store).not.toHaveBeenCalled();
  });
});

describe('parseDeclaredCounts (unit)', () => {
  it('returns all-null for an absent or empty field', () => {
    expect(parseDeclaredCounts(undefined, 3)).toEqual([null, null, null]);
    expect(parseDeclaredCounts([], 3)).toEqual([null, null, null]);
  });

  it('parses integers and treats empty entries as undeclared', () => {
    expect(parseDeclaredCounts(['2', '', '4'], 3)).toEqual([2, null, 4]);
  });

  it('pads missing trailing entries with null', () => {
    expect(parseDeclaredCounts(['2'], 4)).toEqual([2, null, null, null]);
  });

  it('accepts the boundaries 1 and 1000', () => {
    expect(parseDeclaredCounts(['1'], 1)).toEqual([1]);
    expect(parseDeclaredCounts(['1000'], 1)).toEqual([1000]);
  });

  it('rejects more entries than files', () => {
    expect(() => parseDeclaredCounts(['1', '2', '3', '4'], 3)).toThrow(
      BadRequestException,
    );
  });

  it.each(['0', '1001', 'abc', '-1', '1.5'])(
    'rejects invalid entry "%s"',
    (value) => {
      expect(() => parseDeclaredCounts([value], 1)).toThrow(
        BadRequestException,
      );
    },
  );
});
