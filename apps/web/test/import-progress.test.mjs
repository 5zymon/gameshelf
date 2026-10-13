import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

/**
 * Tests for `lib/import/progress.ts` — the pure helpers that turn an
 * `ImportJob` row into the one state each photo gets on the progress page
 * (chip, summary, why line, actions) and into the batch counters.
 *
 * The source is TypeScript with the `@/*` alias and extensionless relative
 * imports (Bundler resolution) that Node's ESM loader does not understand, so
 * we register a small `resolve` hook that maps `@/x` to `src/x` and appends
 * `.ts`/`/index.ts` to relative specifiers (same pattern as
 * `re-enrich.test.mjs`). `progress.ts` imports only types, which Node strips.
 */
const SRC_BASE = new URL('../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidates = null;
    if (specifier.startsWith('@/')) {
      const rel = specifier.slice(2);
      candidates = [
        new URL(`${rel}.ts`, SRC_BASE),
        new URL(`${rel}/index.ts`, SRC_BASE),
      ];
    } else if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL
    ) {
      const dir = new URL('.', context.parentURL);
      candidates = [
        new URL(`${specifier}.ts`, dir),
        new URL(`${specifier}/index.ts`, dir),
      ];
    }
    if (candidates) {
      for (const candidate of candidates) {
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  PLATFORM_NOT_IN_CATALOG_REASON,
  batchCounts,
  canDismissPhoto,
  flaggedItemReason,
  isTerminalStatus,
  mismatchDirection,
  needsDecision,
  photoReviewCounts,
  photoState,
} = await import('../src/lib/import/progress.ts');

/** An import job; tests override only the fields under test. */
function job(overrides = {}) {
  return {
    id: '01990000-0000-7000-8000-000000000001',
    status: 'done',
    declaredCount: null,
    photoRef: null,
    recognizedCount: 3,
    importedCount: 3,
    unrecognizedCount: 0,
    openFlaggedCount: 0,
    errorMessage: null,
    createdAt: '2026-10-14T00:00:00.000Z',
    completedAt: '2026-10-14T00:01:00.000Z',
    batchId: 'batch-1',
    pendingCount: 0,
    needsAttention: false,
    declaredCountMismatch: false,
    ...overrides,
  };
}

/** A flagged item; tests override only the fields under test. */
function item(overrides = {}) {
  return {
    id: '01990000-0000-7000-8000-000000000101',
    importJobId: '01990000-0000-7000-8000-000000000001',
    rawTitle: 'PlayStaton 5',
    rawPlatform: 'PS4',
    reason: null,
    createdAt: '2026-10-14T00:00:00.000Z',
    dismissedAt: null,
    candidates: [],
    ...overrides,
  };
}

/** The batch aggregate as the API returns it. */
function batch(overrides = {}) {
  return {
    batchId: 'batch-1',
    total: 1,
    queued: 0,
    processing: 0,
    done: 1,
    needsAttention: 0,
    failed: 0,
    dismissed: 0,
    completedCount: 1,
    pendingCount: 0,
    allCompleted: true,
    paused: false,
    pauseReason: null,
    pauseSource: null,
    ...overrides,
  };
}

test('photoState: one state per durable status', () => {
  assert.equal(photoState(job({ status: 'queued' })), 'queued');
  assert.equal(photoState(job({ status: 'processing' })), 'processing');
  assert.equal(photoState(job({ status: 'failed' })), 'failed');
  assert.equal(photoState(job({ status: 'dismissed' })), 'dismissed');
  assert.equal(photoState(job({ status: 'done' })), 'ready');
});

test('photoState: needs_attention splits by what still needs a decision', () => {
  const base = { status: 'needs_attention', needsAttention: true };

  // Open flagged titles win over every other trigger.
  assert.equal(
    photoState(
      job({
        ...base,
        openFlaggedCount: 2,
        recognizedCount: 0,
        declaredCountMismatch: true,
      }),
    ),
    'unmatched',
  );
  // Nothing recognized.
  assert.equal(
    photoState(
      job({
        ...base,
        recognizedCount: 0,
      }),
    ),
    'nothingFound',
  );
  // Declared count differs from what was recognized.
  assert.equal(
    photoState(
      job({
        ...base,
        recognizedCount: 4,
        declaredCount: 6,
        declaredCountMismatch: true,
      }),
    ),
    'countMismatch',
  );
});

test('photoState: a pre-fix needs_attention row with nothing open reads as ready', () => {
  assert.equal(
    photoState(
      job({
        status: 'needs_attention',
        needsAttention: true,
        recognizedCount: 3,
        openFlaggedCount: 0,
        declaredCountMismatch: false,
      }),
    ),
    'ready',
  );
});

test('needsDecision: true only for the four decision states', () => {
  assert.equal(needsDecision('failed'), true);
  assert.equal(needsDecision('unmatched'), true);
  assert.equal(needsDecision('nothingFound'), true);
  assert.equal(needsDecision('countMismatch'), true);
  assert.equal(needsDecision('queued'), false);
  assert.equal(needsDecision('processing'), false);
  assert.equal(needsDecision('ready'), false);
  assert.equal(needsDecision('dismissed'), false);
});

test('isTerminalStatus: everything past queued/processing', () => {
  assert.equal(isTerminalStatus('queued'), false);
  assert.equal(isTerminalStatus('processing'), false);
  assert.equal(isTerminalStatus('done'), true);
  assert.equal(isTerminalStatus('needs_attention'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('dismissed'), true);
});

test('canDismissPhoto: mirrors the API dismissJob guard', () => {
  assert.equal(canDismissPhoto(job({ status: 'needs_attention' })), true);
  assert.equal(canDismissPhoto(job({ status: 'failed' })), true);
  assert.equal(canDismissPhoto(job({ status: 'queued' })), false);
  assert.equal(canDismissPhoto(job({ status: 'processing' })), false);
  assert.equal(canDismissPhoto(job({ status: 'done' })), false);
  assert.equal(canDismissPhoto(job({ status: 'dismissed' })), false);
});

test('photoReviewCounts: reviewed is unrecognized minus what is still open', () => {
  assert.deepEqual(
    photoReviewCounts(
      job({ importedCount: 6, unrecognizedCount: 2, openFlaggedCount: 0 }),
    ),
    { added: 6, open: 0, reviewed: 2 },
  );
  assert.deepEqual(
    photoReviewCounts(
      job({ importedCount: 1, unrecognizedCount: 3, openFlaggedCount: 1 }),
    ),
    { added: 1, open: 1, reviewed: 2 },
  );
});

test('photoReviewCounts: reviewed never goes negative', () => {
  assert.deepEqual(
    photoReviewCounts(
      job({ importedCount: 0, unrecognizedCount: 1, openFlaggedCount: 3 }),
    ),
    { added: 0, open: 3, reviewed: 0 },
  );
});

test('photoReviewCounts: a dismissed photo has nothing open', () => {
  // A dismissed photo stops asking for a decision (`open` 0), while `reviewed`
  // still comes from the raw open count — the copy for it says "You dismissed
  // this photo." rather than claiming the titles were reviewed.
  assert.deepEqual(
    photoReviewCounts(
      job({
        status: 'dismissed',
        importedCount: 2,
        unrecognizedCount: 3,
        openFlaggedCount: 3,
      }),
    ),
    { added: 2, open: 0, reviewed: 0 },
  );
});

test('batchCounts: sums added and open flagged titles, failures from the aggregate', () => {
  const items = [
    job({ importedCount: 3, openFlaggedCount: 1 }),
    job({ importedCount: 2, openFlaggedCount: 2 }),
  ];
  assert.deepEqual(batchCounts(items, batch({ failed: 1 })), {
    added: 5,
    toReview: 3,
    failed: 1,
  });
});

test('batchCounts: all reviewed titles are not counted as to review', () => {
  // The reported case: imported 6, unrecognized 2, both reviewed.
  const items = [
    job({ importedCount: 6, unrecognizedCount: 2, openFlaggedCount: 0 }),
  ];
  assert.deepEqual(batchCounts(items, batch()), {
    added: 6,
    toReview: 0,
    failed: 0,
  });
});

test('batchCounts: a dismissed photo contributes no open titles', () => {
  const items = [
    job({
      status: 'dismissed',
      importedCount: 1,
      unrecognizedCount: 3,
      openFlaggedCount: 3,
    }),
  ];
  assert.deepEqual(batchCounts(items, batch()), {
    added: 1,
    toReview: 0,
    failed: 0,
  });
});

test('flaggedItemReason: categories never expose provider text', () => {
  assert.equal(flaggedItemReason(item()), 'notFound');
  assert.equal(
    flaggedItemReason(
      item({
        reason:
          'No game matched the title in any source — IGDB: No IGDB game matched the title',
      }),
    ),
    'notFound',
  );
  assert.equal(
    flaggedItemReason(item({ reason: PLATFORM_NOT_IN_CATALOG_REASON })),
    'noPlatform',
  );
  assert.equal(
    flaggedItemReason(
      item({
        reason: 'Multiple IGDB candidates matched equally well — choose one',
        candidates: [
          {
            source: 'IGDB',
            externalId: 18797,
            title: 'Rise of Nations: Rise of Legends',
            slug: null,
            coverUrl: null,
            score: 0.95,
          },
        ],
      }),
    ),
    'ambiguous',
  );
});

test('mismatchDirection: fewer when more games were declared than recognized', () => {
  assert.equal(
    mismatchDirection(job({ declaredCount: 6, recognizedCount: 4 })),
    'fewer',
  );
  assert.equal(
    mismatchDirection(job({ declaredCount: 3, recognizedCount: 4 })),
    'more',
  );
  assert.equal(
    mismatchDirection(job({ declaredCount: null, recognizedCount: 4 })),
    'more',
  );
});
