"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  CHAT_MODELS,
  CHAT_MODEL_COOKIE,
  CHAT_MODEL_MAX_AGE,
  type ChatModelId,
  type ChatModelOption,
  type ReplyStyle,
} from "@/lib/chat-model";
import { cn } from "@/lib/utils";

/**
 * 返答に使うモデルを選ぶ（#71・#128）。
 *
 * **「話す」と「書く」で別々に持つ。** 音声モードの返答は「3文以内・200文字以内」の指示で
 * 短く保たれているため、いちばん賢いモデルを充てても差が出にくい。読み返す「書く」だけ
 * 据え置ける形にしてある。
 *
 * 選んだ値はCookieに置く。相談の内容ではなく端末ごとの好みなのでDBへは持たず、それでいて
 * サーバー側（`/api/chat`）から読める必要があるため、localStorageは使わない。
 *
 * **#128でCodex（ChatGPTサブスク経由）へ移り、単価バッジ・プロンプトキャッシュの注意書きは
 * 削った。** サブスクの定額制で動くため、トークン単価の概念に合わない。
 */

type Props = {
  /** サーバー側でCookieから読んだ、いまの選択。 */
  initial: Record<ReplyStyle, ChatModelId>;
};

/** 画面に出す順と呼び名。既定の「話す」を先に置く（#27）。 */
const STYLES: { style: ReplyStyle; label: string; hint: string; note: string }[] = [
  {
    style: "voice",
    label: "話す",
    hint: "3文以内の短い返事",
    note: "聞くだけの返事は短く保つよう指示してあるので、軽いモデルでも差が出にくいところです。",
  },
  {
    style: "text",
    label: "書く",
    hint: "見出しや表を使う長い返事",
    note: "調べもの・比較・下書きなど、読み返す返事はこちらです。",
  },
];

export function ModelPicker({ initial }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(initial);

  const choose = useCallback(
    (style: ReplyStyle, id: ChatModelId) => {
      setSelected((current) => ({ ...current, [style]: id }));
      // 次の相談から効かせる。サーバー側（`/api/chat`）がこれを読む。
      document.cookie = `${CHAT_MODEL_COOKIE[style]}=${id}; path=/; max-age=${CHAT_MODEL_MAX_AGE}; samesite=lax`;
      router.refresh();
    },
    [router],
  );

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">返答のモデル</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          込み入った相談ほど、賢いモデルの方が答えが深くなります。選んだ内容はこの端末にだけ
          保存されます。
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {STYLES.map(({ style, label, hint, note }) => (
          <div key={style} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <b className="text-sm font-semibold">{label}</b>
              <span className="text-[0.6875rem] text-muted">{hint}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              {CHAT_MODELS.map((model) => (
                <ModelOption
                  key={model.id}
                  model={model}
                  name={`chat-model-${style}`}
                  checked={selected[style] === model.id}
                  onSelect={() => choose(style, model.id)}
                />
              ))}
            </div>

            <p className="text-xs leading-relaxed text-muted">{note}</p>
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        切り替えても、いまの相談はそのまま続けられます。
      </p>
    </section>
  );
}

function ModelOption({
  model,
  name,
  checked,
  onSelect,
}: {
  model: ChatModelOption;
  name: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-rail-active",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        checked && "border-accent bg-accent-surface shadow-[0_0_0_1px_var(--accent)]",
      )}
    >
      <input
        type="radio"
        name={name}
        value={model.id}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />

      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-[15px] shrink-0 place-items-center rounded-full border-[1.5px] bg-surface",
          checked ? "border-accent" : "border-muted",
        )}
      >
        {checked && <span className="size-[7px] rounded-full bg-accent" />}
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-semibold">
          {model.label}
          <span className="rounded-full border border-border bg-background px-1.5 py-px text-[0.625rem] font-bold text-muted">
            {model.hint}
          </span>
        </span>
      </span>
    </label>
  );
}
