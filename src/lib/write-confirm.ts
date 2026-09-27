/**
 * 書き込み（予定・記録の追加・変更・取り消し）の前に出す「許可／拒否」カードの解析と検証（#380）。
 * **クライアントコンポーネントからもimportする**ので、PrismaやNodeのモジュールに触れないこと。
 *
 * 形は設定の変更案（`settings-proposal.ts`。#346）と同じで、返答の本文に囲みとして入る。
 *
 * ```write-confirm
 * {"title":"予定の変更","rows":[{"label":"予定","value":"宮出運行"},{"label":"開始","value":"17:30 → 18:00"}]}
 * ```
 *
 * **カードのボタンは書き込みを実行しない。** 押すと「許可します」「拒否します」という発言が
 * 送られるだけで、実際に道具を呼ぶのは秘書（モデル）。書き込みを止める錠は従来どおり
 * 書き込みの許可設定（#78）で、ここでは増やしていない。
 */

export type WriteConfirm = {
  title: string;
  rows: { label: string; value: string }[];
};

export const MAX_ROWS = 8;
const TITLE_MAX = 40;
const LABEL_MAX = 30;
const VALUE_MAX = 200;

/** ボタンを押したときに送る発言。 */
export const ALLOW_MESSAGE = "許可します。その内容で実行してください。";
export const DENY_MESSAGE = "拒否します。実行しないでください。";

const FENCE = /```write-confirm\s*\n([\s\S]*?)```/g;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(/\s+/g, " ").trim();
  return flat !== "" && flat.length <= max ? flat : null;
}

/** 1件を検証する。項目が1つも無い・値が不正なら null。 */
export function validateWriteConfirm(raw: unknown): WriteConfirm | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const title = text(item.title, TITLE_MAX);
  if (!title || !Array.isArray(item.rows)) return null;

  const rows: WriteConfirm["rows"] = [];
  for (const row of item.rows.slice(0, MAX_ROWS)) {
    if (typeof row !== "object" || row === null) return null;
    const label = text((row as Record<string, unknown>).label, LABEL_MAX);
    const value = text((row as Record<string, unknown>).value, VALUE_MAX);
    if (!label || !value) return null;
    rows.push({ label, value });
  }
  return rows.length > 0 ? { title, rows } : null;
}

/** 本文から囲みを取り除き、検証を通った最初の1件だけを返す。壊れた囲みは捨てて本文だけを残す。 */
export function extractWriteConfirm(content: string): { text: string; confirm: WriteConfirm | null } {
  const found: { value: WriteConfirm | null } = { value: null };

  const stripped = content
    .replace(FENCE, (_match, body: string) => {
      if (found.value) return "";
      try {
        found.value = validateWriteConfirm(JSON.parse(body));
      } catch {
        // 壊れたカードは捨てる。
      }
      return "";
    })
    .trim();

  return { text: stripped, confirm: found.value };
}

/** 生成の途中（囲みが閉じていない）でも、囲みの部分を見せないための除去。 */
export function stripWriteConfirm(content: string): string {
  return extractWriteConfirm(content)
    .text.replace(/```write-confirm[\s\S]*$/, "")
    .trim();
}

/** カードの状態。`open` だけがボタンを押せる。 */
export type WriteConfirmStatus = "open" | "allowed" | "denied" | "closed";

type EntryShape = { kind: string; role?: string; content?: string; day?: string };

/**
 * `index` にある秘書の発言のカードが、いま押せるかを決める。
 *
 * 押せるのは、**今日の画面で、後ろに何も続いていないとき**だけ。
 * - 後ろに利用者の発言がある: すでに答えた（文面が許可・拒否なら結果を出し、それ以外は `closed`）
 * - 後ろに会話の区切り（#322）がある: 区切りの後の秘書は、このカードの内容を覚えていない
 * - 今日以外の日のカード（引き継ぎ・過去の日）: 同じ理由で、押しても何を実行するか伝わらない
 */
export function writeConfirmStatus(entries: EntryShape[], index: number, todayKey: string): WriteConfirmStatus {
  for (let i = index + 1; i < entries.length; i++) {
    const next = entries[i];
    if (next.kind === "break") return "closed";
    if (next.kind === "message" && next.role === "USER") {
      if (next.content === ALLOW_MESSAGE) return "allowed";
      if (next.content === DENY_MESSAGE) return "denied";
      return "closed";
    }
  }
  const day = entries[index].day ?? todayKey;
  return day === todayKey ? "open" : "closed";
}

/** 秘書のプロンプトに載せる、確認カードの書き方。 */
export const WRITE_CONFIRM_RULES = [
  "予定・記録の追加や変更、取り消しのように、あとから取り消せない結果が残る書き込みは、道具を呼ぶ前に返答の末尾へ確認カードの囲みを添え、利用者の答えを待つ（前の「復唱して確認する」は、この確認カードで行う）。" +
    "囲みは利用者には「許可する／拒否する」のボタンのカードとして見える。本文では何を行うかを1〜2文で伝え、**まだ実行していない**ことを前提に書く",
  '囲みの形: ```write-confirm の行の次にJSON `{"title":"予定の変更","rows":[{"label":"予定","value":"宮出運行"},{"label":"開始","value":"17:30 → 18:00"}]}` を置き、``` で閉じる。' +
    "rows は最大8件で、変更なら「変更前 → 変更後」の形で値を書く。金額・日付・時刻・相手など、実行すると決まる値を漏らさず入れる",
  "「許可します。その内容で実行してください。」と返ってきたら、確認した内容のとおりに道具を呼ぶ。「拒否します。実行しないでください。」と返ってきたら実行せず、やめたことを一言伝える",
];
