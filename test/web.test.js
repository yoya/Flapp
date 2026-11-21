// 埋め込み（web/flapp.js）の、信用する SWF の通信と保存の決まり。ブラウザの代わりに、必要なものだけを用意して確かめる。
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { define() {} };
const { trustedHttp, trustedStorage } = await import('../web/flapp.js');

const setup = () => {
  const log = { fetched: [], assigned: [], opened: [], traces: [] };
  globalThis.location = { href: 'https://page.example/index.html', assign: (u) => log.assigned.push(u) };
  globalThis.window = { open: (u, w) => log.opened.push([u, w]) };
  globalThis.fetch = async (url, init) => { log.fetched.push({ url: String(url), init }); return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) }; };
  return log;
};

test('読み込み: 許されたオリジンだけ、実機が許さないヘッダを除き、credentials を渡す', async () => {
  const log = setup();
  const { network } = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { origins: ['https://swf.example'], credentials: 'omit' });
  assert.ok(await network.load({ url: 'data.txt', method: 'GET', data: null, contentType: null, headers: { 'X-Custom': '1', Cookie: 'a=1', Referer: 'x', 'Sec-Fetch-Mode': 'cors' } }));
  assert.equal(log.fetched[0].url, 'https://swf.example/data.txt');
  assert.deepEqual(log.fetched[0].init.headers, { 'X-Custom': '1' });
  assert.equal(log.fetched[0].init.credentials, 'omit');
  assert.equal(await network.load({ url: 'https://other.example/x', method: 'GET' }), null);
  assert.equal(await network.load({ url: 'javascript:alert(1)', method: 'GET' }), null);
  assert.equal(log.fetched.length, 1);
});

test('allow-networking: internal は読み込みだけ、none はどちらもしない', async () => {
  const log = setup();
  const internal = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { networking: 'internal', navigation: 'always' });
  internal.network.navigate({ url: 'https://swf.example/next', target: '', method: '' });
  assert.deepEqual(log.assigned, []);
  assert.ok(await internal.network.load({ url: 'x', method: 'GET' }));
  const none = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { networking: 'none' });
  assert.equal(await none.network.load({ url: 'x', method: 'GET' }), null);
  assert.equal(await none.media('v.flv'), null);
});

test('このページの移動は、利用者の操作の直後だけ（新しいタブは、ブラウザの決まりに任せる）', () => {
  const log = setup();
  let last = -Infinity;
  const { network } = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { lastInput: () => last });
  network.navigate({ url: 'https://swf.example/next', target: '_self', method: '' });
  assert.deepEqual(log.assigned, []);
  last = performance.now();
  network.navigate({ url: 'https://swf.example/next', target: '_top', method: '' });
  assert.deepEqual(log.assigned, ['https://swf.example/next']);
  network.navigate({ url: 'https://swf.example/w', target: 'win', method: '' });
  assert.deepEqual(log.opened, [['https://swf.example/w', 'win']]);
});

test('保存: SWF ごとの総量の上限（100KB）を超えると、保存できない', () => {
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
  };
  const s = trustedStorage('movie', 100);
  assert.equal(s.save('a', 'x'.repeat(60)), true);
  assert.equal(s.save('b', 'x'.repeat(50)), false); // 60 + 50 > 100
  assert.equal(s.save('a', 'x'.repeat(90)), true); // 同じ名前の書き直しは、前の分を数えない
  assert.equal(s.load('a').length, 90);
  assert.equal(trustedStorage('other', 100).save('b', 'x'.repeat(50)), true); // ほかの SWF とは別
});

test('redirect: 読み込みの宛先を localhost の /x/<元のホスト>/<パス> に切り替える。元の宛先への許可は、切り替えの前に従う', async () => {
  const log = setup();
  const { network } = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { origins: ['https://swf.example'], redirect: 'http://127.0.0.1:18124' });
  assert.ok(await network.load({ url: 'data.txt?k=1', method: 'GET' }));
  assert.equal(log.fetched[0].url, 'http://127.0.0.1:18124/x/swf.example/data.txt?k=1');
  assert.equal(await network.load({ url: 'https://other.example/x', method: 'GET' }), null); // 許されない元の宛先は、切り替えても送らない
  assert.equal(log.fetched.length, 1);
});

test('redirect: 切り替え先が localhost でなければ、何も送らない', async () => {
  for (const bad of ['https://evil.example', 'http://192.168.0.5:18124', 'not a url']) {
    const log = setup();
    const { network, media } = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { redirect: bad });
    assert.equal(await network.load({ url: 'data.txt', method: 'GET' }), null, bad);
    assert.equal(await media('movie.flv'), null, bad);
    assert.equal(log.fetched.length, 0, bad);
  }
});

