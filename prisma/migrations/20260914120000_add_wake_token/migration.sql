-- AlterTable
ALTER TABLE `User` ADD COLUMN `wakeTokenCreatedAt` DATETIME(3) NULL,
    ADD COLUMN `wakeTokenHash` VARCHAR(64) NULL,
    ADD COLUMN `wakeTokenUsedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_wakeTokenHash_key` ON `User`(`wakeTokenHash`);
