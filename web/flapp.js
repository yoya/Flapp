// SWF をページに埋め込む部品（<flapp-player> 要素と embed 関数）と、ホスト側の取り決め（信用する SWF の通信と保存）。
//
//   <script type="module" src="flapp/web/flapp.js"></script>
//   <flapp-player src="movie.swf"></flapp-player>
//
// 属性: src（SWF の URL）、trust（付けると、信用する SWF として動かす。付けなければ、通信もページの移動もしない）、
//       encoding（SWF 5 以前の文字コード。既定はブラウザの言語から）、match-player（実機と同じに映さないものを映さない）。
// プロパティ: movie（再生中の Movie）、メソッド: load(url か bytes, { label })、stop()。
// イベント: trace（detail に文字列）、warning、error、loaded。画面の大きさは SWF のステージの大きさ（CSS で変えられる）。
// 入力は、マウスの動きとボタン、キー（要素をクリックして選んでいる間）。音は、ページを最初にクリックするかキーを押した後から鳴る。
import { Movie } from '../src/player/movie.js';
import { CanvasRenderer } from '../src/render/canvas.js';
import { WebAudioOutput } from '../src/audio/webaudio.js';
import { WebCodecsVideo } from '../src/video/webcodecs.js';

/**
 * SWF を信用するときの、SharedObject の保存先（Movie.load の storage オプション）。localStorage に、SWF ごと（?swf= で読んだときは
 * その URL、ファイルを選んだときはそのファイル名）に分けて書く。書けなければ（容量など）false。
 */
export function trustedStorage(id) {
  const key = (name) => `flapp:so:${id}:${name}`;
  return {
    load(name) { try { return localStorage.getItem(key(name)); } catch { return null; } },
    save(name, text) {
      try {
        if (text === null) localStorage.removeItem(key(name));
        else localStorage.setItem(key(name), text);
        return true;
      } catch { return false; }
    },
  };
}

/**
 * SWF を信用するときの、移動と読み込み（Movie.load の network オプション）と、NetStream.play のファイル（media オプション）。
 * 相対 URL は、?swf= で読んだときはその SWF の URL から、ファイルを選んだときはこのページの URL から解決する。
 * http / https 以外（javascript: や file: など）は、開きも読みもしない。
 */
export function trustedHttp(base, trace) {
  const resolve = (url) => {
    try {
      const target = new URL(url, new URL(base ?? location.href, location.href));
      if (target.protocol === 'http:' || target.protocol === 'https:') return target;
    } catch { /* 解釈できない URL */ }
    trace(`[blocked] ${url}（http / https 以外は、開きも読みもしません）`);
    return null;
  };
  const network = {
    // 移動: target が空か _self / _parent / _top ならこのページを、それ以外の名前なら新しいタブ（そのウィンドウ名）を開く。
    // POST で送る中身があれば、フォームを作って送る。GET なら、中身を URL の後ろに付ける。
    navigate({ url, target, method, data }) {
      const to = resolve(url);
      if (!to) return;
      const where = !target || /^_(self|parent|top)$/i.test(target) ? '_self' : target;
      if (method === 'POST') {
        const form = Object.assign(document.createElement('form'), { method: 'post', action: to.href, target: where });
        for (const [name, value] of new URLSearchParams(data ?? '')) form.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
        document.body.append(form);
        form.submit();
        form.remove();
        return;
      }
      if (data) for (const [name, value] of new URLSearchParams(data)) to.searchParams.append(name, value);
      if (where === '_self') location.assign(to.href);
      else window.open(to.href, where, 'noopener');
    },
    // 読み込み: 結果のバイト列を返す。読めなければ null（スクリプトには失敗として伝わる）。
    async load({ url, method, data, contentType, headers }) {
      const from = resolve(url);
      if (!from) return null;
      try {
        const res = await fetch(from, { method, body: data ?? undefined, headers: { ...(data && contentType ? { 'Content-Type': contentType } : {}), ...(headers ?? {}) } });
        if (!res.ok) trace(`[load] ${from.href}: HTTP ${res.status}`);
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      } catch (e) {
        trace(`[load] ${from.href}: ${e.message}`);
        return null;
      }
    },
  };
  // NetStream.play(url): FLV のバイト列を返す。読めなければ null（見つからない扱い）。
  const media = async (url) => {
    const from = resolve(url);
    if (!from) return null;
    try {
      const res = await fetch(from);
      if (!res.ok) trace(`[play] ${from.href}: HTTP ${res.status}`);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch (e) {
      trace(`[play] ${from.href}: ${e.message}`);
      return null;
    }
  };
  return { network, media };
}


// 音の出力は、ページに 1 つ。ブラウザは利用者の操作があるまで音を出さないので、最初のクリックやキー操作で有効にする。
let sharedAudio = null;
const audioOutput = () => {
  if (sharedAudio) return sharedAudio;
  sharedAudio = new WebAudioOutput();
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => {
      if (sharedAudio.context.state === 'suspended') sharedAudio.resume().then(() => { for (const el of document.querySelectorAll('flapp-player')) el.movie?.sounds.resync(); });
    }, { capture: true });
  }
  return sharedAudio;
};
const video = WebCodecsVideo.supported ? new WebCodecsVideo() : undefined; // H.264 は、ブラウザのデコーダで復号する

