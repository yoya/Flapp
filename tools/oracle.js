// 実機（Flash Player デバッガ版）で SWF を再生し、trace 出力とウィンドウ画像を
// test/expected/ に保存する。macOS 専用。
//
//   node tools/oracle.js [--player <.app>] [--wait <ms>] [--out <dir>] [swf ...]
//
// --out を省くと test/expected/ に保存する。試し撮りは --out tmp のように別の場所へ。
//
// - trace は ~/mm.cfg の TraceOutputFileEnable=1 が前提（無ければ中断する）。
// - trace() の出力は UTF-8 だが、プレイヤー自身の警告文は OS のロケールの符号化で書かれる
//   （日本語環境では Shift-JIS の日本語）。ファイルにはそのままのバイト列を保存する。
// - flashlog.txt は全プレイヤー共有で起動時に空にされるため、必ず 1 本ずつ直列に実行する。
// - 終了させるのは自分が起動したプロセスだけ。既に起動中のプレイヤーには触れない。
// - 画像はウィンドウ全体（タイトルバー込み、Retina では 2 倍）。ステージ部分の切り抜きは未実装。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    player: { type: 'string', default: '/Applications/Adobe Animate 2024/Players/Debug/Flash Player Debugger.app' },
    wait: { type: 'string', default: '2000' },
    out: { type: 'string' },
  },
});

const fixturesDir = join(root, 'test/fixtures');
const outDir = opt.out ? resolve(opt.out) : join(root, 'test/expected');
const swfs = positionals.length
  ? positionals.map((p) => resolve(p))
  : readdirSync(fixturesDir).filter((f) => f.endsWith('.swf')).map((f) => join(fixturesDir, f));
const waitMs = Number(opt.wait);
const flashlog = join(homedir(), 'Library/Preferences/Macromedia/Flash Player/Logs/flashlog.txt');

const mmcfg = join(homedir(), 'mm.cfg');
if (!existsSync(mmcfg) || !/^TraceOutputFileEnable=1$/m.test(readFileSync(mmcfg, 'utf8'))) {
  throw new Error(`${mmcfg} に TraceOutputFileEnable=1 がありません`);
}
if (!existsSync(opt.player)) throw new Error(`プレイヤーがありません: ${opt.player}`);
const exe = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', join(opt.player, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const bin = join(opt.player, 'Contents/MacOS', exe);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// 実行ファイルのパスが完全一致するプロセスの PID 一覧。
function pids() {
  return execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.match(/^\s*(\d+) (.*)$/))
    .filter((m) => m && m[2] === bin)
    .map((m) => Number(m[1]));
}

// 指定 PID が画面に出しているウィンドウの CGWindowID 一覧。
const windowScript = `function run(argv) {
  ObjC.import('CoreGraphics');
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0)));
  return JSON.stringify(list
    .filter((w) => w.kCGWindowOwnerPID === Number(argv[0]) && w.kCGWindowIsOnscreen && w.kCGWindowBounds.Height > 0)
    .map((w) => w.kCGWindowNumber));
}`;

mkdirSync(outDir, { recursive: true });
let failed = false;

for (const swf of swfs) {
  const name = basename(swf, '.swf');
  const before = new Set(pids());
  const started = Date.now();
  // 直前の実行がクラッシュしていると、macOS が「ウインドウを再開しますか？」と尋ねて再生が始まらない。
  // 保存された状態を無視して起動する。
  execFileSync('open', ['-n', '-g', '-a', opt.player, swf, '--args', '-ApplePersistenceIgnoreState', 'YES']);

  let fresh = [];
  for (let i = 0; i < 40 && fresh.length === 0; i++) {
    await sleep(250);
    fresh = pids().filter((p) => !before.has(p));
  }
  if (fresh.length !== 1) {
    // どれが自分のプロセスか断定できないので、何も終了させずに止まる。
    throw new Error(`${name}: 新規プロセスを特定できません (${fresh.length} 個)`);
  }
  const pid = fresh[0];

  try {
    await sleep(waitMs);

    // 起動時刻より前のログは別プロセスの残りなので採用しない（mtime は秒精度のため 1 秒の余裕を見る）。
    if (existsSync(flashlog) && statSync(flashlog).mtimeMs >= started - 1000) {
      const trace = readFileSync(flashlog);
      writeFileSync(join(outDir, `${name}.trace.txt`), trace);
      console.log(`${name}: trace ${trace.length} bytes`);
    } else {
      failed = true;
      console.error(`${name}: flashlog.txt が更新されていません`);
    }

    const wins = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', windowScript, String(pid)], { encoding: 'utf8' }));
    if (wins.length !== 1) {
      failed = true;
      console.error(`${name}: ウィンドウを特定できません (${wins.length} 個)`);
    } else {
      try {
        execFileSync('screencapture', ['-x', '-o', '-l', String(wins[0]), join(outDir, `${name}.png`)], { stdio: 'pipe' });
        console.log(`${name}: 画面を保存`);
      } catch (e) {
        failed = true;
        console.error(`${name}: 画面を取得できません（画面収録の許可が必要な可能性）: ${String(e.stderr).trim()}`);
      }
    }
  } finally {
    process.kill(pid);
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(100);
  }
}

process.exitCode = failed ? 1 : 0;
