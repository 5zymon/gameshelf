-- AlterTable
ALTER TABLE `import_jobs` DROP COLUMN `bull_job_id`,
    ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lease_until` DATETIME(3) NULL,
    ADD COLUMN `next_run_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `import_jobs_status_next_run_at_idx` ON `import_jobs`(`status`, `next_run_at`);

-- Backfill (ADR-005): rows that were waiting in, or running on, the removed
-- Redis queue become runnable now. UTC_TIMESTAMP, not NOW(): Prisma stores
-- DateTime in UTC regardless of the server/session time zone.
UPDATE `import_jobs`
SET `status` = 'queued', `next_run_at` = UTC_TIMESTAMP(3), `lease_until` = NULL
WHERE `status` IN ('queued', 'processing');
