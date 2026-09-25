type Props = {
  className?: string;
  /** 見出しとして単独で置くときだけ渡す。並びの中の飾りなら省略して装飾扱いにする。 */
  title?: string;
};

/**
 * MorrowのMマーク。`public/icon.svg`（ホーム画面・タブ用）と同じ絵を、画面の中でも使う。
 *
 * SVGファイルを `<img>` で読ませずインラインで持っているのは、26px前後で置く場所が多く、
 * 1つ描くたびにリクエストが増えるのが割に合わないため。絵を変えるときは
 * `public/icon.svg`・`public/icon-maskable.svg` とこの3か所を揃えて直す
 * （`scripts/build-icons.sh` の説明も参照）。
 *
 * ファイル側にない角丸と薄い縁取りを足してある。明るい背景でもアイボリーの地が沈まない
 * ようにするため。**同時に何個も並ぶ**（返答1件ごとにアイコンが付く）ので、`id` を使う
 * 書き方にはしない（同じidが1ページに何個も出る）。
 */
export function AppIcon({ className, title }: Props) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="1024" height="1024" rx="235" fill="#FFFAF5" />
      <rect
        x="12"
        y="12"
        width="1000"
        height="1000"
        rx="223"
        fill="none"
        stroke="#344458"
        strokeOpacity="0.14"
        strokeWidth="24"
      />
      <path
        d="M156 696 C192 412 260 300 336 300 C408 300 460 412 512 568 C564 412 616 300 688 300 C764 300 832 412 868 696"
        fill="none"
        stroke="#344458"
        strokeWidth="84"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M172 732 C296 820 436 760 512 604 C588 760 728 820 852 732"
        fill="none"
        stroke="#E99A80"
        strokeWidth="68"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="156" cy="696" r="40" fill="#344458" />
      <circle cx="868" cy="696" r="40" fill="#344458" />
    </svg>
  );
}

/**
 * 横長ロゴ（Mマーク＋Morrowの文字）。文字はHTMLで組み、明るい背景ではネイビー、
 * 暗い背景ではアイボリーにする。`className` の高さ（`size-*`ではなく文字の大きさ）で
 * 全体が伸び縮みする。
 */
export function AppLogo({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.55em] ${className ?? ""}`}>
      <AppIcon className={iconClassName ?? "size-[1.6em] shrink-0"} />
      <span className="font-bold leading-none tracking-tight text-[#344458] dark:text-[#fffaf5]">
        Morrow
      </span>
    </span>
  );
}
