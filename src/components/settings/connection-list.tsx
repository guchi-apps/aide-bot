import { CircleAlert, CircleCheck, CircleSlash, Plug } from "lucide-react";

import type { ConnectionView } from "@/lib/mcp/connections";
import { MCP_PRESETS, findPreset } from "@/lib/mcp/presets";
import { cn } from "@/lib/utils";

/**
 * 接続の一覧と、新しく繋ぐための導線（#46）。
 *
 * **クライアントJSに依存させない。** 操作はどれもフォームのPOSTで、「繋ぐ」は相手の
 * 認可画面への302そのもの。ハイドレーション前に押しても成立するようにしてある
 * （ログイン・ログアウトと同じ考え方）。
 */

type Props = {
  connections: ConnectionView[];
  error?: string;
  connected?: string;
};

export function ConnectionList({ connections, error, connected }: Props) {
  const connectedUrls = new Set(connections.filter((c) => c.connected).map((c) => c.url));

  return (
    // 見出しは`h3`から始める。設定の画面（#71）では「返答のモデル」と並ぶ節の1つになった。
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">接続</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          外部サービスのMCPサーバーへ繋ぐと、秘書が相談の中でそのデータを見に行けるようになります。
          繋いだ内容は相談のたびに参照され、必要だと判断したときだけ呼び出されます。
        </p>
      </header>

      {connected && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-surface px-4 py-2.5 text-sm"
        >
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          {connected} に繋がりました。
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-surface px-4 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        <h4 className="text-[0.6875rem] font-bold tracking-[0.1em] text-muted">繋いでいるもの</h4>

        {connections.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">
            まだ何も繋いでいません。下から選んで繋いでください。
          </p>
        ) : (
          connections.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="text-sm font-medium">{connection.label}</b>
                  <StatusBadge connection={connection} />
                </div>
                <span className="mt-0.5 block truncate text-[0.6875rem] text-muted">
                  {connection.url}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <ActionButton
                  action={connection.enabled ? "disable" : "enable"}
                  id={connection.id}
                  label={connection.enabled ? "使わない" : "使う"}
                />
                <ActionButton action="delete" id={connection.id} label="削除" danger />
              </div>

              <Capabilities url={connection.url} />
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <h4 className="text-[0.6875rem] font-bold tracking-[0.1em] text-muted">新しく繋ぐ</h4>

        {MCP_PRESETS.map((preset) => (
          <form
            key={preset.id}
            action="/api/connections"
            method="post"
            className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <input type="hidden" name="action" value="connect" />
            <input type="hidden" name="url" value={preset.url} />
            <input type="hidden" name="label" value={preset.label} />

            <div className="min-w-0 flex-1">
              <b className="block text-sm font-medium">{preset.label}</b>
              <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-muted">
                {preset.description}
              </span>
            </div>

            <button
              type="submit"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              <Plug className="size-3.5" aria-hidden="true" />
              {connectedUrls.has(preset.url) ? "繋ぎ直す" : "繋ぐ"}
            </button>
          </form>
        ))}

        <form
          action="/api/connections"
          method="post"
          className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3"
        >
          <input type="hidden" name="action" value="connect" />

          <label className="text-sm font-medium" htmlFor="mcp-url">
            その他のMCPサーバー
          </label>
          <p className="text-[0.6875rem] leading-relaxed text-muted">
            公開されているリモートMCPサーバーのURLを入れると、その場でログインして繋げます。
            Googleカレンダーのように公開URLが無いサービスは、ここからは繋げません。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              id="mcp-url"
              name="url"
              type="url"
              required
              placeholder="https://example.com/mcp"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <input
              name="label"
              type="text"
              maxLength={60}
              placeholder="表示名（省略可）"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent md:max-w-[12rem]"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              繋ぐ
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/**
 * その接続で聞けること・いまは取れないこと（#167）。
 *
 * **プリセットに無い接続（利用者が自分でURLを入れて繋いだもの）では何も出さない。**
 * 把握していないものを「できること」として並べると、繋げば何でも聞けるように読める。
 */
function Capabilities({ url }: { url: string }) {
  const preset = findPreset(url);
  if (!preset || (preset.provides.length === 0 && preset.missing.length === 0)) return null;

  return (
    <div className="basis-full border-t border-border pt-2.5">
      {preset.provides.length > 0 && (
        <ul className="flex flex-col gap-1">
          {preset.provides.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-muted">
              <CircleCheck className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      )}

      {preset.missing.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {preset.missing.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-muted">
              <CircleSlash className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0">まだ取れない: {item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ connection }: { connection: ConnectionView }) {
  const [text, tone] = !connection.connected
    ? ["未接続", "text-danger"]
    : connection.enabled
      ? ["使用中", "text-muted"]
      : ["休止中", "text-muted"];

  return <span className={cn("shrink-0 text-[0.6875rem]", tone)}>{text}</span>;
}

function ActionButton({
  action,
  id,
  label,
  danger,
}: {
  action: string;
  id: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <form action="/api/connections" method="post">
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className={cn(
          "whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-rail-active",
          danger && "text-danger",
        )}
      >
        {label}
      </button>
    </form>
  );
}
