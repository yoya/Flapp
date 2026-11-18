// test/as3/*.as（ActionScript 3 のソース）をコンパイルして、test/fixtures/as3-*.swf を作る。
//
//   node tools/mkas3.js [名前 ...]      名前を省くと全部
//
// tools/mkas.js と同じく、コンパイルには FFDec の取り込み機能を使う（Java と FFDec が要る）。
// 生成した SWF はコミットしてあるので、テストを走らせるだけなら FFDec は不要。
//
// 土台の SWF は、文書クラス Main（flash.display.MovieClip の派生）だけを持つ ABC をここで手組みしたもの。
// FFDec がその Main を、テストのソースで置き換える。
//
// ソースの書き方: ファイルの中身が、そのまま Main のコンストラクタの本体になる。
//   「//// class」で始まる行より後ろは、補助のクラスやインターフェースの宣言（行頭から class / interface で始める。
//    それぞれ公開のクラスになる。継承元や型として使うクラスは、使う側より前に書く）。
//   「//// members」で始まる行より後ろ（「//// class」まで）は、Main のメンバー（メソッドやフィールド）の宣言。
//   「// frames: N」という行があれば、メインタイムラインを N フレームにする（省略すると 1）。
//   「// sprite: クラス名 frames=N」は、そのクラスに結び付いたスプライト（40×40 px の四角形を持つ、N フレームのクリップ）を作る。
//   「// place: クラス名 in=置き先のクラス名 frame=F name=名前 x=X y=Y until=G」は、そのスプライトを置き先（省略すると
//    メインタイムライン）の F フレーム目に置き、G フレーム目で取り除く（どれも省略可）。置き先は、置くものより後に書く。
//    クラス名を Square にすると、スプライトではなく四角形の図形そのものを置く。
//   「// unverified: 理由」は、実機と照合できないテスト。SWF の名前が as3x-*.swf になる（期待値は test/avm2.test.js に書く）。
// スクリプトは有限回の trace で終わるように書く。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefineSprite, End, PlaceObject2, RemoveObject2, ShowFrame, square, swf, tag, u16, u32 } from './mkfixtures.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'test/as3');
const outDir = join(root, 'test/fixtures');
const workDir = join(root, 'tmp/as3-build');
const ffdec = process.env.FFDEC_CLI ?? join(homedir(), 'Applications/FFDec.app/Contents/Resources/ffdec-cli.jar');

const utf8 = (s) => [...new TextEncoder().encode(s)];
// ABC の可変長整数（u30）
const u30 = (v) => {
  const out = [];
  do {
    out.push((v & 0x7f) | (v > 0x7f ? 0x80 : 0));
    v >>>= 7;
  } while (v);
  return out;
};

