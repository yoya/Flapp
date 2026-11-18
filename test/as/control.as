// 制御構文
trace("-- if / loops");
var out = "";
var i = 0;
for (; i < 5; i++) {
  if (i == 1) continue;
  if (i == 4) break;
  out += i;
}
trace(out + " i=" + i);
var n = 0;
while (n < 3) n++;
do { n += 10; } while (n < 5);
trace(n);
out = "";
var a = 0;
var b;
for (; a < 3; a++) {
  b = 0;
  for (; b < 3; b++) { if (b == a) break; out += a + "" + b + " "; }
}
trace(out);
trace("-- switch");
function sw(v) {
  switch (v) {
    case 1: return "one";
    case "1": return "string one";
    case 2:
    case 3: return "two or three";
    default: return "other";
  }
}
trace(sw(1) + " / " + sw("1") + " / " + sw(3) + " / " + sw(null));
var fall = "";
switch (2) { case 1: fall += "a"; case 2: fall += "b"; case 3: fall += "c"; break; case 4: fall += "d"; }
trace(fall);
trace("-- for in");
var o = {};
o.first = 1; o.second = 2; o.third = 3;
out = "";
for (var k in o) out += k + " ";
trace(out);
o.second = 20; delete o.first; o.first = 10; o.fourth = 4;
out = "";
for (var k2 in o) out += k2 + "=" + o[k2] + " ";
trace(out);
out = "";
var arr = [10, 20, 30];
arr.extra = "x";
for (var idx in arr) out += idx + " ";
trace(out);
out = "";
for (var s in "abc") out += s;
trace("[" + out + "]");
for (var u in undefined) trace("never");
trace("-- with");
var pt = {x: 1, y: 2};
with (pt) { x = 10; var sum = x + y; }
trace(pt.x + " " + sum);
trace("-- try / catch / finally");
function risky(v) {
  try {
    if (v == 1) throw "str";
    if (v == 2) throw {code: 42};
    if (v == 3) throw new Error("boom");
    return "ok";
  } catch (e) {
    return "caught " + (typeof e) + " " + (e.code == undefined ? e : e.code);
  } finally {
    trace("finally " + v);
  }
}
trace(risky(0));
trace(risky(1));
trace(risky(2));
try {
  try { throw 1; } finally { trace("inner finally"); }
} catch (e2) { trace("outer caught " + e2); }
function rethrow() { try { throw "a"; } catch (e) { throw e + "b"; } }
try { rethrow(); } catch (e3) { trace(e3); }
var err = new Error("msg");
trace(err.message + " | " + err + " | " + (err instanceof Error));
trace("-- labels of truthiness");
var vals = [0, 1, "", "0", "a", null, undefined, NaN, [], {}];
out = "";
var j = 0;
for (; j < vals.length; j++) out += (vals[j] ? "T" : "F");
trace(out);
