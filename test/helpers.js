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
  let warning = false; // 直前の行が警告（警告の続きの "-- …" の行も除く）
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    const line = bytes.subarray(start, i);
    start = i + 1;
    const startsWith = (prefix) => prefix.every((b, k) => line[k] === b);
    if (startsWith(WARNING_SJIS) || startsWith(WARNING_EN) || (warning && startsWith([0x2d, 0x2d, 0x20]))) { warning = true; continue; }
    warning = false;
    lines.push(new TextDecoder(encoding).decode(line));
  }
  return lines;
}

// 入力の手順のキー名 → [仮想キーコード, 文字コード]。ここに無い 1 文字のキーは、その文字（英字は大文字のコード）として扱う。
const KEYS = { Enter: [13, 13], ArrowLeft: [37, 0], ArrowUp: [38, 0], ArrowRight: [39, 0], ArrowDown: [40, 0], ' ': [32, 32] };

/**
 * <名前>.input.json の手順をムービーに与える（実機へは tools/oracle-input.js が同じ手順を送る）。
 * 実機では手順の間にもフレームが進むので、1 手順ごとに frames 回フレームを進める。
 * @param {import('../src/player/movie.js').Movie} movie
 * @param {Array<[string, ...any]>} steps  ["move", x, y] / ["down"] / ["up"] / ["key", 名前]（座標はステージの px）
 */
export function replayInput(movie, steps, frames = 1) {
  for (const [kind, a, b] of steps) {
    if (kind === 'move') movie.mouseMove(a * 20, b * 20);
    else if (kind === 'down') movie.mouseDown();
    else if (kind === 'up') movie.mouseUp();
    else if (kind === 'key') {
      const [code, ascii] = KEYS[a] ?? [a.toUpperCase().charCodeAt(0), a.charCodeAt(0)];
      movie.keyDown(code, ascii);
      movie.keyUp(code);
    }
    for (let i = 0; i < frames; i++) movie.advance();
  }
}
