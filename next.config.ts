import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // スマートフォンからは <IP>.sslip.io で開く。IPは変わりうるためホスト名を直書きしない。
  //
  // ワイルドカードは "*" が1ラベル、"**" が複数ラベルに対応する。sslip.ioのホスト名は
  // IPがそのままラベルになる（192.168.2.114.sslip.io）ため、"*.sslip.io" では一致せず、
  // devサーバーがJSチャンクをブロックしてハイドレーションが完了しなくなる。
  allowedDevOrigins: ["**.sslip.io"],
};

export default nextConfig;
