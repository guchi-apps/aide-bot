/*
 * 秘書アプリの Service Worker（#79）。
 *
 * **役割は通知の受け取りだけ。** 画面やAPIのキャッシュは一切しない。相談の内容は都度
 * サーバーから取るもので、古い返答を出す方が実害が大きいため。`fetch` ハンドラを
 * 持たないことで、ブラウザは通常どおりネットワークへ出る。
 *
 * このファイルは `public/` に置いて `/sw.js` として配る。**`src/proxy.ts` の matcher から
 * 除外してあること**（除外しないと未ログイン時に `/login` へのHTMLが返り、MIMEタイプ違いで
 * 登録に失敗する）。
 *
 * ビルドを通らない素のJSなので、TypeScriptもJSXも使えない。
 */

// 更新したSWをすぐ効かせる。通知の文面や遷移先を直したとき、次にタブを全部閉じるまで
// 古いSWが動き続けるのを避ける。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** 通知の既定値。payloadが壊れていても無音で消えないようにする。 */
const FALLBACK = {
  title: "秘書アプリ",
  body: "お知らせがあります。",
  url: "/",
  tag: "aide-bot",
};

self.addEventListener("push", (event) => {
  // payloadが無い push（購読の検証など）でも通知を出す必要がある。iOSとAndroidは
  // 「pushを受けたのに通知を出さない」を繰り返すと購読を切るため、必ず1つ出す。
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || FALLBACK.title;
  const url = payload.url || FALLBACK.url;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || FALLBACK.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // 同じ理由の通知を積み上げない。抑制はサーバー側（NotificationLog）でも掛けているが、
      // 端末側でも上書きにしておく。
      tag: payload.tag || FALLBACK.tag,
      renotify: false,
      // 押したときに開く先は data に持たせる。notificationclick からは
      // showNotification に渡したものしか読めない。
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || FALLBACK.url;

  // 既に開いているタブ（またはホーム画面から起動したPWA）があればそれを使い、
  // 無ければ新しく開く。毎回開くと相談のタブが増え続ける。
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          // 同じオリジンのタブを1つ再利用する。navigate が使えない実装のために
          // focus だけでも成立させる。
          if ("navigate" in client) {
            return client.navigate(target).then((navigated) => (navigated || client).focus());
          }
          return client.focus();
        }
      }

      return self.clients.openWindow(target);
    }),
  );
});

// 購読が期限切れ等でブラウザ側から差し替えられたとき。ここで取り直してもサーバーへ
// 送る手段（Cookie）が無い場合があるため、**古い購読を消すのはサーバー側の役目**にしてある
// （送信が 404 / 410 で返った購読は削除する）。ここでは登録し直すだけを試みる。
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey =
        event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : undefined;
      if (!applicationServerKey) return;

      let subscription = event.newSubscription;
      if (!subscription) {
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      // 認証Cookieが載る（same-origin）ので、そのまま登録し直せる。失敗しても黙って諦める
      // ——利用者が設定の画面を開けば登録し直せる。
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
        credentials: "include",
      }).catch(() => {});
    })(),
  );
});
