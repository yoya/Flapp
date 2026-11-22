// タグの中身を、入れ子の項目まで、字下げした行にする（tools/swfdump.js の -D / --full）。
//   シェイプのレコード、塗りと線のスタイル、行列と色変換、配置（PlaceObject）、ボタンのレコード、フォントの字形と文字コード、
//   テキストのレコード、AVM1 のアクションと AVM2 の ABC、音とビデオのストリームの頭など。
// 項目の名前は仕様書（SWF File Format Specification v19、AVM2 Overview）の名前。座標と幅は twips。
// SWF は実行しない（読むだけ）。解釈は src/swf/ と src/avm2/ のものを使い、AVM1 のアクションの並びだけはここで読む。
//
//   const ctx = dumpContext(report.header.version);
//   for (const row of report.tags) dumpTag(row, ctx, lines);   // row は inspectSWF のタグの行
import { Reader } from '../src/swf/reader.js';
import { parseDefineShape } from '../src/swf/shape.js';
import { readMorphShape } from '../src/swf/morph.js';
import { parsePlaceObject, parseRemoveObject, parseDefineButton } from '../src/swf/display.js';
import { parseDefineFont, parseDefineFontInfo, parseDefineText, parseDefineEditText } from '../src/swf/text.js';
import { parseDefineSound, parseStartSound, parseDefineButtonSound, parseSoundStreamHead, parseSoundStreamBlock } from '../src/swf/sound.js';
import { parseDefineVideoStream, parseVideoFrame } from '../src/swf/video.js';
import { imageFile } from '../src/swf/bitmap.js';
import { scanMP3 } from '../src/audio/decode.js';
import { readPictureHeader } from '../src/video/h263.js';
import { parseABC, multinameText } from '../src/avm2/abc.js';
import { OPS, decodeCode } from '../src/avm2/ops.js';

