// ビデオ: タグの解析、Sorenson H.263・Screen Video・VP6 の復号、埋め込みビデオの再生、FLV の分解と再生。
// H.263 と VP6 の復号結果は、ffmpeg で復号した結果（tools/assets/video-h263.yuv、video-vp6.yuv.gz、video-vp6a.yuva.gz）と比べる。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateRawSync, deflateSync, gunzipSync } from 'node:zlib';
import { decodeADPCM } from '../src/audio/decode.js';
import { Movie } from '../src/player/movie.js';
import { SoundMixer } from '../src/player/sound.js';
import { FlvPlayback, decodable, embeddedSequence } from '../src/player/video.js';
import { parseSWF } from '../src/swf/parse.js';
import { parseDefineVideoStream, parseVideoFrame } from '../src/swf/video.js';
import { parseFLV } from '../src/video/flv.js';
import { H263Decoder, VideoError, readPictureHeader, toRGBA } from '../src/video/h263.js';
import { ScreenVideo2Decoder, ScreenVideoDecoder } from '../src/video/screen.js';
import { VP6Decoder } from '../src/video/vp6.js';
import { SCREEN_VIDEO, fixtures, screenVideoPixel } from '../tools/mkfixtures.js';

const asset = (name) => readFileSync(new URL(`../tools/assets/${name}`, import.meta.url));
const flvBytes = asset('video-h263.flv');
const tagsOf = async (name, code) => (await parseSWF(fixtures[name])).tags.filter((t) => t.code === code);
// FlvPlayback を動かすための、時刻を手で進められる最小限のホスト。
function host() {
  const h = { time: 0, now: () => h.time, warnings: [], warn: (m) => h.warnings.push(m) };
  h.sounds = new SoundMixer(h, null);
  return h;
}

test('DefineVideoStream と VideoFrame を解析する', async () => {
  const [define] = (await tagsOf('video-h263', 60)).map(parseDefineVideoStream);
  assert.deepEqual(define, { id: 1, numFrames: 8, width: 64, height: 48, deblocking: 0, smoothing: false, codec: 'h263' });
  const frames = (await tagsOf('video-h263', 61)).map(parseVideoFrame);
  assert.deepEqual(frames.map((f) => [f.streamId, f.frameNum]), Array.from({ length: 8 }, (_, n) => [1, n]));
  assert.equal(parseDefineVideoStream((await tagsOf('video-screen', 60))[0]).codec, 'screen');
});

test('H.263: 復号結果が ffmpeg の復号結果と一致する（逆 DCT の丸めの差だけ）', () => {
  const flv = parseFLV(flvBytes);
  const reference = asset('video-h263.yuv');
  const decoder = new H263Decoder();
  let at = 0;
  flv.video.forEach((tag, n) => {
    const p = decoder.decode(tag.data);
    assert.deepEqual([p.width, p.height, p.stride], [64, 48, 64]);
    for (const [plane, w, h] of [[p.y, 64, 48], [p.cb, 32, 24], [p.cr, 32, 24]]) {
      let sum = 0, max = 0;
      for (let i = 0; i < w * h; i++) {
        const d = Math.abs(plane[i] - reference[at + i]);
        sum += d;
        max = Math.max(max, d);
      }
      at += w * h;
      assert.ok(max <= 3 && sum / (w * h) < 0.1, `frame ${n}: max ${max}, mean ${sum / (w * h)}`);
    }
  });
  assert.equal(at, reference.length);
});

test('H.263: ピクチャの見出しと、壊れたデータの扱い', () => {
  const { video } = parseFLV(flvBytes);
  assert.deepEqual(video.map((t) => readPictureHeader(t.data).type), [0, 1, 1, 1, 0, 1, 1, 1]); // 4 フレームごとにキーフレーム
  const header = readPictureHeader(video[0].data);
  assert.deepEqual([header.version, header.width, header.height], [1, 64, 48]);
  // キーフレームより前の差分フレーム、途中で切れたデータ、開始符号の無いデータは、VideoError になる。
  assert.throws(() => new H263Decoder().decode(video[1].data), VideoError);
  assert.throws(() => new H263Decoder().decode(video[0].data.subarray(0, 40)), VideoError);
  assert.throws(() => new H263Decoder().decode(new Uint8Array(64).fill(0xff)), VideoError);
  // 大きすぎる寸法（65535×65535）は、面を確保する前に断る。
  assert.throws(() => readPictureHeader(Uint8Array.from([0, 0, 0x80, 0, 0xff, 0xff, 0xff, 0xff, 0x80, 0, 0])), /out of range/);
  // RGBA への変換: 寸法どおりの大きさで、不透明。
  const rgba = toRGBA(new H263Decoder().decode(video[0].data));
  assert.equal(rgba.length, 64 * 48 * 4);
  assert.ok(rgba.every((v, i) => i % 4 !== 3 || v === 255));
});

