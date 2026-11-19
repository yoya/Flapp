// 書式つきのテキスト: 文字ごとの書式（フィールドが持つ fmts）と、HTML との変換。
//
// 書式は { font, size, color, bold, italic, underline, url, target, align, leftMargin, rightMargin, indent, leading, blockIndent,
// bullet, letterSpacing, kerning, display, tabStops }。書式のオブジェクトは変えずに、変えるときは新しく作る（文字どうしで共有する）。
// 段落（CR で終わる）の align・余白・字下げ・行間・箇条書きは、段落の最初の文字の書式で決まる（実機で確認）。
// 規則は、実機の htmlText の読み書きから確かめた（test/as3/textrich.as、textrich2.as）。

export const FORMAT_KEYS = [
  'font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading',
  'blockIndent', 'bullet', 'letterSpacing', 'kerning', 'display', 'tabStops',
];

/** base に、partial の null でない項目を重ねた、新しい書式。 */
export function mergeFormat(base, partial) {
  const out = { ...base };
  for (const key of FORMAT_KEYS) if (partial[key] !== null && partial[key] !== undefined) out[key] = partial[key];
  return out;
}

// 文字ごとに違えられる項目と、段落（CR で終わる）の最初の文字で決まる項目。
export const CHAR_KEYS = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'letterSpacing', 'kerning'];
export const PARAGRAPH_KEYS = ['align', 'leftMargin', 'rightMargin', 'indent', 'leading', 'blockIndent', 'bullet', 'tabStops', 'display'];

const sameValue = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b);

export function sameFormat(a, b) {
  if (a === b) return true;
  return FORMAT_KEYS.every((key) => sameValue(a[key], b[key]));
}

/** 書式の並び（文字ごと）の a〜b を 1 つにまとめる。項目の値が文字ごとに違えば null。 */
export function mergeRange(fmts, a, b) {
  const out = { ...fmts[a] };
  for (let i = a + 1; i < b; i++) for (const key of FORMAT_KEYS) if (out[key] !== null && !sameValue(out[key], fmts[i][key])) out[key] = null;
  return out;
}

/** 同じ書式（段落の項目も含めて全部）が続くところごとの { text, fmt } の並び。描画用（段落ごとの位置揃えなどを失わない）。 */
export function layoutRunsOf(text, fmts) {
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const last = runs[runs.length - 1];
    if (last && sameFormat(last.fmt, fmts[i])) last.text += text[i];
    else runs.push({ text: text[i], fmt: fmts[i] });
  }
  return runs;
}

/** 同じ書式が続くところごとの { text, fmt } の並び（文字ごとの項目だけで比べる。htmlText 用）。 */
export function runsOf(text, fmts) {
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    const last = runs[runs.length - 1];
    if (last && CHAR_KEYS.every((key) => last.fmt[key] === fmts[i][key])) last.text += text[i]; // 段落の項目は、段落の最初の文字のものを使う
    else runs.push({ text: text[i], fmt: fmts[i] });
  }
  return runs;
}

// --- HTML を読む ---

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, name) => {
  if (name[0] === '#') {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[name.toLowerCase()] ?? m;
});
const attrs = (source) => {
  const out = {};
  for (const m of source.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
};
// "#ff0000" は 16 進として読む（"#f00" は 0x000f00 になる）。"#" の無いものや、読めないものは 0。
const colorOf = (s) => (/^#[0-9a-f]+$/i.test(s) ? parseInt(s.slice(1), 16) & 0xffffff : 0);

/**
 * HTML を、文字列と文字ごとの書式にする。base は、書式を指定しない文字の書式。
 * 読むタグ: b i u font(face size color letterspacing kerning) a(href target) p(align) br li textformat(leftmargin rightmargin
 * indent blockindent leading tabstops) img。ほかのタグとコメントは捨てる。p・br・li の終わりは CR。img は空白 1 つ。
 * multiline が偽なら、CR は捨てる。condenseWhite が真なら、空白と改行の連なりを空白 1 つにする。
 */
export function parseHtml(html, base, { multiline = true, condenseWhite = false } = {}) {
  let text = '';
  const fmts = [];
  const stack = []; // { tag, patch }
  const current = () => stack.reduce((fmt, item) => mergeFormat(fmt, item.patch), base);
  const emit = (s, fmt) => { for (const ch of s) { text += ch; fmts.push(fmt); } };
  const closeTag = (name) => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === name) { stack.length = i; return; }
  };
  let open = null; // 段落（p・li・textformat の途中）の始まりの位置
  void open;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|<[\s\S]*|[^<]+/gi;
  for (const m of html.matchAll(re)) {
    const [whole, closing, rawName, rest] = m;
    if (rawName === undefined) {
      if (whole[0] === '<') continue; // コメント、不正なタグ
      let s = decode(whole).replace(/\r\n|\n/g, condenseWhite ? ' ' : '\r');
      if (condenseWhite) s = s.replace(/\s+/g, ' ');
      emit(s, current());
      continue;
    }
    const name = rawName.toLowerCase();
    if (closing) {
      if (rest.trim() !== '' || /^\s/.test(rest)) continue; // </b > のように空白が入ると、閉じない（実機で確認）
      if (name === 'p' || name === 'li') { emit('\r', current()); closeTag(name); } else closeTag(name);
      continue;
    }
    const a = attrs(rest);
    const size = base.size;
    switch (name) {
      case 'b': stack.push({ tag: 'b', patch: { bold: true } }); break;
      case 'i': stack.push({ tag: 'i', patch: { italic: true } }); break;
      case 'u': stack.push({ tag: 'u', patch: { underline: true } }); break;
      case 'font': {
        const patch = {};
        if (a.face !== undefined) patch.font = a.face;
        if (a.size !== undefined) patch.size = /^[+-]/.test(a.size) ? Math.max(1, size + Number(a.size)) : Math.max(1, Number(a.size) || 1);
        if (a.color !== undefined) patch.color = colorOf(a.color);
        if (a.letterspacing !== undefined) patch.letterSpacing = Number(a.letterspacing) || 0;
        if (a.kerning !== undefined) patch.kerning = a.kerning === '1' || a.kerning.toLowerCase() === 'true';
        stack.push({ tag: 'font', patch });
        break;
      }
      case 'a': stack.push({ tag: 'a', patch: { url: a.href ?? '', target: a.target ?? '' } }); break;
      case 'p': stack.push({ tag: 'p', patch: a.align ? { align: a.align.toLowerCase() } : {} }); break;
      case 'li': // 箇条書きの項目は、必ず新しい行から始まる（実機で確認）
        if (text && !text.endsWith('\r')) emit('\r', current());
        stack.push({ tag: 'li', patch: { bullet: true } });
        break;
      case 'textformat': {
        const n = (v) => (v === undefined ? undefined : Number(v) || 0);
        stack.push({
          tag: 'textformat',
          patch: {
            leftMargin: n(a.leftmargin), rightMargin: n(a.rightmargin), indent: n(a.indent), blockIndent: n(a.blockindent), leading: n(a.leading),
            tabStops: a.tabstops === undefined ? undefined : a.tabstops.split(',').map(Number).filter(Number.isFinite),
          },
        });
        break;
      }
      case 'br': emit('\r', current()); break;
      case 'img': emit(' ', current()); break;
      default: break; // 知らないタグは捨てる
    }
  }
  if (condenseWhite) {
    // タグをまたいでも、空白の連なりは 1 つ（実機で確認）。
    let t = '';
    const f = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ' && t.endsWith(' ')) continue;
      t += text[i];
      f.push(fmts[i]);
    }
    text = t;
    fmts.length = 0;
    fmts.push(...f);
  }
  return multiline ? { text, fmts } : { text: text.replace(/\r/g, ''), fmts: fmts.filter((_, i) => text[i] !== '\r') };
}

