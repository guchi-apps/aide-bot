-- CreateTable
CREATE TABLE `McpConnection` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `slug` VARCHAR(40) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `authorizationEndpoint` VARCHAR(500) NULL,
    `tokenEndpoint` VARCHAR(500) NULL,
    `clientId` VARCHAR(255) NULL,
    `clientSecret` TEXT NULL,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `expiresAt` DATETIME(3) NULL,
    `pendingState` VARCHAR(64) NULL,
    `pendingVerifier` VARCHAR(128) NULL,
    `pendingRedirectUri` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `McpConnection_pendingState_idx`(`pendingState`),
    UNIQUE INDEX `McpConnection_userId_slug_key`(`userId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `McpConnection` ADD CONSTRAINT `McpConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
