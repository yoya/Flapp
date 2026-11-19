// 通信の送信内容。ホストの network.load に渡される要求（メソッド・URL・Content-Type・追加のヘッダ・本文）を、実機の受信側の記録と
// 照らして確かめた値で見る。見本は test/as/netlocal.as（SWF 7 と 8）と test/as3/netlocal.as。
//
// 実機との照合は、サンドボックス（ループバック以外へ通信できない）の中のデバッガ版と、127.0.0.1 の受信サーバで行った
// （道具は tmp/netlab にあるが、git の対象外）。AS3 の変数の並び順（URLVariables）は、実機でも実行のたびに
// 変わるので、ここの値は Flapp の並び順（代入順）。AS3 の送信は、実機のデバッガ版が URLLoader で落ちるので sendToURL で確かめている。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';

const BASE = 'http://127.0.0.1:18123/';
const show = (req) => {
  const body = req.data ? Buffer.from(req.data).toString('latin1') : '';
  const headers = req.headers ? ` ${JSON.stringify(req.headers)}` : '';
  return `${req.method} ${req.url.replace(BASE, '/')} ${req.contentType ?? '-'}${headers}${body ? ` ${JSON.stringify(body)}` : ''}`;
};
const run = async (name) => {
  const seen = [], traces = [];
  const network = { load: (req) => { seen.push(show(req)); return null; }, navigate: () => {} };
  const movie = await Movie.load(readFileSync(new URL(`fixtures/${name}.swf`, import.meta.url)), { encoding: 'shift_jis', trace: (s) => traces.push(s), network });
  for (let i = 0; i < 8; i++) movie.advance();
  return { seen, traces, movie };
};

// AS2（LoadVars・XML・loadVariables）。SWF 7 と 8 で同じ。
//   - LoadVars.sendAndLoad の GET は、URL に ? があっても、変数が空でも、必ず ? を付けて続ける（"c?pre=1?y=…"、"d3?"）。loadVariables の GET は、? があれば &。
//   - addRequestHeader は POST のときだけ送られる。同じ名前は後のものが勝つ。配列の形もある。Content-Type は contentType より優先。
//   - クリップやレベルの変数は、作った順に並べ、空白は + にして、関数は [type Function]、$version は送らない（LoadVars は逆順で、空白は %20）。
const AS2 = [
  "GET /vars.txt?q=1 -",
  "POST /b application/x-www-form-urlencoded \"z=3%2E5&y=%E6%97%A5%E6%9C%AC%20%E8%AA%9E%26%3D&x=1\"",
  "GET /c?pre=1?y=a%20b&x=1 -",
  "POST /d application/x-www-form-urlencoded {\"X-Flapp\":\"yes\"} \"v=w\"",
  "POST /e text/plain \"v=1&contentType=text%2Fplain\"",
  "POST /x application/x-www-form-urlencoded \"<r><i n=\\\"1\\\">t</i></r>\"",
  "POST /x2 text/xml {\"X-Two\":\"2\"} \"<a />\"",
  "POST /lv?k=1 application/x-www-form-urlencoded \"who=box&n=7&onData=%5Btype+Function%5D\"",
  "GET /lvn?base=http%3A%2F%2F127%2E0%2E0%2E1%3A18123%2F&show=%5Btype+Function%5D&a=onLoad%3D%255Btype%2520Function%255D&b=z%3D3%252E5%26y%3D%25E6%2597%25A5%25E6%259C%25AC%2520%25E8%25AA%259E%2526%253D%26x%3D1&br=onLoad%3D%255Btype%2520Function%255D&c=y%3Da%2520b%26x%3D1&cr=onLoad%3D%255Btype%2520Function%255D&d=v%3Dw&dr=onLoad%3D%255Btype%2520Function%255D&e=v%3D1%26contentType%3Dtext%252Fplain&er=onLoad%3D%255Btype%2520Function%255D&x=%3Cr%3E%3Ci+n%3D%221%22%3Et%3C%2Fi%3E%3C%2Fr%3E&xr=&x2=%3Ca+%2F%3E&x2r= -",
  "GET /c2?x=1 -",
  "GET /c3?a=1&b=2?x=1 -",
  "GET /c4?q=1? -",
  "POST /c5?q=1 application/x-www-form-urlencoded \"x=1\"",
  "GET /lvq?k=1&who=box&n=7&onData=%5Btype+Function%5D -",
  "POST /lvr application/x-www-form-urlencoded \"base=http%3A%2F%2F127%2E0%2E0%2E1%3A18123%2F&show=%5Btype+Function%5D&a=onLoad%3D%255Btype%2520Function%255D&b=z%3D3%252E5%26y%3D%25E6%2597%25A5%25E6%259C%25AC%2520%25E8%25AA%259E%2526%253D%26x%3D1&br=onLoad%3D%255Btype%2520Function%255D&c=y%3Da%2520b%26x%3D1&cr=onLoad%3D%255Btype%2520Function%255D&d=v%3Dw&dr=onLoad%3D%255Btype%2520Function%255D&e=v%3D1%26contentType%3Dtext%252Fplain&er=onLoad%3D%255Btype%2520Function%255D&x=%3Cr%3E%3Ci+n%3D%221%22%3Et%3C%2Fi%3E%3C%2Fr%3E&xr=&x2=%3Ca+%2F%3E&x2r=&c2=x%3D1&c2r=onLoad%3D%255Btype%2520Function%255D&c3=x%3D1&c3r=onLoad%3D%255Btype%2520Function%255D&c4=&c4r=onLoad%3D%255Btype%2520Function%255D&c5=x%3D1&c5r=onLoad%3D%255Btype%2520Function%255D&box2=two+words&box2n=null&box2u=undefined&box2o=%5Bobject+Object%5D&box2b=true&box2f=1%2E5&box2neg=%2D3\"",
  "POST /x3?z=1 application/x-www-form-urlencoded \"<a />\"",
  "POST /x4 application/x-www-form-urlencoded {\"X-A\":\"1\",\"X-B\":\"2\"} \"<a />\"",
  "POST /x5 application/x-www-form-urlencoded {\"X-C\":\"4\"} \"<a />\"",
  "POST /d2 application/x-www-form-urlencoded; charset=x {\"Accept\":\"text/plain\"} \"k=v\"",
  "GET /d3? -",
  "GET /d4 -",
];
for (const name of ['asx-netlocal', 'asx-netlocal8']) {
  test(`${name}: AS2 の通信は、実機と同じ内容をホストに渡す`, async () => {
    const { seen, movie } = await run(name);
    assert.deepEqual(seen, AS2);
    assert.deepEqual(movie.warnings, []);
  });
}

