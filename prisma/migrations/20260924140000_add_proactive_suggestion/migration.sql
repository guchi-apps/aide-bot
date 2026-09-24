-- AlterTable
ALTER TABLE `User` ADD COLUMN `proactiveAvoidWork` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `proactiveCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `proactiveFreeTime` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `proactiveFrequency` VARCHAR(20) NOT NULL DEFAULT 'daily',
    ADD COLUMN `proactiveOngoing` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `proactiveQuietEnd` INTEGER NOT NULL DEFAULT 8,
    ADD COLUMN `proactiveQuietStart` INTEGER NOT NULL DEFAULT 22,
    ADD COLUMN `proactiveWeekend` BOOLEAN NOT NULL DEFAULT true;