test('Screen Video: 変わったブロックだけを書き換えて、各フレームの画素が元の絵と一致する', async () => {
  const frames = (await tagsOf('video-screen', 61)).map(parseVideoFrame);
  const decoder = new ScreenVideoDecoder();
  frames.forEach((frame, n) => {
    const p = decoder.decode(frame.data.subarray(1)); // 先頭の 1 バイトは、フレームの種類とコーデック
    assert.deepEqual([p.width, p.height], [SCREEN_VIDEO.width, SCREEN_VIDEO.height]);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const i = (y * p.width + x) * 4;
        assert.deepEqual([...p.rgba.subarray(i, i + 4)], [...screenVideoPixel(n, x, y), 255], `frame ${n} (${x}, ${y})`);
      }
    }
  });
  assert.throws(() => new ScreenVideoDecoder().decode(frames[0].data.subarray(1, 30)), VideoError);
  assert.throws(() => new ScreenVideoDecoder().decode(Uint8Array.from([0x0f, 0xff, 0x0f, 0xff])), /out of range/); // 4095×4095
});

test('埋め込みビデオ: ratio で指定されたフレームが表示される', async () => {
  const movie = await Movie.load(fixtures['video-h263']);
  for (let i = 0; i < 10; i++) movie.advance();
  const [main, still] = movie.root.sortedChildren();
  // 期待する絵: 先頭から順に復号したもの。
  const decoder = new H263Decoder();
  const pictures = parseFLV(flvBytes).video.map((t) => toRGBA(decoder.decode(t.data)));
  assert.equal(main.ratio, 7);
  assert.deepEqual(main.image().rgba, pictures[7]);
  assert.equal(still.ratio, 2); // 後から置かれて、フレーム 2 のまま（キーフレーム 0 から復号される）
  assert.deepEqual(still.image().rgba, pictures[2]);
  // 描画命令は、ビデオの枠（64×48 px）いっぱいにその絵を塗った矩形。
  const [op] = main.paths();
  assert.equal(op.style.bitmap, main.image());
  assert.deepEqual(op.path, [['M', 0, 0], ['L', 1280, 0], ['L', 1280, 960], ['L', 0, 960], ['Z']]);
  assert.deepEqual(main.boundsInParent(), { xmin: 200, xmax: 200 + 2560, ymin: 200, ymax: 200 + 1920 }); // 2 倍に拡大して置いてある
  assert.deepEqual(movie.warnings, []);

  const screen = await Movie.load(fixtures['video-screen']);
  for (let i = 0; i < 5; i++) screen.advance();
  const image = screen.root.sortedChildren()[0].image();
  assert.deepEqual([...image.rgba.subarray(0, 4)], [...screenVideoPixel(2, 0, 0), 255]);
});

test('埋め込みビデオ: 一度に復号するフレーム数には上限があり、壊れたフレームは警告を残して止まる', async () => {
  const packets = (await tagsOf('video-screen', 61)).map((t) => parseVideoFrame(t).data);
  // 100 フレームぶんのストリーム（中身は 3 種類の繰り返し）。いきなり最後のフレームを求めても、1 回では追いつかない。
  const frames = new Map(Array.from({ length: 100 }, (_, n) => [n, packets[n % 3]]));
  const warnings = [];
  const sequence = embeddedSequence('screen', frames, (m) => warnings.push(m));
  sequence.show(99);
  assert.equal(sequence.decoded, 31);
  for (let i = 0; i < 3; i++) sequence.show(99);
  assert.equal(sequence.decoded, 99);
  assert.deepEqual(warnings, []);
  // 壊れたフレームに当たったら、それより前の絵を残して止まる。
  frames.set(50, packets[0].subarray(0, 20));
  const broken = embeddedSequence('screen', frames, (m) => warnings.push(m));
  for (let i = 0; i < 5; i++) broken.show(99);
  assert.equal(broken.decoded, 50);
  assert.ok(broken.image);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^video frame 50: /);
});

