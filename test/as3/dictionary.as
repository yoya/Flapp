// Dictionary: オブジェクトをキーにできる
var d:Dictionary = new Dictionary();
var k1:Object = {}; var k2:Sprite = new Sprite(); var k3:Array = [1]; var k4:Function = function():void {};
d[k1] = "one"; d[k2] = "two"; d[k3] = "three"; d[k4] = "four"; d[Sprite] = "class"; d["s"] = "str"; d[5] = "five"; d[1.5] = "x"; d[true] = "t"; d[null] = "n"; d[undefined] = "u";
trace(d[k1], d[k2], d[k3], d[k4], d[Sprite], d[{}], d[[1]], d[new Sprite()], d[MovieClip]);
trace(d.s, d["s"], d[5], d["5"], d[1.5], d["1.5"], d[true], d["true"], d[null], d["null"], d[undefined], d["undefined"], d[String(k1)], d[String(k3)], d["1"]);
d["5"] = "FIVE"; trace(d[5], d.hasOwnProperty("5"), d.hasOwnProperty("s"), d.hasOwnProperty("zz"));
trace(k1 in d, {} in d, "s" in d, 5 in d, "zz" in d, k2 in d, Sprite in d);
trace(delete d[k1], k1 in d, d[k1], delete d[k1], delete d["s"], d.s, delete d["zz"]);
var kinds:Array = []; var count:int = 0; for (var key:* in d) { kinds.push(typeof key); count++; } kinds.sort(); trace(count, kinds);
var values:Array = []; for each (var value:String in d) values.push(value); values.sort(); trace(values);
d[k2] = "TWO"; trace(d[k2]); for (key in d) if (key === k2) trace("found", d[key]);
trace(d is Dictionary, d is Object, getQualifiedClassName(d), d, new Dictionary(true)[k1]);
// ふつうのオブジェクトでは、キーは文字列になる
var o:Object = {}; o[k2] = 1; o[k3] = 2; o[k1] = 3; trace(o["[object Sprite]"], o["1"], o["[object Object]"], k2 in o, new Sprite() in o);
var a:Array = []; a[k3] = "x"; trace(a[1], a.length, a["1"]);
var e:Dictionary = new Dictionary(); e[k1] = e; e[e] = k1; trace(e[k1] === e, e[e] === k1, e[e[k1]] === k1);
var oo:Object = {}; oo[7] = 1; oo["8"] = 2; oo.x = 3; oo[-1] = 4; oo["07"] = 5; oo[268435455] = 6; oo[268435456] = 7; oo[4294967295] = 8;
var seen:Array = []; for (var name:* in oo) seen.push(typeof name + ":" + name); seen.sort(); trace(seen);
trace(delete oo.x, delete oo.x, delete oo[7], delete oo["nothing"], oo.x, delete k2.x, delete k2["name"], k2.name != null);
