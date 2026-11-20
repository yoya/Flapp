// SWF の中身（ヘッダ・制御・コンテンツ）を取り出して、表と詳細にできる形にする。SWF は実行しない（読むだけ）。
//
//   import { inspectSWF } from './inspect.js';
//   const report = await inspectSWF(bytes);   // { header, summary, tags }
//
// タグは、スプライトの中のものも、深さ（depth）と親のスプライト（parentSprite）つきで、ファイルの順に並べる。
// 壊れたタグは、その詳細にエラーを書き、ほかのタグは通常どおり出す。
import { parseSWF } from '../src/swf/parse.js';
import { tagNames } from '../src/swf/tagnames.js';
import { Reader } from '../src/swf/reader.js';
import { parseDefineEditText, parseDefineFont, parseDefineText } from '../src/swf/text.js';
import { parseDefineSound } from '../src/swf/sound.js';
import { parseABC, multinameText } from '../src/avm2/abc.js';

const SECTION = {
  control: [0, 1, 9, 41, 43, 58, 64, 65, 69, 77, 78, 92, 93],
  display: [4, 5, 26, 28, 70, 88],
  action: [12, 59, 72, 82, 76, 56, 57, 71, 42, 78],
  sound: [14, 15, 18, 19, 45, 89],
  video: [60, 61],
  sprite: [39],
};
// 定義（キャラクタ）の番号は本体の先頭の u16。ここに無いものは、定義ではない。
const DEFINITION_ID = new Set([2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 60, 62, 75, 83, 84, 87, 13]);

const hex = (bytes, max = 256) => {
  const lines = [];
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i += 16) {
    const row = [...bytes.subarray(i, Math.min(i + 16, n))];
    lines.push(`${i.toString(16).padStart(6, '0')}  ${row.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')}`);
  }
  if (bytes.length > max) lines.push(`… 残り ${bytes.length - max} バイト`);
  return lines.join('\n');
};

const sectionOf = (code) => {
  for (const [name, codes] of Object.entries(SECTION)) if (codes.includes(code)) return name;
  return DEFINITION_ID.has(code) ? 'definition' : 'other';
};

const rect = (r) => { const b = r.rect(); return `${b.xmin / 20},${b.ymin / 20} – ${b.xmax / 20},${b.ymax / 20} px`; };

