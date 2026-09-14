"use client";

import { CircleAlert, Copy, Sunrise } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/**
 * 起きたら朝の見通しを届ける（#233）。
 *
 * iPhoneのショートカットへ入れる値（URL・方法・ヘッダ）と、トークンの発行・作り直し・削除を置く。
 * ショートカットは文字列として配れないので、iOSの画面に出ている名前で手順を並べる
 * （dayspanの `/settings/shortcuts` と同じ考え方）。
 *
 * **トークンは発行した直後にしか出せない**（DBにはハッシュだけ。`src/lib/wake-token.ts`）。
 */

const WAKE_PATH = "/api/briefing/wake";

function subscribeNothing() {
  return () => {};
}

type Props = {
  /** トークンを発行した時刻（日本時間で整形済み）。発行していなければnull。 */
  issuedAtLabel: string | null;
  /** 最後に合図を受け取った時刻（日本時間で整形済み）。まだ一度も無ければnull。 */
  usedAtLabel: string | null;
};

type Message = { tone: "info" | "error"; text: string };

export function WakeTriggerCard({ issuedAtLabel, usedAtLabel }: Props) {
  // 送り先のURLは、いま開いているアドレスから作る。サーバーの描画では分からないので空にしておく
  // （localStorageの値と同じ理由で、useEffectから入れない）。
  const origin = useSyncExternalStore(subscribeNothing, () => window.location.origin, () => "");

  const [issuedAt, setIssuedAt] = useState(issuedAtLabel);
  const [usedAt, setUsedAt] = useState(usedAtLabel);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const issue = useCallback(async () => {
    if (
      issuedAt &&
      !window.confirm("作り直すと、いまショートカットに入れているトークンは使えなくなります。作り直しますか？")
    ) {
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/wake-token", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!response.ok || !body.token) {
        throw new Error(body.error ?? "発行できませんでした。");
      }

      setToken(body.token);
      setIssuedAt("たったいま");
      setUsedAt(null);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "発行できませんでした。" });
    } finally {
      setBusy(false);
    }
  }, [issuedAt]);

  const revoke = useCallback(async () => {
    if (!window.confirm("起きた合図を受け付けないようにします。朝の見通しは設定の時刻に届くようになります。")) {
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/wake-token", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "変更できませんでした。");
      }

      setToken(null);
      setIssuedAt(null);
      setUsedAt(null);
      setMessage({ tone: "info", text: "合図を受け付けないようにしました" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "変更できませんでした。" });
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ tone: "info", text: `${label}をコピーしました` });
    } catch {
      setMessage({ tone: "error", text: "コピーできませんでした。値を長押しして選んでください。" });
    }
  }, []);

  const url = `${origin}${WAKE_PATH}`;
  const headerValue = token ? `Bearer ${token}` : "Bearer <発行したトークン>";

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">起きたら届ける</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          iPhoneのショートカットから起きた合図を送ると、朝のお知らせをその場で届けます。合図が届かなかった日は、
          上の時刻に届きます。
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-surface text-accent">
            <Sunrise className="size-[22px]" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <b className="block text-sm font-medium">起きた合図</b>
            <p className="mt-0.5 text-[0.6875rem] text-muted">
              {issuedAt
                ? `発行: ${issuedAt}・最後の合図: ${usedAt ?? "まだありません"}`
                : "まだ受け付けていません"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void issue()}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {issuedAt ? "作り直す" : "発行する"}
          </button>
        </div>

        {token && (
          <p className="rounded-lg bg-accent-surface px-3.5 py-2.5 text-xs leading-relaxed">
            トークンを発行しました。<b className="font-medium">この値はいまだけ表示されます。</b>
            ショートカットへ入れ終えるまで、この画面を閉じないでください。
          </p>
        )}

        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              message.tone === "error" ? "text-danger" : "text-accent",
            )}
          >
            {message.tone === "error" && <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
            {message.text}
          </p>
        )}

        {issuedAt && (
          <>
            <dl className="flex flex-col gap-2 rounded-lg bg-rail px-3.5 py-3">
              <Field label="URL" value={url} onCopy={() => void copy("URL", url)} />
              <Field label="方法" value="POST" />
              <Field label="ヘッダ" value="Authorization" />
              <Field
                label="値"
                value={headerValue}
                onCopy={token ? () => void copy("ヘッダの値", headerValue) : undefined}
              />
            </dl>

            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
              <li>ショートカットの「オートメーション」で、DaySpanへ起床を送っている「アラーム ▸ 停止したとき」を開きます</li>
              <li>
                DaySpanへの「URLの内容を取得」の後に「辞書の値を取得」を足し、キーを
                <code className="mx-1 font-mono">status</code>にします
              </li>
              <li>
                「もしも」を足し、その値が<code className="mx-1 font-mono">saved</code>
                のときだけ進むようにします。睡眠の記録を止めたとき（起きたとき）だけ届けるためです
              </li>
              <li>「もしも」の中に「URLの内容を取得」を足し、上のURL・方法・ヘッダを入れます（本文は要りません）</li>
            </ol>
          </>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          4時より前の合図や、通知を受け取る端末が無いときは届けません。理由はショートカットの応答の
          「message」に入ります。
        </p>

        {issuedAt && (
          <button
            type="button"
            onClick={() => void revoke()}
            disabled={busy}
            className="self-start text-xs text-muted underline underline-offset-2 hover:text-danger disabled:opacity-50"
          >
            合図を受け付けないようにする
          </button>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-12 shrink-0 text-[0.6875rem] text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-mono text-xs">{value}</dd>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`${label}をコピー`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:text-accent"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
