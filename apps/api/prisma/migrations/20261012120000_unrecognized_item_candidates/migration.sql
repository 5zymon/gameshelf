-- AlterTable
ALTER TABLE `unrecognized_items` ADD COLUMN `raw_edition` VARCHAR(255) NULL,
    ADD COLUMN `candidates` JSON NULL;