test('埋め込みビデオ: 対応していないコーデックは、警告を残して表示しない', async () => {
  const bytes = fixtures['video-h263'].slice();
  const at = (await tagsOf('video-h263', 60))[0].offset;
  bytes[at + 2 + 9] = 7; // DefineVideoStream の CodecID を、SWF には無い 7 にする（タグの見出し 2 バイト + 9 バイト目）
  const movie = await Movie.load(bytes);
  for (let i = 0; i < 3; i++) movie.advance();
  assert.deepEqual(movie.warnings, ['video 1: codec unknown-7 is not supported (it will not be shown)']);
  assert.deepEqual(movie.root.sortedChildren()[0].paths(), []);
});

test('FLV を分解する', () => {
  const flv = parseFLV(flvBytes);
  assert.equal(flv.video.length, 8);
  assert.equal(flv.audio.length, 0);
  assert.deepEqual(flv.video.map((t) => [t.codec, t.key]), Array.from({ length: 8 }, (_, n) => ['h263', n % 4 === 0]));
  assert.deepEqual(flv.video.map((t) => t.time), [0, 83, 167, 250, 333, 417, 500, 583]);
  assert.equal(flv.duration, 583);
  assert.deepEqual({ ...flv.metadata }, { duration: 0.666, width: 64, height: 48, videodatarate: 195.3125, framerate: 12, videocodecid: 2, filesize: 4182 });
  // 音声つきのファイル（ADPCM、tools/assets/tone-adpcm.flv）。
  const tone = parseFLV(asset('tone-adpcm.flv'));
  assert.equal(tone.video.length, 0);
  assert.deepEqual([tone.audio[0].format, tone.audio[0].rate, tone.audio[0].bits16, tone.audio[0].stereo], ['adpcm', 22050, true, false]);
  // 途中で切れたファイルは、読めたところまで。FLV でないものは VideoError。
  assert.equal(parseFLV(flvBytes.subarray(0, 3000)).video.length, 4);
  assert.throws(() => parseFLV(Uint8Array.from([0x46, 0x57, 0x53, 8, 0, 0, 0, 0, 0])), VideoError);
});

test('FLV の再生: 時刻に合わせて絵が進み、最後のタグの時刻で終わる', () => {
  const h = host();
  const playback = new FlvPlayback(h, parseFLV(flvBytes));
  const decoder = new H263Decoder();
  const pictures = parseFLV(flvBytes).video.map((t) => toRGBA(decoder.decode(t.data)));
  assert.equal(playback.duration, 583);
  playback.play(0);
  assert.deepEqual(playback.image().rgba, pictures[0]);
  h.time = 260; // フレーム 3（250 ms）
  assert.deepEqual(playback.image().rgba, pictures[3]);
  assert.equal(playback.time, 260);
  assert.equal(playback.finished(), false);
  playback.pause();
  h.time = 1000;
  assert.equal(playback.time, 260); // 止めている間は進まない
  playback.resume();
  h.time = 1100; // 再開してから 100 ms
  assert.equal(playback.time, 360);
  assert.deepEqual(playback.image().rgba, pictures[4]);
  // 位置の変更は、指定より前でいちばん近いキーフレーム（0 ms か 333 ms）になる。
  playback.seek(300);
  assert.equal(playback.time, 0);
  playback.seek(500);
  assert.equal(playback.time, 333);
  assert.deepEqual(playback.image().rgba, pictures[4]);
  h.time += 400;
  assert.equal(playback.finished(), true);
  assert.equal(playback.finished(), false); // 終わりの通知は 1 回だけ
  assert.equal(playback.time, 583);
  assert.deepEqual(playback.image().rgba, pictures[7]);
  assert.deepEqual(h.warnings, []);
});

test('FLV の再生: 復号できない映像や音声は、警告を残して飛ばす', () => {
  const h = host();
  const tone = parseFLV(asset('tone-adpcm.flv'));
  tone.audio.forEach((t) => { t.format = 'nellymoser'; });
  const playback = new FlvPlayback(h, tone);
  playback.play(0);
  assert.equal(playback.image(), null);
  assert.deepEqual(h.warnings, ['video: FLV audio format nellymoser is not supported (it will be silent)']);
  // H.264 は、ホストがデコーダを渡さなければ映らない。
  const flv = parseFLV(flvBytes);
  flv.video.forEach((t) => { t.codec = 'avc'; t.packetType = 1; });
  const avc = new FlvPlayback(h, flv);
  avc.play(0);
  assert.equal(avc.image(), null);
  assert.equal(h.warnings[1], 'video: codec avc needs a decoder from the host (it will not be shown)');
});

