// swf: 6
// SWF 6 の挙動: 大文字小文字を区別しない、undefined が空文字や 0 になる
trace("-- undefined / null");
var u;
trace("[" + undefined + "] [" + null + "] [" + u + "]");
trace((u + 1) + " " + (null + 1) + " " + (u * 2));
trace(Number(undefined) + " " + Number(null) + " " + Number("") + " " + Number("abc") + " " + Number("010") + " " + Number("0x10"));
trace("[" + String(undefined) + "] " + (u == null) + " " + (u == 0) + " " + ("" == 0) + " " + (u == ""));
trace(undefined);
trace("-- case insensitive");
var MyVar = 5;
trace(myvar + " " + MYVAR + " " + this.myVAR);
function Foo() { return "foo"; }
trace(foo() + " " + FOO());
var o = {Key: 1};
trace(o.key + " " + o.KEY + " " + o["kEy"]);
o.KEY = 2;
var out = "";
for (var k in o) out += k + " ";
trace(out + o.Key);
trace((math.PI == Math.PI) + " " + typeof MATH + " " + typeof Math.FLOOR);
trace(_currentframe + " " + _CURRENTFRAME + " " + this._X + " " + _Root + " " + typeof THIS);
trace("-- boolean of strings");
trace(Boolean("a") + " " + Boolean("1") + " " + Boolean("0") + " " + Boolean("") + " " + Boolean("true") + " " + Boolean(" 2") + " " + Boolean("0x1"));
if ("hello") trace("truthy"); else trace("falsy");
if ("3") trace("truthy"); else trace("falsy");
trace("-- arrays and strings");
var a = [1, undefined, null, 3];
trace(a + " | " + a.join("-") + " | " + new Array(2));
trace("abc" + u + "def" + " " + ("" + u).length + " " + (u + "").length);
trace((1 < u) + " " + (u < 1) + " " + (u == u) + " " + (NaN == NaN) + " " + typeof (1 < u));
