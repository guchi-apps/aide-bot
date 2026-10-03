-- CreateTable
CREATE TABLE `ApnsDevice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(200) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `environment` VARCHAR(16) NOT NULL,
    `deviceLabel` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastNotifiedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ApnsDevice_tokenHash_key`(`tokenHash`),
    INDEX `ApnsDevice_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ApnsDevice` ADD CONSTRAINT `ApnsDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
