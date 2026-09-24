/**
 * 秘書の側から話しかける（声かけ。#278）ときの判定と文面の組み立て。**純粋な関数だけ。**
 *
 * DBにもモデルにも触れないものをここへ切り出してあるのは、`test/nudge-choice.test.ts` から
 * そのまま流せるようにするため（#265で `parseChoice()` を `notices.ts` から出したのと
 * 同じ分け方。テストからDBへは繋がない）。
 *
 * ## 何を歯止めにしているか
 *
 * 声かけは「利用者が頼んでいないのに秘書が話し出す」ものなので、頻度を間違えると
 * **朝の見通し（#79）が避けた「読まれなくなる通知」と同じ末路**になる。歯止めは3つで、
 * うち2つがここにある。
 *
 * 1. 話題（#144）からの声かけは `NUDGE_INTERVAL_MS` に1回まで（`topicNudgeDue()`）
 * 2. 最後の発言から `NUDGE_QUIET_MS` は積まない（`quietEnough()`）
 * 3. 同じ材料は一度だけ（`Notice.shownAt` / `Topic.spokenAt`。DB側の印なのでここには無い）
 */

/**
 * 話題（#144）から声かけを作る間隔。
 *
 * ニュースは「逃すと困る」ものではないので、目に入る回数はこの程度で足りる。仕入れ自体が
 * 1時間に1回まで（`TOPIC_REFRESH_INTERVAL_MS`）なので、これより短くしても新しい話題は増えない
 * ——同じ記事を何度も振らないぶん（`Topic.spokenAt`）、短くすると溜まった古い記事から順に
 * 吐き出すだけになる。
 */
export const NUDGE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 最後の発言からこれだけは声かけを積まない。
 *
 * **話している最中に横から別の話を始めないため。** 併せて、生成中の相談へ割り込まないための
 * 錠にもなっている——`/api/chat` は利用者の発言を保存してからCodexを待つ（最大120秒）ので、
 * 生成の最中はこの条件で必ず弾かれる。#48が `pendingGenerations` で守っている「打ち切られた
 * 返答より後ろに発言が入らない」順序を、声かけの側からも崩さない。
 */
export const NUDGE_QUIET_MS = 3 * 60 * 1000;

/** 話題からの声かけを作ってよい時刻か。`lastNudgeAt` はプロセス内に持つ前回の時刻。 */
export function topicNudgeDue(now: number, lastNudgeAt: number | null): boolean {
  if (lastNudgeAt === null) return true;

  return now - lastNudgeAt >= NUDGE_INTERVAL_MS;
}

/** 会話が途切れていて、横から話しかけてよい状態か。発言が1件も無ければ話しかけてよい。 */
export function quietEnough(now: number, lastMessageAt: number | null): boolean {
  if (lastMessageAt === null) return true;

  return now - lastMessageAt >= NUDGE_QUIET_MS;
}

/**
 * リンクの見出しに使える形へ均す。
 *
 * 見出しは記事の題やお知らせのタイトルで、**外から来た文字列**（モデルが書いた・他のアプリが
 * 積んだ）。`[` `]` がそのまま入るとMarkdownのリンクが途中で切れ、URLが本文として出る。
 * 改行も1行に畳む——リンクの見出しは1行でしか書けない。
 */
function linkLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\[\]]/g, (character) => `\\${character}`);
}

/**
 * 声かけの本文に出典のリンクを添える（#278）。
 *
 * 「書く」画面は返答をMarkdownとして描く（`src/components/chat/markdown.tsx`。リンクは
 * 別のタブで開く）ので、吹き出しの「開く」（#137）に当たるものをここではリンクで置く。
 *
 * - `url` が無ければ本文だけを返す。**リンクが無いお知らせもある**ので、空のリンクを作らない
 * - URLは山括弧で囲む。閉じ括弧を含むURL（`…(2026年)` のような記事）でリンクが切れないため。
 *   山括弧そのものを含むURLだけは囲めないので、そのときはリンクを付けずに本文だけを返す
 */
export function withSourceLink(text: string, label: string, url: string | null | undefined): string {
  if (!url || url === "") return text;
  if (url.includes("<") || url.includes(">")) return text;

  const title = linkLabel(label);

  return `${text}\n\n[${title === "" ? "元のページを開く" : title}](<${url}>)`;
}
