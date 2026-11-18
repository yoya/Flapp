// 開発用の静的ファイルサーバ。リポジトリ直下を 127.0.0.1 だけに公開する。
//   node tools/serve.js [port]
// ブラウザが古い ES モジュールを使い続けないよう、キャッシュさせない。
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] ?? 8123);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.swf': 'application/x-shockwave-flash', '.txt': 'text/plain',
};

createServer((req, res) => {
  const send = (status, text) => res.writeHead(status, { 'Content-Type': 'text/plain' }).end(text);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
  let path;
  try {
    path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
  } catch {
    return send(400, 'bad request');
  }
  // リポジトリの外と、隠しファイル（.git など）は返さない。
  if (!path.startsWith(root) || path.slice(root.length).split(sep).some((p) => p.startsWith('.'))) return send(403, 'forbidden');
  let stat;
  try {
    stat = statSync(path);
    if (stat.isDirectory()) stat = statSync((path = join(path, 'index.html')));
  } catch {
    return send(404, 'not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/web/`));
