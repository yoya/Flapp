// SWF のヘッダとタグ一覧を表示する。
//   node tools/swfdump.js file.swf [...]
import { readFileSync } from 'node:fs';
import { parseSWF } from '../src/swf/parse.js';

function printTags(tags, indent) {
  for (const t of tags) {
    const name = t.name ?? '(unknown)';
    const extra = t.tags ? `  id=${t.spriteId} frames=${t.frameCount}` : '';
    console.log(`${String(t.offset).padStart(8)}  ${indent}${String(t.code).padStart(3)} ${name.padEnd(28)} ${String(t.length).padStart(8)}${extra}`);
    if (t.tags) printTags(t.tags, `${indent}  `);
  }
}

let failed = false;
for (const path of process.argv.slice(2)) {
  try {
    const swf = await parseSWF(readFileSync(path));
    const { xmin, xmax, ymin, ymax } = swf.frameSize;
    console.log(`${path}: ${swf.signature} version ${swf.version}, length ${swf.fileLength}, ` +
      `${(xmax - xmin) / 20}x${(ymax - ymin) / 20} px, ${swf.frameRate} fps, ${swf.frameCount} frames`);
    console.log(`${'offset'.padStart(8)}  tag ${'name'.padEnd(28)} ${'length'.padStart(8)}`);
    printTags(swf.tags, '');
    for (const w of swf.warnings) console.error(`warning: ${w}`);
  } catch (e) {
    failed = true;
    console.error(`${path}: ${e.name === 'SWFError' ? e.message : e.stack}`);
  }
}
process.exitCode = failed ? 1 : 0;
