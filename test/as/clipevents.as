// onClipEvent と onLoad / onUnload / onEnterFrame
// sprite: 1 frames 2 name mc depth 1
// frames: 5
trace("root 1");
mc.onUnload = function() { trace("onUnload method " + this._name); };
mc.onEnterFrame = function() { trace("onEnterFrame method " + this.n); };
//// sprite 1 on load
trace("load " + this + " " + _name + " " + _currentframe);
var n = 0;
//// sprite 1 on enterFrame
n++;
trace("enterFrame " + n + " frame " + _currentframe);
//// sprite 1 on unload
trace("unload " + this + " n=" + n);
//// sprite 1 frame 1
trace("mc frame 1 n=" + n);
//// sprite 1 frame 2
trace("mc frame 2");
//// frame 2
trace("root 2");
//// frame 3
trace("root 3");
mc.swapDepths(100);
mc.removeMovieClip();
trace("removed [" + mc + "]");
//// frame 4
trace("root 4 [" + mc + "]");
//// frame 5
trace("root 5");
stop();
