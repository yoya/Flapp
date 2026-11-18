// Object.watch / unwatch と __resolve
var o = {a: 1};
function w(prop, oldVal, newVal, user) { trace("watch " + prop + ": " + oldVal + " -> " + newVal + " user=" + user + " this.a=" + this.a); return newVal * 2; }
trace("watch returns " + o.watch("a", w, "U") + " " + o.watch("b", w) + " " + o.watch("c") + " " + o.watch());
o.a = 5; trace("a=" + o.a);
o.a = 6; trace("a=" + o.a);
o.b = 1; trace("b=" + o.b);
o.c = 3; trace("c=" + o.c);
delete o.a; o.a = 10; trace("after delete a=" + o.a);
trace("unwatch " + o.unwatch("a") + " " + o.unwatch("a") + " " + o.unwatch("zzz"));
o.a = 7; trace("a=" + o.a);
o.watch("b", function(p, a, b) { trace("no return " + a + " -> " + b); });
o.b = 9; trace("b=[" + o.b + "]");
var p = {x: 1};
var q = new Object(); q.__proto__ = p;
p.watch("x", function(prop, a, b) { trace("proto watch " + a + " -> " + b); return b; });
q.x = 2; trace("q.x=" + q.x + " p.x=" + p.x + " own=" + q.hasOwnProperty("x"));
var r = new Object();
r.__resolve = function(name) { trace("resolve " + name); return name + "!"; };
trace(r.zzz + " " + r.a + " " + typeof r.f);
r.known = 1; trace(r.known);
trace(r.method(1, 2));
r.__resolve = undefined; trace("[" + r.zzz + "]");
