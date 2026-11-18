// test/as/*.as（ActionScript 1/2 のソース）をコンパイルして、test/fixtures/as-*.swf を作る。
//
//   node tools/mkas.js [名前 ...]      名前を省くと全部
//
// コンパイルには FFDec (JPEXS Free Flash Decompiler) の取り込み機能を使うので、Java と FFDec が要る。
// FFDec の場所は環境変数 FFDEC_CLI（ffdec-cli.jar のパス）で変えられる。
// 生成した SWF はコミットしてあるので、テストを走らせるだけなら FFDec は不要。
//
// ソースの書き方:
//   先頭のコメントで SWF の構成を指定する（省略可）。
//     // swf: 6                              SWF のバージョン（既定は 8）
//     // sprite: 1 frames 2 name mc depth 1  スプライト 1 を 2 フレームで定義し、ルートの 1 フレーム目に名前 mc・深度 1 で置く
//     //         ... in 2                    ルートではなくスプライト 2 の中に置く
//     //         ... export sym              attachMovie 用の書き出し名を付ける（この場合は置かない）
//     //         ... square 40               中身として 40px の正方形を持たせる
//     //         ... at 20,30                置く位置（px）
//     // label: 3 loop                       ルートの 3 フレーム目にフレームラベル loop を付ける
//     // label: 2 _over sprite 1             スプライト 1 の 2 フレーム目にラベルを付ける
//   本文は「//// 」で始まる行で区切る。区切りが無ければ全体がルートの 1 フレーム目。
//     //// frame 2                 ルートの 2 フレーム目のスクリプト
//     //// sprite 1 frame 1        スプライト 1 の 1 フレーム目のスクリプト
//     //// sprite 1 on load        スプライト 1 を置くときに付ける onClipEvent(load) の中身（ルートに置くスプライトだけ）。
//                                  load / enterFrame / unload / mouseDown / mouseUp / mouseMove / keyDown / keyUp と、
//                                  on(press) の形になる press / release / releaseOutside / rollOver / rollOut / dragOver / dragOut
// 入力を与えるテストは、手順を test/fixtures/as-<名前>.input.json に置く（tools/oracle-input.js を参照）。
// スクリプトは有限回の trace で終わるように書く（実機の出力は再生開始から数秒後に取るため）。
//
// FFDec 21.0.2 のコンパイラの制約（ソース側で避ける）:
//   - for 文の初期化式を出力しない。`var i = 0; for (; i < n; i++)` のようにループの前で初期化する
//   - 単項の +、void、オブジェクトリテラルの文字列・数値のキーは構文エラーになる
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefineSprite, End, PlaceObject2, ShowFrame, square, swf, tag, u16 } from './mkfixtures.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'test/as');
const outDir = join(root, 'test/fixtures');
const workDir = join(root, 'tmp/as-build');
const ffdec = process.env.FFDEC_CLI ?? join(homedir(), 'Applications/FFDec.app/Contents/Resources/ffdec-cli.jar');

// 取り込み先になる、中身が trace 1 つだけのアクション。
const placeholder = () => tag(12, [0x96, 3, 0, 0, 0x78, 0, 0x26, 0]); // Push "x"; Trace; End
const cstr = (s) => [...new TextEncoder().encode(s), 0];

// クリップイベントのフラグ（PlaceObject2 の CLIPEVENTFLAGS を下位バイトから並べた値）。0x0400 以上は on(press) の形で書く。
const EVENTS = {
  load: 0x01, enterFrame: 0x02, unload: 0x04, mouseMove: 0x08, mouseDown: 0x10, mouseUp: 0x20, keyDown: 0x40, keyUp: 0x80,
  press: 0x0400, release: 0x0800, releaseOutside: 0x1000, rollOver: 0x2000, rollOut: 0x4000, dragOver: 0x8000, dragOut: 0x010000,
};

