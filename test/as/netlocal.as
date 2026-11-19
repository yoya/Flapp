// unverified: 受信サーバ（tmp/netlab/receiver.mjs）が要る。送った内容は、実機と Flapp の受信側の記録で照合する（test/avm1.test.js、test/avm2.test.js）
// 127.0.0.1:18123 の受信サーバ（tmp/netlab/receiver.mjs）へ送る。送った内容（メソッド・URL・本文・ヘッダ）は受信側の記録で照合する
// swf: 7
// sprite: 1 frames 1 name box depth 1
var base = "http://127.0.0.1:18123/";
function show(label) { return function(ok) { trace(label + " " + ok + " ok=" + this.ok + " name=" + this.name); }; }
var a = new LoadVars(); a.onLoad = show("a"); a.load(base + "vars.txt?q=1");
var b = new LoadVars(); b.x = "1"; b.y = "日本 語&="; b.z = 3.5; var br = new LoadVars(); br.onLoad = show("b"); b.sendAndLoad(base + "b", br, "POST");
var c = new LoadVars(); c.x = "1"; c.y = "a b"; var cr = new LoadVars(); cr.onLoad = show("c"); c.sendAndLoad(base + "c?pre=1", cr, "GET");
var d = new LoadVars(); d.addRequestHeader("X-Flapp", "yes"); d.v = "w"; var dr = new LoadVars(); dr.onLoad = show("d"); d.sendAndLoad(base + "d", dr, "POST");
var e = new LoadVars(); e.contentType = "text/plain"; e.v = "1"; var er = new LoadVars(); er.onLoad = show("e"); e.sendAndLoad(base + "e", er, "POST");
var x = new XML("<r><i n=\"1\">t</i></r>"); var xr = new XML(); xr.onLoad = function(ok) { trace("x " + ok + " " + this.toString()); }; x.sendAndLoad(base + "x", xr);
var x2 = new XML("<a/>"); x2.contentType = "text/xml"; x2.addRequestHeader("X-Two", "2"); var x2r = new XML(); x2r.onLoad = function(ok) { trace("x2 " + ok); }; x2.sendAndLoad(base + "x2", x2r);
box.who = "box"; box.n = 7;
box.onData = function() { trace("box onData ok=" + this.ok); };
box.loadVariables(base + "lv?k=1", "POST");
loadVariablesNum(base + "lvn", 0, "GET");
var c2 = new LoadVars(); c2.x = "1"; var c2r = new LoadVars(); c2r.onLoad = show("c2"); c2.sendAndLoad(base + "c2", c2r, "GET");
var c3 = new LoadVars(); c3.x = "1"; var c3r = new LoadVars(); c3r.onLoad = show("c3"); c3.sendAndLoad(base + "c3?a=1&b=2", c3r, "GET");
var c4 = new LoadVars(); var c4r = new LoadVars(); c4r.onLoad = show("c4"); c4.sendAndLoad(base + "c4?q=1", c4r, "GET");
var c5 = new LoadVars(); c5.x = "1"; var c5r = new LoadVars(); c5r.onLoad = show("c5"); c5.sendAndLoad(base + "c5?q=1", c5r, "POST");
box.loadVariables(base + "lvq?k=1", "GET");
box2 = "two words"; box2n = null; box2u = undefined; box2o = {a: 1}; box2b = true; box2f = 1.5; box2neg = -3;
loadVariablesNum(base + "lvr", 0, "POST");
var x3 = new XML("<a/>"); var x3r = new XML(); x3r.onLoad = function(ok) { trace("x3 " + ok); }; x3.sendAndLoad(base + "x3?z=1", x3r);
var x4 = new XML("<a/>"); x4.addRequestHeader(["X-A", "1", "X-B", "2"]); var x4r = new XML(); x4r.onLoad = function(ok) { trace("x4 " + ok); }; x4.sendAndLoad(base + "x4", x4r);
var x5 = new XML("<a/>"); x5.addRequestHeader("X-C", "3"); x5.addRequestHeader("X-C", "4"); var x5r = new XML(); x5r.onLoad = function(ok) { trace("x5 " + ok); }; x5.sendAndLoad(base + "x5", x5r);
var d2 = new LoadVars(); d2.addRequestHeader("Accept", "text/plain"); d2.addRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=x"); d2.k = "v"; var d2r = new LoadVars(); d2r.onLoad = show("d2"); d2.sendAndLoad(base + "d2", d2r, "POST");
var d3 = new LoadVars(); d3.addRequestHeader("X-G", "get"); var d3r = new LoadVars(); d3r.onLoad = show("d3"); d3.sendAndLoad(base + "d3", d3r, "GET");
var d4 = new LoadVars(); d4.addRequestHeader("X-Load", "1"); d4.onLoad = show("d4"); d4.load(base + "d4");
