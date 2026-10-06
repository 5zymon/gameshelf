-- AlterTable
ALTER TABLE `import_jobs` ADD COLUMN `batch_id` VARCHAR(64) NULL,
    ADD COLUMN `bull_job_id` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `import_jobs_batch_id_idx` ON `import_jobs`(`batch_id`);
