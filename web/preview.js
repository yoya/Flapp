// 解析ページの見本（サムネイルとプレビュー）。ブラウザでだけ動く。
//   - シェイプとスプライト: 定義を 1 つ置いた最小の SWF を、既存の描画（CanvasRenderer）で描く。
//   - 画像（DefineBits など）: 画素にして（圧縮されたものは decodeImage で）、そのまま描く。
// サムネイルは、画面に見えてから 1 つずつ描く（多いと重いため）。
import { Movie } from '../src/player/movie.js';
import { CanvasRenderer, decodeImage } from '../src/render/canvas.js';
import { parseBitmap } from '../src/swf/bitmap.js';
import { miniSWF } from './inspect.js';

const IMAGE_CODES = new Set([6, 20, 21, 35, 36, 90]);

/** 定義の見本を、長い辺が max（px）に収まる canvas にする。描けなければ null。 */
export async function drawPreview(report, row, max) {
  if (IMAGE_CODES.has(row.code)) return drawImage(report, row, max);
  if (row.section === 'definition' || row.section === 'sprite') return drawVector(report, row, max);
  return null;
}

async function drawVector(report, row, max) {
  const bytes = miniSWF(report.swf, row.id);
  if (!bytes) return null;
  const movie = await Movie.load(bytes, { decodeImage, now: () => 0 });
  const w = Math.max(1, (movie.frameSize.xmax - movie.frameSize.xmin) / 20);
  const h = Math.max(1, (movie.frameSize.ymax - movie.frameSize.ymin) / 20);
  const scale = max / Math.max(w, h);
  const canvas = document.createElement('canvas');
  const renderer = new CanvasRenderer(canvas);
  await renderer.prepare(movie);
  renderer.render(movie, scale);
  await renderer.decoded(); // 画像の復号を待ってから、もう一度描く
  renderer.render(movie, scale);
  return canvas;
}

async function drawImage(report, row, max) {
  const bmp = await parseBitmap(row.raw, report.jpegTables);
  const rgba = bmp.rgba ?? (await decodeImage(bmp.encoded)).rgba;
  const { width, height } = bmp;
  const pixels = new Uint8ClampedArray(rgba);
  if (bmp.alpha) for (let i = 0; i < bmp.alpha.length; i++) pixels[i * 4 + 3] = bmp.alpha[i];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  // 表示の大きさは CSS で決める（描いた画素はそのまま）
  const k = max / Math.max(width, height); // 小さい画像も、指定の大きさまで拡大する（描いた画素は変えない）
  canvas.style.width = `${Math.round(width * k)}px`;
  canvas.style.height = `${Math.round(height * k)}px`;
  return canvas;
}

// --- サムネイルの遅延描画 ---
// root の中の .thumb（data-i で行を指す）を、画面に見えたものから順に描く。描けないものは ✕ を出す。
export function lazyThumbs(root, report, size = 72) {
  const queue = [];
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { slot, row } = queue.shift();
      try {
        const canvas = await drawPreview(report, row, size);
        if (canvas) {
          canvas.style.maxWidth = `${size}px`;
          canvas.style.maxHeight = `${size}px`;
          slot.replaceChildren(canvas);
        } else {
          slot.textContent = '—';
        }
      } catch {
        slot.textContent = '✕';
      }
    }
    busy = false;
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      queue.push({ slot: en.target, row: report.tags[Number(en.target.dataset.i)] });
    }
    pump();
  }, { root: null, rootMargin: '200px' });
  for (const slot of root.querySelectorAll('.thumb')) io.observe(slot);
  return io;
}