// 文書クラス Main と、空の補助クラス・インターフェース（extras: { name, isInterface }。クラスはどれも Object の派生）を持つ ABC。
// FFDec は既にあるクラスしか置き換えられないので、テストが使うクラスは空のものを先に用意しておく。
function baseABC(extras) {
  const strings = ['Main', '', 'flash.display', 'MovieClip', 'Object', 'flash.events', 'EventDispatcher', 'DisplayObject', 'InteractiveObject', 'DisplayObjectContainer', 'Sprite', ...extras.map((e) => e.name)];
  const S = (s) => strings.indexOf(s) + 1;
  const namespaces = [[0x16, S('')], [0x16, S('flash.display')], [0x18, S('Main')], [0x16, S('flash.events')]]; // 1: 公開、2: flash.display、3: Main の protected、4: flash.events
  const qnames = [
    [1, 'Main'], [2, 'MovieClip'], [1, 'Object'], [4, 'EventDispatcher'], [2, 'DisplayObject'], [2, 'InteractiveObject'], [2, 'DisplayObjectContainer'], [2, 'Sprite'],
    ...extras.map((e) => [1, e.name]),
  ];
  const Q = (name) => qnames.findIndex((q) => q[1] === name) + 1;
  const body = (method, maxStack, scopeDepth, code) => [
    ...u30(method), ...u30(maxStack), ...u30(1), ...u30(scopeDepth), ...u30(scopeDepth + 9), ...u30(code.length), ...code, 0, 0, // 例外なし、trait なし
  ];
  // スクリプトの初期化: 継承元のクラスをスコープに積んでから newclass でクラスを作り、大域の同名のプロパティに入れる。
  // インターフェースには継承元が無い（null を渡して作る）。
  const scriptInit = (name, index, chain) => [
    0xd0, 0x30, 0x65, 0x00, // getlocal_0; pushscope; getscopeobject 0
    ...chain.slice(0, -1).flatMap((base) => [0x60, ...u30(Q(base)), 0x30]), // getlex X; pushscope
    ...(chain.length ? [0x60, ...u30(Q(chain[chain.length - 1])), 0x2a, 0x30] : [0x20]), // getlex 継承元; dup; pushscope ／ pushnull
    0x58, ...u30(index), // newclass
    ...new Array(chain.length).fill(0x1d), // popscope
    0x68, ...u30(Q(name)), 0x47, // initproperty 名前; returnvoid
  ];
  // クラスの並び: 補助クラス、最後に Main。クラス i のメソッドは 3i（コンストラクタ）、3i+1（クラスの初期化）、3i+2（スクリプトの初期化）。
  const classes = [...extras.map((e) => ({ name: e.name, chain: e.isInterface ? [] : ['Object'], flags: [e.isInterface ? 0x05 : 0x01] })), {
    name: 'Main', chain: ['Object', 'EventDispatcher', 'DisplayObject', 'InteractiveObject', 'DisplayObjectContainer', 'Sprite', 'MovieClip'], flags: [0x09, 3], // sealed + protected 名前空間
  }];
  return [
    16, 0, 46, 0, // minor 16, major 46
    1, 1, 1, // int / uint / double なし
    ...u30(strings.length + 1), ...strings.flatMap((s) => [...u30(utf8(s).length), ...utf8(s)]),
    ...u30(namespaces.length + 1), ...namespaces.flatMap(([kind, name]) => [kind, ...u30(name)]),
    1, // 名前空間の組なし
    ...u30(qnames.length + 1), ...qnames.flatMap(([ns, name]) => [0x07, ...u30(ns), ...u30(S(name))]),
    ...u30(classes.length * 3), ...new Array(classes.length * 3).fill([0, 0, 0, 0]).flat(), // メソッド（引数なし、型なし、名前なし、フラグなし）
    0, // メタデータなし
    ...u30(classes.length),
    ...classes.flatMap((cls, i) => [...u30(Q(cls.name)), ...u30(cls.chain.length ? Q(cls.chain[cls.chain.length - 1]) : 0), ...cls.flags, 0, ...u30(i * 3), 0]), // instance: インターフェースなし、trait なし
    ...classes.flatMap((cls, i) => [...u30(i * 3 + 1), 0]), // class: trait なし
    ...u30(classes.length),
    ...classes.flatMap((cls, i) => [...u30(i * 3 + 2), 1, ...u30(Q(cls.name)), 0x04, 1, ...u30(i)]), // スクリプト: trait は「クラス（スロット 1）」
    ...u30(classes.length * 3),
    ...classes.flatMap((cls, i) => [
      ...body(i * 3, 1, cls.chain.length + 2, cls.chain.length ? [0xd0, 0x30, 0xd0, 0x49, 0x00, 0x47] : [0x47]), // getlocal_0; pushscope; getlocal_0; constructsuper 0; returnvoid
      ...body(i * 3 + 1, 1, cls.chain.length + 1, [0xd0, 0x30, 0x47]),
      ...body(i * 3 + 2, 3, 1, scriptInit(cls.name, i, cls.chain)),
    ]),
  ];
}

