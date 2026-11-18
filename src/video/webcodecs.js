// H.264 (AVC) の復号を、ブラウザのデコーダ（WebCodecs の VideoDecoder）に任せる。ブラウザ専用。
//
// プレイヤーからは「映像の出力」として使う（Movie.load の video オプション）。インターフェース:
//   open({ codec, description, width, height }): handle | null   復号を始める。対応していなければ null
//   handle.ready              次のフレームを入れてよいか（復号を待たせすぎないための目安）
//   handle.push({ key, time, data })   フレームを復号の順に入れる。time は表示時刻（ミリ秒）
//   handle.image(time)        time 以前でいちばん新しい復号済みの絵 { type: 'bitmap', width, height, image, version }。無ければ null
//   handle.reset()            入れたフレームを捨てる（位置を変えるとき。次はキーフレームから入れる）
//   handle.close()
// 復号は非同期なので、絵は入れてから少し遅れて出てくる。

const MAX_READY = 12; // 復号済みで、まだ表示していないフレームを持っておく数

class Handle {
  #decoder;
  #config;
  #ready = []; // 復号済みのフレーム { time, frame }（表示時刻の順）
  #shown = null; // 今の絵
  #generation = 0;
  pending = 0;

  constructor(config) {
    this.#config = config;
    this.#start();
  }

  #start() {
    const generation = this.#generation;
    this.#decoder = new VideoDecoder({
      output: (frame) => {
        this.pending = Math.max(0, this.pending - 1);
        if (generation !== this.#generation) { frame.close(); return; } // reset より前に入れたぶん
        this.#ready.push({ time: frame.timestamp / 1000, frame });
        this.#ready.sort((a, b) => a.time - b.time);
      },
      error: () => { this.failed = true; },
    });
    this.#decoder.configure(this.#config);
  }

  push({ key, time, data }) {
    if (this.failed || this.#decoder.state !== 'configured') return;
    this.pending++;
    this.#decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: Math.round(time * 1000), data }));
  }

  /** 復号を待たせすぎていないか（これが偽の間は、次のフレームを入れない）。 */
  get ready() {
    return this.pending + this.#ready.length < MAX_READY;
  }

  image(time) {
    // time 以前のフレームのうち、いちばん新しいものを絵にする。それより古いものは捨てる。
    let latest = null;
    while (this.#ready.length && this.#ready[0].time <= time) {
      latest?.frame.close();
      latest = this.#ready.shift();
    }
    if (latest) {
      const { frame } = latest;
      const width = frame.displayWidth, height = frame.displayHeight;
      if (!this.#shown || this.#shown.width !== width || this.#shown.height !== height) {
        this.#shown = { type: 'bitmap', width, height, image: new OffscreenCanvas(width, height), version: 0 };
      }
      this.#shown.image.getContext('2d').drawImage(frame, 0, 0, width, height);
      this.#shown.version++;
      frame.close();
    }
    return this.#shown;
  }

  reset() {
    this.#generation++;
    for (const { frame } of this.#ready) frame.close();
    this.#ready = [];
    this.pending = 0;
    if (this.#decoder.state !== 'closed') this.#decoder.close();
    this.failed = false;
    this.#start();
  }

  close() {
    this.#generation++;
    for (const { frame } of this.#ready) frame.close();
    this.#ready = [];
    if (this.#decoder.state !== 'closed') this.#decoder.close();
  }
}

export class WebCodecsVideo {
  /** このブラウザで使えるか。 */
  static get supported() {
    return typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function' && typeof OffscreenCanvas === 'function';
  }

  /**
   * @param {{ codec: string, description: Uint8Array, width?: number, height?: number }} stream
   *   codec は 'avc'。description は AVCDecoderConfigurationRecord（FLV の AVC シーケンスヘッダの中身）
   */
  open({ codec, description }) {
    if (!WebCodecsVideo.supported || codec !== 'avc' || description.length < 4) return null;
    // コーデックの名前は、設定の 2〜4 バイト目（プロファイル、互換性、レベル）から作る。
    const hex = [...description.subarray(1, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
    try {
      return new Handle({ codec: `avc1.${hex}`, description, optimizeForLatency: true });
    } catch {
      return null;
    }
  }
}
