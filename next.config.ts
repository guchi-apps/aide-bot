import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
