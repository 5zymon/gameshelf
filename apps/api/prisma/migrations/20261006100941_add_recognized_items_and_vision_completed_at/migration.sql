-- AlterTable
ALTER TABLE `import_jobs` ADD COLUMN `vision_completed_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `recognized_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `import_job_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `raw_title` VARCHAR(255) NOT NULL,
    `raw_edition` VARCHAR(255) NULL,
    `raw_platform` VARCHAR(255) NULL,
    `confidence` DOUBLE NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `game_id` INTEGER NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `recognized_items_import_job_id_status_idx`(`import_job_id`, `status`),
    UNIQUE INDEX `recognized_items_import_job_id_position_key`(`import_job_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recognized_items` ADD CONSTRAINT `recognized_items_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recognized_items` ADD CONSTRAINT `recognized_items_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
