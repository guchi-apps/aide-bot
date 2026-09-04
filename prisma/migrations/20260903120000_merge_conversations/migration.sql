-- 相談をテーマ別スレッドから1本の連続セッションへ変える（#157）。
--
-- **このマイグレーションは元に戻せない。** 既存のスレッドの発言・書き込みの記録・使用量を
-- 利用者ごとに1本へ付け替え、空になったスレッドを消す。付け替えるのは行の紐付けだけなので、
-- 費用（ApiUsage）も「取り消せない書き込みをした事実」（ToolCall）も失われない。

-- AlterTable
ALTER TABLE `Conversation`
    ADD COLUMN `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `summary` TEXT NULL,
    ADD COLUMN `summarizedCount` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `Conversation_userId_isPrimary_idx` ON `Conversation`(`userId`, `isPrimary`);

-- 連続セッションを利用者ごとにちょうど1本作る。
--
-- 既存のスレッドから1本を選んで昇格させるのではなく新しく作るのは、選ぶためのサブクエリが
-- 更新対象と同じテーブルを指すことになり（MySQLの "You can't specify target table ... in FROM
-- clause"）、一時テーブルを挟む必要が出るため。idを `main_<userId>` に決め打ちすると、
-- 次のUPDATEが同じ規則で宛先を組み立てられる（cuidは25文字なので VARCHAR(191) に収まる）。
INSERT INTO `Conversation` (`id`, `userId`, `title`, `isPrimary`, `summarizedCount`, `createdAt`, `updatedAt`)
SELECT CONCAT('main_', `u`.`id`), `u`.`id`, '秘書との記録', true, 0, NOW(3), NOW(3)
FROM `User` AS `u`;

-- 既存のスレッドにぶら下がっていたものを、その利用者の連続セッションへ付け替える。
UPDATE `Message` AS `m`
    JOIN `Conversation` AS `c` ON `c`.`id` = `m`.`conversationId`
    SET `m`.`conversationId` = CONCAT('main_', `c`.`userId`)
    WHERE `c`.`isPrimary` = false;

UPDATE `ToolCall` AS `t`
    JOIN `Conversation` AS `c` ON `c`.`id` = `t`.`conversationId`
    SET `t`.`conversationId` = CONCAT('main_', `c`.`userId`)
    WHERE `c`.`isPrimary` = false;

UPDATE `ApiUsage` AS `a`
    JOIN `Conversation` AS `c` ON `c`.`id` = `a`.`conversationId`
    SET `a`.`conversationId` = CONCAT('main_', `c`.`userId`)
    WHERE `c`.`isPrimary` = false;

-- 空になったテーマ別のスレッドを消す。
DELETE FROM `Conversation` WHERE `isPrimary` = false;

-- 最後に話した時刻（#101のひとりごとが読む）を、付け替えた発言の実際の時刻に合わせる。
-- 作ったばかりの行は NOW(3) のままなので、直さないと「さっきの続きでも大丈夫です」が出続ける。
UPDATE `Conversation` AS `c`
    JOIN (
        SELECT `conversationId`, MIN(`createdAt`) AS `first`, MAX(`createdAt`) AS `last`
        FROM `Message` GROUP BY `conversationId`
    ) AS `m` ON `m`.`conversationId` = `c`.`id`
    SET `c`.`createdAt` = `m`.`first`, `c`.`updatedAt` = `m`.`last`;