// SWF 5 以前の文字列の文字コードの既定（実機は OS の言語に合わせるので、ブラウザの言語から決める）。
const defaultEncoding = () => {
  const language = navigator.language.toLowerCase();
  return language.startsWith('ja') ? 'shift_jis' : language.startsWith('ko') ? 'euc-kr' : /^zh-(tw|hk|hant)/.test(language) ? 'big5' : language.startsWith('zh') ? 'gbk' : 'windows-1252';
};

export class FlappPlayer extends HTMLElement {
  static observedAttributes = ['src', 'trust', 'encoding', 'match-player'];
  #canvas = document.createElement('canvas');
  #renderer = new CanvasRenderer(this.#canvas);
  #timer = 0;
  #generation = 0; // load のたびに増やし、古い読み込みの続きを捨てる
  #source = null; // { bytes, label, base }（属性を変えたときに読み直す）
  movie = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host { display: inline-block; line-height: 0; } canvas { display: block; outline: none; }</style>';
    root.append(this.#canvas);
    const canvas = this.#canvas;
    // マウスとキーの入力をムービーへ伝える。キー入力は、要素をクリックして選んでいる間だけ受け取る。
    const input = (handle) => (e) => {
      if (!this.movie) return;
      handle(this.movie, e);
      canvas.style.cursor = this.movie.avm && !this.movie.avm.mouseVisible ? 'none' : this.movie.hoverButton ? 'pointer' : '';
      this.#draw();
    };
    const moveTo = (movie, e) => {
      const rect = canvas.getBoundingClientRect();
      movie.mouseMove(Math.round((e.clientX - rect.left) * 20), Math.round((e.clientY - rect.top) * 20));
    };
    canvas.tabIndex = 0;
    canvas.addEventListener('mousemove', input(moveTo));
    canvas.addEventListener('mouseleave', input((movie) => movie.mouseLeave()));
    canvas.addEventListener('mousedown', input((movie, e) => { moveTo(movie, e); movie.mouseDown(); }));
    window.addEventListener('mouseup', input((movie) => movie.mouseUp()));
    canvas.addEventListener('keydown', input((movie, e) => {
      if (!e.keyCode || e.metaKey) return;
      e.preventDefault();
      movie.keyDown(e.keyCode, e.key.length === 1 && e.key >= ' ' && e.key <= '~' ? e.key.charCodeAt(0) : e.key === 'Enter' ? 13 : 0);
    }));
    canvas.addEventListener('keyup', input((movie, e) => { if (e.keyCode) movie.keyUp(e.keyCode); }));
    addEventListener('pagehide', () => this.movie?.saveSharedObjects()); // 実機も、閉じるときに保存する
  }

