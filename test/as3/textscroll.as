// size: 320x200
// スクロール（scrollV / maxScrollV / bottomScrollV / scroll イベント）と、スクロールした画面。実機の値を測る
var kept:Array = [];
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
var a:TextField = new TextField(); a.x = 10; a.y = 10; a.width = 140; a.height = 52; a.multiline = true; a.wordWrap = true; a.border = true; addChild(a);
var b:TextField = new TextField(); b.x = 170; b.y = 10; b.width = 140; b.height = 52; b.multiline = true; b.wordWrap = true; b.border = true; addChild(b);
var c:TextField = new TextField(); c.x = 10; c.y = 90; c.width = 140; c.height = 30; c.border = true; c.type = "input"; addChild(c);
for each (var o:TextField in [a, b, c]) o.addEventListener("scroll", function(e:Event):void { kept.push(e); trace("  scroll", (e.target as TextField).name == "" ? "?" : "ev", e.target === a ? "a" : e.target === b ? "b" : "c", (e.target as TextField).scrollV, (e.target as TextField).scrollH); });
var info:Function = function(f:TextField):String { return [f.numLines, f.scrollV, f.maxScrollV, f.bottomScrollV, f.scrollH, f.maxScrollH].join(","); };
t("empty", function():* { return info(a); });
t("3 lines", function():* { a.text = "1\r2\r3"; return info(a); });
t("4 lines", function():* { a.text = "1\r2\r3\r4"; return info(a); });
t("10 lines", function():* { a.text = "1\r2\r3\r4\r5\r6\r7\r8\r9\r10"; return info(a); });
t("scrollV 3", function():* { a.scrollV = 3; return info(a); });
t("scrollV 99", function():* { a.scrollV = 99; return info(a); });
t("scrollV -5", function():* { a.scrollV = -5; return info(a); });
t("scrollV 0", function():* { a.scrollV = 0; return info(a); });
t("scrollV 2 then shorter", function():* { a.scrollV = 5; a.text = "1\r2\r3\r4"; return info(a); });
t("scrollV same", function():* { a.scrollV = 1; a.scrollV = 1; return info(a); });
t("scrollH on wrap", function():* { a.scrollH = 20; return info(a); });
t("append resets?", function():* { a.text = "1\r2\r3\r4\r5\r6\r7\r8"; a.scrollV = 4; a.appendText("\r9"); return info(a); });
t("text resets", function():* { a.text = "x"; return info(a); });
t("scrollH nowrap short", function():* { c.text = "abc"; c.scrollH = 10; return info(c); });
a.text = "1\r2\r3\r4\r5\r6\r7\r8\r9\r10"; a.scrollV = 4;
b.text = "1\r2\r3\r4\r5\r6\r7\r8\r9\r10";
c.text = "short";
