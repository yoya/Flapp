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
  return a.img === b.img && FORMAT_KEYS.every((key) => sameValue(a[key], b[key]));
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
    if (last && last.fmt.img === fmts[i].img && CHAR_KEYS.every((key) => last.fmt[key] === fmts[i][key])) last.text += text[i]; // 段落の項目は、段落の最初の文字のものを使う
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

// --- StyleSheet（CSS）---
// スタイルは { fontSize: "20px", color: "#ff0000", … }（プロパティ名は camelCase、値は文字列）。書式の変更（partial）にする。
// 実機で確かめた読み方: color は "#" と 16 進の数字だけ（"#f0f" は 0x000f0f、名前や "!important" 付きは無視）。font-size は整数部分（0 以下は無視、
// "150%" は 150）。font-weight は bold / normal だけ、font-style は italic / normal、text-decoration は underline / none。
// font-family は、カンマのあとの空白を除き、sans-serif は _sans、serif は _serif（monospace はそのまま）。display: none は中身を捨てる。
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
export function cssPatch(style) {
  const patch = {};
  const set = (key, v) => { if (v !== undefined) patch[key] = v; };
  for (const [name, raw] of Object.entries(style)) {
    const v = String(raw).trim();
    switch (name) {
      case 'color': set('color', /^#[0-9a-f]{1,6}$/i.test(v) ? parseInt(v.slice(1), 16) : undefined); break;
      case 'fontFamily': set('font', v === '' ? undefined : { 'sans-serif': '_sans', serif: '_serif' }[v.toLowerCase()] ?? v.replace(/,\s+/g, ',')); break;
      case 'fontSize': { const n = Math.trunc(num(v) ?? 0); set('size', n > 0 ? n : undefined); break; }
      case 'fontWeight': set('bold', v === 'bold' ? true : v === 'normal' ? false : undefined); break;
      case 'fontStyle': set('italic', v === 'italic' ? true : v === 'normal' ? false : undefined); break;
      case 'textDecoration': set('underline', v === 'underline' ? true : v === 'none' ? false : undefined); break;
      case 'textAlign': set('align', ['left', 'center', 'right', 'justify'].includes(v) ? v : undefined); break;
      case 'marginLeft': set('leftMargin', num(v)); break;
      case 'marginRight': set('rightMargin', num(v)); break;
      case 'textIndent': set('indent', num(v)); break;
      case 'leading': set('leading', num(v)); break;
      case 'letterSpacing': set('letterSpacing', num(v)); break;
      case 'kerning': set('kerning', v === 'true' ? true : v === 'false' ? false : undefined); break;
      default: break;
    }
  }
  return patch;
}

// スタイルシートがあるときの、タグごとの扱い（実機で確認）: タグ名のスタイルが効くのは p・li・a と、b i u font textformat span br img 以外のタグ
// （div・em・h1 など。スタイルがあれば、終わりに改行が付く）。class の指定が効くのは span・p・li・a だけ。
const BUILTIN_TAGS = new Set(['b', 'i', 'u', 'font', 'textformat', 'span', 'br', 'img', 'p', 'li', 'a']);
const CLASS_TAGS = new Set(['span', 'p', 'li', 'a']);

/**
 * HTML を、文字列と文字ごとの書式にする。base は、書式を指定しない文字の書式。
 * 読むタグ: b i u font(face size color letterspacing kerning) a(href target) p(align) br li textformat(leftmargin rightmargin
 * indent blockindent leading tabstops) img。ほかのタグとコメントは捨てる。p・br・li の終わりは CR。img は大きさ 2 の空白 1 つ（書式の img に指定を持つ）。
 * multiline が偽なら、CR は捨てる。condenseWhite が真なら、空白と改行の連なりを空白 1 つにする。
 * styles は { get(セレクタ) → スタイル | null }（スタイルシート。上の cssPatch の形）。
 */
export function parseHtml(html, base, { multiline = true, condenseWhite = false, styles = null } = {}) {
  let text = '';
  const fmts = [];
  const stack = []; // { tag, patch, hidden }
  let block = null; // スタイルシートがあるとき、開いているブロックのタグ（1 つだけ。入れ子では最後に開いたもの。実機で確認）
  const current = () => stack.reduce((fmt, item) => mergeFormat(fmt, item.patch), base);
  const emit = (s, fmt) => { if (stack.some((item) => item.hidden)) return; for (const ch of s) { text += ch; fmts.push(fmt); } };
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
      if (styles) {
        if (block === name) { emit('\r', current()); block = null; }
        closeTag(name);
      } else if (name === 'p' || name === 'li') { emit('\r', current()); closeTag(name); } else closeTag(name);
      continue;
    }
    const a = attrs(rest);
    const size = base.size;
    if (styles && name !== 'font' && name !== 'b' && name !== 'i' && name !== 'u' && name !== 'textformat' && name !== 'br' && name !== 'img') {
      // スタイルシートで書式が決まるタグ。タグ名のスタイル、class の順に重ねる。
      const rules = [];
      const own = name === 'span' ? null : styles.get(name);
      if (own) rules.push(own);
      if (name === 'a') { const link = styles.get('a:link'); if (link) rules.push(link); }
      const cls = CLASS_TAGS.has(name) && a.class !== undefined ? styles.get(`.${a.class.toLowerCase()}`) : null;
      if (cls) rules.push(cls);
      const styled = BUILTIN_TAGS.has(name) || own;
      if (styled) {
        const patch = {};
        if (name === 'a') Object.assign(patch, { url: a.href ?? '', target: a.target ?? '' });
        if (name === 'p' && a.align) patch.align = a.align.toLowerCase();
        if (name === 'li') { if (text && !text.endsWith('\r')) emit('\r', current()); patch.bullet = true; }
        for (const rule of rules) Object.assign(patch, cssPatch(rule));
        stack.push({ tag: name, patch, hidden: rules.some((rule) => String(rule.display).trim() === 'none') });
        if (name === 'p' || name === 'li' || !BUILTIN_TAGS.has(name)) block = name;
      }
      continue;
    }
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
      case 'img': { // 画像は、大きさ 2 の空白 1 つになる（実機で確認。src が無いと、何も入らない）。画像の指定は、その文字の書式に持たせる
        if (a.src === undefined) break;
        const n = (v) => (v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
        const align = a.align === undefined ? undefined : a.align === 'right' ? 'right' : 'left'; // right 以外の指定は left になる（実機で確認）
        emit(' ', { ...current(), size: 2, img: { src: a.src, width: n(a.width), height: n(a.height), align, hspace: n(a.hspace), vspace: n(a.vspace), id: a.id } });
        break;
      }
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
  const attrsOf = (pairs) => pairs.map(([k, v]) => `${k}="${v}"`).join(' ');
  const imgTag = (img) => `<IMG ${attrsOf([['SRC', img.src], ['WIDTH', img.width], ['HEIGHT', img.height], ['ALIGN', img.align], ['VSPACE', img.vspace], ['HSPACE', img.hspace], ['ID', img.id]].filter(([, v]) => v !== undefined))}>`;
  return paragraphs.map(([a, b]) => {
    const p = fmts[a] ?? fmts[Math.max(0, a - 1)];
    let out = '';
    const states = []; // 開いている FONT の指定（外側から。段落の終わりまで閉じない。画像の FONT だけは、次が元の指定なら閉じる）
    let wrapped = false; // 直前が画像の文字で、その FONT（大きさ 2）が開いたまま
    const same = (x, y) => x.every(([, v], i) => v === y[i][1]);
    for (const run of runsOf(text.slice(a, b), fmts.slice(a, b))) {
      const f = run.fmt;
      const now = fontAttrs(f);
      if (wrapped) {
        if (states.length > 1 && same(now, states[states.length - 2])) states.pop(), out += '</FONT>';
        wrapped = false;
      }
      const top = states[states.length - 1];
      if (!top) { out += `<FONT ${attrsOf(now)}>`; states.push(now); } else if (!same(now, top)) {
        out += `<FONT ${attrsOf(now.filter(([, v], i) => v !== top[i][1]))}>`;
        states.push(now);
        wrapped = !!f.img;
      }
      // 画像の文字は、IMG のあとに空白が 1 つ付く。リンクは IMG も包み、太字などは空白だけを包む（実機で確認）。
      let body = escapeText(run.text);
      if (f.underline) body = `<U>${body}</U>`;
      if (f.italic) body = `<I>${body}</I>`;
      if (f.bold) body = `<B>${body}</B>`;
      if (f.img) body = imgTag(f.img) + body;
      if (f.url) body = `<A HREF="${f.url}" TARGET="${f.target ?? ''}">${body}</A>`;
      out += body;
    }
    if (!states.length) { out += `<FONT ${attrsOf(fontAttrs(p))}>`; states.push(null); } // 空の段落
    out += '</FONT>'.repeat(states.length);
    out = p.bullet ? `<LI>${out}</LI>` : `<P ALIGN="${p.align.toUpperCase()}">${out}</P>`;
    const layout = [['LEFTMARGIN', p.leftMargin], ['RIGHTMARGIN', p.rightMargin], ['INDENT', p.indent], ['LEADING', p.leading], ['BLOCKINDENT', p.blockIndent]]
      .filter(([, v]) => v).map(([k, v]) => ` ${k}="${v}"`).join('');
    return layout ? `<TEXTFORMAT${layout}>${out}</TEXTFORMAT>` : out;
  }).join('');
}