  connectedCallback() { if (this.hasAttribute('src') && !this.movie) this.#fetch(); }
  disconnectedCallback() { this.stop(); }
  attributeChangedCallback(name, old, value) {
    if (!this.isConnected || old === value) return;
    if (name === 'src') this.#fetch();
    else if (this.#source) this.load(this.#source.bytes, { label: this.#source.label, base: this.#source.base });
  }

  async #fetch() {
    const src = this.getAttribute('src');
    if (!src) return;
    const url = new URL(src, location.href).href;
    const generation = ++this.#generation;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (generation === this.#generation) await this.load(bytes, { label: src, base: url });
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
    }
  }

  /** SWF のバイト列（または URL）を読んで、最初から再生する。base は、相対 URL の基準（URL から読んだときの、その SWF の URL）。 */
  async load(source, { label = '', base } = {}) {
    if (typeof source === 'string') { this.setAttribute('src', source); return; }
    this.stop();
    const generation = ++this.#generation;
    this.#source = { bytes: source, label, base };
    const trace = (text) => { this.dispatchEvent(new CustomEvent('trace', { detail: text })); };
    const http = this.hasAttribute('trust') && this.getAttribute('trust') !== '0' ? trustedHttp(base, trace) : null;
    // 信用しないときは、URL から読んだ SWF の NetStream.play のファイルだけ、同じサーバから渡す。
    const media = http ? http.media : base && (async (url) => {
      const target = new URL(url, base);
      if (target.origin !== location.origin) return null;
      const res = await fetch(target);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    });
    let movie;
    try {
      movie = await Movie.load(source, {
        trace, audio: audioOutput(), video, media, network: http?.network, storage: http ? trustedStorage(label || base || '') : undefined,
        onRequest: ({ kind, url }) => { if (!http) this.dispatchEvent(new CustomEvent('trace', { detail: `[${kind}] ${url}（信用していないので、開きも読みもしません）` })); },
        matchPlayer: this.hasAttribute('match-player'), rasterize: this.#renderer.rasterizer(),
        encoding: this.getAttribute('encoding') ?? defaultEncoding(), language: navigator.language.slice(0, 2),
      });
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
      return;
    }
    if (generation !== this.#generation) return; // 読み込み中に、別の SWF が指定された
    await this.#renderer.prepare(movie);
    this.movie = movie;
    this.#draw();
    this.dispatchEvent(new CustomEvent('loaded', { detail: { version: movie.version, frameRate: movie.frameRate } }));
    // フレームレートは、スクリプトが途中で変えることがあるので、毎回読む。0 は実質停止。
    const tick = () => {
      if (this.movie !== movie) return;
      movie.advance();
      this.#draw();
      if (movie.warnings.length) { for (const w of movie.warnings.splice(0)) this.dispatchEvent(new CustomEvent('warning', { detail: w })); }
      this.#timer = setTimeout(tick, movie.frameRate > 0 ? 1000 / movie.frameRate : 100);
    };
    this.#timer = setTimeout(tick, movie.frameRate > 0 ? 1000 / movie.frameRate : 100);
  }

  /** 再生を止めて、ムービーを捨てる（SharedObject は保存する）。 */
  stop() {
    clearTimeout(this.#timer);
    this.#generation++;
    this.movie?.saveSharedObjects();
    this.movie = null;
  }

  #draw() {
    const movie = this.movie;
    if (!movie) return;
    const scale = window.devicePixelRatio || 1;
    this.#renderer.render(movie, scale);
    this.#canvas.style.width = `${this.#canvas.width / scale}px`;
    this.#canvas.style.height = `${this.#canvas.height / scale}px`;
  }
}
customElements.define('flapp-player', FlappPlayer);

/** target（要素か、その中に <flapp-player> を作る入れ物）に SWF を埋め込む。<flapp-player> を返す。options: trust、encoding、matchPlayer。 */
export function embed(target, src, { trust = false, encoding, matchPlayer = false } = {}) {
  const el = target instanceof FlappPlayer ? target : document.createElement('flapp-player');
  if (trust) el.setAttribute('trust', '');
  if (encoding) el.setAttribute('encoding', encoding);
  if (matchPlayer) el.setAttribute('match-player', '');
  if (!(target instanceof FlappPlayer)) target.append(el);
  el.setAttribute('src', src);
  return el;
}