const hex2 = (v) => v.toString(16).padStart(2, '0');
const addr = (v) => v.toString(16).padStart(4, '0');
// 不透明なら #rrggbb、アルファがあれば #rrggbbaa。
const color = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a === 255 ? '' : hex2(c.a)}`;
const rect = (b) => `(${b.xmin}, ${b.ymin}) – (${b.xmax}, ${b.ymax})`;
const matrix = (m) => `[a=${m.a} b=${m.b} c=${m.c} d=${m.d} tx=${m.tx} ty=${m.ty}]`;
const cxform = (c) => `[mult=${c.rm},${c.gm},${c.bm},${c.am} add=${c.ra},${c.ga},${c.ba},${c.aa}]`;
const flagNames = (v, table) => table.filter(([bit]) => v & bit).map(([, name]) => name).join(',') || 'none';

// ClipEventFlags（下位バイトから並べた値。SWF 5 は下位 16 ビットだけ）。
const CLIP_EVENTS = [
  [0x01, 'Load'], [0x02, 'EnterFrame'], [0x04, 'Unload'], [0x08, 'MouseMove'], [0x10, 'MouseDown'], [0x20, 'MouseUp'], [0x40, 'KeyDown'], [0x80, 'KeyUp'],
  [0x100, 'Data'], [0x200, 'Initialize'], [0x400, 'Press'], [0x800, 'Release'], [0x1000, 'ReleaseOutside'], [0x2000, 'RollOver'], [0x4000, 'RollOut'], [0x8000, 'DragOver'],
  [0x10000, 'DragOut'], [0x20000, 'KeyPress'], [0x40000, 'Construct'],
];
// BUTTONCONDACTION の条件（下位バイトから並べた 16 ビットの下位 9 ビット）。
const BUTTON_CONDS = [
  [0x01, 'IdleToOverUp'], [0x02, 'OverUpToIdle'], [0x04, 'OverUpToOverDown'], [0x08, 'OverDownToOverUp'], [0x10, 'OverDownToOutDown'],
  [0x20, 'OutDownToOverDown'], [0x40, 'OutDownToIdle'], [0x80, 'IdleToOverDown'], [0x100, 'OverDownToIdle'],
];
// DefineFunction2 のフラグ（下位バイトから並べた 16 ビット）。
const FUNCTION2_FLAGS = [
  [0x01, 'PreloadThis'], [0x02, 'SuppressThis'], [0x04, 'PreloadArguments'], [0x08, 'SuppressArguments'], [0x10, 'PreloadSuper'],
  [0x20, 'SuppressSuper'], [0x40, 'PreloadRoot'], [0x80, 'PreloadParent'], [0x100, 'PreloadGlobal'],
];

// AVM1 のアクション（仕様 5 章）。0x2d は Flash Lite の FSCommand2。
const AVM1_OPS = {
  0x00: 'End', 0x04: 'NextFrame', 0x05: 'PreviousFrame', 0x06: 'Play', 0x07: 'Stop', 0x08: 'ToggleQuality', 0x09: 'StopSounds',
  0x0a: 'Add', 0x0b: 'Subtract', 0x0c: 'Multiply', 0x0d: 'Divide', 0x0e: 'Equals', 0x0f: 'Less', 0x10: 'And', 0x11: 'Or', 0x12: 'Not',
  0x13: 'StringEquals', 0x14: 'StringLength', 0x15: 'StringExtract', 0x17: 'Pop', 0x18: 'ToInteger', 0x1c: 'GetVariable', 0x1d: 'SetVariable',
  0x20: 'SetTarget2', 0x21: 'StringAdd', 0x22: 'GetProperty', 0x23: 'SetProperty', 0x24: 'CloneSprite', 0x25: 'RemoveSprite', 0x26: 'Trace',
  0x27: 'StartDrag', 0x28: 'EndDrag', 0x29: 'StringLess', 0x2a: 'Throw', 0x2b: 'CastOp', 0x2c: 'ImplementsOp', 0x2d: 'FSCommand2',
  0x30: 'RandomNumber', 0x31: 'MBStringLength', 0x32: 'CharToAscii', 0x33: 'AsciiToChar', 0x34: 'GetTime', 0x35: 'MBStringExtract',
  0x36: 'MBCharToAscii', 0x37: 'MBAsciiToChar', 0x3a: 'Delete', 0x3b: 'Delete2', 0x3c: 'DefineLocal', 0x3d: 'CallFunction', 0x3e: 'Return',
  0x3f: 'Modulo', 0x40: 'NewObject', 0x41: 'DefineLocal2', 0x42: 'InitArray', 0x43: 'InitObject', 0x44: 'TypeOf', 0x45: 'TargetPath',
  0x46: 'Enumerate', 0x47: 'Add2', 0x48: 'Less2', 0x49: 'Equals2', 0x4a: 'ToNumber', 0x4b: 'ToString', 0x4c: 'PushDuplicate', 0x4d: 'StackSwap',
  0x4e: 'GetMember', 0x4f: 'SetMember', 0x50: 'Increment', 0x51: 'Decrement', 0x52: 'CallMethod', 0x53: 'NewMethod', 0x54: 'InstanceOf',
  0x55: 'Enumerate2', 0x60: 'BitAnd', 0x61: 'BitOr', 0x62: 'BitXor', 0x63: 'BitLShift', 0x64: 'BitRShift', 0x65: 'BitURShift',
  0x66: 'StrictEquals', 0x67: 'Greater', 0x68: 'StringGreater', 0x69: 'Extends',
  0x81: 'GotoFrame', 0x83: 'GetURL', 0x87: 'StoreRegister', 0x88: 'ConstantPool', 0x8a: 'WaitForFrame', 0x8b: 'SetTarget', 0x8c: 'GoToLabel',
  0x8d: 'WaitForFrame2', 0x8e: 'DefineFunction2', 0x8f: 'Try', 0x94: 'With', 0x96: 'Push', 0x99: 'Jump', 0x9a: 'GetURL2', 0x9b: 'DefineFunction',
  0x9d: 'If', 0x9e: 'Call', 0x9f: 'GotoFrame2',
};

// AVM2 の命令のうち、最初のオペランドが multiname の番号のもの。
const MULTINAME_OPS = new Set([
  'getsuper', 'setsuper', 'getdescendants', 'findpropstrict', 'findproperty', 'finddef', 'getlex', 'setproperty', 'getproperty', 'initproperty',
  'deleteproperty', 'coerce', 'astype', 'istype', 'callproperty', 'callproplex', 'callsuper', 'callsupervoid', 'callpropvoid', 'constructprop',
]);

const fillText = (s) => {
  if (s.type === 'solid') return `solid ${color(s.color)}`;
  if (s.type === 'bitmap') return `bitmap id=${s.bitmapId} ${s.repeat ? 'repeat' : 'clip'} ${s.smooth ? 'smooth' : 'nosmooth'} matrix=${matrix(s.matrix)}`;
  return `${s.type} spread=${s.spread} interpolation=${s.linearRGB ? 'linearRGB' : 'normal'}${s.focal ? ` focal=${s.focal}` : ''} ` +
    `matrix=${matrix(s.matrix)} stops=[${s.stops.map((g) => `${g.ratio}:${color(g.color)}`).join(' ')}]`;
};

const lineText = (s) => {
  const parts = [`width=${s.width}`, s.fill ? `fill=(${fillText(s.fill)})` : `color=${color(s.color)}`];
  if (s.noHScale !== undefined) { // LINESTYLE2
    parts.push(`cap=${s.startCap}/${s.endCap}`, `join=${s.join}${s.miterLimit !== undefined ? `(${s.miterLimit})` : ''}`);
    for (const k of ['noHScale', 'noVScale', 'pixelHinting', 'noClose']) if (s[k]) parts.push(k);
  }
  return parts.join(' ');
};

const imageType = (b) => {
  if (b[0] === 0x89 && b[1] === 0x50) return 'PNG';
  if (b[0] === 0x47 && b[1] === 0x49) return 'GIF';
  if ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0xff && b[1] === 0xd9)) return 'JPEG';
  return 'unknown';
};

/** ファイル全体で引き継ぐ状態（フォントの字形の数と文字コード、タイムラインごとのストリームの音の形式、ビデオのコーデック）。 */
export function dumpContext(version) {
  return { version, fonts: new Map(), streamHeads: new Map(), videos: new Map() };
}

/**
 * inspectSWF のタグの行（row.raw が元のタグ）を、字下げ（2 文字ずつ）した行にして out に足す。
 * 壊れていれば、そこまでの行を out に残したまま例外を投げる。足す項目の無いタグは何も足さない。
 */
export function dumpTag(row, ctx, out = []) {
  const tag = row.raw;
  const body = tag.body;
  const legacy = ctx.version < 6;
  const put = (depth, text) => out.push(`${'  '.repeat(depth)}${text}`);
  // SWF 5 以前の文字列はバイト列のまま（1 バイト = 1 文字）なので、ASCII の外は \xHH で出す。
  const quote = (s) => (legacy ? JSON.stringify(s).replace(/[\u0080-ÿ]/g, (c) => `\\x${hex2(c.charCodeAt(0))}`) : JSON.stringify(s));
  const val = (v) => {
    if (typeof v === 'string') return quote(v);
    if (v === null || typeof v !== 'object') return String(v);
    if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
    if (v instanceof Uint8Array) return `${v.length} bytes`;
    if ('tx' in v && 'a' in v) return matrix(v);
    if ('rm' in v) return cxform(v);
    if ('r' in v && 'g' in v && 'b' in v && Object.keys(v).length === 4) return color(v);
    return `{${Object.entries(v).map(([k, x]) => `${k}=${val(x)}`).join(' ')}}`;
  };
  const styles = (depth, fills, lines) => {
    put(depth, `FillStyles (${fills.length})`);
    fills.forEach((s, i) => put(depth + 1, `[${i + 1}] ${fillText(s)}`));
    put(depth, `LineStyles (${lines.length})`);
    lines.forEach((s, i) => put(depth + 1, `[${i + 1}] ${lineText(s)}`));
  };
  const records = (depth, label, list) => {
    put(depth, `${label} (${list.length})`);
    for (const rec of list) {
      if (rec.type === 'line') { put(depth + 1, `StraightEdge to (${rec.x}, ${rec.y})`); continue; }
      if (rec.type === 'curve') { put(depth + 1, `CurvedEdge control (${rec.cx}, ${rec.cy}) to (${rec.x}, ${rec.y})`); continue; }
      const parts = ['StyleChange'];
      if (rec.moveTo) parts.push(`moveTo (${rec.moveTo.x}, ${rec.moveTo.y})`);
      for (const k of ['fill0', 'fill1', 'line']) if (k in rec) parts.push(`${k}=${rec[k]}`);
      if (rec.fillStyles) parts.push('NewStyles');
      put(depth + 1, parts.join(' '));
      if (rec.fillStyles) styles(depth + 2, rec.fillStyles, rec.lineStyles);
    }
  };
  const codeChar = (code) => (code === undefined ? '' : `0x${code.toString(16).padStart(4, '0')}${(!legacy || code < 0x80) && code >= 0x20 ? ` ${JSON.stringify(String.fromCodePoint(code))}` : ''}`);
  const filters = (depth, list) => {
    put(depth, `SurfaceFilterList (${list.length})`);
    for (const f of list) put(depth + 1, `${f.type} ${Object.entries(f).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${val(v)}`).join(' ')}`);
  };

  // AVM1 のアクションの並び。分岐先と関数の終わりは、絶対位置（この並びの先頭から）で出す。
  const actions = (depth, code) => {
    let pool = [];
    let p = 0;
    while (p < code.length) {
      const at = p;
      const op = code[p++];
      const name = AVM1_OPS[op] ?? `Unknown_0x${hex2(op)}`;
      let len = 0;
      if (op >= 0x80) {
        if (p + 2 > code.length) { put(depth, `${addr(at)}  ${name} (truncated)`); return; }
        len = code[p] | (code[p + 1] << 8);
        p += 2;
        if (p + len > code.length) { put(depth, `${addr(at)}  ${name} (truncated: length ${len})`); return; }
      }
      const r = new Reader(code.subarray(p, p + len), legacy);
      p += len;
      const next = p;
      const branch = () => { const off = r.s16(); return `${off} (→ ${addr(next + off)})`; };
      let text = '';
      const sub = [];
      switch (op) {
        case 0x81: text = `frame=${r.u16()}`; break;
        case 0x83: text = `url=${quote(r.string())} target=${quote(r.string())}`; break;
        case 0x87: text = `register=${r.u8()}`; break;
        case 0x88: {
          pool = [];
          for (let n = r.u16(); n > 0; n--) pool.push(r.string());
          text = `count=${pool.length}`;
          pool.forEach((s, i) => sub.push(`[${i}] ${quote(s)}`));
          break;
        }
        case 0x8a: text = `frame=${r.u16()} skip=${r.u8()}`; break;
        case 0x8b: case 0x8c: text = quote(r.string()); break;
        case 0x8d: text = `skip=${r.u8()}`; break;
        case 0x9b: {
          const fname = r.string();
          const params = [];
          for (let n = r.u16(); n > 0; n--) params.push(r.string());
          const size = r.u16();
          text = `${quote(fname)} (${params.join(', ')}) codeSize=${size} (→ ${addr(next + size)})`;
          break;
        }
        case 0x8e: {
          const fname = r.string();
          const count = r.u16();
          const registers = r.u8();
          const flags = r.u16();
          const params = [];
          for (let n = count; n > 0; n--) { const reg = r.u8(); params.push(`${reg ? `r${reg}:` : ''}${r.string()}`); }
          const size = r.u16();
          text = `${quote(fname)} (${params.join(', ')}) registers=${registers} flags=${flagNames(flags, FUNCTION2_FLAGS)} codeSize=${size} (→ ${addr(next + size)})`;
          break;
        }
        case 0x8f: {
          const f = r.u8();
          const trySize = r.u16(), catchSize = r.u16(), finallySize = r.u16();
          const target = f & 0x04 ? `register=${r.u8()}` : `name=${quote(r.string())}`;
          text = `trySize=${trySize} catchSize=${catchSize} finallySize=${finallySize} catch=${f & 0x01 ? 'yes' : 'no'} finally=${f & 0x02 ? 'yes' : 'no'} ${target}`;
          break;
        }
        case 0x94: { const size = r.u16(); text = `size=${size} (→ ${addr(next + size)})`; break; }
        case 0x96: {
          const values = [];
          while (r.remaining > 0) {
            const type = r.u8();
            if (type === 0) values.push(quote(r.string()));
            else if (type === 1) values.push(`float:${r.f32()}`);
            else if (type === 2) values.push('null');
            else if (type === 3) values.push('undefined');
            else if (type === 4) values.push(`r${r.u8()}`);
            else if (type === 5) values.push(r.u8() ? 'true' : 'false');
            else if (type === 6) {
              // DOUBLE は上位 4 バイトが先に入っている
              const hi = r.u32(), lo = r.u32();
              const d = new DataView(new ArrayBuffer(8));
              d.setUint32(4, hi, true);
              d.setUint32(0, lo, true);
              values.push(`double:${d.getFloat64(0, true)}`);
            } else if (type === 7) values.push(`int:${r.s32()}`);
            else if (type === 8 || type === 9) {
              const i = type === 8 ? r.u8() : r.u16();
              values.push(`c${i}${pool[i] !== undefined ? `=${quote(pool[i])}` : ''}`);
            } else { values.push(`(unknown type ${type})`); break; }
          }
          text = values.join(', ');
          break;
        }
        case 0x99: case 0x9d: text = branch(); break;
        case 0x9a: {
          const f = r.u8();
          text = `method=${['none', 'GET', 'POST', '?'][f >> 6]} loadTarget=${f & 0x02 ? 'sprite' : 'window'} loadVariables=${(f & 0x01) !== 0}`;
          break;
        }
        case 0x9f: {
          const f = r.u8();
          text = `play=${(f & 0x01) !== 0}${f & 0x02 ? ` sceneBias=${r.u16()}` : ''}`;
          break;
        }
        default: if (len) text = `(${len} bytes)`;
      }
      put(depth, `${addr(at)}  ${name}${text ? ` ${text}` : ''}`);
      for (const s of sub) put(depth + 1, s);
    }
  };

  // AVM2 の ABC。クラス・スクリプト・メソッド（本体の命令列つき）の順に出す。
  const abcDump = (depth, bytes) => {
    const abc = parseABC(bytes);
    const mn = (i) => multinameText(abc, i);
    const entry = (list, i) => (list[i] === undefined ? `?${i}` : JSON.stringify(list[i]));
    const traits = (d, list) => {
      for (const t of list) {
        let s = `Trait ${t.kind} ${mn(t.name)}`;
        if (t.kind === 'slot' || t.kind === 'const') s += ` slot=${t.slotId} : ${mn(t.typeName)}${t.hasValue ? ` = ${val(t.value)}` : ''}`;
        else if (t.kind === 'class') s += ` slot=${t.slotId} class=${t.classIndex}`;
        else if (t.kind === 'function') s += ` slot=${t.slotId} method=${t.method}`;
        else s += ` disp=${t.dispId} method=${t.method}`;
        if (t.final) s += ' final';
        if (t.override) s += ' override';
        if (t.metadata) s += ` metadata=[${t.metadata.map((i) => abc.metadata[i]?.name ?? `?${i}`).join(', ')}]`;
        put(d, s);
      }
    };
    const operands = (ins) => {
      const a = ins.args;
      if (!a.length) return '';
      const kinds = OPS[ins.op]?.[1] ?? '';
      if (MULTINAME_OPS.has(ins.name)) return [mn(a[0]), ...a.slice(1)].join(', ');
      switch (ins.name) {
        case 'pushstring': case 'debugfile': case 'dxns': return entry(abc.strings, a[0]);
        case 'pushint': return String(abc.ints[a[0]] ?? `?${a[0]}`);
        case 'pushuint': return String(abc.uints[a[0]] ?? `?${a[0]}`);
        case 'pushdouble': return String(abc.doubles[a[0]] ?? `?${a[0]}`);
        case 'pushnamespace': return abc.namespaces[a[0]] ? JSON.stringify(abc.namespaces[a[0]].uri) : `?${a[0]}`;
        case 'newclass': return `${a[0]} (${abc.instances[a[0]] ? mn(abc.instances[a[0]].name) : '?'})`;
        case 'newfunction': return `method ${a[0]}`;
        case 'callstatic': return `method ${a[0]}, ${a[1]}`;
        case 'lookupswitch': return `default → ${addr(a[0])}, cases → [${a.slice(1).map(addr).join(', ')}]`;
        default: return kinds === 'o' ? `→ ${addr(a[0])}` : a.join(', ');
      }
    };
    const count = (list) => list.length - 1; // 定数プールの 0 番は、データに無い「無し」の値
    put(depth, `version ${abc.major}.${abc.minor}`);
    put(depth, `ConstantPool int=${count(abc.ints)} uint=${count(abc.uints)} double=${count(abc.doubles)} string=${count(abc.strings)} ` +
      `namespace=${count(abc.namespaces)} nsSet=${count(abc.nsSets)} multiname=${count(abc.multinames)}`);
    abc.metadata.forEach((m, i) => put(depth, `Metadata [${i}] ${m.name} ${m.items.map((it) => `${it.key}=${JSON.stringify(it.value)}`).join(' ')}`));
    abc.instances.forEach((inst, i) => {
      const flags = ['sealed', 'final', 'isInterface'].filter((k) => inst[k]);
      put(depth, `Class [${i}] ${mn(inst.name)} extends ${mn(inst.superName)}` +
        `${inst.interfaces.length ? ` implements ${inst.interfaces.map(mn).join(', ')}` : ''}${flags.length ? ` (${flags.join(', ')})` : ''}` +
        `${inst.protectedNs ? ` protectedNs=${JSON.stringify(inst.protectedNs.uri)}` : ''}`);
      put(depth + 1, `iinit: method ${inst.init}`);
      traits(depth + 1, inst.traits);
      put(depth + 1, `cinit: method ${abc.classes[i].init}`);
      traits(depth + 1, abc.classes[i].traits);
    });
    abc.scripts.forEach((s, i) => {
      put(depth, `Script [${i}] init: method ${s.init}`);
      traits(depth + 1, s.traits);
    });
    abc.methods.forEach((m, i) => {
      const params = m.paramTypes.map((t, k) => `${m.paramNames?.[k] ? `${m.paramNames[k]}:` : ''}${mn(t)}`).join(', ');
      const flags = ['needArguments', 'needActivation', 'needRest', 'setDxns'].filter((k) => m[k]);
      put(depth, `Method [${i}]${m.name ? ` ${JSON.stringify(m.name)}` : ''} (${params}) : ${mn(m.returnType)}${flags.length ? ` (${flags.join(', ')})` : ''}`);
      if (m.optional.length) put(depth + 1, `optional: ${m.optional.map(val).join(', ')}`);
      const b = m.body;
      if (!b) return;
      put(depth + 1, `body maxStack=${b.maxStack} localCount=${b.localCount} initScopeDepth=${b.initScopeDepth} maxScopeDepth=${b.maxScopeDepth} code=${b.code.length} bytes`);
      for (const ins of decodeCode(b.code)) {
        const o = operands(ins);
        put(depth + 2, `${addr(ins.at)}  ${ins.name}${o ? ` ${o}` : ''}${ins.broken ? ' (broken)' : ''}`);
      }
      for (const e of b.exceptions) put(depth + 1, `exception from=${addr(e.from)} to=${addr(e.to)} target=${addr(e.target)} type=${mn(e.type)} var=${mn(e.varName)}`);
      if (b.traits.length) {
        put(depth + 1, 'activation traits');
        traits(depth + 2, b.traits);
      }
    });
  };

  switch (tag.code) {
    case 2: case 22: case 32: case 83: {
      const s = parseDefineShape(tag);
      put(0, `ShapeBounds: ${rect(s.bounds)}`);
      if (s.edgeBounds) {
        put(0, `EdgeBounds: ${rect(s.edgeBounds)}`);
        put(0, `UsesWindingRule: ${s.usesWindingRule}`);
      }
      styles(0, s.fillStyles, s.lineStyles);
      records(0, 'ShapeRecords', s.records);
      break;
    }
    case 46: case 84: {
      const m = readMorphShape(tag);
      put(0, `StartBounds: ${rect(m.startBounds)}`);
      put(0, `EndBounds: ${rect(m.endBounds)}`);
      if (m.startEdgeBounds) { put(0, `StartEdgeBounds: ${rect(m.startEdgeBounds)}`); put(0, `EndEdgeBounds: ${rect(m.endEdgeBounds)}`); }
      put(0, `MorphFillStyles (${m.fillStyles.length})`);
      m.fillStyles.forEach((s, i) => { put(1, `[${i + 1}] start: ${fillText(s.start)}`); put(1, `${' '.repeat(String(i + 1).length + 2)} end: ${fillText(s.end)}`); });
      put(0, `MorphLineStyles (${m.lineStyles.length})`);
      m.lineStyles.forEach((s, i) => { put(1, `[${i + 1}] start: ${lineText(s.start)}`); put(1, `${' '.repeat(String(i + 1).length + 2)} end: ${lineText(s.end)}`); });
      records(0, 'StartEdges', m.startRecords);
      records(0, 'EndEdges', m.endRecords);
      break;
    }
    case 4: case 26: case 70: {
      const p = parsePlaceObject(tag, ctx.version);
      put(0, `Depth: ${p.depth}`);
      if (tag.code !== 4) put(0, `Move: ${p.move}`);
      const keys = [['className', 'ClassName'], ['characterId', 'CharacterId'], ['matrix', 'Matrix'], ['cxform', 'ColorTransform'], ['ratio', 'Ratio'],
        ['name', 'Name'], ['clipDepth', 'ClipDepth'], ['blendMode', 'BlendMode'], ['visible', 'Visible']];
      for (const [k, label] of keys) if (k in p) put(0, `${label}: ${val(p[k])}`);
      if ('opaqueBackground' in p) put(0, `BackgroundColor: #${p.opaqueBackground.toString(16).padStart(6, '0')}`);
      if (p.filters) filters(0, p.filters);
      if (p.clipActions) {
        put(0, `ClipActions (${p.clipActions.length})`);
        for (const a of p.clipActions) {
          put(1, `ClipActionRecord events=${flagNames(a.events, CLIP_EVENTS)}${'keyCode' in a ? ` keyCode=${a.keyCode}` : ''}`);
          actions(2, a.code);
        }
      }
      break;
    }
    case 5: case 28: {
      const p = parseRemoveObject(tag);
      if ('characterId' in p) put(0, `CharacterId: ${p.characterId}`);
      put(0, `Depth: ${p.depth}`);
      break;
    }
    case 7: case 34: {
      const b = parseDefineButton(tag);
      if (tag.code === 34) put(0, `TrackAsMenu: ${(body[2] & 1) !== 0}`);
      put(0, `ButtonRecords (${b.records.length})`);
      for (const rec of b.records) {
        const states = ['up', 'over', 'down', 'hitTest'].filter((k) => rec[k]).join(',') || 'none';
        put(1, `ButtonRecord states=${states} CharacterId=${rec.characterId} Depth=${rec.depth} Matrix=${matrix(rec.matrix)}` +
          `${rec.cxform ? ` ColorTransform=${cxform(rec.cxform)}` : ''}${rec.blendMode ? ` BlendMode=${rec.blendMode}` : ''}`);
        if (rec.filters) filters(2, rec.filters);
      }
      if (tag.code === 7) {
        put(0, 'Actions');
        actions(1, b.actions[0].code);
      } else {
        put(0, `ButtonCondActions (${b.actions.length})`);
        for (const a of b.actions) {
          put(1, `ButtonCondAction conditions=${flagNames(a.cond, BUTTON_CONDS)}${a.key ? ` keyPress=${a.key}` : ''}`);
          actions(2, a.code);
        }
      }
      break;
    }
    case 23: {
      const r = new Reader(body);
      put(0, `ButtonId: ${r.u16()}`);
      put(0, `ColorTransform: ${cxform(r.cxform(false))}`);
      break;
    }
    case 17: {
      const s = parseDefineButtonSound(tag);
      put(0, `ButtonId: ${s.buttonId}`);
      for (const [event, { soundId, info }] of Object.entries(s.sounds)) put(0, `${event}: SoundId=${soundId} ${Object.entries(info).map(([k, v]) => `${k}=${val(v)}`).join(' ')}`);
      break;
    }
    case 10: case 48: case 75: {
      const f = parseDefineFont(tag);
      ctx.fonts.set(f.id, { glyphCount: f.glyphCount, codes: f.codes });
      if (tag.code !== 10) {
        put(0, `FontName: ${quote(f.name)}`);
        put(0, `Bold: ${f.bold}  Italic: ${f.italic}`);
      }
      put(0, `EMSquare: ${f.unitsPerEm}`);
      if (f.advances) put(0, `Ascent: ${f.ascent}  Descent: ${f.descent}  Leading: ${f.leading}`);
      put(0, `Glyphs (${f.glyphCount})`);
      for (let i = 0; i < f.glyphCount; i++) {
        const parts = [`[${i}]`];
        if (f.codes) parts.push(`code=${codeChar(f.codes[i])}`);
        if (f.advances) parts.push(`advance=${f.advances[i]}`);
        put(1, parts.join(' '));
        try {
          records(2, 'GlyphShape', f.glyphRecords(i));
        } catch (e) {
          put(2, `GlyphShape: 解釈できません: ${e.message}`);
        }
      }
      break;
    }
    case 13: case 62: {
      const id = body[0] | (body[1] << 8);
      const known = ctx.fonts.get(id);
      const info = parseDefineFontInfo(tag, known?.glyphCount ?? Infinity);
      if (known) known.codes = info.codes;
      else ctx.fonts.set(id, { glyphCount: info.codes.length, codes: info.codes });
      put(0, `FontId: ${info.id}`);
      put(0, `FontName: ${quote(info.name)}`);
      put(0, `Bold: ${info.bold}  Italic: ${info.italic}`);
      put(0, `CodeTable (${info.codes.length})`);
      info.codes.forEach((c, i) => put(1, `[${i}] ${codeChar(c)}`));
      break;
    }
    case 88: {
      const r = new Reader(body);
      put(0, `FontId: ${r.u16()}`);
      put(0, `FontName: ${quote(r.string())}`);
      put(0, `FontCopyright: ${quote(r.string())}`);
      break;
    }
    case 11: case 33: {
      const t = parseDefineText(tag);
      put(0, `TextBounds: ${rect(t.bounds)}`);
      put(0, `TextMatrix: ${matrix(t.matrix)}`);
      put(0, `TextRecords (${t.records.length})`);
      let fontId;
      for (const rec of t.records) {
        if ('fontId' in rec) fontId = rec.fontId;
        const parts = ['TextRecord'];
        for (const [k, label] of [['fontId', 'FontId'], ['height', 'TextHeight'], ['color', 'TextColor'], ['xOffset', 'XOffset'], ['yOffset', 'YOffset']]) {
          if (k in rec) parts.push(`${label}=${val(rec[k])}`);
        }
        put(1, parts.join(' '));
        put(2, `GlyphEntries (${rec.glyphs.length}): ${rec.glyphs.map((g) => `${g.index}:${g.advance}`).join(' ')}`);
        const codes = ctx.fonts.get(fontId)?.codes;
        if (codes && !legacy) put(2, `Text: ${JSON.stringify(rec.glyphs.map((g) => (codes[g.index] === undefined ? '?' : String.fromCodePoint(codes[g.index]))).join(''))}`);
      }
      break;
    }
    case 37: {
      const e = parseDefineEditText(tag, legacy);
      put(0, `Bounds: ${rect(e.bounds)}`);
      for (const [k, v] of Object.entries(e)) if (k !== 'id' && k !== 'bounds') put(0, `${k}: ${val(v)}`);
      break;
    }
    case 74: {
      const r = new Reader(body);
      put(0, `TextId: ${r.u16()}`);
      const useFlashType = r.ub(2), gridFit = r.ub(3);
      r.ub(3);
      put(0, `UseFlashType: ${useFlashType}  GridFit: ${gridFit}`);
      put(0, `Thickness: ${r.f32()}  Sharpness: ${r.f32()}`);
      break;
    }
    case 14: {
      const s = parseDefineSound(tag);
      put(0, `SoundFormat: ${s.format}  SoundRate: ${s.rate}  SoundSize: ${s.bits}  SoundType: ${s.channels === 2 ? 'stereo' : 'mono'}`);
      put(0, `SoundSampleCount: ${s.sampleCount}`);
      if (s.format === 'mp3') {
        put(0, `SeekSamples: ${s.seekSamples}`);
        const m = scanMP3(s.data);
        put(0, `MP3Frames: ${m.frames} (samples ${m.samples}, ${m.rate} Hz, ${m.channels} ch)`);
      }
      put(0, `SoundData: ${s.data.length} bytes`);
      break;
    }
    case 15: case 89: {
      const s = parseStartSound(tag);
      put(0, 'className' in s ? `SoundClassName: ${quote(s.className)}` : `SoundId: ${s.soundId}`);
      put(0, `SoundInfo: ${Object.entries(s.info).map(([k, v]) => `${k}=${val(v)}`).join(' ')}`);
      break;
    }
    case 18: case 45: {
      const h = parseSoundStreamHead(tag);
      ctx.streamHeads.set(row.parentSprite, h);
      put(0, `StreamSoundCompression: ${h.format}  StreamSoundRate: ${h.rate}  StreamSoundSize: ${h.bits}  StreamSoundType: ${h.channels === 2 ? 'stereo' : 'mono'}`);
      put(0, `StreamSoundSampleCount: ${h.samplesPerFrame}`);
      if (h.format === 'mp3') put(0, `LatencySeek: ${h.latencySeek}`);
      break;
    }
    case 19: {
      const head = ctx.streamHeads.get(row.parentSprite);
      if (!head) { put(0, `StreamSoundData: ${body.length} bytes (SoundStreamHead がありません)`); break; }
      const b = parseSoundStreamBlock(tag, head);
      if (head.format === 'mp3') {
        put(0, `SampleCount: ${b.sampleCount}  SeekSamples: ${b.seekSamples}`);
        put(0, `MP3Frames: ${scanMP3(b.data).frames}`);
      }
      put(0, `StreamSoundData: ${b.data.length} bytes`);
      break;
    }
    case 60: {
      const v = parseDefineVideoStream(tag);
      ctx.videos.set(v.id, v.codec);
      put(0, `NumFrames: ${v.numFrames}  Width: ${v.width}  Height: ${v.height}`);
      put(0, `VideoFlagsDeblocking: ${v.deblocking}  VideoFlagsSmoothing: ${v.smoothing}  CodecID: ${v.codec}`);
      break;
    }
    case 61: {
      const f = parseVideoFrame(tag);
      put(0, `StreamID: ${f.streamId}  FrameNum: ${f.frameNum}  VideoData: ${f.data.length} bytes`);
      if (ctx.videos.get(f.streamId) === 'h263') {
        try {
          const h = readPictureHeader(f.data);
          put(0, `PictureHeader: version=${h.version} size=${h.width}x${h.height} type=${['intra', 'inter', 'disposable'][h.type]} quantizer=${h.quant}`);
        } catch (e) {
          put(0, `PictureHeader: 解釈できません: ${e.message}`);
        }
      }
      break;
    }
    case 6: case 21: case 35: case 90: {
      const r = new Reader(body);
      r.u16();
      let alphaOffset = null;
      if (tag.code === 35 || tag.code === 90) alphaOffset = r.u32();
      if (tag.code === 90) put(0, `DeblockParam: ${r.fixed8()}`);
      const image = body.subarray(r.pos, alphaOffset === null ? body.length : Math.min(body.length, r.pos + alphaOffset));
      put(0, `ImageData: ${imageType(image)}, ${image.length} bytes`);
      try {
        // 古い JPEG は、先頭に FF D9 FF D8（実機が読み飛ばす誤った頭）が付いていることがある
        const im = imageFile(image[0] === 0xff && image[1] === 0xd9 && image[2] === 0xff && image[3] === 0xd8 ? image.subarray(4) : image);
        if (im) put(0, `Size: ${im.width} x ${im.height}`);
      } catch (e) {
        put(0, `Size: 解釈できません: ${e.message}`);
      }
      if (alphaOffset !== null) put(0, `BitmapAlphaData: ${Math.max(0, body.length - r.pos - alphaOffset)} bytes (zlib)`);
      break;
    }
    case 20: case 36: {
      const r = new Reader(body);
      r.u16();
      const format = r.u8();
      put(0, `BitmapFormat: ${format} (${{ 3: 'colormapped 8-bit', 4: 'RGB 15-bit', 5: tag.code === 36 ? 'ARGB 32-bit' : 'RGB 24-bit' }[format] ?? 'unknown'})`);
      put(0, `BitmapWidth: ${r.u16()}  BitmapHeight: ${r.u16()}`);
      if (format === 3) put(0, `BitmapColorTableSize: ${r.u8() + 1}`);
      put(0, `ZlibBitmapData: ${r.remaining} bytes`);
      break;
    }
    case 8: put(0, `JPEGData: ${body.length} bytes`); break;
    case 12: actions(0, body); break;
    case 59: {
      const r = new Reader(body);
      put(0, `SpriteId: ${r.u16()}`);
      actions(0, body.subarray(2));
      break;
    }
    case 72: abcDump(0, body); break;
    case 82: {
      const r = new Reader(body);
      put(0, `Flags: ${r.u32()}`);
      put(0, `Name: ${JSON.stringify(r.string())}`);
      abcDump(0, body.subarray(r.pos));
      break;
    }
    case 86: {
      const r = new Reader(body);
      const scenes = r.encodedU32();
      put(0, `Scenes (${scenes})`);
      for (let i = 0; i < scenes; i++) put(1, `offset=${r.encodedU32()} name=${quote(r.string())}`);
      const labels = r.encodedU32();
      put(0, `FrameLabels (${labels})`);
      for (let i = 0; i < labels; i++) put(1, `frame=${r.encodedU32()} label=${quote(r.string())}`);
      break;
    }
    case 78: {
      const r = new Reader(body);
      put(0, `CharacterId: ${r.u16()}`);
      put(0, `Splitter: ${rect(r.rect())}`);
      break;
    }
    case 66: {
      const r = new Reader(body);
      put(0, `Depth: ${r.u16()}  TabIndex: ${r.u16()}`);
      break;
    }
    default:
      break;
  }
  return out;
}
