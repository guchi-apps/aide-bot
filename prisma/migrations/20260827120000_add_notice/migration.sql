-- CreateTable
CREATE TABLE `Notice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(40) NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `dedupeKey` VARCHAR(120) NOT NULL,
    `body` TEXT NOT NULL,
    `url` VARCHAR(500) NULL,
    `priority` ENUM('LOW', 'NORMAL', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `showAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `spokenText` TEXT NULL,
    `spokenUrgent` BOOLEAN NOT NULL DEFAULT false,
    `shownAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notice_userId_shownAt_createdAt_idx`(`userId`, `shownAt`, `createdAt`),
    UNIQUE INDEX `Notice_userId_source_kind_dedupeKey_key`(`userId`, `source`, `kind`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Notice` ADD CONSTRAINT `Notice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

