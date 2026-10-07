/**
 * Shared GameShelf HTTP wire contracts.
 *
 * These types mirror the NestJS response models and query DTOs field-for-field
 * on the wire (JSON): dates are `string`, not `Date`, and nullable fields are
 * `T | null`. The backend DTOs remain the source of truth; this package is the
 * single definition the frontend imports. Drift is guarded by the live-API
 * OpenAPI comparison, not at compile time (the backend DTOs are untouched).
 */

// ── Games ────────────────────────────────────────────────────────────────
export interface GamePlatform {
  id: number;
  name: string;
  slug: string;
}

export interface GameListItem {
  id: number;
  title: string;
  edition: string | null;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  /** NON-nullable: the backend always projects the platform. */
  platform: GamePlatform;
}

/** `Game.source` — mirrored from the Prisma `GameSource` enum. */
export type GameSource = 'IGDB' | 'MobyGames' | 'MANUAL';

export interface GameDetail {
  id: number;
  title: string;
  platformId: number;
  edition: string | null;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  copyCount: number;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  rawMetadata: string | null;
  enrichedAt: string | null;
  source: GameSource;
  externalId: number | null;
  platformUnverified: boolean;
  userEditedFields: string[];
  createdAt: string;
  updatedAt: string;
  platform: GamePlatform;
}

export interface ListGamesMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListGamesFilters {
  platforms: GamePlatform[];
  editions: string[];
}

export interface ListGamesResponse {
  items: GameListItem[];
  meta: ListGamesMeta;
  filters: ListGamesFilters;
}

export type GameSortField = 'title' | 'year' | 'platform' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface ListGamesQuery {
  page?: number;
  limit?: number;
  platformId?: number;
  edition?: string;
  year?: number;
  publisher?: string;
  genre?: string;
  playerCount?: number;
  q?: string;
  sort?: GameSortField;
  order?: SortDirection;
}

export interface SearchGamesQuery {
  q?: string;
}

// ── Enrichment / manual add ──────────────────────────────────────────────
export type CatalogSource = 'IGDB' | 'MobyGames';

export interface EnrichCandidatePlatform {
  igdbId: number | null;
  name: string;
  abbreviation: string | null;
}

export interface EnrichCandidate {
  externalId: number;
  title: string;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  coverUrl: string | null;
  platforms: EnrichCandidatePlatform[];
  source: CatalogSource;
}

export interface GameSearchResponse {
  candidates: EnrichCandidate[];
}

export interface EnrichGameResponse {
  status: 'matched' | 'unrecognized' | 'transient' | 'config_error';
  reason: string | null;
  applied: boolean;
  candidates: EnrichCandidate[];
  game: GameDetail;
}

export interface EnrichCandidateRef {
  source: CatalogSource;
  externalId: number;
}

export interface CreateGameRequest {
  title: string;
  platformId: number;
  edition?: string;
  releaseYear?: number;
  publisher?: string;
  genre?: string;
  playerCount?: number;
  coverUrl?: string;
  candidate?: EnrichCandidateRef;
}

/**
 * `UpdateGameDto extends PartialType(CreateGameDto)`; an explicit `null`
 * clears an optional field (the API's `@IsOptional` lets `null` through).
 */
export type UpdateGameRequest = {
  [K in keyof CreateGameRequest]?: CreateGameRequest[K] | null;
};

export interface EnrichGameRequest {
  candidate?: EnrichCandidateRef;
}

// ── Platforms ────────────────────────────────────────────────────────────
export interface Platform {
  id: number;
  name: string;
  abbreviation: string | null;
  alternativeName: string | null;
  platformFamily: number | null;
  igdbId: number | null;
  slug: string;
  addedByImport: boolean;
  hidden: boolean;
  gameCount: number;
}

export interface CreatePlatformRequest {
  name: string;
}

export interface UpdatePlatformRequest {
  name: string;
  abbreviation?: string | null;
  alternativeName?: string | null;
  igdbId?: number | null;
  hidden?: boolean;
}

export interface MergePlatformRequest {
  targetId: number;
}

// ── Import jobs ──────────────────────────────────────────────────────────
export const IMPORT_JOB_STATUSES = [
  'queued',
  'processing',
  'done',
  'needs_attention',
  'failed',
  'dismissed',
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export type ImportPauseSource = 'llm' | 'igdb';

export interface ImportJob {
  id: number;
  status: ImportJobStatus;
  declaredCount: number | null;
  photoRef: string | null;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  batchId: string | null;
  bullJobId: string | null;
  pendingCount: number;
  needsAttention: boolean;
  declaredCountMismatch: boolean;
  queueState: string | null;
}

export interface UnrecognizedItem {
  id: number;
  importJobId: number;
  rawTitle: string;
  rawPlatform: string | null;
  reason: string | null;
  createdAt: string;
  dismissedAt: string | null;
}

export interface ImportJobDetail extends ImportJob {
  unrecognizedItems: UnrecognizedItem[];
}

export interface ListImportJobsMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListImportJobsResponse {
  items: ImportJob[];
  meta: ListImportJobsMeta;
}

export interface ListImportJobsQuery {
  page?: number;
  limit?: number;
  status?: ImportJobStatus;
  batchId?: string;
}

export interface ImportBatchProgress {
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
  pauseSource: ImportPauseSource | null;
}

export interface ImportQueueState {
  paused: boolean;
  reason: string | null;
  source: ImportPauseSource | null;
  pausedAt: string | null;
}

export interface ImportUploadJob {
  id: number;
  jobId: string;
  status: string;
  declaredCount: number | null;
}

export interface StartImportUploadResponse {
  batchId: string;
  jobs: ImportUploadJob[];
}

export interface DismissImportJobRequest {
  status: 'dismissed';
}

export interface DismissUnrecognizedItemRequest {
  dismissed: boolean;
}

// ── Auth / setup ─────────────────────────────────────────────────────────
export interface AuthUser {
  id: number;
  email: string;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
}

export interface SetupStatus {
  setupRequired: boolean;
}

export type SetupRequest = LoginRequest;

export interface SetupResponse {
  user: AuthUser;
}

// ── Errors (wire) ────────────────────────────────────────────────────────
export const GAME_ALREADY_IN_CATALOG = 'GAME_ALREADY_IN_CATALOG';

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  code?: string;
}

export interface GameConflictErrorBody extends ApiErrorBody {
  code: 'GAME_ALREADY_IN_CATALOG';
  game: GameDetail;
}