test('FLV の再生: ADPCM の音声は、タグごとに復号してつなぐ', () => {
  const h = host();
  const playback = new FlvPlayback(h, parseFLV(asset('tone-adpcm.flv')));
  const { sound } = playback;
  // 0.3 秒・22050 Hz の音が、4096 サンプルずつ 2 つのタグに入っている（2 つ目は、余りを無音で埋めてある）。
  assert.deepEqual([sound.format, sound.rate, sound.channels, sound.bits, sound.sampleCount], ['adpcm', 22050, 1, 16, 8192]);
  assert.deepEqual(sound.blocks.map((b) => b.sampleCount), [4096, 4096]);
  // 復号した結果は、ffmpeg で復号したもの（test/sound.test.js と同じハッシュ）。
  const out = sound.blocks.flatMap((b) => [...decodeADPCM(b.data, 1, b.sampleCount)[0]]);
  const bytes = Buffer.alloc(out.length * 2);
  out.forEach((v, i) => bytes.writeInt16LE(v, i * 2));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '84cac926993757523b7ad2e78b0f557e63232e3c16fd5da618702ca6be471cd1');
  assert.deepEqual(h.warnings, []);
});

test('Screen Video v2: 復号結果が ffmpeg の復号結果と一致する（15 ビットの色の広げ方の差だけ）', () => {
  const flv = parseFLV(asset('video-screen2.flv'));
  const reference = gunzipSync(asset('video-screen2.rgb.gz'));
  const decoder = new ScreenVideo2Decoder();
  const pixel = (p, x, y) => [...p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3)];
  const seen = flv.video.map((tag, n) => {
    const p = decoder.decode(tag.data);
    assert.deepEqual([p.width, p.height], [128, 64]);
    // 実機は 15 ビットの色の下位 3 ビットを 0 のままにするので、ffmpeg（上位ビットを写す）より 0〜7 だけ暗い。
    for (let i = 0; i < 128 * 64; i++) {
      for (let k = 0; k < 3; k++) {
        const diff = reference[(n * 128 * 64 + i) * 3 + k] - p.rgba[i * 4 + k];
        assert.ok(diff >= 0 && diff <= 7, `frame ${n} value ${i}.${k}: ${diff}`);
      }
    }
    return [pixel(p, 2, 2), pixel(p, 10, 10), pixel(p, 85, 35), pixel(p, 100, 5)].map(String).join(' ');
  });
  // 地の色（15 ビットの色）と、現れては消える四角（赤と黄はパレットの色）。消えたところは、キーフレームの絵に戻る。
  const gray = '64,88,128';
  assert.deepEqual(seen, [
    `${gray} ${gray} ${gray} ${gray}`,
    `${gray} 255,0,0 ${gray} ${gray}`, // 一部の行だけが送られる
    `${gray} 255,0,0 255,255,0 ${gray}`, // 左のブロックは「変わっていない」
    `${gray} ${gray} ${gray} ${gray}`, // 行が 1 つも無いブロック: キーフレームに戻る
    `${gray} ${gray} 255,255,0 ${gray}`,
    `${gray} ${gray} ${gray} ${gray}`,
    `${gray} ${gray} 24,48,192 24,48,192`, // 右のブロック全体が変わる
  ]);
});