// AS3（sendToURL）。
//   - GET の data は、URL に ? があれば区切りなしでそのまま続ける（"u1?pre=1a=1&…"）。
//   - 本文の無い POST は、GET で送る（空の URLVariables でも。この場合は Content-Type が付く）。
//   - requestHeaders の Content-Type は contentType より優先。sendToURL は、単純なヘッダ以外（application/octet-stream や application/json の
//     Content-Type、X-Flapp など）に SecurityError #3769。
//   - 空白・非 ASCII などを含む URL は、全体を作り直す（非 ASCII はシステムの文字コード（ここでは Shift-JIS）のバイトにして、表せない文字は ?。% は %25）。
const AS3 = [
  "GET /u1?pre=1a=1&b=x%20y%26z%3D%25&c=%E6%97%A5%E6%9C%AC -",
  "POST /u2 application/x-www-form-urlencoded \"a=1&b=x%20y%26z%3D%25&c=%E6%97%A5%E6%9C%AC\"",
  "POST /u3 text/plain \"plain text body\"",
  "GET /u6?p=1&q=2 -",
  "POST /u7?pre=1 application/x-www-form-urlencoded \"a=1&b=x%20y%26z%3D%25&c=%E6%97%A5%E6%9C%AC\"",
  "GET /u8 -",
  "GET /u9 application/x-www-form-urlencoded",
  "POST /u10 application/x-www-form-urlencoded \"zeta=1&alpha=2&mid=3&beta=4&n1=5&flag=true&nothing=null\"",
  "GET /u11?zeta=1&alpha=2&mid=3&beta=4&n1=5&flag=true&nothing=null -",
  "POST /u12 application/x-www-form-urlencoded; charset=UTF-8 \"raw=1&x=%41\"",
  "POST /u14 application/x-www-form-urlencoded \"\\u0000\\u0001ÿab\"",
  "POST /u15 application/x-www-form-urlencoded \"æ¥æ¬èª\"",
  "POST /u16 text/plain \"k=v\"",
  "POST /u17 application/x-www-form-urlencoded {\"Accept\":\"text/html\"} \"k=v\"",
  "GET /u18 -",
  "GET /u19?q=1#fragx=1 -",
  "GET /u%2020/? -",
  "GET /q1/p%20? -",
  "GET /q2?k=?&l=%2593%25FA%2596%7B -",
  "GET /q3/%2593%25FA%2596%7B/x -",
  "GET /q4?a%2520b=c%252Fd&e%20f=g%20h -",
  "GET /q5?k=? -",
  "POST /q6 application/x-www-form-urlencoded \"k=Ã©\"",
];
test('as3x-netlocal: AS3 の sendToURL は、実機と同じ内容をホストに渡す', async () => {
  const { seen, traces, movie } = await run('as3x-netlocal');
  assert.deepEqual(seen, AS3);
  assert.deepEqual(traces, ["g1 ok","g2 ok","g3 ok","g4 SecurityError 3769","g5 SecurityError 3769","g6 ok","g7 ok","g8 ok","g9 ok","g10 ok","g11 ok","g12 ok","g13 SecurityError 3769","g14 ok","g15 ok","g16 ok","g17 ok","g18 ok","g19 ok","g20 ok","g21 ok","g22 ok","g23 ok","g24 ok","g25 ok","g26 ok","defaults GET null len0 null null","sent"]);
  assert.deepEqual(movie.warnings, []);
});
