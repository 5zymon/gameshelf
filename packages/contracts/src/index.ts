/**
 * Shared GameShelf HTTP wire contracts.
 *
 * These types mirror the NestJS response models and query DTOs field-for-field
 * on the wire (JSON): dates are `string`, not `Date`, and nullable fields are
 * `T | null`. The backend DTOs remain the source of truth; this package is the
 * single definition the frontend imports. Drift is guarded by the live-API
 * OpenAPI comparison, not at compile time (the backend DTOs are untouched).
 *
 * Entity ids are UUIDv7 strings (ADR-006); `externalId`/`igdbId` stay numeric.
 */

// ── Games ────────────────────────────────────────────────────────────────
export interface GamePlatform {
  id: string;
  name: string;
  slug: string;
}

export interface GameListItem {
  id: string;
  title: string;
  edition: string | null;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  /** IGDB 0–100; null = unrated. */
  rating: number | null;
  /** NON-nullable: the backend always projects the platform. */
  platform: GamePlatform;
}

/** `Game.source` — mirrored from the Prisma `GameSource` enum. */
export type GameSource = 'IGDB' | 'MobyGames' | 'MANUAL';

export interface GameImage {
  url: string;
  thumbUrl: string | null;
}

export interface GameVideo {
  id: string;
  name: string | null;
  videoId: string;
}

export interface GameDetail {
  id: string;
  title: string;
  platformId: string;
  edition: string | null;
  releaseYear: number | null;
  publisher: string | null;
  genre: string | null;
  playerCount: number | null;
  summary: string | null;
  rating: number | null;
  ratingCount: number | null;
  copyCount: number;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  images: GameImage[];
  videos: GameVideo[];
  rawMetadata: string | null;
  enrichedAt: string | null;
  source: GameSource;
  externalId: number | null;
  igdbUrl: string | null;
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
  /** Repeated on the wire (`?platformId=<uuid>&platformId=<uuid>`); a game on any of them matches. */
  platformId?: string[];
  edition?: string;
  year?: number;
  /** Inclusive lower bound on the release year; games without a year never match. */
  yearFrom?: number;
  /** Inclusive upper bound on the release year; games without a year never match. */
  yearTo?: number;
  /** `true` → only games without a release year; `false` → no filter. */
  noYear?: boolean;
  /** `true` → only games whose platform is unverified; `false` → no filter. */
  platformUnverified?: boolean;
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
  /** Ranked candidates, best first, up to 10; empty when nothing matched. */
  candidates: EnrichCandidate[];
  game: GameDetail;
}

export interface EnrichCandidateRef {
  source: CatalogSource;
  externalId: number;
}

/** Body for POST /import-jobs/:id/unrecognized/:itemId/pick (card 105). */
export interface PickUnrecognizedCandidateRequest extends EnrichCandidateRef {
  /** Re-search query that produced the candidate; lifts the stored-tie requirement. */
  query?: string;
  /** User-confirmed platform (UUIDv7). */
  platformId?: string;
}

export interface CreateGameRequest {
  title: string;
  platformId: string;
  edition?: string;
  releaseYear?: number;
  publisher?: string;
  genre?: string;
  playerCount?: number;
  summary?: string;
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
  id: string;
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
  targetId: string;
}

/** Mirrors `PlatformsSyncService.PlatformSyncResult`. */
export interface PlatformSyncResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
}

// ── Stats ────────────────────────────────────────────────────────────────
export interface StatsTotals {
  /** Count of Game rows (titles). */
  games: number;
  /** Sum of Game.copyCount; 0 when there are no games. */
  copies: number;
}

export interface StatsPlatform {
  id: string; // Platform.id
  name: string; // Platform.name
  games: number; // games assigned to this platform, platformUnverified included (0001)
}

export interface StatsDataQuality {
  unverifiedPlatform: number; // games with platformUnverified = true
}

export interface StatsDecade {
  decade: number; // first year of the decade, e.g. 1990 for 1990–1999
  games: number; // games whose releaseYear falls in the decade
}

export interface StatsResponse {
  totals: StatsTotals;
  platforms: StatsPlatform[]; // only platforms with ≥ 1 game; games desc, then name asc
  dataQuality: StatsDataQuality;
  decades: StatsDecade[]; // only decades with ≥ 1 game; decade ascending
  noReleaseYear: number; // games with releaseYear = null
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
  id: string;
  status: ImportJobStatus;
  declaredCount: number | null;
  photoRef: string | null;
  recognizedCount: number;
  importedCount: number;
  unrecognizedCount: number;
  /** Flagged items still awaiting review (not dismissed, picked or added); live for every status. */
  openFlaggedCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  batchId: string | null;
  pendingCount: number;
  needsAttention: boolean;
  declaredCountMismatch: boolean;
}

