// @ts-check

// TypeScript（next.config.ts）にしない。本番の `next start` は .ts の設定ファイルを
// トランスパイルするためにSWCのネイティブバイナリを読み込み、そのまま常駐して
// メモリとスレッドを食う。.mjs なら読み込まれない（ops-dashboard#291・#304、aide-bot#291）。
/** @type {import("next").NextConfig} */
const nextConfig = {
  // スマートフォンからは <IP>.sslip.io か Tailscale の <ホスト>.ts.net で開く。
  // IPは変わりうるためホスト名を直書きしない。
  //
  // ワイルドカードは "*" が1ラベル、"**" が複数ラベルに対応する。sslip.ioのホスト名は
  // IPがそのままラベルになる（192.168.2.114.sslip.io）ため、"*.sslip.io" では一致せず、
  // devサーバーがJSチャンクをブロックしてハイドレーションが完了しなくなる。
  //
  // ここに載っていないホスト名で開くと、画面は出るのにボタンが一切効かない形で失敗する
  // （JSチャンクだけが403になり、HTMLは通るため。#24でts.net経由の確認時に踏んだ）。
  allowedDevOrigins: ["**.sslip.io", "**.ts.net"],
};

export default nextConfig;
