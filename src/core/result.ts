/** 使用者操作無法完成的原因（UI 會轉成孩子看得懂的話）。 */
export type FoldError =
  | 'pick-on-line' // 點選的位置剛好在摺線上，分不出要翻哪一邊
  | 'nothing-to-fold' // 摺線沒有穿過紙，或某一邊根本沒有紙
  | 'too-thin'; // 會切出極細的碎片

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: FoldError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: FoldError): { readonly ok: false; readonly error: FoldError } => ({ ok: false, error });
