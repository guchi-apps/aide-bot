"use client";

import { BellRing, CircleAlert, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 秘書の方から届く通知のオン／オフ（#79）。
 *
 * **設定の画面の中で、ここだけはクライアントJSに依存する。** 購読を作れるのは
 * `navigator.serviceWorker` と `PushManager` を触ったブラウザ側だけで、フォームのPOSTでは
 * 代わりにならない（接続の画面がJSに依存しないのとは事情が違う）。
 *
 * ## iOSの落とし穴
 *
 * iOSのWeb Pushは **16.4以降、かつホーム画面に追加したPWAでのみ**動く。Safariのタブで
 * 開いているだけでは `PushManager` そのものが無い。案内を出さないと「通知が来ない」という
 * 不具合に見えるため、iOSで未追加のときは先にその案内を出す。
 */

type Props = {
  /** VAPIDの公開鍵。サーバー側で環境変数から読んで渡す（`NEXT_PUBLIC_*` に置かない理由は `@/lib/push/config`）。 */
  publicKey: string;
  /** サーバー側で数えた、登録済みの端末数。 */
  initialDeviceCount: number;
};

type PushState = {
  /** この端末がWeb Pushに対応しているか。 */
  supported: boolean;
  permission: NotificationPermission;
  /** この端末が購読済みか。 */
  subscribed: boolean;
  /** iOSで、ホーム画面に追加せずSafariのタブで開いているか。 */
  needsHomeScreen: boolean;
};

const LOADING: PushState = {
  supported: false,
  permission: "default",
  subscribed: false,
  needsHomeScreen: false,
};

/**
 * base64urlの公開鍵を `applicationServerKey` に渡せる形へ直す。
 *
 * `subscribe()` はUint8Arrayしか受け付けない（文字列を受ける実装もあるが、Safariは弾く）。
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);

  // 戻り値の型を `Uint8Array<ArrayBuffer>` に固定する。素の `Uint8Array` は
  // `SharedArrayBuffer` 由来のものも含む型になり、`BufferSource` を求める
  // `applicationServerKey` へ渡せない。
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** ホーム画面から起動したPWAとして開いているか。 */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOSのSafariだけは display-mode を持たず、独自のこのフラグで判定する。
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * いまの状態を読む。
 *
 * **必ずawaitを挟んでから返す。** 同期に読める値も含めてここへ寄せてあるのは、
 * 呼び出し側のuseEffectが `setState` を同期で呼ばないようにするため
 * （ESLintの `react-hooks/set-state-in-effect`。localStorageを直接読まないのと同じ理由）。
 */
async function readPushState(): Promise<PushState> {
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  if (!supported) {
    return { ...LOADING, needsHomeScreen: isIos() && !isStandalone() };
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;

  return {
    supported: true,
    permission: Notification.permission,
    subscribed: subscription !== null,
    needsHomeScreen: false,
  };
}

export function NotificationSettings({ publicKey, initialDeviceCount }: Props) {
  const [state, setState] = useState<PushState>(LOADING);
  const [ready, setReady] = useState(false);
  const [deviceCount, setDeviceCount] = useState(initialDeviceCount);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const next = await readPushState();
      if (cancelled) return;
      setState(next);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMessage(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((current) => ({ ...current, permission }));
        setMessage({
          tone: "error",
          text: "通知が許可されませんでした。ブラウザ（またはiOSの設定アプリ）でこのサイトの通知を許可してから、もう一度お試しください。",
        });
        return;
      }

      // 登録は何度呼んでも同じ1つになる。オンにした時点で初めて登録するのは、
      // 通知を使わない利用者にService Workerを常駐させないため。
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        // falseは主要ブラウザが軒並み拒否する（黙って通知を出す用途を塞ぐため）。
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!response.ok) {
        // サーバーへ保存できなかった購読は持っていても意味が無い。畳んでから知らせる。
        await subscription.unsubscribe().catch(() => {});
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error ?? "購読を保存できませんでした。");
      }

      const { deviceCount: count } = (await response.json()) as { deviceCount: number };
      setDeviceCount(count);
      setState((current) => ({ ...current, permission: "granted", subscribed: true }));
      setMessage({ tone: "info", text: "この端末で通知を受け取れるようになりました。" });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "通知を有効にできませんでした。",
      });
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setMessage(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;

      if (subscription) {
        // **サーバー側から先に消す。** 先にunsubscribe()すると、失敗したときに
        // 送り先だけがDBに残り、毎朝失敗し続ける。
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
        await subscription.unsubscribe();
      }

      setDeviceCount((current) => Math.max(0, current - 1));
      setState((current) => ({ ...current, subscribed: false }));
      setMessage({ tone: "info", text: "この端末への通知を止めました。" });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "通知を止められませんでした。",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as {
        delivered?: number;
        error?: string;
      };

      if (!response.ok) throw new Error(result.error ?? "テスト通知を送れませんでした。");

      setMessage(
        result.delivered && result.delivered > 0
          ? { tone: "info", text: `${result.delivered}台へ送りました。数秒で届きます。` }
          : {
              tone: "error",
              text: "送り先が1台もありませんでした。もう一度オンにし直してください。",
            },
      );
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "テスト通知を送れませんでした。",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">秘書からのお知らせ</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          毎朝1回、その日の予定・天気・部屋やシステムの状況をまとめて届けます。押すとその相談が
          開くので、そのまま続きを聞けます。
          <b className="font-medium text-foreground">
            {" "}
            届くのは1日1本まで。知らせることが無い日は届きません。
          </b>
        </p>
      </header>

      {publicKey === "" ? (
        <Notice tone="error">
          通知に必要な設定がサーバー側にありません。VAPIDの鍵が設定されるまで、この端末では
          通知を登録できません。
        </Notice>
      ) : !ready ? (
        <p className="text-[0.8125rem] text-muted">この端末の状態を確認しています…</p>
      ) : state.needsHomeScreen ? (
        <Notice tone="error" icon={<Smartphone className="mt-0.5 size-4 shrink-0" />}>
          iPhone・iPadでは、<b className="font-medium">ホーム画面に追加したときだけ</b>通知を
          受け取れます。共有ボタンから「ホーム画面に追加」で開き直してから、この画面をもう一度
          開いてください。
        </Notice>
      ) : !state.supported ? (
        <Notice tone="error">
          この端末（またはブラウザ）は通知に対応していません。ChromeかEdge、iPhoneでは
          ホーム画面に追加したSafariでお試しください。
        </Notice>
      ) : state.permission === "denied" ? (
        <Notice tone="error">
          このサイトの通知がブロックされています。ブラウザのサイト設定（iPhoneでは設定アプリの
          「通知」）で許可してから、もう一度お試しください。
        </Notice>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <b className="text-sm font-medium">この端末で受け取る</b>
            <span className="mt-0.5 block text-[0.6875rem] text-muted">
              {state.subscribed ? "受け取ります" : "受け取りません"}
              {deviceCount > 0 && ` ／ 登録済みの端末: ${deviceCount}台`}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {state.subscribed && (
              <button
                type="button"
                onClick={sendTest}
                disabled={busy}
                className="whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-rail-active disabled:opacity-50"
              >
                試しに送る
              </button>
            )}

            <button
              type="button"
              onClick={state.subscribed ? disable : enable}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50",
                state.subscribed
                  ? "border border-border bg-surface text-muted"
                  : "bg-accent text-accent-foreground",
              )}
            >
              {!state.subscribed && <BellRing className="size-3.5" aria-hidden="true" />}
              {state.subscribed ? "止める" : "受け取る"}
            </button>
          </div>
        </div>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <p className="text-xs leading-relaxed text-muted">
        通知は端末ごとに登録します。iPhoneとPCの両方で受け取りたいときは、それぞれの端末で
        この画面を開いてオンにしてください。
      </p>
    </section>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "info" | "error";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm leading-relaxed",
        tone === "error"
          ? "border-danger/30 bg-danger-surface text-danger"
          : "border-accent/30 bg-accent-surface",
      )}
    >
      {icon ?? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
