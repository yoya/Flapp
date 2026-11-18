// 制御構造と例外
var out:String = "";
for (var i:int = 0; i < 5; i++) { if (i == 3) continue; out += i; }
trace("for", out);
var n:int = 0; while (n < 100) { n += 7; if (n > 30) break; } trace("while", n);
do { n--; } while (n > 30); trace("do", n);
outer: for (var a:int = 0; a < 3; a++) { for (var b:int = 0; b < 3; b++) { if (b == 2) continue outer; if (a == 2) break outer; trace("label", a, b); } }
var sw:Function = function(v:*):String { switch (v) { case 1: return "one"; case "1": return "string one"; case 2: case 3: return "two or three"; default: return "other"; } };
trace("switch", sw(1), sw("1"), sw(2), sw(3), sw(4), sw(null));
var obj:Object = {b: 2, a: 1, c: 3};
var keys:Array = [];
for (var k:String in obj) keys.push(k);
keys.sort(); trace("for in", keys);
var sum:int = 0; for each (var v:int in obj) sum += v; trace("for each", sum);
var arr:Array = [10, 20, 30]; out = "";
for (var idx:String in arr) out += idx + "=" + arr[idx] + " ";
trace("array for in", out);
trace("ternary", n > 0 ? "pos" : "neg", null ? 1 : 2);
trace("-- exceptions");
var thrower:Function = function(x:int):int { if (x > 1) throw new Error("too big", 42); return x; };
try { trace("ok", thrower(1)); trace(thrower(2)); trace("not reached"); } catch (e:Error) { trace("caught", e.message, e.errorID, e.name, e is Error, e); } finally { trace("finally 1"); }
var f:Function = function():String { try { return "try"; } finally { trace("finally runs before return"); } return "end"; };
trace(f());
try { try { throw "a string"; } catch (e2:Error) { trace("wrong handler"); } } catch (e3:*) { trace("caught any", e3, typeof e3); }
try { var nothing:Object = null; trace(nothing.x); } catch (e4:TypeError) { trace("TypeError", e4.errorID, e4.message.substr(0, 12), e4.name); }
try { var und:* = undefined; und.foo(); } catch (e5:TypeError) { trace("TypeError", e5.errorID, e5.message.substr(0, 12)); }
try { trace(this["nope"]()); } catch (e6:ReferenceError) { trace("ReferenceError", e6.errorID, e6 is Error, e6 is TypeError); }
try { var fn:* = 5; fn(); } catch (e10:TypeError) { trace("TypeError", e10.errorID); }
try { var num:Number = 1; Object(num).foo(); } catch (e11:TypeError) { trace("TypeError", e11.errorID); }
try { new (Object(5))(); } catch (e12:TypeError) { trace("TypeError", e12.errorID); }
try { var arr2:Array = new Array(-1); } catch (e13:RangeError) { trace("RangeError", e13.errorID); }
try { (5).toString(99); } catch (e14:RangeError) { trace("RangeError", e14.errorID); }
try { throw new RangeError("range"); } catch (e7:Error) { trace(e7.name, e7 is RangeError, e7 is Error, e7.toString(), e7.errorID); }
try { throw {code: 5}; } catch (e8:Object) { trace("object thrown", e8.code); }
var count:int = 0;
for (var j:int = 0; j < 3; j++) { try { if (j == 1) throw new Error("in loop"); count += 10; } catch (e9:Error) { count += 1; } finally { count += 100; } }
trace("loop with try", count);