function build(name) {
  const source = readFileSync(join(srcDir, `${name}.as`), 'utf8');
  const lines = source.split('\n');
  const classAt = lines.findIndex((l) => l.startsWith('//// class'));
  const membersAt = lines.findIndex((l) => l.startsWith('//// members'));
  const bodyEnd = membersAt >= 0 ? membersAt : classAt >= 0 ? classAt : lines.length;
  const members = membersAt >= 0 ? lines.slice(membersAt + 1, classAt >= 0 ? classAt : lines.length).join('\n') : '';
  // 補助のクラスとインターフェースは、宣言ごとに 1 ファイルの公開クラスにする（宣言の順に取り込む）。
  const outer = [];
  for (const line of classAt >= 0 ? lines.slice(classAt + 1) : []) {
    const head = /^(?:dynamic |final )*(class|interface) (\w+)/.exec(line);
    if (head) outer.push({ name: head[2], isInterface: head[1] === 'interface', lines: [] });
    if (!outer.length) throw new Error(`${name}: 「//// class」の後ろは、class か interface の宣言で始める`);
    outer[outer.length - 1].lines.push(line);
  }
  const frames = Number(/^\/\/ frames: (\d+)/m.exec(source)?.[1] ?? 1); // メインタイムラインのフレーム数
  // スプライトと、その配置。キャラクタ ID は 1 が四角形、2 以降がスプライト。深度は 1 が四角形、2 以降が置いた順。
  const sprites = [...source.matchAll(/^\/\/ sprite: (\w+)(?: frames=(\d+))?/gm)].map((m, i) => ({ cls: m[1], frames: Number(m[2] ?? 1), id: i + 2 }));
  const places = [...source.matchAll(/^\/\/ place: (\w+)(.*)$/gm)].map((m) => ({ cls: m[1], ...Object.fromEntries(m[2].trim().split(/\s+/).filter(Boolean).map((kv) => kv.split('='))) }));
  const timeline = (owner, count, shape) => {
    const mine = places.filter((p) => (p.in ?? 'Main') === owner);
    const tags = [];
    for (let f = 1; f <= count; f++) {
      if (f === 1 && shape) tags.push(PlaceObject2({ depth: 1, id: 1 }));
      mine.forEach((p, i) => {
        const sprite = p.cls === 'Square' ? { id: 1 } : sprites.find((sp) => sp.cls === p.cls); // Square は四角形そのもの
        if (!sprite) throw new Error(`${name}: place の ${p.cls} に sprite の宣言が無い`);
        if (Number(p.frame ?? 1) === f) tags.push(PlaceObject2({ depth: i + 2, id: sprite.id, name: p.name, matrix: { tx: Number(p.x ?? 0) * 20, ty: Number(p.y ?? 0) * 20 } }));
        if (Number(p.until ?? 0) === f) tags.push(RemoveObject2(i + 2));
      });
      tags.push(ShowFrame());
    }
    return tags;
  };
  const pack = (declaration) => `package
{
   import flash.display.*;
   import flash.events.*;
   import flash.geom.*;
   import flash.net.*;
   import flash.system.*;
   import flash.text.*;
   import flash.utils.*;

${declaration}
}
`;
  const dir = join(workDir, name);
  rmSync(dir, { recursive: true, force: true });
  const units = [...outer.map((unit) => ({ name: unit.name, text: pack(`public ${unit.lines.join('\n')}`) })), {
    name: 'Main',
    text: pack(`   public class Main extends MovieClip
   {
      public function Main()
      {
         super();
${lines.slice(0, bodyEnd).join('\n')}
      }
${members}
   }`),
  }];
  const abc = baseABC(outer);
  mkdirSync(dir, { recursive: true });
  const base = join(dir, 'base.swf');
  writeFileSync(base, swf({
    version: 15,
    frames,
    tags: [
      tag(69, [0x08, 0, 0, 0]), // FileAttributes: ActionScript3
      tag(9, [255, 255, 255]),
      ...(sprites.length || places.length ? [square(1, 800, [0x33, 0x66, 0x99])] : []),
      ...sprites.map((sprite) => DefineSprite(sprite.id, sprite.frames, [...timeline(sprite.cls, sprite.frames, true), End()])),
      tag(82, [...u32(1), ...utf8('frame1'), 0, ...abc], true), // DoABC（遅延初期化）
      tag(76, [...u16(sprites.length + 1), ...sprites.flatMap((sprite) => [...u16(sprite.id), ...utf8(sprite.cls), 0]), ...u16(0), ...utf8('Main'), 0]), // SymbolClass: スプライトとメインタイムライン
      ...timeline('Main', frames, false), End(),
    ],
  }));
  // 実機と照合できないテスト（「// unverified:」の行がある）は as3x- にして、実機の出力と比べるテストの対象から外す。
  const out = join(outDir, `${/^\/\/ unverified:/m.test(source) ? 'as3x' : 'as3'}-${name}.swf`);
  // 1 クラスずつ取り込む（後のクラスが、先に取り込んだクラスのメンバーを参照できるように）。
  let from = base;
  units.forEach((unit, i) => {
    const scripts = join(dir, `scripts${i}`);
    mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, `${unit.name}.as`), unit.text);
    const to = i === units.length - 1 ? out : join(dir, `step${i}.swf`);
    let log;
    try {
      log = execFileSync('java', ['-jar', ffdec, '-importScript', from, to, scripts], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`${name}: FFDec が失敗 (${unit.name}): ${e.stderr || e.message}`);
    }
    if (/SEVERE|Exception|error/i.test(log)) throw new Error(`${name}: FFDec の出力に誤りがある (${unit.name}):\n${log}`);
    from = to;
  });
  console.log(out.slice(outDir.length + 1));
}

const names = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(srcDir).filter((f) => f.endsWith('.as')).map((f) => f.slice(0, -3)).sort();
for (const name of names) build(name);
