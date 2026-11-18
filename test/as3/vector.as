// Vector.<T>
var vi:Vector.<int> = new Vector.<int>();
trace(vi.length, vi.fixed, vi, vi is Vector.<int>, vi is Vector.<Number>, vi is Vector.<*>, vi is Array, getQualifiedClassName(vi), Vector.<int>);
vi.push(3, 1.9, "7", -2); trace(vi, vi.length, vi[1], vi[2] + 1, typeof vi[2]);
vi[4] = 10; trace(vi, vi.length);
try { vi[6] = 1; } catch (e1:RangeError) { trace("RangeError", e1.errorID); }
try { trace(vi[5]); } catch (e2:RangeError) { trace("RangeError", e2.errorID); }
try { trace(vi[-1]); } catch (e3:RangeError) { trace("RangeError", e3.errorID); }
trace(vi.pop(), vi.shift(), vi, vi.unshift(8, 9), vi, vi.indexOf(7), vi.indexOf("7"), vi.lastIndexOf(9), vi.join("-"), vi.reverse(), vi.slice(1, 3), vi.slice(-2), vi.concat(vi).length);
trace(vi.splice(1, 2), vi, vi.splice(1, 0, 5, 6), vi, vi.sort(Array.NUMERIC), vi.sort(Array.NUMERIC | Array.DESCENDING), vi.sort(function(a:int, b:int):int { return a - b; }));
trace("-- defaults");
var vn:Vector.<Number> = new Vector.<Number>(3); var vu:Vector.<uint> = new Vector.<uint>(2); var vs:Vector.<String> = new Vector.<String>(2);
var vb:Vector.<Boolean> = new Vector.<Boolean>(2); var vo:Vector.<Object> = new Vector.<Object>(2); var va:Vector.<*> = new Vector.<*>(2);
trace(vn, vu, vs, vb, vo, va, vs[0] === null, vo[0] === null, va[0] === null, va[0] === undefined);
vn[0] = 1.5; vn[1] = "2.5"; vu[0] = -1; vs[0] = 12; vb[0] = "x"; vo[0] = undefined; va[0] = undefined;
trace(vn, vu, vs, vb, vo, va, typeof vs[0], vo[0] === null, va[0] === undefined);
trace(new Vector.<int>().pop(), new Vector.<Number>().shift(), new Vector.<String>().pop(), new Vector.<Object>().pop(), new Vector.<*>().pop(), new Vector.<Boolean>().pop());
trace(vs is Vector.<*>, vo is Vector.<*>, vn is Vector.<*>, vb is Vector.<*>, va is Vector.<Object>, vs is Vector.<Object>, vs is Vector.<String>, vs is Object, vn as Vector.<int>, getQualifiedClassName(vs), getQualifiedClassName(va));
trace("-- fixed");
var vf:Vector.<int> = new Vector.<int>(2, true); vf[0] = 5; vf[1] = 6; trace(vf, vf.fixed, vf.length);
try { vf.push(1); } catch (e4:RangeError) { trace("RangeError", e4.errorID); }
try { vf[2] = 1; } catch (e5:RangeError) { trace("RangeError", e5.errorID); }
try { vf.length = 5; } catch (e6:RangeError) { trace("RangeError", e6.errorID); }
try { vf.pop(); } catch (e7:RangeError) { trace("RangeError", e7.errorID); }
vf.fixed = false; vf.length = 4; trace(vf); vf.length = 1; trace(vf);
trace("-- typed");
var vp:Vector.<Sprite> = new Vector.<Sprite>(); vp.push(new Sprite(), null); trace(vp.length, vp[0], vp[1], vp is Vector.<DisplayObject>, vp is Vector.<*>, getQualifiedClassName(vp));
try { vp.push(new Shape()); } catch (e8:TypeError) { trace("TypeError", e8.errorID); }
try { vp[0] = Object("text"); } catch (e9:TypeError) { trace("TypeError", e9.errorID); }
trace("-- convert");
var fromArray:Vector.<int> = Vector.<int>([1, "2", 3.7]); trace(fromArray, Vector.<int>(fromArray) === fromArray, Vector.<Number>(fromArray), Vector.<Number>(fromArray) is Vector.<Number>, Vector.<String>([1, null, true]));
var lit:Vector.<String> = new <String>["b", "a", "c"]; trace(lit, lit.length, lit.sort(0), lit.fixed);
trace("-- loops");
var names:Array = []; for (var k:* in lit) names.push(k, typeof k); trace(names); var values:Array = []; for each (var v:String in lit) values.push(v); trace(values);
trace(lit.map(function(s:String, i:int, w:Vector.<String>):String { return s + i + (w === lit); }), lit.filter(function(s:String, i:int, w:Vector.<String>):Boolean { return s != "b"; }), lit.some(function(s:String, i:int, w:Vector.<String>):Boolean { return s == "c"; }), lit.every(function(s:String, i:int, w:Vector.<String>):Boolean { return s == "c"; }));
lit.forEach(function(s:String, i:int, w:Vector.<String>):void { trace(s, i); });
trace(lit.map(function(s:String, i:int, w:Vector.<String>):String { return s; }) is Vector.<String>, 1 in lit, 3 in lit, "length" in lit, lit.hasOwnProperty(0), lit["1"], lit.toString(), String(lit), lit + "");
var nested:Vector.<Vector.<int>> = new Vector.<Vector.<int>>(); nested.push(Vector.<int>([1, 2]), Vector.<int>([3])); trace(nested, nested[0][1], nested.length, getQualifiedClassName(nested));
