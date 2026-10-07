-- AlterTable
ALTER TABLE `platforms` ADD COLUMN `added_by_import` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hidden` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `platform_aliases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `platform_id` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `normalized_name` VARCHAR(512) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_aliases_normalized_name_key`(`normalized_name`),
    INDEX `platform_aliases_platform_id_idx`(`platform_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `platform_aliases` ADD CONSTRAINT `platform_aliases_platform_id_fkey` FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
