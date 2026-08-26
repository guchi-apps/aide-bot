-- CreateTable
CREATE TABLE `ToolCall` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `serverLabel` VARCHAR(60) NOT NULL,
    `serverSlug` VARCHAR(40) NOT NULL,
    `toolName` VARCHAR(120) NOT NULL,
    `input` TEXT NOT NULL,
    `output` TEXT NULL,
    `failed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ToolCall_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ToolCall_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ToolCall` ADD CONSTRAINT `ToolCall_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ToolCall` ADD CONSTRAINT `ToolCall_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
