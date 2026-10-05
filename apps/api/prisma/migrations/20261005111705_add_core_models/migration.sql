/*
  Warnings:

  - Added the required column `platform_id` to the `games` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `games` ADD COLUMN `cover_url` VARCHAR(2083) NULL,
    ADD COLUMN `edition` VARCHAR(255) NULL,
    ADD COLUMN `enriched_at` DATETIME(3) NULL,
    ADD COLUMN `genre` VARCHAR(255) NULL,
    ADD COLUMN `platform_id` INTEGER NOT NULL,
    ADD COLUMN `player_count` INTEGER NULL,
    ADD COLUMN `publisher` VARCHAR(255) NULL,
    ADD COLUMN `raw_metadata` MEDIUMTEXT NULL,
    ADD COLUMN `release_year` INTEGER NULL,
    ADD COLUMN `source` ENUM('IGDB', 'MobyGames', 'MANUAL') NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(255) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_agent` VARCHAR(255) NULL,

    INDEX `sessions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platforms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `abbreviation` VARCHAR(255) NULL,
    `alternative_name` VARCHAR(255) NULL,
    `igdb_id` INTEGER NULL,
    `slug` VARCHAR(255) NOT NULL,

    UNIQUE INDEX `platforms_name_key`(`name`),
    UNIQUE INDEX `platforms_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` VARCHAR(32) NOT NULL,
    `declared_count` INTEGER NULL,
    `recognized_count` INTEGER NOT NULL DEFAULT 0,
    `imported_count` INTEGER NOT NULL DEFAULT 0,
    `unrecognized_count` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `import_jobs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unrecognized_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `import_job_id` INTEGER NOT NULL,
    `raw_title` VARCHAR(255) NOT NULL,
    `raw_platform` VARCHAR(255) NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `unrecognized_items_import_job_id_idx`(`import_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `games_platform_id_idx` ON `games`(`platform_id`);

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `games` ADD CONSTRAINT `games_platform_id_fkey` FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unrecognized_items` ADD CONSTRAINT `unrecognized_items_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
