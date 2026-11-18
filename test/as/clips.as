// クリップのフレームアクションの実行順と、親子関係
// sprite: 1 frames 2 name a depth 1
// sprite: 2 frames 2 name b depth 2
// sprite: 3 frames 2 name inner depth 1 in 1
// frames: 3
trace("root 1");
trace(a + " " + b + " " + a.inner + " " + typeof a + " " + a._name + " " + a.inner._parent._name);
var ticks = 0;
this.onEnterFrame = function() {
  ticks++;
  trace("root enterFrame " + ticks + " frame " + _currentframe);
  if (ticks >= 3) delete this.onEnterFrame;
};
a.onEnterFrame = function() {
  trace("a enterFrame " + this._currentframe);
  if (ticks >= 2) delete this.onEnterFrame;
};
//// sprite 1 frame 1
trace("a 1 this=" + this + " parent=" + _parent + " root=" + _root);
var local = "a-var";
//// sprite 1 frame 2
trace("a 2 " + local + " " + _parent.ticks);
stop();
//// sprite 2 frame 1
trace("b 1 sees a.local=" + _parent.a.local + " " + _root.a.inner);
//// sprite 2 frame 2
trace("b 2");
stop();
//// sprite 3 frame 1
trace("inner 1 " + this + " " + _parent + " " + _parent._parent + " " + _target);
//// sprite 3 frame 2
trace("inner 2");
stop();
//// frame 2
trace("root 2 " + a._currentframe + " " + b._currentframe + " " + a.inner._currentframe);
//// frame 3
trace("root 3");
stop();
