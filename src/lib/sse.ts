/**
 * Server-Sent Events の読み取り。`/api/chat` の返答を受ける側が共通で使う。
 *
 * 「書く」（`chat-panel.tsx`）と「話す」（`voice-panel.tsx`）で同じ経路を読むため、
 * 解釈はここ1か所に置く。どちらかだけ直して片方が取り残されるのを防ぐ。
 */

export type StreamEvent = { name: string; data: Record<string, unknown> };

/** SSEの1ブロック（空行区切り）をイベント名とJSONに分ける。 */
export function parseStreamEvent(block: string): StreamEvent | null {
  let name = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    const data = JSON.parse(dataLines.join("\n")) as unknown;
    if (typeof data !== "object" || data === null) return null;
    return { name, data: data as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}
