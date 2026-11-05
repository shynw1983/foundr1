/** Translate validation context without turning store-authored display text into UI copy. */
export function translatePosDisplayStandbyError(error: string, t: (value: string, values?: Record<string, string | number>) => string) {
  const block = /^(縦向き|横向き)の(\d+)番目の表示の(.+)$/.exec(error);
  if (block) return t("{orientation}・部品 {number}：{message}", { orientation: t(block[1]), number: block[2], message: t(block[3]) });
  const count = /^(縦向き|横向き)の待機画面には16個まで配置できます。$/.exec(error);
  if (count) return t("{orientation}には16個まで配置できます。", { orientation: t(count[1]) });
  return t(error);
}
