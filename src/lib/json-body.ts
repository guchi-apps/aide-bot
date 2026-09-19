/**
 * リクエスト本文をJSONのオブジェクトとして読む（#262）。
 *
 * `request.json()` は本文が `null` なら `null` を返し、`123` や `"text"` ならそのまま返す。
 * `as Body` と型を当てたまま `body.message` を読むと、`null` のときだけTypeErrorで500になる。
 * 呼び出し側が原因を切り分けられるよう、読めない本文はすべてここで `null` にまとめ、
 * Route Handlerは400（MCPなら `-32600`）を返す。
 *
 * 配列も落とす。どの口も受け取るのはオブジェクトで、配列を通すと `body.message` などが
 * 黙って `undefined` になり、「項目が無い」と「形が違う」の区別が付かなくなる。
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }

  return isJsonObject(value) ? value : null;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
