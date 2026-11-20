// unverified: 実機へはキー入力を送れない。入力の動きは test/textinput.test.js で確かめる
// frames: 1
stop();
this.createTextField("a", 1, 10, 10, 200, 24); a.type = "input"; a.variable = "v"; a.text = "init";
this.createTextField("b", 2, 10, 50, 200, 24); b.type = "input"; b.password = true;
a.onChanged = function(f) { trace("onChanged " + f._name + " " + f.text + " v=" + v); };
a.onSetFocus = function(old) { trace("a.onSetFocus " + old); };
b.onKillFocus = function(n) { trace("b.onKillFocus " + n); };
