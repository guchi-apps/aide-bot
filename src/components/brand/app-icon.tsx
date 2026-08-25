type Props = {
  className?: string;
  /** 見出しとして単独で置くときだけ渡す。並びの中の飾りなら省略して装飾扱いにする。 */
  title?: string;
};

/**
 * 秘書のアイコン。`public/icon.svg`（ホーム画面・タブ用）と同じ絵を、画面の中でも使う。
 *
 * SVGファイルを `<img>` で読ませずインラインで持っているのは、26px前後で置く場所が多く、
 * 1つ描くたびにリクエストが増えるのが割に合わないため。絵を変えるときは
 * `public/icon.svg` とこの2か所を揃えて直す（`scripts/build-icons.sh` の説明も参照）。
 *
 * 角丸の背景はSVG側に持たせてあるので、呼ぶ側は大きさだけを決めればよい。
 * ファイル側にあるグラデーションと maskable 用の余白は、この大きさでは効かないので持たない。
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
      <rect width="512" height="512" rx="112" fill="#0d9488" />
      <path d="M152 222 L167 104 L253 175 Z" fill="#fff6ea" />
      <path d="M360 222 L345 104 L259 175 Z" fill="#fff6ea" />
      <path d="M180 197 L188 143 L227 180 Z" fill="#f6a09a" />
      <path d="M332 197 L324 143 L285 180 Z" fill="#f6a09a" />
      <circle cx="256" cy="284" r="132" fill="#fff6ea" />
      <circle cx="163" cy="322" r="21" fill="#f6a09a" />
      <circle cx="349" cy="322" r="21" fill="#f6a09a" />
      <ellipse cx="205" cy="272" rx="16" ry="20" fill="#12403c" />
      <ellipse cx="307" cy="272" rx="16" ry="20" fill="#12403c" />
      <circle cx="211" cy="265" r="5" fill="#fff6ea" />
      <circle cx="313" cy="265" r="5" fill="#fff6ea" />
      <path
        d="M232 320 q12 19 24 0 q12 19 24 0"
        fill="none"
        stroke="#12403c"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M196 410 L247 444 L196 478 Z" fill="#e8695c" />
      <path d="M316 410 L265 444 L316 478 Z" fill="#e8695c" />
      <circle cx="256" cy="444" r="18" fill="#cf5346" />
    </svg>
  );
}
