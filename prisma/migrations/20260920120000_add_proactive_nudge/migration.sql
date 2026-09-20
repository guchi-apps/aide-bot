-- AlterTable
ALTER TABLE `Message` ADD COLUMN `proactive` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Topic` ADD COLUMN `spokenAt` DATETIME(3) NULL;
