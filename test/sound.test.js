// 音: タグの解析、復号、鳴らす時機の管理。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeADPCM, decodeSound, scanMP3 } from '../src/audio/decode.js';
import { Movie } from '../src/player/movie.js';
import { parseSWF } from '../src/swf/parse.js';
import { parseDefineSound, parseStartSound } from '../src/swf/sound.js';
import { DefineSound, End, ShowFrame, adpcmBytes, fixtures, pcmBytes, swf, tag, tone, u16 } from '../tools/mkfixtures.js';

const sounds = async () => (await parseSWF(fixtures['sound-event'])).tags.filter((t) => t.code === 14).map(parseDefineSound);

test('DefineSound と StartSound を読める', async () => {
  const list = await sounds();
  assert.deepEqual(list.map((s) => [s.id, s.format, s.rate, s.bits, s.channels, s.sampleCount]), [
    [1, 'pcm', 22050, 16, 1, 6615], [2, 'adpcm', 22050, 16, 1, 6615], [3, 'mp3', 22050, 16, 1, 8064],
    [4, 'pcm', 11025, 8, 1, 2205], [5, 'adpcm', 11025, 16, 1, 2205],
  ]);
  const starts = (await parseSWF(fixtures['sound-event'])).tags.filter((t) => t.code === 15).map(parseStartSound);
  assert.deepEqual(starts[0], { soundId: 1, info: { stop: false, noMultiple: false, loops: 1 } });
  assert.deepEqual(starts[1].info.loops, 2);
  assert.deepEqual(starts[2].info.envelope, [{ position: 0, left: 32768, right: 0 }, { position: 8000, left: 0, right: 32768 }]);
  assert.deepEqual([starts[3].info.inPoint, starts[3].info.outPoint, starts[3].info.loops], [2000, 6000, 3]);
  assert.equal(starts[4].info.noMultiple, true);
  assert.equal(starts[6].info.stop, true);
});

test('PCM は元の波形に戻る（8 ビットは上位 8 ビットぶん）', async () => {
  const list = await sounds();
  assert.deepEqual(decodeSound(list[0]).channels[0], tone(22050, 0.3));
  const eight = decodeSound(list[3]).channels[0];
  const original = tone(11025, 0.2, 330);
  assert.equal(eight.length, original.length);
  assert.ok(eight.every((v, i) => Math.abs(v - original[i]) < 256));
});

test('ADPCM: ffmpeg が符号化したデータを、ffmpeg と同じ値に復号する', () => {
  // tone-adpcm.flv の音声タグ（1 つが独立した ADPCM データ）を順に復号する。期待値は ffmpeg で復号した結果のハッシュ。
  const flv = readFileSync(new URL('../tools/assets/tone-adpcm.flv', import.meta.url));
  const out = [];
  for (let p = 13; p + 11 <= flv.length;) {
    const size = (flv[p + 1] << 16) | (flv[p + 2] << 8) | flv[p + 3];
    if (flv[p] === 8) out.push(...decodeADPCM(flv.subarray(p + 12, p + 11 + size), 1, 4096)[0]);
    p += 11 + size + 4;
  }
  const bytes = Buffer.alloc(out.length * 2);
  out.forEach((v, i) => bytes.writeInt16LE(v, i * 2));
  assert.equal(out.length, 8192);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '84cac926993757523b7ad2e78b0f557e63232e3c16fd5da618702ca6be471cd1');
});

test('ADPCM: 符号の幅 2〜5 ビットのどれでも、元の波形に近い音に戻る', () => {
  const original = tone(22050, 0.3);
  const ratio = (size) => {
    const decoded = decodeADPCM(Uint8Array.from(adpcmBytes(original, size)), 1, original.length)[0];
    assert.equal(decoded.length, original.length);
    let noise = 0, signal = 0;
    for (let i = 0; i < original.length; i++) {
      noise += (decoded[i] - original[i]) ** 2;
      signal += original[i] ** 2;
    }
    return 10 * Math.log10(signal / noise); // S/N (dB)
  };
  const all = [2, 3, 4, 5].map(ratio);
  assert.ok(all[0] > 5 && all[1] > 15 && all[2] > 25 && all[3] > 30, `S/N ${all.map((v) => v.toFixed(1))}`);
});

test('MP3 のフレームを数えて長さが分かる', async () => {
  const mp3 = (await sounds())[2];
  assert.deepEqual(scanMP3(mp3.data), { frames: 14, samples: 8064, rate: 22050, channels: 1 });
  assert.deepEqual(scanMP3(new Uint8Array(100)), { frames: 0, samples: 0, rate: 0, channels: 0 });
  assert.equal(decodeSound(mp3), null); // 復号は出力側に任せる
});

