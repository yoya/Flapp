// キーのイベント: Key のリスナー、onClipEvent(keyDown / keyUp)、Key.getCode / getAscii / isDown
// 入力の手順は test/fixtures/as-key.input.json
// sprite: 1 name a depth 1 square 40 at 20,20
var kl = new Object();
// （Key.isDown は確かめない。実機は OS のキーの状態を見るので、合成した入力では常に false になる。）
kl.onKeyDown = function() { trace("listener down code=" + Key.getCode() + " ascii=" + Key.getAscii()); };
kl.onKeyUp = function() { trace("listener up code=" + Key.getCode() + " ascii=" + Key.getAscii()); };
trace("add " + Key.addListener(kl) + " " + Key.addListener(kl) + " remove " + Key.removeListener(kl) + " " + Key.removeListener(kl) + " add " + Key.addListener(kl));
a.onKeyDown = function() { trace("a.onKeyDown method"); };
_root.onKeyDown = function() { trace("root.onKeyDown method"); };
trace(Key.BACKSPACE + " " + Key.CAPSLOCK + " " + Key.CONTROL + " " + Key.DELETEKEY + " " + Key.DOWN + " " + Key.END + " " + Key.ENTER + " " + Key.ESCAPE + " " + Key.HOME);
trace(Key.INSERT + " " + Key.LEFT + " " + Key.PGDN + " " + Key.PGUP + " " + Key.RIGHT + " " + Key.SHIFT + " " + Key.SPACE + " " + Key.TAB + " " + Key.UP);
trace("before: code=" + Key.getCode() + " ascii=" + Key.getAscii() + " typeof Key=" + typeof Key);
stop();
//// sprite 1 on keyDown
trace("a clip keyDown " + Key.getCode() + " " + _name);
//// sprite 1 on keyUp
trace("a clip keyUp " + Key.getCode());
