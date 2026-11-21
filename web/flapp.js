// Flapp — SWF を JavaScript で再生する Flash Player（web 側の埋め込み部品）
// Copyright (c) 2026 Yoshihiro Yamazaki
// Version 1.1.0
//
// SWF をページに埋め込む部品（<flapp-player> 要素と embed 関数）と、ホスト側の取り決め（信用する SWF の通信と保存）。
//
//   <script type="module" src="flapp/web/flapp.js"></script>
//   <flapp-player src="movie.swf"></flapp-player>
//
// 属性: src（SWF の URL）、trust（付けると、信用する SWF として動かす。付けなければ、通信もページの移動もしない）、
//       allow-networking / allow-origins / credentials / allow-navigation（信用するときの通信の決まり。trustedHttp の policy）、
//       encoding（SWF 5 以前の文字コード。既定はブラウザの言語から）、match-player（実機と同じに映さないものを映さない）。
// プロパティ: movie（再生中の Movie）、メソッド: load(url か bytes, { label })、stop()。
// イベント: trace（detail に文字列）、warning、error、loaded。画面の大きさは SWF のステージの大きさ（CSS で変えられる）。
// 入力は、マウスかタッチ（タップはクリック、なぞるとドラッグ）と、キー（要素をクリックして選んでいる間）。音は、ページを最初にクリックするかキーを押した後から鳴る。
// ステージが画面より広ければ、縦横の比のまま、幅に収まるように縮めて表示する（スマートフォン）。
import { Movie } from '../src/player/movie.js';
import { CanvasRenderer, decodeImage } from '../src/render/canvas.js';
import { WebAudioOutput } from '../src/audio/webaudio.js';
import { WebCodecsVideo } from '../src/video/webcodecs.js';

const STORAGE_LIMIT = 100 * 1024; // SWF ごとの保存の総量（文字数。実機の、サイトごとの既定の保存量）

/**
 * SWF を信用するときの、SharedObject の保存先（Movie.load の storage オプション）。localStorage に、SWF ごと（?swf= で読んだときは
 * その URL、ファイルを選んだときはそのファイル名）に分けて書く。総量が上限を超える、または書けなければ（容量など）false
 * （スクリプトには、保存できなかったと伝わる）。
 */
export function trustedStorage(id, limit = STORAGE_LIMIT) {
  const prefix = `flapp:so:${id}:`;
  const key = (name) => prefix + name;
  const used = (except) => {
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix) && k !== except) total += localStorage.getItem(k)?.length ?? 0;
      }
    } catch { /* 読めない */ }
    return total;
  };
  return {
    load(name) { try { return localStorage.getItem(key(name)); } catch { return null; } },
    save(name, text) {
      try {
        if (text === null) localStorage.removeItem(key(name));
        else if (used(key(name)) + text.length > limit) return false;
        else localStorage.setItem(key(name), text);
        return true;
      } catch { return false; }
    },
  };
}

// 実機が、スクリプトから足すことを許さないヘッダ（URLRequestHeader の説明にある一覧。小文字）。送る前に取り除く。
const BLOCKED_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'accept-ranges', 'age', 'allow', 'allowed', 'authorization', 'charge-to', 'connect', 'connection',
  'content-length', 'content-location', 'content-range', 'cookie', 'date', 'delete', 'etag', 'expect', 'get', 'head', 'host', 'if-modified-since',
  'keep-alive', 'last-modified', 'location', 'max-forwards', 'options', 'origin', 'post', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'public', 'put', 'range', 'referer', 'request-range', 'retry-after', 'server', 'te', 'trace', 'trailer',
  'transfer-encoding', 'upgrade', 'uri', 'user-agent', 'vary', 'via', 'warning', 'www-authenticate', 'x-flash-version',
]);
const GESTURE_WINDOW = 1000; // 利用者の操作（クリック・キー）の後、ページの移動を許す時間（ms）

