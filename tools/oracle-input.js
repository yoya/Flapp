// 実機（Flash Player デバッガ版）に入力を与えて再生し、trace 出力を test/expected/<名前>.input.trace.txt に保存する。macOS 専用。
//
//   node tools/oracle-input.js <swf> [--out <dir>]
//
// 入力の手順は SWF と同じ場所の <名前>.input.json。次の配列を並べたもの（座標はステージの px）:
//   ["move", x, y]   マウスを動かす          ["down"] / ["up"]   マウスのボタンを押す / 離す
//   ["key", "a"]     キーを押す（下の KEY にあるもの）
//   ["shot", "名前"] その時点のウィンドウを <出力先>/<SWF 名>.<名前>.png に保存する
//
// 注意:
// - 合成した入力を送るので、実行するアプリに「アクセシビリティ」の許可が要る（システム設定 → プライバシーとセキュリティ）。
// - 実機はクリックを画面全体の入力としてしか受け付けない。そのため実機のウィンドウを前面に出し、実際のカーソルを動かす
//   （終わったら元の位置へ戻す）。実行中の十数秒はマウスとキーボードに触れないこと。
// - マウス操作は、その位置でいちばん手前にあるのが実機のウィンドウのときだけ送る。違えば中断する。
// - キーは実機のプロセスだけに送る。
// - flashlog.txt は全プレイヤー共有なので、tools/oracle.js と同時には動かさない。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseSWF } from '../src/swf/parse.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
if (positionals.length !== 1) throw new Error('使い方: node tools/oracle-input.js <swf> [--out <dir>]');
const file = resolve(positionals[0]);
const name = basename(file, '.swf');
const steps = readFileSync(file.replace(/\.swf$/, '.input.json'), 'utf8');
const outDir = opt.out ? resolve(opt.out) : join(root, 'test/expected');
const player = '/Applications/Adobe Animate 2024/Players/Debug/Flash Player Debugger.app';
const bin = join(player, 'Contents/MacOS/Flash Player Debugger');
const flashlog = join(homedir(), 'Library/Preferences/Macromedia/Flash Player/Logs/flashlog.txt');
if (!existsSync(player)) throw new Error(`プレイヤーがありません: ${player}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pids = () => execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).split('\n')
  .map((l) => l.match(/^\s*(\d+) (.*)$/)).filter((m) => m && m[2] === bin).map((m) => Number(m[1]));
const swf = await parseSWF(readFileSync(file));
const stageHeight = (swf.frameSize.ymax - swf.frameSize.ymin) / 20;

// 入力を送る側（JavaScript for Automation）。引数: PID、手順の JSON、ステージの高さ、画像の保存先の接頭辞。
const script = `ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightPostEventAccess', ['bool', []]);
function run(argv) {
  if (!$.CGPreflightPostEventAccess()) throw new Error('入力を送る許可（アクセシビリティ）がありません');
  const pid = Number(argv[0]);
  const windows = () => ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))); // 画面上のもの、手前から順
  const win = windows().find((w) => w.kCGWindowOwnerPID === pid && w.kCGWindowBounds.Height > 0);
  // ステージはウィンドウの下端に接している（上はタイトルバー）。
  const ox = win.kCGWindowBounds.X, oy = win.kCGWindowBounds.Y + win.kCGWindowBounds.Height - Number(argv[2]);
  const KEY = { a: 0, x: 7, y: 16, z: 6, ' ': 49, Enter: 36, ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126 }; // 仮想キーコード
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const original = $.CGEventGetLocation($.CGEventCreate(null));
  let pos = $.CGPointMake(ox, oy), down = false;
  const topmostIsPlayer = () => {
    const inside = (b) => pos.x >= b.X && pos.x < b.X + b.Width && pos.y >= b.Y && pos.y < b.Y + b.Height;
    const top = windows().find((w) => w.kCGWindowLayer === 0 && inside(w.kCGWindowBounds));
    return top && top.kCGWindowOwnerPID === pid;
  };
  const mouse = (type) => {
    if (!topmostIsPlayer()) throw new Error('実機のウィンドウが手前に無いので中断');
    const e = $.CGEventCreateMouseEvent(null, type, pos, 0);
    if (type !== 5) $.CGEventSetIntegerValueField(e, 1, 1); // クリック回数
    $.CGEventPost(0, e);
  };
  try {
    for (const [kind, a, b] of JSON.parse(argv[1])) {
      if (kind === 'move') { pos = $.CGPointMake(ox + a, oy + b); mouse(down ? 6 : 5); } // 6 ドラッグ / 5 移動
      else if (kind === 'down') { down = true; mouse(1); }
      else if (kind === 'up') { down = false; mouse(2); }
      else if (kind === 'key') {
        if (!(a in KEY)) throw new Error('未対応のキー: ' + a);
        $.CGEventPostToPid(pid, $.CGEventCreateKeyboardEvent(null, KEY[a], true));
        delay(0.05);
        $.CGEventPostToPid(pid, $.CGEventCreateKeyboardEvent(null, KEY[a], false));
      } else if (kind === 'shot') {
        delay(0.3);
        app.doShellScript('screencapture -x -o -l ' + win.kCGWindowNumber + ' ' + JSON.stringify(argv[3] + a + '.png'));
      }
      delay(0.25);
    }
  } finally {
    if (down) $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 2, pos, 0)); // 押したままにしない
    $.CGWarpMouseCursorPosition(original);
  }
}`;

mkdirSync(outDir, { recursive: true });
const before = new Set(pids());
const started = Date.now();
execFileSync('open', ['-n', '-a', player, file, '--args', '-ApplePersistenceIgnoreState', 'YES']);
let fresh = [];
for (let i = 0; i < 40 && fresh.length === 0; i++) {
  await sleep(250);
  fresh = pids().filter((p) => !before.has(p));
}
// どれが自分のプロセスか断定できなければ、何も送らず、何も終了させずに止まる。
if (fresh.length !== 1) throw new Error(`${name}: 新規プロセスを特定できません (${fresh.length} 個)`);
try {
  await sleep(1500);
  execFileSync('osascript', ['-l', 'JavaScript', '-e', script, String(fresh[0]), steps, String(stageHeight), join(outDir, `${name}.`)], { stdio: ['ignore', 'inherit', 'inherit'] });
  await sleep(500);
  const trace = readFileSync(flashlog);
  writeFileSync(join(outDir, `${name}.input.trace.txt`), trace);
  console.log(`${name}: trace ${trace.length} bytes (${Date.now() - started} ms)`);
} finally {
  try { process.kill(fresh[0]); } catch { /* 既に終了している */ }
}