/** One tied catalog candidate offered for a flagged item (card 105). */
export interface UnrecognizedItemCandidate {
  source: CatalogSource;
  externalId: number;
  title: string;
  slug: string | null;
  /** Same-origin signed preview URL; never an external host. */
  coverUrl: string | null;
  score: number;
}

export interface UnrecognizedItem {
  id: string;
  importJobId: string;
  rawTitle: string;
  rawPlatform: string | null;
  reason: string | null;
  createdAt: string;
  dismissedAt: string | null;
  /** Empty unless several candidates matched equally well. */
  candidates: UnrecognizedItemCandidate[];
}

/** Query for GET /import-jobs/:id/unrecognized/:itemId/search (card 105 re-search). */
export interface SearchUnrecognizedItemQuery {
  q?: string;
  platformId?: string;
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
  id: string;
  /** Equals `id`: the import_jobs row is the queue entry (ADR-005). */
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

// ── LLM settings ─────────────────────────────────────────────────────────
export type VisionProviderId = 'custom';

export interface LlmProviderSummary {
  id: VisionProviderId;
  label: string;
  defaultModel: string;
}

/** Mirrors `apps/api/src/settings/dto/llm-settings.model.ts` (dates → string). */
export interface LlmSettingsModel {
  provider: VisionProviderId;
  model: string;
  // The OpenAI-compatible endpoint's base URL; null until one is saved.
  baseUrl: string | null;
  keyPresent: boolean;
  importEnabled: boolean;
  availableProviders: LlmProviderSummary[];
  updatedAt: string | null;
}

/** Mirrors `apps/api/src/settings/dto/put-llm-settings.dto.ts` (write-only key). */
export interface PutLlmSettingsRequest {
  provider: VisionProviderId;
  // Omit = keep. "" = clear back to the default.
  model?: string;
  // Absolute http(s) URL (trailing / normalized). Required unless one is
  // already stored; omit to keep it.
  baseUrl?: string;
  // Omit = keep. "" = clear.
  apiKey?: string;
}

/** Mirrors `VisionErrorCode` in `apps/api/src/settings/vision/vision.errors.ts`. */
export type VisionErrorCode =
  | 'unknown_provider'
  | 'unauthorized'
  | 'model_not_found'
  | 'rate_limited'
  | 'timeout'
  | 'bad_response'
  | 'network'
  | 'server_error';
export type VisionTestCode = 'ok' | 'not_configured' | VisionErrorCode;

/** Mirrors `apps/api/src/settings/dto/llm-test-result.model.ts`. */
export interface LlmTestResult {
  ok: boolean;
  code: VisionTestCode;
  provider: VisionProviderId;
  model: string;
  message: string;
}

// ── Game database status ────────────────────────────────────────────────
export const GAME_DATABASE_IDS = ['igdb', 'mobygames'] as const;
export type GameDatabaseId = (typeof GAME_DATABASE_IDS)[number];
export const GAME_DATABASE_STATES = [
  'configured',
  'missing',
  'rejected',
] as const;
export type GameDatabaseState = (typeof GAME_DATABASE_STATES)[number];

/** Mirrors `apps/api/src/settings/dto/game-database-status.model.ts`. */
export interface GameDatabaseStatus {
  id: GameDatabaseId;
  label: string;
  state: GameDatabaseState;
  message: string | null;
}

// ── Auth / setup ─────────────────────────────────────────────────────────
/** Supported UI languages (ticket 7.2); English is the default. */
export type AppLanguage = 'pl' | 'en';

/** Supported UI themes (ticket 7.3); 'system' tracks the OS preference. */
export type AppTheme = 'light' | 'dark' | 'system';

export interface AuthUser {
  id: string;
  email: string;
  language: AppLanguage;
  theme: AppTheme;
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

// ── Preferences (per-user) ───────────────────────────────────────────────
/** Mirrors `apps/api/src/settings/dto/preferences.model.ts`. */
export interface PreferencesModel {
  language: AppLanguage;
  theme: AppTheme;
}

/** Body of `PUT /settings/preferences`. */
export interface PutPreferencesRequest {
  language: AppLanguage;
  theme: AppTheme;
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
