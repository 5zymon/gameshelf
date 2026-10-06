-- CreateTable
CREATE TABLE `llm_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(128) NULL,
    `api_key_ciphertext` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
