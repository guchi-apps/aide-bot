-- AlterTable
ALTER TABLE `User` ADD COLUMN `topicCategories` VARCHAR(120) NOT NULL DEFAULT 'general,life,tech';

-- CreateTable
CREATE TABLE `Topic` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `summary` VARCHAR(400) NOT NULL,
    `lead` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `urlHash` VARCHAR(64) NOT NULL,
    `sourceName` VARCHAR(120) NOT NULL,
    `publishedOn` VARCHAR(10) NOT NULL DEFAULT '',
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Topic_userId_fetchedAt_idx`(`userId`, `fetchedAt`),
    UNIQUE INDEX `Topic_userId_urlHash_key`(`userId`, `urlHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Topic` ADD CONSTRAINT `Topic_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