test('Screen Video v2: キーブロックの決まり方、Current の印、IFrameImage は、実機で確かめたとおりに働く', () => {
  // 32×16 px、ブロックは 16×16 が 2 つ。絵は 15 ビットの色の雑音（1 画素 2 バイト）で、(f, j) ごとに違う。
  // 同じストリームを実機で再生して確かめた挙動を、そのまま期待値にしている。
  const noise = (f, j) => {
    let seed = f * 1000 + j * 17 + 1;
    return Uint8Array.from({ length: 512 }, (_, i) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return i % 2 ? (seed >>> 16) & 0xff : ((seed >>> 16) & 0xff) | 0x80; });
  };
  // 辞書の中身を少しだけ変えたもの。辞書を使って圧縮すると短くなり、違う辞書で展開すると違う絵になる。
  const near = (data) => { const out = Uint8Array.from(data); out[101] ^= 0x1f; return out; };
  const plain = (data) => deflateSync(data);
  const primed = (data, dictionary) => {
    const body = deflateRawSync(data, { dictionary });
    assert.ok(body.length < 64); // 辞書に頼っている
    return Buffer.concat([body, Buffer.alloc(4)]); // 末尾の adler32 は見られないので、でたらめでよい
  };
  const blocks = (list) => list.flatMap((b) => (b ? [(b[1].length + 1) >> 8, (b[1].length + 1) & 255, b[0], ...b[1]] : [0, 0]));
  const packet = (flags, ...lists) => Uint8Array.from([0, 32, 0, 16, flags, ...lists.flatMap(blocks)]);
  const decoder = new ScreenVideo2Decoder();
  // ブロック j に映っている絵を、15 ビットの色のデータ（下の行から）に戻す。
  const shown = (j) => {
    const { rgba } = decoder;
    const out = [];
    for (let row = 0; row < 16; row++) {
      for (let x = j * 16; x < j * 16 + 16; x++) {
        const at = ((15 - row) * 32 + x) * 4, colour = ((rgba[at] >> 3) << 10) | ((rgba[at + 1] >> 3) << 5) | (rgba[at + 2] >> 3);
        out.push(0x80 | (colour >> 8), colour & 0xff);
      }
    }
    return Uint8Array.from(out);
  };
  decoder.decode(packet(0, [[0x10, plain(noise(0, 0))], [0x10, plain(noise(0, 1))]]));
  assert.deepEqual([shown(0), shown(1)], [noise(0, 0), noise(0, 1)]);
  // 素のブロックは、差分フレームでもキーブロックになる。次の priming は、それを辞書にする。
  decoder.decode(packet(0, [[0x10, plain(noise(1, 0))], null]));
  decoder.decode(packet(0, [[0x11, primed(near(noise(1, 0)), noise(1, 0))], [0x12, plain(noise(5, 1))]]));
  assert.deepEqual(shown(0), near(noise(1, 0)));
  // Current の印（形式の 2）: 位置の 2 バイトは無く、素のブロックとして映る。ただしキーブロックにはならない
  // （次の priming の辞書は、フレーム 0 のままになる）。両方の印が立っていれば、ふつうの priming。
  assert.deepEqual(shown(1), noise(5, 1));
  decoder.decode(packet(0, [null, [0x13, primed(near(noise(0, 1)), noise(0, 1))]]));
  assert.deepEqual([shown(0), shown(1)], [near(noise(1, 0)), near(noise(0, 1))]);
  // IFrameImage: ブロックの列がもう 1 つ続き、同じ規則で続けて処理される（先の列で置き換わったキーブロックが、辞書になる）。
  decoder.decode(packet(2, [[0x10, plain(noise(6, 0))], null], [[0x11, primed(near(noise(6, 0)), noise(6, 0))], [0x10, plain(noise(7, 1))]]));
  assert.deepEqual([shown(0), shown(1)], [near(noise(6, 0)), noise(7, 1)]);
  assert.throws(() => decoder.decode(packet(2, [null, null])), /truncated/); // 2 つ目の列が無い
});

test('Screen Video v2: 実機が再生できないものと壊れたデータは VideoError にする。埋め込みでは使えない', () => {
  const [key, inter] = parseFLV(asset('video-screen2.flv')).video.map((t) => t.data);
  assert.throws(() => new ScreenVideo2Decoder().decode(inter), /without a key block/); // キーフレームより前の差分
  assert.throws(() => new ScreenVideo2Decoder().decode(key.subarray(0, 20)), VideoError);
  const palette = Uint8Array.from(key); // Buffer の slice は写しにならないので、写しを作る
  palette[4] = 1; // ストリームの中のパレット（実機は、これが付いたストリームで落ちる）
  assert.throws(() => new ScreenVideo2Decoder().decode(palette), /palette/);
  // FLV では再生できるが、SWF に埋め込んだもの（実機も何も表示しない）は対象外。
  assert.equal(decodable('screen2'), false);
  const h = host();
  const playback = new FlvPlayback(h, parseFLV(asset('video-screen2.flv')));
  playback.play(0);
  h.time = 500;
  assert.deepEqual([...playback.image().rgba.subarray((5 * 128 + 100) * 4, (5 * 128 + 100) * 4 + 3)], [24, 48, 192]);
  assert.deepEqual(h.warnings, []);
});

