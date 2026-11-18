// テスト用の補助。

const WARNING_SJIS = [0x8c, 0x78, 0x8d, 0x90, 0x20, 0x3a, 0x20]; // "警告 : "（Shift-JIS）
const WARNING_EN = [...'Warning: '].map((c) => c.charCodeAt(0));

/**
 * 実機（デバッガ版）のログから trace() の出力行だけを取り出す。
 * デバッガ版は「未宣言の変数を参照した」などの警告も同じログに書く（OS の言語の符号化で）ので、それを除く。
 * @param {Uint8Array} bytes  test/expected/*.trace.txt の中身
 * @param {string} [encoding]  trace の文字コード。SWF 5 以前の出力は UTF-8 ではなく、SWF の中のバイト列のまま書かれる
 * @returns {string[]}
 */
export function realTrace(bytes, encoding = 'utf-8') {
  const lines = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    const line = bytes.subarray(start, i);
    start = i + 1;
    const startsWith = (prefix) => prefix.every((b, k) => line[k] === b);
    if (!startsWith(WARNING_SJIS) && !startsWith(WARNING_EN)) lines.push(new TextDecoder(encoding).decode(line));
  }
  return lines;
}
