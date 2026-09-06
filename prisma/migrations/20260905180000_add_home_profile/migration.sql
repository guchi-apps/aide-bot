-- AlterTable
ALTER TABLE `User` ADD COLUMN `homeProfile` TEXT NULL,
    ADD COLUMN `homeProfileFetchedAt` DATETIME(3) NULL;
