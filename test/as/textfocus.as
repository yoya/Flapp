// Selection とフォーカスのイベント（onSetFocus / onKillFocus）。実機の値を測る
// frames: 1
stop();
this.createTextField("a", 1, 10, 10, 200, 24); a.type = "input"; a.text = "Hello world";
this.createTextField("b", 2, 10, 50, 200, 24); b.type = "input"; b.text = "Hello world";
this.createTextField("c", 3, 10, 90, 200, 24); c.text = "static";
this.createTextField("d", 4, 10, 130, 200, 24); d.text = "nosel"; d.selectable = false;
this.createEmptyMovieClip("mc", 5);
var sel = function() { return [Selection.getBeginIndex(), Selection.getEndIndex(), Selection.getCaretIndex()].join(","); };
trace("initial " + Selection.getFocus() + " " + sel());
a.onSetFocus = function(old) { trace("a.onSetFocus " + old); };
a.onKillFocus = function(n) { trace("a.onKillFocus " + n); };
b.onSetFocus = function(old) { trace("b.onSetFocus " + old); };
var l = {}; l.onSetFocus = function(o, n) { trace("sel.onSetFocus " + o + " " + n); }; Selection.addListener(l);
trace("setFocus a: " + Selection.setFocus("a") + " " + Selection.getFocus() + " " + sel());
trace("setSelection: " + sel());
Selection.setSelection(2, 5); trace("2,5 " + sel());
Selection.setSelection(5, 2); trace("5,2 " + sel());
Selection.setSelection(-3, 99); trace("out " + sel());
a.text = "abc"; trace("text assign " + sel());
trace("setFocus b obj: " + Selection.setFocus(b) + " " + Selection.getFocus() + " " + sel());
trace("setFocus b again: " + Selection.setFocus(b));
trace("setFocus nope: " + Selection.setFocus("nope") + " " + Selection.getFocus());
trace("setFocus c: " + Selection.setFocus("c") + " " + Selection.getFocus());
trace("setFocus d: " + Selection.setFocus("d") + " " + Selection.getFocus());
trace("setFocus mc: " + Selection.setFocus("mc") + " " + Selection.getFocus());
trace("setFocus null: " + Selection.setFocus(null) + " " + Selection.getFocus() + " " + sel());
trace("setFocus undefined: " + Selection.setFocus(undefined) + " " + Selection.getFocus());
trace("setFocus _level0.a: " + Selection.setFocus("_level0.a") + " " + Selection.getFocus());
Selection.removeListener(l);
trace("setFocus b: " + Selection.setFocus("b"));
trace("typeof Selection: " + typeof Selection + " " + (Selection.onSetFocus == undefined));
Selection.setFocus("a"); Selection.setSelection(1, 3);
trace("data: " + a.text + " " + sel());

