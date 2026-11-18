// マウスのイベント: クリップのボタン動作 (onPress など)、onMouseDown など、Mouse のリスナー、onClipEvent / on(press)
// 入力の手順は test/fixtures/as-mouse.input.json
// sprite: 1 name a depth 1 square 40 at 20,20
// sprite: 2 name b depth 2 square 40 at 100,20
// sprite: 3 name c depth 3 square 40 at 20,100
// sprite: 4 name d depth 4 square 40 at 100,100
var listener = new Object();
listener.onMouseDown = function() { trace("listener down " + _root._xmouse + "," + _root._ymouse); };
listener.onMouseUp = function() { trace("listener up"); };
Mouse.addListener(listener);
a.onPress = function() { trace("a onPress " + this._name + " " + this._xmouse + "," + this._ymouse); };
a.onRelease = function() { trace("a onRelease"); };
a.onReleaseOutside = function() { trace("a onReleaseOutside"); };
a.onRollOver = function() { trace("a onRollOver"); };
a.onRollOut = function() { trace("a onRollOut"); };
a.onDragOut = function() { trace("a onDragOut"); };
a.onDragOver = function() { trace("a onDragOver"); };
a.onMouseDown = function() { trace("a onMouseDown"); };
a.onMouseUp = function() { trace("a onMouseUp"); };
b.onRelease = function() { trace("b onRelease"); };
d.onMouseDown = function() { trace("d onMouseDown hit=" + this.hitTest(_root._xmouse, _root._ymouse, true)); };
_root.onMouseDown = function() { trace("root onMouseDown"); };
trace("typeof Mouse=" + typeof Mouse + " hide=" + Mouse.hide() + " show=" + Mouse.show() + " hide=" + Mouse.hide() + " hide=" + Mouse.hide() + " show=" + Mouse.show());
stop();
//// sprite 3 on mouseDown
trace("c clip mouseDown " + _name);
//// sprite 3 on mouseUp
trace("c clip mouseUp");
//// sprite 3 on press
trace("c on press " + this._name);
//// sprite 3 on release
trace("c on release");
//// sprite 3 on rollOver
trace("c on rollOver");
//// sprite 3 on rollOut
trace("c on rollOut");
