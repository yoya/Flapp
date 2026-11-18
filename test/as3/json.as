// JSON
trace(JSON.stringify(1), JSON.stringify("a\"b\\c\n\t\u0001\u001fé/ "), JSON.stringify(true), JSON.stringify(null), JSON.stringify(undefined), JSON.stringify(NaN), JSON.stringify(Infinity), JSON.stringify(1.5e300), JSON.stringify(-0.5), JSON.stringify(""), typeof JSON.stringify(undefined));
trace(JSON.stringify([1, "a", null, undefined, [2, [3]], true, function():void {}, NaN]), JSON.stringify([]), JSON.stringify({}), JSON.stringify({a: 1}), JSON.stringify({a: undefined}), JSON.stringify({a: function():void {}}), JSON.stringify({a: [1, {b: 2}]}), JSON.stringify(Vector.<int>([1, 2])), JSON.stringify(new Array(2)));
var flat:Function = function(s:String):String { return s.split("\n").join("|"); };
trace(flat(JSON.stringify({a: [1, 2]}, null, 2))); trace(flat(JSON.stringify([1, [2, {b: 3}], [], {}], null, "--"))); trace(JSON.stringify([1], null, 20) == JSON.stringify([1], null, 10), flat(JSON.stringify([1], null, "abcdefghijklmnop")), flat(JSON.stringify([{}, [], [[]]], null, 1)), JSON.stringify([1], null, 0), JSON.stringify([1], null, ""), JSON.stringify(1, null, 2), JSON.stringify(function():void {}), JSON.stringify([undefined]), JSON.stringify({a: 1}, null, -1), flat(JSON.stringify({a: 1}, null, 1.9)));
trace("-- replacer");
trace(JSON.stringify({a: 1, b: 2}, ["b"]), JSON.stringify({a: {b: 1, c: 2}}, ["a", "c"]), JSON.stringify([{a: 1}], ["x"]), JSON.stringify({5: 1}, [5]));
trace(JSON.stringify([1, 2, {a: 3}], function(k:String, v:*):* { trace(" replace", k == "" ? "(empty)" : k, typeof k, typeof v, this is Array, this is Object); return typeof v == "number" ? v * 2 : v; }));
trace(JSON.stringify({a: 1}, function(k:String, v:*):* { return k == "a" ? undefined : v; }), JSON.stringify([1], function(k:String, v:*):* { return k == "0" ? undefined : v; }), JSON.stringify(1, function(k:String, v:*):* { return "x" + v; }));
trace(JSON.stringify(new WithJSON()), JSON.stringify([new WithJSON()]), JSON.stringify({key: new WithJSON()}), JSON.stringify(new One()), JSON.stringify(new Hidden()), JSON.stringify(new Getter()), typeof JSON.stringify(new Date(0)), JSON.stringify(new Date(0)).charAt(0), JSON.stringify(Sprite), JSON.stringify([One]));
var cyc:Object = {}; cyc.self = [cyc];
try { JSON.stringify(cyc); } catch (e1:TypeError) { trace("TypeError", e1.errorID); }
try { JSON.stringify(1, 5); } catch (e2:TypeError) { trace("TypeError", e2.errorID); }
try { JSON.stringify(1, null, {}); } catch (e3:TypeError) { trace("TypeError", e3.errorID); }
trace("-- parse");
trace(JSON.parse("1"), flat(JSON.parse('"a\\u0041\\n\\/\\"x"')), JSON.parse("[1, 2, [3]]"), JSON.parse("[1, 2, [3]]").length, JSON.parse('{"a": {"b": [true, false, null]}}').a.b, JSON.parse(" 1.5e2 "), JSON.parse("-0"), JSON.parse("true"), JSON.parse("null"), JSON.parse("\t\r\n[ ]\n").length, JSON.parse('""') === "");
var o:Object = JSON.parse('{"x": 1, "y": "s", "x": 2, "": 3}'); trace(o.x, o.y, o[""], o is Object, getQualifiedClassName(o), getQualifiedClassName(JSON.parse("[]")), typeof JSON.parse("1"), JSON.parse("1e400"), JSON.parse("12345678901234567890"));
var bad:Array = ["", "{", "[1,]", "{a:1}", "'a'", "01", "1 2", "nul", "[1 2]", '{"a" 1}', '"\\x"', "+1", ".5", "1.", "tru", '"a\nb"', "NaN", "undefined", '{"a":1,}', "[", '"abc', "1e", "-", '"\\u12"', "// c\n1", "[1]]", " 1"];
var codes:Array = []; for each (var text:String in bad) { try { codes.push(JSON.stringify(JSON.parse(text))); } catch (e4:Error) { codes.push(e4.errorID); } } trace(codes);
try { JSON.parse(null); } catch (e5:Error) { trace("null", e5.errorID); }
trace(JSON.parse("007"), JSON.parse("-01.50"), JSON.parse("[00]"), JSON.parse("1E2"), JSON.parse("1e+2"), JSON.parse("0.0e-0"));
trace(JSON.stringify(JSON.parse('[1, 2, {"a": 3, "b": [4]}]', function(k:String, v:*):* { trace(" revive", k == "" ? "(empty)" : k, typeof k, typeof v, this is Array); return typeof v == "number" ? v + 1 : v; })));
trace(JSON.stringify(JSON.parse('{"a": 1, "b": {"a": 2, "c": 3}}', function(k:String, v:*):* { return k == "a" ? undefined : v; })), JSON.stringify(JSON.parse('[1, 2, 3]', function(k:String, v:*):* { return v === 2 ? undefined : v; })), JSON.parse("5", function(k:String, v:*):* { return "replaced"; }));
trace(JSON.parse(JSON.stringify("日本 \u0000")).length, JSON.stringify(JSON.parse('{"a":[1,{"b":null}],"c":"d"}').a), JSON.stringify("\u007f\u0080￿").length);
//// class
class WithJSON { public var x:int = 1; public function toJSON(k:String):* { return "custom:" + k; } }
class One { public var value:int = 7; private var secret:int = 1; public function hello():void {} }
class Hidden { private var a:int = 1; internal var b:int = 2; protected var c:int = 3; public static var d:int = 4; }
class Getter { public function get computed():String { return "got"; } public function set writeOnly(v:int):void {} }
