-- CreateTable
CREATE TABLE `import_queue_state` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paused` BOOLEAN NOT NULL DEFAULT false,
    `reason` TEXT NULL,
    `source` VARCHAR(16) NULL,
    `paused_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
