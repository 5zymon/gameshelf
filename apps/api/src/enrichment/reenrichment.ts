import type { Prisma } from '../generated/prisma/client';
import type { EnrichedGameData } from './game-enrichment.service';

/**
 * Hand-editable metadata fields whose provenance is tracked. `title`,
 * `platformId`, and `edition` are deliberately excluded: re-enrichment never
 * touches them, so they need no provenance marker.
 */
export const TRACKED_METADATA_FIELDS = [
  'releaseYear',
  'publisher',
  'genre',
  'playerCount',
  'coverUrl',
] as const;

export type TrackedMetadataField = (typeof TRACKED_METADATA_FIELDS)[number];

const TRACKED_FIELD_SET: ReadonlySet<string> = new Set(TRACKED_METADATA_FIELDS);

/**
 * Parses the persisted provenance column into a de-duplicated, sorted list of
 * known field names. Tolerates every shape the value can reach us as: the raw
 * Prisma `String?` column (a JSON array), an already-parsed array (the
 * `GameDetailModel`), and `null`/garbage (→ `[]`). Unknown names are dropped.
 */
export function parseEditedFields(value: unknown): TrackedMetadataField[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const fields = new Set<string>();
  for (const entry of parsed as unknown[]) {
    if (typeof entry === 'string' && TRACKED_FIELD_SET.has(entry)) {
      fields.add(entry);
    }
  }
  return [...fields].sort() as TrackedMetadataField[];
}

/**
 * Serializes a provenance list back to the persisted `String?` column:
 * `JSON.stringify` of the sorted, unique, known field names (unknown names and
 * duplicates are dropped).
 */
export function serializeEditedFields(fields: Iterable<string>): string {
  const unique = new Set<string>();
  for (const field of fields) {
    if (TRACKED_FIELD_SET.has(field)) {
      unique.add(field);
    }
  }
  return JSON.stringify([...unique].sort());
}

/** The parsed provenance set used by the merge policy. */
export function toEditedFields(value: unknown): Set<TrackedMetadataField> {
  return new Set(parseEditedFields(value));
}

/** Union of the persisted provenance and a newly edited set, sorted. */
export function mergeEditedFields(
  existing: unknown,
  added: Iterable<string>,
): TrackedMetadataField[] {
  const merged = new Set<string>(parseEditedFields(existing));
  for (const field of added) {
    if (TRACKED_FIELD_SET.has(field)) {
      merged.add(field);
    }
  }
  return [...merged].sort() as TrackedMetadataField[];
}

/** The existing `Game` row fields the merge policy reads. */
export interface ReenrichmentExisting {
  id: number;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  coverUrl: string | null;
  sourceCoverUrl: string | null;
  rawMetadata: string | null;
  source: string;
  externalId: number | null;
  igdbSlug: string | null;
  platformUnverified: boolean;
  userEditedFields: unknown;
  images: { url: string }[];
}

export interface BuildReenrichmentUpdateInput {
  existing: ReenrichmentExisting;
  enriched: EnrichedGameData;
  editedFields?: ReadonlySet<string>;
}

/**
 * Pure merge policy for re-enriching an **existing** game. Unlike the import
 * create-path (where `null` is correct for a fresh row), re-enrichment never
 * wipes data: a metadata field is only written when the candidate provides a
 * non-null value and the user has not hand-edited it. `title`, `platformId`,
 * and `edition` are never emitted.
 *
 * Returns `null` when no tracked field changes, so the caller performs no write
 * at all (record idempotency — `enrichedAt` is only stamped on a real change).
 */
export function buildReenrichmentUpdate(
  input: BuildReenrichmentUpdateInput,
): Prisma.GameUpdateInput | null {
  const { existing, enriched } = input;
  const edited = input.editedFields ?? new Set<string>();
  const data: Prisma.GameUpdateInput = {};

  if (
    !edited.has('releaseYear') &&
    enriched.releaseYear !== null &&
    enriched.releaseYear !== existing.releaseYear
  ) {
    data.releaseYear = enriched.releaseYear;
  }
  if (
    !edited.has('publisher') &&
    enriched.publisher !== null &&
    enriched.publisher !== existing.publisher
  ) {
    data.publisher = enriched.publisher;
  }
  if (
    !edited.has('genre') &&
    enriched.genre !== null &&
    enriched.genre !== existing.genre
  ) {
    data.genre = enriched.genre;
  }
  if (
    !edited.has('playerCount') &&
    enriched.playerCount !== null &&
    enriched.playerCount !== existing.playerCount
  ) {
    data.playerCount = enriched.playerCount;
  }
  if (
    !edited.has('coverUrl') &&
    enriched.coverUrl !== null &&
    enriched.coverUrl !== existing.coverUrl
  ) {
    data.coverUrl = enriched.coverUrl;
  }
  // Persist the external link even when the download failed (coverUrl stays
  // null), so the background sweep / `covers:redownload` can retry it later.
  if (
    !edited.has('coverUrl') &&
    enriched.sourceCoverUrl !== null &&
    enriched.sourceCoverUrl !== existing.sourceCoverUrl
  ) {
    data.sourceCoverUrl = enriched.sourceCoverUrl;
  }
  if (enriched.source !== existing.source) {
    data.source = enriched.source;
  }
  if (enriched.externalId !== existing.externalId) {
    data.externalId = enriched.externalId;
  }
  if (enriched.igdbSlug !== existing.igdbSlug) {
    data.igdbSlug = enriched.igdbSlug;
  }
  if (existing.platformUnverified) {
    data.platformUnverified = false;
  }

  // Gallery: source-derived only (no manual gallery editing exists), so it is
  // replaced when the candidate supplies a non-empty, different gallery and is
  // never wiped when the candidate supplies none. Identical order writes nothing.
  if (
    enriched.images.length > 0 &&
    !sameOrderedUrls(existing.images, enriched.images)
  ) {
    data.images = {
      deleteMany: {},
      create: enriched.images.map((image, index) => ({
        position: index,
        url: image.url,
        sourceUrl: image.sourceUrl,
      })),
    };
  }

  if (Object.keys(data).length === 0) {
    return null;
  }

  // The archival payload and the enrichment timestamp accompany a real change.
  data.rawMetadata = enriched.rawMetadata;
  data.enrichedAt = enriched.enrichedAt;
  return data;
}

/** True when two galleries have the same length and URL at every position. */
function sameOrderedUrls(
  a: readonly { url: string }[],
  b: readonly { url: string }[],
): boolean {
  return (
    a.length === b.length && a.every((entry, i) => entry.url === b[i]?.url)
  );
}
