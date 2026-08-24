"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 秘書の返答をMarkdownとして表示する。
 *
 * react-markdown は既定で生のHTMLを描画しない（rehype-rawを入れていない）。返答は
 * 外部のモデルが作った文字列なので、この既定のまま使う。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
          // 幅の広い表でページごと横に伸びないよう、表だけを包んでスクロールさせる。
          table: ({ children: rows }) => (
            <div className="chat-md-scroll">
              <table>{rows}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