// 出力の代わりに、呼ばれた内容を記録するもの。
const recorder = () => {
  const calls = [];
  return {
    calls,
    play: (sound, options) => { calls.push(['play', sound.id, options]); return calls.length; },
    stop: (handle) => { calls.push(['stop', handle]); },
  };
};

test('イベント音: フレームの StartSound で鳴り、繰り返し・重ね鳴らしの禁止・停止の指定に従う', async () => {
  let time = 0;
  const audio = recorder();
  const movie = await Movie.load(fixtures['sound-event'], { now: () => time, audio });
  const frame = (n) => { while (movie.root.currentFrame < n) { time += 1000 / 12; movie.advance(); } };
  assert.deepEqual(audio.calls.map((c) => c.slice(0, 2)), [['play', 1]]); // 1 フレーム目
  frame(7);
  assert.deepEqual(audio.calls[1].slice(0, 2), ['play', 2]);
  assert.equal(audio.calls[1][2].loops, 2);
  frame(17);
  assert.deepEqual(audio.calls[2][2].envelope, [{ time: 0, left: 1, right: 0 }, { time: 8000 / 44100, left: 0, right: 1 }]);
  frame(23);
  const options = audio.calls[3][2];
  assert.deepEqual([audio.calls[3][1], options.loops], [4, 3]);
  assert.ok(Math.abs(options.inPoint - 2000 / 44100) < 1e-9 && Math.abs(options.outPoint - 6000 / 44100) < 1e-9);
  frame(24); // 4 は鳴っている最中なので、noMultiple の StartSound は無視される。5 は鳴る
  assert.deepEqual(audio.calls.slice(4).map((c) => c.slice(0, 2)), [['play', 5]]);
  frame(26); // 4 を止める
  assert.deepEqual(audio.calls[5], ['stop', 4]);
  assert.equal(movie.sounds.playing.some((p) => p.sound.id === 4), false);
  frame(40);
  assert.deepEqual(movie.sounds.playing, []); // 鳴り終わった音は片付く
  assert.equal(audio.calls.length, 6);
});

test('StartSound2: AS3 のクラス名に結び付いた音を鳴らす', async () => {
  const name = (text) => [...new TextEncoder().encode(text), 0];
  const audio = recorder();
  const movie = await Movie.load(swf({
    version: 10, frames: 2,
    tags: [
      tag(69, [0x08, 0, 0, 0]), // FileAttributes: ActionScript 3
      DefineSound(1, 3, 22050, 2205, pcmBytes(tone(22050, 0.1))),
      tag(76, [...u16(1), ...u16(1), ...name('snd.Beep')]), // SymbolClass
      tag(89, [...name('snd.Beep'), 0]), ShowFrame(),
      tag(89, [...name('snd.Missing'), 0]), ShowFrame(), // 結び付いていない名前は鳴らない
      End(),
    ],
  }), { audio });
  movie.advance();
  assert.deepEqual(audio.calls.map((c) => c.slice(0, 2)), [['play', 1]]);
});

test('ストリーム音: フレームが進む間だけ鳴り、飛んだらその位置から鳴らし直す', async () => {
  let time = 0;
  const audio = recorder();
  const movie = await Movie.load(fixtures['sound-stream'], { now: () => time, audio });
  const log = [];
  for (let i = 0; i < 22; i++) {
    time += 1000 / 12;
    const before = audio.calls.length;
    movie.advance();
    log.push(`${movie.root.currentFrame}:${audio.calls.slice(before).map((c) => (c[0] === 'play' ? `play@${Math.round(c[2].offset * 22050)}` : 'stop')).join('+')}`);
  }
  // 2 フレーム目から鳴り始める（1 フレーム目は読み込み時に処理済みで、その次の advance で 2 フレーム目になる）。
  // 9 フレーム目はデータが無いので止まる。10 フレーム目で 3 フレーム目へ戻り、その位置（1838 × 2 サンプル目）から鳴らし直す。
  // 2 周目の 6 フレーム目で stop() が呼ばれ、音も止まる。
  assert.deepEqual(log.slice(0, 14), [
    '2:play@1838', '3:', '4:', '5:', '6:', '7:', '8:', '9:stop', '3:play@3676', '4:', '5:', '6:stop', '6:', '6:',
  ]);
  const stream = movie.root.frames.stream;
  assert.deepEqual([stream.sound.format, stream.sound.rate, stream.sound.sampleCount, stream.sound.blocks.length], ['adpcm', 22050, 1838 * 8, 8]);
});
