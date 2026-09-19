/**
 * `node --test` が `@/…`（tsconfig の `paths`）を解決するためのフック。
 *
 * Next.js のビルドは `@/` を解決してくれるが、素のNodeは知らない。テスト対象は `@/lib/…` を
 * importしているので、`src/` 以下の `.ts` / `.tsx` へ引き直す。**依存パッケージは足さない**。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = specifier.slice(2);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      const url = new URL(candidate, SRC);
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
    }
  }
  return nextResolve(specifier, context);
}