// 各タグの詳細（[項目, 値] の並び と、表に出す短い要約）。失敗したら例外を投げる（呼び出し側が記録する）。
function decode(tag, state) {
  const r = new Reader(tag.body);
  const code = tag.code;
  const out = [];
  switch (code) {
    case 9: { const c = r.rgb(); out.push(['背景色', `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`]); return { details: out, summary: out[0][1] }; }
    case 69: {
      const f = r.u8();
      const flags = [[0, 'UseNetwork'], [3, 'ActionScript3'], [4, 'HasMetadata'], [5, 'UseGPU'], [6, 'UseDirectBlit']].filter(([bit]) => f & (1 << bit)).map(([, name]) => name);
      out.push(['属性', flags.join(', ') || 'なし']);
      return { details: out, summary: flags.join(', ') || 'なし' };
    }
    case 65: { const depth = r.u16(), seconds = r.u16(); out.push(['再帰の上限', depth], ['スクリプトの時間制限（秒）', seconds]); return { details: out, summary: `再帰 ${depth}、${seconds} 秒` }; }
    case 43: { const name = r.string(); out.push(['ラベル', name], ['フレーム', state.frame]); return { details: out, summary: `${name}（フレーム ${state.frame}）` }; }
    case 77: { const xml = r.string(); out.push(['メタデータ', xml.slice(0, 2000)]); return { details: out, summary: `${xml.length} 文字` }; }
    case 76: case 56: {
      const n = r.u16(); const list = [];
      for (let i = 0; i < n; i++) { const id = r.u16(); list.push([id, r.string()]); }
      for (const [id, name] of list) out.push([`ID ${id}`, name]);
      const label = code === 76 ? 'シンボルのクラス' : '書き出し';
      return { details: out, summary: `${label} ${n} 件（${list.slice(0, 3).map(([, n]) => n).join('、')}${n > 3 ? '…' : ''}）`, symbols: code === 76 ? list : null, exports: code === 56 ? list : null };
    }
    case 57: case 71: {
      const url = r.string();
      if (code === 71) { r.u8(); r.u8(); }
      const n = r.u16(); const list = [];
      for (let i = 0; i < n; i++) { const id = r.u16(); list.push([id, r.string()]); }
      out.push(['読み込み元', url]);
      for (const [id, name] of list) out.push([`ID ${id}`, name]);
      return { details: out, summary: `${url}（${n} 件）`, imports: list.map(([, name]) => `${url} : ${name}`) };
    }
    case 72: case 82: {
      let abcBytes = tag.body;
      if (code === 82) { r.u32(); const name = r.string(); out.push(['名前', name]); abcBytes = tag.body.subarray(r.pos); }
      const abc = parseABC(abcBytes);
      const classes = abc.instances.map((x) => multinameText(abc, x.name));
      out.push(['バージョン', `${abc.major}.${abc.minor}`], ['クラス', classes.length], ['メソッド', abc.methods.length], ['スクリプト', abc.scripts.length]);
      for (const c of classes) out.push(['クラス', c]);
      return { details: out, summary: `クラス ${classes.length}、メソッド ${abc.methods.length}`, classes, abc: { classes: classes.length, methods: abc.methods.length, scripts: abc.scripts.length, version: `${abc.major}.${abc.minor}` } };
    }
    case 39: { const id = r.u16(); const frames = r.u16(); out.push(['スプライト ID', id], ['フレーム', frames]); return { details: out, summary: `フレーム ${frames}`, id }; }
    case 2: case 22: case 32: case 83: { const id = r.u16(); out.push(['ID', id], ['範囲', rect(r)]); return { details: out, summary: `ID ${id}`, id }; }
    case 6: case 21: case 35: { const id = r.u16(); out.push(['ID', id]); return { details: out, summary: `ID ${id}（ビットマップ）`, id }; }
    case 20: case 36: { const id = r.u16(); const format = r.u8(), w = r.u16(), h = r.u16(); out.push(['ID', id], ['形式', format], ['大きさ', `${w} × ${h}`]); return { details: out, summary: `ID ${id}（${w} × ${h}）`, id }; }
    case 10: case 48: case 75: {
      const f = parseDefineFont(tag);
      out.push(['ID', f.id], ['名前', f.name || '（名前なし）'], ['字形の数', f.glyphCount], ['太字', f.bold], ['斜体', f.italic]);
      return { details: out, summary: `${f.name || '（名前なし）'}（字形 ${f.glyphCount}）`, id: f.id };
    }
    case 13: case 62: { const id = r.u16(); const nl = r.u8(); const name = new TextDecoder().decode(r.bytesView(nl)); out.push(['ID', id], ['名前', name]); return { details: out, summary: name, id }; }
    case 11: case 33: { const t = parseDefineText(tag); out.push(['ID', t.id], ['範囲', `${t.bounds.xmin / 20},${t.bounds.ymin / 20} – ${t.bounds.xmax / 20},${t.bounds.ymax / 20} px`]); return { details: out, summary: `ID ${t.id}`, id: t.id }; }
    case 37: {
      const e = parseDefineEditText(tag, false);
      out.push(['ID', e.id], ['変数', e.variableName || '（なし）'], ['初めの文字', (e.text ?? '').slice(0, 80)], ['大きさ', `${e.bounds.xmax / 20 - e.bounds.xmin / 20} × ${e.bounds.ymax / 20 - e.bounds.ymin / 20} px`]);
      return { details: out, summary: e.variableName || '（変数なし）', id: e.id };
    }
    case 14: {
      const s = parseDefineSound(tag);
      out.push(['ID', s.id], ['形式', s.format], ['サンプリング（Hz）', s.rate], ['サンプル数', s.sampleCount], ['チャンネル', s.channels]);
      return { details: out, summary: `${s.rate} Hz、${s.sampleCount} サンプル`, id: s.id };
    }
    case 60: { const id = r.u16(); const frames = r.u16(), w = r.u16(), h = r.u16(); out.push(['ID', id], ['フレーム数', frames], ['大きさ', `${w} × ${h}`]); return { details: out, summary: `${w} × ${h}、${frames} フレーム`, id }; }
    case 87: { const id = r.u16(); out.push(['ID', id], ['大きさ（バイト）', tag.body.length - 6]); return { details: out, summary: `${tag.body.length - 6} バイト`, id }; }
    case 12: out.push(['バイト数', tag.body.length]); return { details: out, summary: `${tag.body.length} バイト` };
    default: {
      if (DEFINITION_ID.has(code)) { const id = r.u16(); out.push(['ID', id]); return { details: out, summary: `ID ${id}`, id }; }
      out.push(['バイト数', tag.body.length]);
      return { details: out, summary: `${tag.body.length} バイト` };
    }
  }
}

