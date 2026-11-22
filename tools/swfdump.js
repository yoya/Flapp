// SWF のヘッダとタグ一覧を表示する。
//   node tools/swfdump.js [-d | --detail] [-D | --full] [--hex] file.swf [...]
//     -d, --detail  タグの中身も出す（解釈した項目と、要約）
//     -D, --full    入れ子の項目まで出す（シェイプのレコード、スタイル、行列、配置、ボタン、フォントの字形、テキストのレコード、
//                   AVM1 のアクションと AVM2 の ABC の逆アセンブル、音とビデオの頭など。--detail を含む）
//     --hex         中身の先頭 256 バイトの 16 進ダンプも出す（--detail を含む）
// 中身の解釈は web/inspect.js（解析ページと同じもの）と、-D の分は web/dump.js。
import { readFileSync } from 'node:fs';
import { parseSWF } from '../src/swf/parse.js';
import { inspectSWF } from '../web/inspect.js';
import { dumpContext, dumpTag } from '../web/dump.js';

const OPTIONS = ['-d', '--detail', '-D', '--full', '--hex'];
const args = process.argv.slice(2);
const hexOn = args.includes('--hex');
const fullOn = args.includes('-D') || args.includes('--full');
const detailOn = hexOn || fullOn || args.includes('-d') || args.includes('--detail');
const files = args.filter((a) => !OPTIONS.includes(a));

function printTags(tags, indent) {
  for (const t of tags) {
    const name = t.name ?? '(unknown)';
    const extra = t.tags ? `  id=${t.spriteId} frames=${t.frameCount}` : '';
    console.log(`${String(t.offset).padStart(8)}  ${indent}${String(t.code).padStart(3)} ${name.padEnd(28)} ${String(t.length).padStart(8)}${extra}`);
    if (t.tags) printTags(t.tags, `${indent}  `);
  }
}

// 中身の表示。タグごとに、一行の要約と、解釈した項目（字下げ）、解釈できないときの理由、16 進ダンプを続ける。
function printDetailed(report) {
  const ctx = dumpContext(report.header.version);
  for (const t of report.tags) {
    const indent = '  '.repeat(t.depth);
    console.log(`${String(t.offset).padStart(8)}  ${indent}${String(t.code).padStart(3)} ${t.name.padEnd(28)} ${String(t.length).padStart(8)}  ${t.summary}`);
    const pad = `${' '.repeat(10)}${indent}    `;
    for (const [key, value] of t.details) console.log(`${pad}${key}: ${value}`);
    if (t.error) console.log(`${pad}解釈できません: ${t.error}`);
    if (fullOn) {
      const lines = [];
      try {
        dumpTag(t, ctx, lines);
      } catch (e) {
        lines.push(`解釈できません: ${e.message ?? e}`);
      }
      for (const line of lines) console.log(`${pad}${line}`);
    }
    if (hexOn) for (const line of t.hex.split('\n')) console.log(`${pad}${line}`);
  }
}

if (files.length === 0) {
  console.error('usage: node tools/swfdump.js [-d | --detail] [-D | --full] [--hex] file.swf [...]');
  process.exitCode = 2;
}

let failed = false;
for (const path of files) {
  try {
    const bytes = readFileSync(path);
    const swf = await parseSWF(bytes);
    const { xmin, xmax, ymin, ymax } = swf.frameSize;
    console.log(`${path}: ${swf.signature} version ${swf.version}, length ${swf.fileLength}, ` +
      `${(xmax - xmin) / 20}x${(ymax - ymin) / 20} px, ${swf.frameRate} fps, ${swf.frameCount} frames`);
    console.log(`${'offset'.padStart(8)}  tag ${'name'.padEnd(28)} ${'length'.padStart(8)}`);
    if (detailOn) {
      const report = await inspectSWF(bytes);
      printDetailed(report);
    } else {
      printTags(swf.tags, '');
    }
    for (const w of swf.warnings) console.error(`warning: ${w}`);
  } catch (e) {
    failed = true;
    console.error(`${path}: ${e.name === 'SWFError' ? e.message : e.stack}`);
  }
}
process.exitCode = failed ? 1 : (files.length === 0 ? 2 : 0);
