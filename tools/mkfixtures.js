// テスト用 SWF を生成して test/fixtures/ に書き出す。
// 仕様: docs/swf-file-format-spec-v19.pdf 1〜2 章（ヘッダ・RECT・タグ）、5 章（アクション）。
//
// zws-hello.swf だけはここで生成しない（Node に LZMA 圧縮が無いため）。lzma-src.swf を
// 次のコマンドで圧縮したものをコミットしている:
//   python3 -c 'import lzma,struct;d=open("test/fixtures/lzma-src.swf","rb").read();c=lzma.compress(d[8:],format=lzma.FORMAT_ALONE);open("test/fixtures/zws-hello.swf","wb").write(b"ZWS"+d[3:8]+struct.pack("<I",len(c)-13)+c[:5]+c[13:])'
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
export const u32 = (v) => [...u16(v & 0xffff), ...u16(v >>> 16)];
const cstr = (s) => [...new TextEncoder().encode(s), 0];

// RECT (Xmin=0, Ymin=0 固定)。単位は twips。
function rect(xmax, ymax) {
  const nbits = 32 - Math.clz32(Math.max(xmax, ymax)) + 1; // 符号ビット込み
  let bits = nbits.toString(2).padStart(5, '0');
  for (const v of [0, xmax, 0, ymax]) bits += v.toString(2).padStart(nbits, '0');
  bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  return bits.match(/.{8}/g).map((b) => parseInt(b, 2));
}

export function tag(code, body = []) {
  return body.length < 0x3f
    ? [...u16((code << 6) | body.length), ...body]
    : [...u16((code << 6) | 0x3f), ...u32(body.length), ...body];
}

export function swf({ version, width = 240, height = 160, fps = 12, frames = 1, zlib = false, tags }) {
  const body = Uint8Array.from([...rect(width * 20, height * 20), 0, fps, ...u16(frames), ...tags.flat()]);
  const head = [zlib ? 0x43 : 0x46, 0x57, 0x53, version, ...u32(8 + body.length)];
  return Uint8Array.from([...head, ...(zlib ? deflateSync(body) : body)]);
}

const SetBackgroundColor = (r, g, b) => tag(9, [r, g, b]);
const ShowFrame = () => tag(1);
const End = () => tag(0);
const DoAction = (actions) => tag(12, [...actions.flat(), 0]);
const PushString = (s) => [0x96, ...u16(s.length + 2), 0, ...cstr(s)]; // ASCII のみ
const Trace = () => [0x26];
const traceTag = (s) => DoAction([PushString(s), Trace()]);

// LZMA のリテラルと一致の両方を通すための、乱数と繰り返しが混ざった 4096 バイト。
let seed = 1;
const blob = Array.from({ length: 4096 }, (_, i) => {
  if (i % 512 >= 128) return 'Flapp LZMA '.charCodeAt(i % 11);
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 16) & 0xff;
});

export const fixtures = {
  // 背景色 + AVM1 の trace 1 回。実機の起動・trace 取得・画面取得の確認用。
  'trace-hello': swf({
    version: 8,
    tags: [SetBackgroundColor(0x33, 0x66, 0x99), traceTag('hello Flapp'), ShowFrame(), End()],
  }),
  // zlib 圧縮 (CWS)。
  'cws-hello': swf({
    version: 8, zlib: true,
    tags: [SetBackgroundColor(0x33, 0x99, 0x66), traceTag('hello CWS'), ShowFrame(), End()],
  }),
  // DefineSprite の入れ子。スプライト内のアクションが動くことで、タグ列の解釈を実機で裏付ける。
  'sprite-hello': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0x99, 0x66, 0x33),
      tag(39, [...u16(1), ...u16(1), ...traceTag('hello sprite'), ...ShowFrame(), ...End()]), // DefineSprite id=1
      tag(26, [0x02, ...u16(1), ...u16(1)]), // PlaceObject2: HasCharacter, depth=1, id=1
      ShowFrame(),
      End(),
    ],
  }),
  // zws-hello.swf の元になる無圧縮版。長いタグヘッダ (DefineBinaryData) を含む。
  'lzma-src': swf({
    version: 13,
    tags: [
      SetBackgroundColor(0x66, 0x33, 0x99),
      tag(87, [...u16(1), ...u32(0), ...blob]), // DefineBinaryData id=1
      traceTag('hello ZWS'),
      ShowFrame(),
      End(),
    ],
  }),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../test/fixtures/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(fixtures)) {
    writeFileSync(new URL(`${name}.swf`, dir), bytes);
    console.log(`${name}.swf ${bytes.length} bytes`);
  }
}
