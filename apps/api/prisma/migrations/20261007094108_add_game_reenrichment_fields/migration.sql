-- AlterTable
ALTER TABLE `games` ADD COLUMN `external_id` INTEGER NULL,
    ADD COLUMN `platform_unverified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `user_edited_fields` VARCHAR(255) NULL;
