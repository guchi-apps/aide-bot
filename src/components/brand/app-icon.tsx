type Props = {
  className?: string;
  /** 見出しとして単独で置くときだけ渡す。並びの中の飾りなら省略して装飾扱いにする。 */
  title?: string;
};

/**
 * 秘書のロボット。`public/icon.svg`（ホーム画面・タブ用）と同じ絵を、画面の中でも使う。
 *
 * SVGファイルを `<img>` で読ませずインラインで持っているのは、26px前後で置く場所が多く、
 * 1つ描くたびにリクエストが増えるのが割に合わないため。絵を変えるときは
 * `public/icon.svg` とこの2か所を揃えて直す（`scripts/build-icons.sh` の説明も参照）。
 *
 * ファイル側にあるグラデーション・編み目の模様・maskable用の余白は、この大きさでは効かない
 * ので持たせていない。**同時に何個も並ぶ**（返答1件ごとにアイコンが付く）ので、
 * `id` を使う書き方にもしない——同じidが1ページに何個も出ることになる。
 */
export function AppIcon({ className, title }: Props) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="512" height="512" rx="112" fill="#e05a49" />
      {/* 足（体の後ろ側）と耳 */}
      <ellipse cx="148" cy="410" rx="30" ry="24" fill="#654030" />
      <ellipse cx="364" cy="410" rx="30" ry="24" fill="#654030" />
      <ellipse cx="110" cy="296" rx="25" ry="39" fill="#654030" />
      <ellipse cx="402" cy="296" rx="25" ry="39" fill="#654030" />
      {/* アンテナ */}
      <circle cx="256" cy="130" r="11" fill="#a9e5ff" />
      <rect x="252" y="132" width="8" height="42" rx="4" fill="#3a291f" />
      <ellipse cx="256" cy="176" rx="47" ry="13" fill="#654030" />
      {/* 体 */}
      <ellipse cx="256" cy="300" rx="152" ry="143" fill="#e8c295" />
      {/* 前の足 */}
      <ellipse cx="206" cy="432" rx="31" ry="22" fill="#654030" />
      <ellipse cx="306" cy="432" rx="31" ry="22" fill="#654030" />
      {/* 顔 */}
      <rect x="148" y="230" width="216" height="152" rx="72" fill="#2c211a" />
      <circle cx="206" cy="302" r="22" fill="none" stroke="#3ba7ff" strokeWidth="9" />
      <circle cx="206" cy="302" r="14" fill="#101d29" />
      <circle cx="198" cy="293" r="5.5" fill="#eaf7ff" />
      <circle cx="306" cy="302" r="22" fill="none" stroke="#3ba7ff" strokeWidth="9" />
      <circle cx="306" cy="302" r="14" fill="#101d29" />
      <circle cx="298" cy="293" r="5.5" fill="#eaf7ff" />
      <ellipse cx="256" cy="354" rx="14" ry="10" fill="#140e0a" />
      {/* アンテナから広がる波 */}
      <g fill="none" stroke="#5cc0ff" strokeLinecap="round">
        <path d="M224.1 141.6 A 34 34 0 0 1 244.4 98.1" strokeWidth="6" />
        <path d="M287.9 141.6 A 34 34 0 0 0 267.6 98.1" strokeWidth="6" />
        <path d="M207.1 147.8 A 52 52 0 0 1 238.2 81.1" strokeWidth="5" strokeOpacity="0.65" />
        <path d="M304.9 147.8 A 52 52 0 0 0 273.8 81.1" strokeWidth="5" strokeOpacity="0.65" />
      </g>
    </svg>
  );
}
