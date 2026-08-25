-- AlterTable
ALTER TABLE `Message` ADD COLUMN `cacheReadTokens` INTEGER NULL,
    ADD COLUMN `cacheWriteTokens` INTEGER NULL,
    ADD COLUMN `inputTokens` INTEGER NULL,
    ADD COLUMN `model` VARCHAR(64) NULL,
    ADD COLUMN `outputTokens` INTEGER NULL;