/** SWF を読んで、ヘッダ・要約・タグの一覧を返す。 */
export async function inspectSWF(bytes) {
  const swf = await parseSWF(bytes);
  const header = {
    signature: swf.signature,
    compression: { FWS: '無圧縮', CWS: 'zlib', ZWS: 'LZMA' }[swf.signature] ?? swf.signature,
    version: swf.version,
    fileLength: swf.fileLength,
    width: (swf.frameSize.xmax - swf.frameSize.xmin) / 20,
    height: (swf.frameSize.ymax - swf.frameSize.ymin) / 20,
    frameRate: swf.frameRate,
    frameCount: swf.frameCount,
    warnings: swf.warnings,
  };
  const tags = [];
  const summary = { sections: {}, definitions: {}, labels: [], symbolClasses: [], exports: [], imports: [], abc: [], classes: [], sprites: 0, background: null, attributes: null, limits: null, frames: 0 };
  const walk = (list, depth, parentSprite, frameStart) => {
    let frame = 1;
    for (const t of list) {
      const code = t.code;
      const section = sectionOf(code);
      const row = {
        index: tags.length, offset: t.offset, length: t.length, code, name: t.name ?? tagNames[code] ?? `Tag ${code}`,
        section, depth, parentSprite, frame, id: null, summary: '', details: [], hex: hex(t.body), error: null,
      };
      try {
        const d = decode(t, { frame });
        row.summary = d.summary ?? '';
        row.details = d.details ?? [];
        if (d.id !== undefined && d.id !== null) row.id = d.id;
        if (code === 9) summary.background = d.summary;
        if (code === 69) summary.attributes = d.details;
        if (code === 65) summary.limits = d.summary;
        if (code === 43) summary.labels.push({ name: d.details[0][1], frame });
        if (d.symbols) summary.symbolClasses.push(...d.symbols.map(([id, name]) => ({ id, name })));
        if (d.exports) summary.exports.push(...d.exports.map(([id, name]) => ({ id, name })));
        if (d.imports) summary.imports.push(...d.imports);
        if (d.abc) { summary.abc.push(d.abc); summary.classes.push(...d.classes); }
      } catch (e) {
        row.error = e.message ?? String(e);
        row.summary = '（解釈できません）';
      }
      if (section === 'definition' || section === 'sprite' || section === 'sound' || section === 'video') {
        const kind = t.name ?? `Tag ${code}`;
        summary.definitions[kind] = (summary.definitions[kind] ?? 0) + 1;
      }
      summary.sections[section] = (summary.sections[section] ?? 0) + 1;
      tags.push(row);
      if (code === 1) frame++;
      if (code === 39 && t.tags) {
        summary.sprites++;
        walk(t.tags, depth + 1, t.spriteId, 1);
      }
    }
    if (depth === 0) summary.frames = frame - 1;
  };
  walk(swf.tags, 0, null, 1);
  summary.tagCount = tags.length;
  summary.bytes = swf.fileLength;
  return { header, summary, tags };
}