// VP6 の素材（tools/mkvp6.js で作ったもの）: 64×48 px で符号化されていて、表示するのは 62×44 px。8 フレーム。
const VP6 = { width: 62, height: 44, stride: 64, frames: 8 };
// ffmpeg の復号結果（表示する範囲だけの YUV、アルファ付きなら A も）を、フレームごとの面に分ける。
function vp6Reference(name, alpha = false) {
  const data = gunzipSync(asset(name));
  const { width: w, height: h } = VP6;
  const sizes = [w * h, (w >> 1) * (h >> 1), (w >> 1) * (h >> 1), ...(alpha ? [w * h] : [])];
  let at = 0;
  const frames = Array.from({ length: VP6.frames }, () => sizes.map((size) => data.subarray(at, (at += size))));
  assert.equal(at, data.length);
  return frames;
}
// ffmpeg の復号結果から作る、表示される絵（RGBA）。実機に合わせた変換: 輝度は 16〜235、色差は 16〜240 に収める。
// アルファ付きの色はアルファを掛けた値で、アルファより明るい色はアルファまでに抑える。それを、掛ける前の色に戻す。
function vp6Shown([y, cb, cr, a]) {
  const { width: w, height: h } = VP6;
  const clamp = (v, low, high) => Math.min(Math.max(v, low), high);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const luma = 1.164 * (clamp(y[py * w + px], 16, 235) - 16);
      const c = (py >> 1) * (w >> 1) + (px >> 1);
      const u = clamp(cb[c], 16, 240) - 128, v = clamp(cr[c], 16, 240) - 128;
      const alpha = a ? a[py * w + px] : 255;
      const colour = [luma + 1.596 * v, luma - 0.392 * u - 0.813 * v, luma + 2.017 * u].map((value) => clamp(value, 0, alpha));
      rgba.set([...colour.map((value) => (alpha ? (value * 255) / alpha : value)), alpha], (py * w + px) * 4);
    }
  }
  return rgba;
}

test('VP6: 復号結果が ffmpeg の復号結果と完全に一致する（アルファ付きと、インターレースも）', () => {
  for (const [name, reference, alpha] of [['video-vp6.flv', 'video-vp6.yuv.gz', false], ['video-vp6a.flv', 'video-vp6a.yuva.gz', true], ['video-vp6i.flv', 'video-vp6i.yuv.gz', false]]) {
    const flv = parseFLV(asset(name));
    assert.deepEqual(flv.video.map((t) => [t.codec, t.key]), Array.from({ length: 8 }, (_, n) => [alpha ? 'vp6a' : 'vp6', n % 4 === 0]));
    const expected = vp6Reference(reference, alpha);
    const decoder = new VP6Decoder(alpha);
    flv.video.forEach((tag, n) => {
      assert.equal(tag.data[0], 0x24); // 右を 2 px、下を 4 px 削る
      const p = decoder.decode(tag.data.subarray(1));
      assert.deepEqual([p.width, p.height, p.stride], [64, 48, 64]); // 符号化された大きさ
      const planes = [[p.y, 64, 62, 44], [p.cb, 32, 31, 22], [p.cr, 32, 31, 22], ...(alpha ? [[p.alpha, 64, 62, 44]] : [])];
      planes.forEach(([plane, stride, w, h], k) => {
        for (let y = 0; y < h; y++) assert.deepEqual([...plane.subarray(y * stride, y * stride + w)], [...expected[n][k].subarray(y * w, y * w + w)], `${name} frame ${n} plane ${k} row ${y}`);
      });
    });
  }
});

test('VP6: インターレースのアルファの面は、同じデータを色のストリームとして復号したときの輝度と同じになる', () => {
  // ffmpeg は、インターレースのアルファの面を正しく復号しない（行の間隔を 2 倍にしない）ので、ffmpeg とは比べられない。
  // 輝度の復号は ffmpeg と一致することを確かめてあるので、それと同じ結果になることを確かめる。
  const whole = new VP6Decoder(true), plain = new VP6Decoder();
  let fields = 0;
  for (const tag of parseFLV(asset('video-vp6ai.flv')).video) {
    const data = tag.data.subarray(1);
    const offset = (data[0] << 16) | (data[1] << 8) | data[2];
    assert.deepEqual(whole.decode(data).alpha, plain.decode(data.subarray(3 + offset)).y);
    assert.equal(whole.alpha.interlaced, 1);
    fields += whole.alpha.ilBlock;
  }
  assert.ok(fields > 0); // フィールドごとに符号化したマクロブロックがある
});

