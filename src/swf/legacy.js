// SWF 5 以前の文字列。
//
// SWF 6 以降の文字列は UTF-8 だが、SWF 5 以前は作成した環境の文字コード（日本語環境なら Shift-JIS）のバイト列で、
// どの文字コードかはファイルに書かれていない。実機は再生する OS の文字コードとして扱う。
// ここでは実機と同じく文字列をバイト列のまま持つ（JS の文字列の 1 文字 = 1 バイト）。名前の照合や比較、長さはバイト単位で、
// 画面や trace に出すときだけ、指定された文字コードで Unicode に直す。

// 2 バイト文字の 1 バイト目になる値（TextDecoder が返す正式な名前ごと）。ここに無い文字コードは 1 バイト文字だけとして扱う。
const LEAD_BYTE = {
  shift_jis: (b) => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc),
  'euc-kr': (b) => b >= 0x81 && b <= 0xfe,
  gbk: (b) => b >= 0x81 && b <= 0xfe,
  big5: (b) => b >= 0x81 && b <= 0xfe,
};

/** バイト列を、1 バイト = 1 文字の文字列にする。 */
export function byteString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return s;
}

export class LegacyText {
  /** @param {string} encoding  TextDecoder が受け付ける文字コード名（'shift_jis'、'windows-1252' など） */
  constructor(encoding) {
    this.decoder = new TextDecoder(encoding); // 未知の名前なら RangeError
    this.encoding = this.decoder.encoding;
    this.lead = LEAD_BYTE[this.encoding] ?? (() => false);
  }

  /** バイト列の文字列を Unicode の文字列にする（表示用）。 */
  decode(s) {
    return this.decoder.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }

  /** 各文字が始まるバイト位置と、末尾の位置。最後が 2 バイト文字の 1 バイト目だけで終わっていれば、その手前まで。 */
  #starts(s) {
    const starts = [];
    let i = 0;
    while (i < s.length) {
      const size = this.lead(s.charCodeAt(i)) ? 2 : 1;
      if (i + size > s.length) break;
      starts.push(i);
      i += size;
    }
    starts.push(i);
    return starts;
  }

  /** 文字数（mbLength）。 */
  length(s) {
    return this.#starts(s).length - 1;
  }

  /** 末尾に残った「2 バイト文字の 1 バイト目だけ」を落とす（実機は文字の途中で切れた分を捨てる）。 */
  whole(s) {
    const starts = this.#starts(s);
    return s.slice(0, starts[starts.length - 1]);
  }

  /** 文字単位の切り出し（mbSubstring）。from は 0 始まり、count が負なら末尾まで。 */
  slice(s, from, count) {
    const starts = this.#starts(s);
    const last = starts.length - 1;
    const a = Math.min(Math.max(0, from), last);
    const b = count < 0 ? last : Math.min(a + count, last);
    return s.slice(starts[a], starts[b]);
  }

  /** 名前の照合用に英大文字を小文字にする。2 バイト文字の 2 バイト目は、英字と同じ値でも変えない。 */
  lower(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const b = s.charCodeAt(i);
      if (this.lead(b) && i + 1 < s.length) {
        out += s[i] + s[i + 1];
        i++;
      } else {
        out += b >= 0x41 && b <= 0x5a ? String.fromCharCode(b + 0x20) : s[i];
      }
    }
    return out;
  }
}
