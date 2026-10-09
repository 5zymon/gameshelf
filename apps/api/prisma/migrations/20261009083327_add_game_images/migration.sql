-- CreateTable
CREATE TABLE `game_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `game_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `url` VARCHAR(2083) NOT NULL,
    `source_url` VARCHAR(2083) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `game_images_game_id_idx`(`game_id`),
    UNIQUE INDEX `game_images_game_id_position_key`(`game_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `game_images` ADD CONSTRAINT `game_images_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