/**
 * SWF を信用するときの、移動と読み込み（Movie.load の network オプション）と、NetStream.play のファイル（media オプション）。
 * 相対 URL は、?swf= で読んだときはその SWF の URL から、ファイルを選んだときはこのページの URL から解決する。
 * http / https 以外（javascript: や file: など）は、開きも読みもしない。
 * policy（埋め込むページが SWF に許すこと）:
 *   networking: 'all'（既定）| 'internal'（読み込みだけ。ページの移動はしない）| 'none'（どちらもしない）。実機の allowNetworking と同じ段階
 *   origins: 通信してよいオリジンの並び（'https://a.example' など）。null（既定）なら、どこでもよい
 *   credentials: fetch の credentials（'same-origin' が既定。'omit' にすると、クッキーなどを送らない）
 *   navigation: 'gesture'（既定。このページそのものの移動は、利用者の操作の直後だけ）| 'always'
 *   lastInput: () => 最後の利用者の操作の時刻（performance.now()）
 *   redirect: null（既定）か、localhost（localhost・127.0.0.1・[::1]）の http の起点（'http://127.0.0.1:18124'）。
 *             あると、読み込み・メディア・移動の宛先を、起点の /x/<元のホスト>/<パス>?<クエリ> に切り替える（試験用。
 *             受信サーバで、SWF が何を送ったかを見る）。移動はページを動かさず、同じメソッドと中身を送るだけ。
 *             切り替え先が localhost でなければ、通信はすべて止める。
 */