test('VP6: matchPlayer を指定すると、インターレースのストリームを実機と同じに映さない', async () => {
  const size = { width: 62, height: 44 };
  const frames = (name) => new Map(parseFLV(asset(name)).video.map((t, n) => [n, t.data.subarray(1)]));
  // 既定では、ffmpeg と同じに復号して映す。
  const shown = embeddedSequence('vp6', frames('video-vp6i.flv'), () => {}, size).show(0);
  assert.deepEqual(shown.rgba, vp6Shown(vp6Reference('video-vp6i.yuv.gz')[0]));
  // 埋め込みのビデオ: 枠が黒くなる。アルファ付きは、何も映らない。警告は 1 回だけ。
  const warnings = [];
  const hidden = embeddedSequence('vp6', frames('video-vp6i.flv'), (m) => warnings.push(m), size, true);
  for (const n of [0, 3, 7]) assert.deepEqual([hidden.show(n).width, hidden.show(n).height, ...new Set(hidden.show(n).rgba)], [62, 44, 0, 255]);
  assert.deepEqual(warnings, ['interlaced VP6 is not shown (as in the real player)']);
  assert.equal(embeddedSequence('vp6a', frames('video-vp6ai.flv'), () => {}, size, true).show(7), null);
  // FLV: 何も映らない。
  for (const name of ['video-vp6i.flv', 'video-vp6ai.flv']) {
    const h = Object.assign(host(), { matchPlayer: true });
    const playback = new FlvPlayback(h, parseFLV(asset(name)));
    playback.play(0);
    h.time = 520;
    assert.equal(playback.image(), null);
    assert.deepEqual(h.warnings, ['video: interlaced VP6 is not shown (as in the real player)']);
    const plain = new FlvPlayback(host(), parseFLV(asset(name)));
    plain.play(0);
    assert.deepEqual([plain.image().width, plain.image().height], [62, 44]);
  }
  // インターレースでないストリームには、影響しない。オプションは Movie.load から渡る。
  const movie = await Movie.load(fixtures['video-vp6'], { matchPlayer: true });
  for (let i = 0; i < 10; i++) movie.advance();
  assert.equal(movie.matchPlayer, true);
  assert.deepEqual(movie.root.sortedChildren()[0].image().rgba, vp6Shown(vp6Reference('video-vp6.yuv.gz')[7]));
  assert.deepEqual(movie.warnings, []);
  assert.equal((await Movie.load(fixtures['video-vp6'])).matchPlayer, false);
});

test('埋め込みビデオ: matchPlayer を指定すると、H.263 と VP6 の塗りに、横方向の混ぜ合わせを頼む印が付く', async () => {
  // 実機は、埋め込みの H.263 / VP6 を整数倍で描くとき、横方向だけ右隣の画素と混ぜる。混ぜるのは描画側（render/canvas.js）で、
  // その結果は web/compare.html?matchPlayer で実機の画面と比べる。ここでは、描画側に頼む印だけを確かめる。
  const blend = async (name, options) => {
    const movie = await Movie.load(fixtures[name], options);
    for (let i = 0; i < 10; i++) movie.advance();
    return movie.root.sortedChildren().map((video) => video.paths()[0].style.blendRight);
  };
  assert.deepEqual(await blend('video-vp6', { matchPlayer: true }), [true, true]);
  assert.deepEqual(await blend('video-h263', { matchPlayer: true }), [true, true]);
  assert.deepEqual(await blend('video-vp6a', { matchPlayer: true }), [false]); // アルファ付きと Screen Video は、実機でも混ざらない
  assert.deepEqual(await blend('video-screen', { matchPlayer: true }), [false]);
  assert.deepEqual(await blend('video-vp6'), [false, false]);
  // NetStream の絵を映しているときも、混ぜない。
  const movie = await Movie.load(fixtures['video-vp6'], { matchPlayer: true });
  const [video] = movie.root.sortedChildren();
  const picture = video.image();
  video.source = { image: () => picture };
  assert.equal(video.paths()[0].style.blendRight, false);
});

