-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `contextStartedAt` DATETIME(3) NULL,
    ADD COLUMN `lastUserMessageAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `ContextBreak` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,

    INDEX `ContextBreak_conversationId_at_idx`(`conversationId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContextBreak` ADD CONSTRAINT `ContextBreak_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