// 起点が localhost（localhost・127.0.0.1・[::1]）の http なら、その origin。そうでなければ null。
export function loopbackOrigin(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

export function trustedHttp(base, trace, { networking = 'all', origins = null, credentials = 'same-origin', navigation = 'gesture', lastInput = () => -Infinity, redirect = null } = {}) {
  const local = redirect === null || redirect === undefined ? null : loopbackOrigin(redirect);
  const refused = redirect !== null && redirect !== undefined && local === null; // 切り替え先が localhost でないときは、何もしない
  const allowed = (url) => !origins || origins.includes(url.origin);
  const resolve = (url) => {
    try {
      const target = new URL(url, new URL(base ?? location.href, location.href));
      if (target.protocol !== 'http:' && target.protocol !== 'https:') trace(`[blocked] ${url}（http / https 以外は、開きも読みもしません）`);
      else if (!allowed(target)) trace(`[blocked] ${target.href}（許されたオリジンではありません）`);
      else if (refused) trace(`[blocked] ${target.href}（切り替え先が localhost ではありません）`);
      else if (local) return new URL(`/x/${target.host}${target.pathname}${target.search}`, local);
      else return target;
    } catch {
      trace(`[blocked] ${url}（解釈できない URL です）`);
    }
    return null;
  };
  const headersOf = (data, contentType, headers) => {
    const out = data && contentType ? { 'Content-Type': contentType } : {};
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (BLOCKED_HEADERS.has(name.toLowerCase()) || /^(sec-|proxy-)/i.test(name)) trace(`[blocked] header ${name}`);
      else out[name] = value;
    }
    return out;
  };
  const network = {
    // 移動: target が空か _self / _parent / _top ならこのページを、それ以外の名前なら新しいタブ（そのウィンドウ名）を開く。
    // POST で送る中身があれば、フォームを作って送る。GET なら、中身を URL の後ろに付ける。
    navigate({ url, target, method, data }) {
      if (networking !== 'all') { trace(`[blocked] ${url}（ページの移動は許されていません）`); return; }
      const to = resolve(url);
      if (!to) return;
      if (local) {
        // 切り替えたときは、ページを動かさず、同じメソッドと中身を切り替え先へ送る（応答は読まない）。
        const post = method === 'POST';
        const init = post ? { method: 'POST', body: new URLSearchParams(data ?? '').toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, mode: 'no-cors' } : { mode: 'no-cors' };
        if (!post && data) for (const [name, value] of new URLSearchParams(data)) to.searchParams.append(name, value);
        fetch(to, init).catch((e) => trace(`[navigate] ${to.href}: ${e.message}`));
        return;
      }
      const where = !target || /^_(self|parent|top)$/i.test(target) ? '_self' : target;
      if (where === '_self' && navigation !== 'always' && performance.now() - lastInput() > GESTURE_WINDOW) {
        trace(`[blocked] ${to.href}（このページの移動は、クリックやキーの直後だけです）`);
        return;
      }
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
      if (networking === 'none') return null;
      const from = resolve(url);
      if (!from) return null;
      try {
        const res = await fetch(from, { method, body: data ?? undefined, headers: headersOf(data, contentType, headers), credentials });
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
    if (networking === 'none') return null;
    const from = resolve(url);
    if (!from) return null;
    try {
      const res = await fetch(from, { credentials });
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
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) { // iOS は、指を離したときの操作でないと有効にできないことがある
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

/**
 * keydown をムービーへ伝える。キーは仮想キーコード（Key.getCode() の値）と文字コード（Key.getAscii() の値）で渡し、打ち込まれた文字
 * （1 文字のキー）は、フォーカスのある入力フィールドへ入れる（textInput）。コピー・切り取り・貼り付け（Ctrl / ⌘ + C・X・V）は、ブラウザの
 * イベント（attachInput）に任せる。⌘ + A 以外の ⌘ のキーはブラウザへ返す。Tab は、入力フィールドにフォーカスがあるときだけ、ブラウザの
 * 移動に使わせない。IME の変換中の入力は、attachInput が受ける。
 */
export function sendKey(movie, e) {
  if (!e.keyCode || e.isComposing || e.keyCode === 229 || (e.metaKey && e.key !== 'a')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && 'cxv'.includes(e.key.toLowerCase())) return;
  movie.keyDown(e.keyCode, e.key.length === 1 && e.key >= ' ' && e.key <= '~' ? e.key.charCodeAt(0) : e.key === 'Enter' ? 13 : 0, { shift: e.shiftKey, ctrl, alt: e.altKey });
  if (e.key.length === 1 && !ctrl) movie.textInput(e.key);
  if (e.keyCode !== 9 || movie.focus) e.preventDefault();
}

/**
 * canvas のキーボード入力（キー、IME、コピー・切り取り・貼り付け）とマウスホイールを、ムービーへつなぐ。
 * キーは、canvas の横に置く見えない textarea が受ける（IME の変換は、textarea でないと受けられない）。canvas にフォーカスが来たら、
 * textarea へ移す。getMovie は今のムービー（無ければ null）、after は入力のあとに呼ぶ（描き直しなど）。
 */
export function attachInput(canvas, getMovie, after = () => {}) {
  const area = document.createElement('textarea');
  area.setAttribute('aria-hidden', 'true');
  area.autocapitalize = 'off';
  area.spellcheck = false;
  area.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;resize:none;overflow:hidden;font-size:16px;pointer-events:none';
  canvas.after(area);
  const act = (handle) => (e) => { const movie = getMovie(); if (movie) { handle(movie, e); after(movie); } };
  const place = () => { area.style.left = `${canvas.offsetLeft}px`; area.style.top = `${canvas.offsetTop}px`; };
  // タッチでは、入力フィールドを選んだときだけ textarea へ移す（タップのたびに、画面のキーボードが出ないように）。
  // ほかの所を触ったら、textarea から外して、キーボードを閉じる。マウスやペンでは、いつも移す。
  let touch = false; // 最後に押したのがタッチか
  canvas.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch'; }, { capture: true });
  const focus = () => {
    if (touch && getMovie()?.focus?.type !== 'input') { area.blur(); return; }
    place();
    area.focus({ preventScroll: true });
  };
  canvas.addEventListener('focus', focus);
  canvas.addEventListener('click', focus); // タップの中で、同期して移す（iOS は、利用者の操作の中で移さないとキーボードが出ない）
  area.addEventListener('keydown', act(sendKey));
  canvas.addEventListener('keydown', act(sendKey)); // textarea へ移していないとき（タッチの後の、外付けのキーボード）
  canvas.addEventListener('keyup', act((movie, e) => { if (e.keyCode) movie.keyUp(e.keyCode); }));
  // 画面のキーボード（Android）は、keydown が keyCode 229 で来て、中身は beforeinput で届く。keydown で扱えたキーは、
  // そこで既定の動作を止めているので、ここには来ない。textarea は空のままにする（既定の動作を止める）。
  area.addEventListener('beforeinput', (e) => {
    const movie = getMovie();
    if (!movie || e.isComposing || /Composition/.test(e.inputType ?? '')) return; // 変換中は、composition のイベントで受ける
    if (e.inputType === 'insertText' && e.data) movie.textInput(e.data);
    else if (e.inputType === 'deleteContentBackward') { movie.keyDown(8, 0, {}); movie.keyUp(8); }
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { movie.keyDown(13, 13, {}); movie.keyUp(13); }
    else return;
    e.preventDefault();
    after(movie);
  });
  area.addEventListener('keyup', act((movie, e) => { if (e.keyCode) movie.keyUp(e.keyCode); }));
  area.addEventListener('compositionupdate', act((movie, e) => movie.compose(e.data)));
  area.addEventListener('compositionend', act((movie, e) => { movie.textInput(e.data ?? ''); area.value = ''; }));
  area.addEventListener('copy', act((movie, e) => { const text = movie.copySelection(); if (text !== null) { e.clipboardData.setData('text/plain', text); e.preventDefault(); } }));
  area.addEventListener('cut', act((movie, e) => { const text = movie.cutSelection(); if (text !== null) { e.clipboardData.setData('text/plain', text); e.preventDefault(); } }));
  area.addEventListener('paste', act((movie, e) => { movie.paste(e.clipboardData.getData('text/plain')); e.preventDefault(); }));
  // ホイールは、1 目盛りを 3 行として、ポインタの下のフィールドを動かす（動かせなければ、ページのスクロールに任せる）。
  canvas.addEventListener('wheel', act((movie, e) => { if (movie.mouseWheel(Math.sign(e.deltaY) * 3)) e.preventDefault(); }), { passive: false });
  return area;
}

export class FlappPlayer extends HTMLElement {
  static observedAttributes = ['src', 'trust', 'encoding', 'match-player', 'allow-networking', 'allow-origins', 'credentials', 'allow-navigation', 'redirect-to'];
  #canvas = document.createElement('canvas');
  #renderer = new CanvasRenderer(this.#canvas);
  #timer = 0;
  #generation = 0; // load のたびに増やし、古い読み込みの続きを捨てる
  #source = null; // { bytes, label, base }（属性を変えたときに読み直す）
  #lastInput = -Infinity; // 最後の利用者の操作（クリック・キー）の時刻
  #visible = true; // 画面の中に見えているか（見えていなければ、1 秒に 2 回だけ進める）
  movie = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host { display: inline-block; line-height: 0; position: relative; max-width: 100%; } canvas { display: block; outline: none; max-width: 100%; height: auto; touch-action: none; }</style>';
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
      const k = (movie.frameSize.xmax - movie.frameSize.xmin) / canvas.clientWidth; // 表示が縮んでいても、ステージの座標に合わせる（twips。枠線は除く）
      movie.mouseMove(Math.round((e.clientX - rect.left - canvas.clientLeft) * k), Math.round((e.clientY - rect.top - canvas.clientTop) * k));
    };
    canvas.tabIndex = 0;
    for (const type of ['pointerdown', 'keydown']) this.addEventListener(type, () => { this.#lastInput = performance.now(); }, { capture: true });
    // 画面の外にあるときは遅くする（実機のプラグインと同じく 1 秒に 2 回）。ページが隠れているときは、ブラウザがタイマーを止める。
    if (typeof IntersectionObserver === 'function') new IntersectionObserver((entries) => { this.#visible = entries.at(-1).isIntersecting; }).observe(this);
    // ポインタ（マウス・タッチ・ペン）の入力。指を離しても、押したままの間は動きを伝え続ける（ポインタを捕まえる）。
    canvas.addEventListener('pointermove', input((movie, e) => { if (e.isPrimary) moveTo(movie, e); }));
    canvas.addEventListener('pointerleave', input((movie, e) => { if (e.isPrimary) movie.mouseLeave(); }));
    canvas.addEventListener('pointerdown', input((movie, e) => {
      if (!e.isPrimary) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 捕まえられないポインタ（合成のイベントなど）は、捕まえずに続ける */ }
      moveTo(movie, e);
      movie.mouseDown();
    }));
    const release = input((movie, e) => { if (e.isPrimary) movie.mouseUp(); });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    attachInput(canvas, () => this.movie, () => { canvas.style.cursor = this.movie.avm && !this.movie.avm.mouseVisible ? 'none' : this.movie.hoverButton ? 'pointer' : ''; this.#draw(); });
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
    // 信用するときの通信の決まり（属性）。allow-networking: all | internal | none、allow-origins: 許すオリジンを空白で区切って並べる
    // （* か省略なら、どこでも）、credentials: same-origin | omit | include、allow-navigation: gesture | always。
    const word = (name, values, otherwise) => (values.includes(this.getAttribute(name)) ? this.getAttribute(name) : otherwise);
    const origins = (this.getAttribute('allow-origins') ?? '*').trim();
    const http = this.hasAttribute('trust') && this.getAttribute('trust') !== '0' ? trustedHttp(base, trace, {
      networking: word('allow-networking', ['all', 'internal', 'none'], 'all'),
      origins: origins === '*' || origins === '' ? null : origins.split(/\s+/).map((o) => { try { return new URL(o).origin; } catch { return o; } }),
      credentials: word('credentials', ['same-origin', 'omit', 'include'], 'same-origin'),
      navigation: word('allow-navigation', ['gesture', 'always'], 'gesture'),
      lastInput: () => this.#lastInput,
      redirect: this.getAttribute('redirect-to'), // 試験用: 宛先を localhost に切り替える（trustedHttp の redirect）
    }) : null;
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
        matchPlayer: this.hasAttribute('match-player'), rasterize: this.#renderer.rasterizer(), decodeImage,
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
      this.#timer = setTimeout(tick, this.#visible ? (movie.frameRate > 0 ? 1000 / movie.frameRate : 100) : 500);
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
    this.#canvas.style.width = `${this.#canvas.width / scale}px`; // 高さは CSS（height: auto）が、縦横の比で決める
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