// --- HTML に書く ---

const ESCAPED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeText = (s) => s.replace(/[&<>"']/g, (ch) => ESCAPED[ch]);
const hex = (n) => `#${(n & 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`;
const fontAttrs = (f) => [['FACE', f.font || 'Times Roman'], ['SIZE', f.size], ['COLOR', hex(f.color)], ['LETTERSPACING', f.letterSpacing], ['KERNING', f.kerning ? 1 : 0]];

/**
 * 文字列と文字ごとの書式を、実機の htmlText と同じ形の HTML にする。段落（CR で終わる）ごとに <P ALIGN> か <LI>（余白などがあれば
 * <TEXTFORMAT> で包む）、その中は最初の文字の書式の <FONT>。途中で FONT の項目が変わったら、変わった項目だけの <FONT> を入れ子で開く
 * （段落の終わりまで閉じない）。文字ごとの A・B・I・U は、その文字の並びごとに包む。
 */
export function toHtml(text, fmts) {
  if (!text) return '';
  const paragraphs = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\r') { paragraphs.push([start, i]); start = i + 1; }
  if (start < text.length) paragraphs.push([start, text.length]);
  return paragraphs.map(([a, b]) => {
    const p = fmts[a] ?? fmts[Math.max(0, a - 1)];
    let out = '';
    let state = null;
    let depth = 0;
    for (const run of runsOf(text.slice(a, b), fmts.slice(a, b))) {
      const f = run.fmt;
      const now = fontAttrs(f);
      if (!state) out += `<FONT ${now.map(([k, v]) => `${k}="${v}"`).join(' ')}>`, depth++;
      else {
        const changed = now.filter(([, v], i) => v !== state[i][1]);
        if (changed.length) out += `<FONT ${changed.map(([k, v]) => `${k}="${v}"`).join(' ')}>`, depth++;
      }
      state = now;
      let body = escapeText(run.text);
      if (f.underline) body = `<U>${body}</U>`;
      if (f.italic) body = `<I>${body}</I>`;
      if (f.bold) body = `<B>${body}</B>`;
      if (f.url) body = `<A HREF="${f.url}" TARGET="${f.target ?? ''}">${body}</A>`;
      out += body;
    }
    if (!state) out += `<FONT ${fontAttrs(p).map(([k, v]) => `${k}="${v}"`).join(' ')}>`, depth++; // 空の段落
    out += '</FONT>'.repeat(depth);
    out = p.bullet ? `<LI>${out}</LI>` : `<P ALIGN="${p.align.toUpperCase()}">${out}</P>`;
    const layout = [['LEFTMARGIN', p.leftMargin], ['RIGHTMARGIN', p.rightMargin], ['INDENT', p.indent], ['LEADING', p.leading], ['BLOCKINDENT', p.blockIndent]]
      .filter(([, v]) => v).map(([k, v]) => ` ${k}="${v}"`).join('');
    return layout ? `<TEXTFORMAT${layout}>${out}</TEXTFORMAT>` : out;
  }).join('');
}