test('redirect: 移動は、ページを動かさず、同じメソッドと中身を切り替え先へ送る', async () => {
  const log = setup();
  const { network } = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { redirect: 'http://localhost:18124' });
  network.navigate({ url: 'https://example.com/form', target: '_blank', method: 'POST', data: 'score=12&user=yo%20ya' });
  network.navigate({ url: 'http://example.com/page', target: '_self', method: 'GET', data: 'form=a%20b&count=3' });
  assert.deepEqual(log.assigned, []); // ページは動かない
  assert.deepEqual(log.opened, []); // 新しいタブも開かない
  assert.equal(log.fetched[0].url, 'http://localhost:18124/x/example.com/form');
  assert.equal(log.fetched[0].init.method, 'POST');
  assert.equal(log.fetched[0].init.body, 'score=12&user=yo+ya'); // フォームと同じ符号化（URLSearchParams）
  assert.equal(log.fetched[0].init.mode, 'no-cors');
  assert.equal(log.fetched[1].url, 'http://localhost:18124/x/example.com/page?form=a+b&count=3');
  assert.equal(log.fetched[1].init.method, undefined);
});

test('redirect: networking が none なら、切り替えても何も送らない', async () => {
  const log = setup();
  const { network } = trustedHttp('https://swf.example/a.swf', (s) => log.traces.push(s), { networking: 'none', redirect: 'http://127.0.0.1:18124' });
  network.navigate({ url: 'https://example.com/form', target: '_blank', method: 'GET', data: '' });
  assert.equal(await network.load({ url: 'data.txt' }), null);
  assert.equal(log.fetched.length, 0);
});

// --- 入力（attachInput）。ブラウザの要素の代わりに、イベントを受けるだけの物を使う ---
const { attachInput } = await import('../web/flapp.js');
const inputSetup = () => {
  const log = [];
  const element = () => Object.assign(new EventTarget(), {
    style: {}, setAttribute() {}, after() {}, offsetLeft: 0, offsetTop: 0,
    focus() { log.push('focus'); }, blur() { log.push('blur'); },
  });
  globalThis.document = { createElement: element };
  const movie = {
    focus: null,
    textInput: (t) => log.push(`text ${t}`), keyDown: (code, ascii) => log.push(`down ${code} ${ascii}`), keyUp: (code) => log.push(`up ${code}`),
  };
  const canvas = element();
  const area = attachInput(canvas, () => movie);
  const fire = (target, type, props = {}) => { const e = Object.assign(new Event(type, { cancelable: true }), props); target.dispatchEvent(e); return e; };
  return { log, movie, canvas, area, fire };
};

test('タッチ: 入力フィールドを選んだときだけ、キーボードを出す（textarea へ移す）。マウスでは、いつも移す', () => {
  const { log, movie, canvas, fire } = inputSetup();
  fire(canvas, 'pointerdown', { pointerType: 'touch' });
  fire(canvas, 'click');
  assert.deepEqual(log, ['blur']); // 入力フィールドでない所のタップ: キーボードを出さない
  log.length = 0;
  movie.focus = { type: 'input' };
  fire(canvas, 'pointerdown', { pointerType: 'touch' });
  fire(canvas, 'click');
  assert.deepEqual(log, ['focus']);
  log.length = 0;
  movie.focus = { type: 'dynamic' }; // 選べるだけのテキスト
  fire(canvas, 'pointerdown', { pointerType: 'touch' });
  fire(canvas, 'click');
  assert.deepEqual(log, ['blur']);
  log.length = 0;
  movie.focus = null;
  fire(canvas, 'pointerdown', { pointerType: 'mouse' });
  fire(canvas, 'click');
  assert.deepEqual(log, ['focus']);
});

test('画面のキーボード: beforeinput の文字・削除・改行を、ムービーへ伝える。変換中のものは伝えない', () => {
  const { log, area, fire } = inputSetup();
  assert.equal(fire(area, 'beforeinput', { inputType: 'insertText', data: 'あ' }).defaultPrevented, true);
  fire(area, 'beforeinput', { inputType: 'deleteContentBackward' });
  fire(area, 'beforeinput', { inputType: 'insertLineBreak' });
  assert.deepEqual(log, ['text あ', 'down 8 0', 'up 8', 'down 13 13', 'up 13']);
  log.length = 0;
  assert.equal(fire(area, 'beforeinput', { inputType: 'insertCompositionText', data: 'か', isComposing: true }).defaultPrevented, false);
  assert.equal(fire(area, 'beforeinput', { inputType: 'insertFromPaste', data: 'x' }).defaultPrevented, false); // 貼り付けは paste のイベントで受ける
  assert.deepEqual(log, []);
});
