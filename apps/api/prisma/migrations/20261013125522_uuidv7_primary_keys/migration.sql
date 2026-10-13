-- ADR-006: integer auto-increment keys -> UUIDv7 CHAR(36). Existing integer ids
-- cannot become valid UUIDv7s, so all keyed data is wiped (dev DB is disposable).
-- The llm_settings / import_queue_state singletons keep their rows (fixed id 1).
DELETE FROM `sessions`;
DELETE FROM `platform_aliases`;
DELETE FROM `game_images`;
DELETE FROM `game_videos`;
DELETE FROM `recognized_items`;
DELETE FROM `unrecognized_items`;
DELETE FROM `games`;
DELETE FROM `import_jobs`;
DELETE FROM `platforms`;
DELETE FROM `users`;

-- DropForeignKey
ALTER TABLE `game_images` DROP FOREIGN KEY `game_images_game_id_fkey`;

-- DropForeignKey
ALTER TABLE `game_videos` DROP FOREIGN KEY `game_videos_game_id_fkey`;

-- DropForeignKey
ALTER TABLE `games` DROP FOREIGN KEY `games_platform_id_fkey`;

-- DropForeignKey
ALTER TABLE `platform_aliases` DROP FOREIGN KEY `platform_aliases_platform_id_fkey`;

-- DropForeignKey
ALTER TABLE `recognized_items` DROP FOREIGN KEY `recognized_items_game_id_fkey`;

-- DropForeignKey
ALTER TABLE `recognized_items` DROP FOREIGN KEY `recognized_items_import_job_id_fkey`;

-- DropForeignKey
ALTER TABLE `sessions` DROP FOREIGN KEY `sessions_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `unrecognized_items` DROP FOREIGN KEY `unrecognized_items_import_job_id_fkey`;

-- DropIndex
DROP INDEX `recognized_items_game_id_fkey` ON `recognized_items`;

-- AlterTable
ALTER TABLE `game_images` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `game_id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `game_videos` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `game_id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `games` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `platform_id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `import_jobs` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `import_queue_state` MODIFY `id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `llm_settings` MODIFY `id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `platform_aliases` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `platform_id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `platforms` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `recognized_items` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `import_job_id` CHAR(36) NOT NULL,
    MODIFY `game_id` CHAR(36) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `sessions` MODIFY `user_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `unrecognized_items` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `import_job_id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `users` DROP PRIMARY KEY,
    MODIFY `id` CHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_aliases` ADD CONSTRAINT `platform_aliases_platform_id_fkey` FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `games` ADD CONSTRAINT `games_platform_id_fkey` FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recognized_items` ADD CONSTRAINT `recognized_items_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recognized_items` ADD CONSTRAINT `recognized_items_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `unrecognized_items` ADD CONSTRAINT `unrecognized_items_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_images` ADD CONSTRAINT `game_images_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_videos` ADD CONSTRAINT `game_videos_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