test('VP6: 壊れたデータは VideoError にする（ほかの例外や、止まらない復号にならない）', () => {
  // でたらめに壊すのは、インターレースのストリーム（復号の経路がいちばん多い）。
  const frames = parseFLV(asset('video-vp6i.flv')).video.map((t) => t.data.subarray(1));
  assert.throws(() => new VP6Decoder().decode(frames[1]), /without a key frame/);
  assert.throws(() => new VP6Decoder().decode(frames[0].subarray(0, 5)), /too short/);
  assert.throws(() => new VP6Decoder().decode(new Uint8Array(0)), /too short/);
  const edit = (change) => { const data = Uint8Array.from(frames[0]); change(data); return data; };
  assert.throws(() => new VP6Decoder().decode(edit((d) => { d[1] = 9 << 3; })), /unknown version/);
  assert.throws(() => new VP6Decoder().decode(edit((d) => { d[2] = 0; })), /size is zero/);
  assert.throws(() => new VP6Decoder().decode(edit((d) => { d[2] = d[3] = 255; })), /out of range/); // 4080×4080
  assert.throws(() => new VP6Decoder().decode(edit((d) => { d[0] |= 1; d[2] = 0xff; d[3] = 0xff; })), VideoError); // 係数の区画がフレームの外
  // アルファ付き: 色のデータの長さがフレームからはみ出す。色とアルファの大きさが違う。
  const [alphaKey] = parseFLV(asset('video-vp6a.flv')).video.map((t) => Uint8Array.from(t.data.subarray(1)));
  assert.throws(() => new VP6Decoder(true).decode(Uint8Array.from([0xff, 0xff, 0xff, ...alphaKey.subarray(3)])), /outside the frame/);
  const offset = (alphaKey[0] << 16) | (alphaKey[1] << 8) | alphaKey[2];
  alphaKey[3 + offset + 3] = 2; // アルファの側の、マクロブロックの列の数
  assert.throws(() => new VP6Decoder(true).decode(alphaKey), VideoError);
  // でたらめに壊したフレームを続けて復号しても、VideoError のほかは起きない。
  let seed = 1;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  let failed = 0;
  for (let round = 0; round < 300; round++) {
    const decoder = new VP6Decoder();
    for (const frame of frames) {
      let data = Uint8Array.from(frame);
      if (round % 3 === 0) data = data.subarray(0, rnd(data.length + 1));
      else for (let k = 1 + rnd(4); k > 0; k--) data[rnd(data.length)] = rnd(256);
      try {
        const p = decoder.decode(data);
        assert.ok(p.width * p.height <= 1 << 22 && p.y.length === p.width * p.height);
      } catch (e) {
        assert.ok(e instanceof VideoError, e.stack);
        failed++;
      }
    }
  }
  assert.ok(failed > 100, String(failed));
});

test('埋め込みビデオと FLV の VP6: 絵は表示する大きさに切り取られ、色は実機と同じ変換で RGBA になる', async () => {
  for (const [fixture, flvName, reference, alpha] of [['video-vp6', 'video-vp6.flv', 'video-vp6.yuv.gz', false], ['video-vp6a', 'video-vp6a.flv', 'video-vp6a.yuva.gz', true]]) {
    const pictures = vp6Reference(reference, alpha).map(vp6Shown);
    assert.equal(decodable(alpha ? 'vp6a' : 'vp6'), true);
    assert.equal(parseDefineVideoStream((await tagsOf(fixture, 60))[0]).codec, alpha ? 'vp6a' : 'vp6');
    const movie = await Movie.load(fixtures[fixture]);
    for (let i = 0; i < 10; i++) movie.advance();
    const [main, still] = movie.root.sortedChildren();
    assert.equal(main.ratio, 7);
    assert.deepEqual([main.image().width, main.image().height], [62, 44]);
    assert.deepEqual(main.image().rgba, pictures[7]);
    if (!alpha) {
      assert.equal(still.ratio, 5); // 後から置かれて、フレーム 5 のまま（キーフレーム 4 から復号される）
      assert.deepEqual(still.image().rgba, pictures[5]);
    } else assert.ok(main.image().rgba.some((v, i) => i % 4 === 3 && v > 0 && v < 255)); // 半透明の画素がある
    assert.deepEqual(movie.warnings, []);
    // FLV: パケットの先頭の 1 バイトが、右と下から削る画素数。
    const h = host();
    const playback = new FlvPlayback(h, parseFLV(asset(flvName)));
    playback.play(0);
    assert.deepEqual(playback.image().rgba, pictures[0]);
    h.time = 520; // フレーム 6（500 ms）
    assert.deepEqual([playback.image().width, playback.image().height], [62, 44]);
    assert.deepEqual(playback.image().rgba, pictures[6]);
    assert.deepEqual(h.warnings, []);
  }
  // 符号化された大きさより広い枠には、何も映らない（黒くなる）。狭い枠には、左上の部分が映る。
  const frames = new Map(parseFLV(asset('video-vp6.flv')).video.map((t, n) => [n, t.data.subarray(1)]));
  const wide = embeddedSequence('vp6', frames, () => {}, { width: 80, height: 48 }).show(0);
  assert.deepEqual([wide.width, wide.height, ...new Set(wide.rgba)], [80, 48, 0, 255]);
  const narrow = embeddedSequence('vp6', frames, () => {}, { width: 20, height: 10 }).show(0);
  const full = vp6Shown(vp6Reference('video-vp6.yuv.gz', false)[0]);
  assert.deepEqual([...narrow.rgba.subarray(0, 80)], [...full.subarray(0, 80)]);
  assert.deepEqual([...narrow.rgba.subarray(9 * 80)], [...full.subarray(9 * 62 * 4, 9 * 62 * 4 + 80)]);
});
