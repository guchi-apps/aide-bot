-- CreateTable
CREATE TABLE `Memory` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('WISH', 'DECISION', 'ONGOING') NOT NULL,
    `content` VARCHAR(400) NOT NULL,
    `status` ENUM('CANDIDATE', 'CONFIRMED', 'DISMISSED', 'FORGOTTEN') NOT NULL DEFAULT 'CANDIDATE',
    `confidence` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'MEDIUM',
    `sourceMessageId` VARCHAR(191) NULL,
    `sourceQuote` VARCHAR(400) NOT NULL,
    `sourceAt` DATETIME(3) NOT NULL,
    `dedupeKey` VARCHAR(64) NOT NULL,
    `notionStatus` VARCHAR(20) NULL,
    `notionUrl` VARCHAR(500) NULL,
    `notionCheckedAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Memory_userId_status_updatedAt_idx`(`userId`, `status`, `updatedAt`),
    UNIQUE INDEX `Memory_userId_dedupeKey_key`(`userId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Memory` ADD CONSTRAINT `Memory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