function build(name) {
  const source = readFileSync(join(srcDir, `${name}.as`), 'utf8');
  let version = 8;
  const sprites = new Map(); // ID → { frames, name, depth, parent, exportName, squareSize }
  const labels = new Map(); // ルートのフレーム番号 → ラベル
  const spriteLabels = new Map(); // "スプライト ID:フレーム番号" → ラベル
  for (const line of source.split('\n')) {
    let m;
    if ((m = line.match(/^\/\/ swf: (\d+)/))) version = Number(m[1]);
    if ((m = line.match(/^\/\/ label: (\d+) (\S+) sprite (\d+)/))) spriteLabels.set(`${m[3]}:${m[1]}`, m[2]);
    else if ((m = line.match(/^\/\/ label: (\d+) (\S+)/))) labels.set(Number(m[1]), m[2]);
    if ((m = line.match(/^\/\/ sprite: (\d+)(.*)/))) {
      const opt = (key) => m[2].match(new RegExp(` ${key} (\\S+)`))?.[1];
      sprites.set(Number(m[1]), {
        frames: Number(opt('frames') ?? 1), name: opt('name'), depth: Number(opt('depth') ?? m[1]),
        parent: opt('in') ? Number(opt('in')) : 0, exportName: opt('export'), squareSize: opt('square') ? Number(opt('square')) : 0,
        at: (opt('at') ?? '0,0').split(',').map(Number),
      });
    }
  }

  const badLoop = source.split('\n').findIndex((line) => /\bfor\s*\(\s*[^;)\s][^;)]*;/.test(line));
  if (badLoop >= 0) throw new Error(`${name}: line ${badLoop + 1}: for 文の初期化式は FFDec が出力しないので、ループの前に書く`);

  // FFDec が使うスプライトのフォルダ名。書き出し名があればそれが後ろに付く。
  const spriteFolder = (id) => `DefineSprite_${id}${sprites.get(id)?.exportName ? `_${sprites.get(id).exportName}` : ''}`;

  // 本文を区切りごとのスクリプトに分ける。キーは FFDec が書き出すときのフォルダ名。
  const scripts = new Map();
  let key = 'frame_1';
  let rootFrames = 1;
  for (const line of source.split('\n')) {
    const ev = line.match(/^\/\/\/\/ sprite (\d+) on (\w+)/);
    if (ev && !(ev[2] in EVENTS)) throw new Error(`${name}: 未対応のクリップイベント ${ev[2]}`);
    const m = line.match(/^\/\/\/\/ (?:sprite (\d+) )?frame (\d+)/);
    if (ev) {
      const id = Number(ev[1]);
      key = `frame_1/PlaceObject2_${id}_${sprites.get(id).depth}/CLIPACTIONRECORD ${EVENTS[ev[2]] >= 0x0400 ? 'on' : 'onClipEvent'}(${ev[2]})`;
      (sprites.get(id).events ??= []).push(ev[2]);
    } else if (m) {
      key = m[1] ? `${spriteFolder(Number(m[1]))}/frame_${m[2]}` : `frame_${m[2]}`;
      if (!m[1]) rootFrames = Math.max(rootFrames, Number(m[2]));
    } else if (/^\/\/ frames: (\d+)/.test(line)) {
      rootFrames = Math.max(rootFrames, Number(line.match(/\d+/)[0]));
    } else {
      scripts.set(key, `${scripts.get(key) ?? ''}${line}\n`);
    }
  }
  const has = (k) => scripts.has(k);

  // 土台の SWF。スクリプトのあるフレームにだけ、取り込み先のアクションを置く。
  const frame = (prefix, n, extra = []) => [...extra, ...(has(`${prefix}frame_${n}`) ? [placeholder()] : []), ShowFrame()];
  const actionBytes = [0x96, 3, 0, 0, 0x78, 0, 0x26, 0]; // 取り込み先（Push "x"; Trace; End）
  const childrenOf = (parent) => [...sprites].filter(([, s]) => s.parent === parent && !s.exportName)
    .map(([id, s]) => PlaceObject2({
      depth: s.depth, id, name: s.name, matrix: s.at[0] || s.at[1] ? { tx: s.at[0] * 20, ty: s.at[1] * 20 } : undefined,
      clipActions: s.events?.map((name) => ({ events: EVENTS[name], code: actionBytes })),
    }));
  const tags = [];
  // 子として置かれるスプライトは、親より先に定義する。
  const level = (id) => (sprites.get(id)?.parent ? 1 + level(sprites.get(id).parent) : 0);
  const order = [...sprites.keys()].sort((a, b) => level(b) - level(a) || a - b);
  for (const id of order) {
    const s = sprites.get(id);
    const content = [];
    if (s.squareSize) {
      tags.push(square(1000 + id, s.squareSize * 20, [0, 0, 255]));
      content.push(PlaceObject2({ depth: 1, id: 1000 + id }));
    }
    const frames = [];
    for (let n = 1; n <= s.frames; n++) {
      const label = spriteLabels.has(`${id}:${n}`) ? [tag(43, cstr(spriteLabels.get(`${id}:${n}`)))] : [];
      frames.push(...frame(`${spriteFolder(id)}/`, n, [...label, ...(n === 1 ? [...content, ...childrenOf(id)] : [])]));
    }
    tags.push(DefineSprite(id, s.frames, [...frames, End()]));
    if (s.exportName) tags.push(tag(56, [...u16(1), ...u16(id), ...cstr(s.exportName)])); // ExportAssets
  }
  for (let n = 1; n <= rootFrames; n++) {
    const label = labels.has(n) ? [tag(43, cstr(labels.get(n)))] : []; // FrameLabel
    tags.push(...frame('', n, [...label, ...(n === 1 ? childrenOf(0) : [])]));
  }
  tags.push(End());

  const dir = join(workDir, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [k, text] of scripts) {
    const event = k.match(/ (on|onClipEvent)\((\w+)\)$/);
    if (event) {
      // クリップイベントは 1 ファイル 1 イベントで、onClipEvent(...) { } で包んだ形にする。
      mkdirSync(join(dir, 'scripts', k, '..'), { recursive: true });
      writeFileSync(join(dir, 'scripts', `${k}.as`), `${event[1]}(${event[2]}){\n${text}}\n`);
    } else {
      mkdirSync(join(dir, 'scripts', k), { recursive: true });
      writeFileSync(join(dir, 'scripts', k, 'DoAction.as'), text);
    }
  }
  const base = join(dir, 'base.swf');
  writeFileSync(base, swf({ version, frames: rootFrames, tags }));
  const out = join(outDir, `as-${name}.swf`);
  // FFDec は構文エラーでも終了コード 0 のことがあるので、出力の SEVERE も見る。
  let log;
  try {
    log = execFileSync('java', ['-jar', ffdec, '-importScript', base, out, join(dir, 'scripts')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log = `SEVERE: ${e.stderr || e.message}`;
  }
  const lines = log.split('\n');
  const error = lines.find((line) => /on line \d+/.test(line)) ?? lines.find((line) => /SEVERE|Exception/.test(line));
  if (error) throw new Error(`${name}: ${error.replace(/, file: .*/, '')}`);
  console.log(`as-${name}.swf (SWF ${version}, ${rootFrames} frames, ${sprites.size} sprites)`);
}

const names = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(srcDir).filter((f) => f.endsWith('.as')).map((f) => f.slice(0, -3)).sort();
let failed = false;
for (const name of names) {
  try {
    build(name);
  } catch (e) {
    failed = true;
    console.error(e.message);
  }
}
process.exitCode = failed ? 1 : 0;
