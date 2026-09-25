-- AlterTable
ALTER TABLE `User` ADD COLUMN `topicCategoriesReady` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `TopicCategory` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(20) NOT NULL,
    `label` VARCHAR(30) NOT NULL,
    `short` VARCHAR(12) NOT NULL,
    `scope` VARCHAR(200) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TopicCategory_userId_sortOrder_idx`(`userId`, `sortOrder`),
    UNIQUE INDEX `TopicCategory_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TopicCategory` ADD CONSTRAINT `TopicCategory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
