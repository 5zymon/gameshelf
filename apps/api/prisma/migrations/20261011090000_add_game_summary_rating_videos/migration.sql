-- AlterTable
ALTER TABLE `games` ADD COLUMN `summary` TEXT NULL,
    ADD COLUMN `rating` DOUBLE NULL,
    ADD COLUMN `rating_count` INTEGER NULL;

-- CreateTable
CREATE TABLE `game_videos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `game_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `video_id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `game_videos_game_id_idx`(`game_id`),
    UNIQUE INDEX `game_videos_game_id_position_key`(`game_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `game_videos` ADD CONSTRAINT `game_videos_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
