import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwindのクラス名を条件付きで組み立て、競合するユーティリティを後勝ちで解決する。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
