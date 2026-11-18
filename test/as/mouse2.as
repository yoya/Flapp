// ボタンのように反応するクリップの細部: _up / _over / _down ラベル、enabled、useHandCursor
// 入力の手順は test/fixtures/as-mouse2.input.json
// sprite: 1 frames 4 name a depth 1 square 40 at 20,20
// label: 1 _up sprite 1
// label: 2 _over sprite 1
// label: 3 _down sprite 1
// sprite: 2 frames 3 name b depth 2 square 40 at 100,20
// sprite: 3 frames 4 name c depth 3 square 40 at 20,100
// label: 2 _over sprite 3
a.onRelease = function() { trace("a release frame=" + this._currentframe); };
b.onPress = function() { trace("b press frame=" + this._currentframe); };
c.onRollOver = function() { trace("c rollOver frame=" + this._currentframe); };
c.onRollOut = function() { trace("c rollOut frame=" + this._currentframe); };
var kl = new Object();
kl.onKeyDown = function() {
  if (Key.getCode() == 90) { b.enabled = !b.enabled; a.enabled = !a.enabled; }
  trace("state a=" + a._currentframe + " b=" + b._currentframe + " c=" + c._currentframe + " enabled a=" + a.enabled + " b=" + b.enabled + " hand=" + a.useHandCursor);
};
Key.addListener(kl);
trace("initial enabled=" + a.enabled + " hand=" + a.useHandCursor + " trackAsMenu=" + a.trackAsMenu + " focus=" + a.tabEnabled);
stop();
//// sprite 1 frame 1
stop();
//// sprite 2 frame 1
stop();
//// sprite 3 frame 1
stop();
