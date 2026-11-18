// 再帰の深さの上限
// frames: 3
var depth = 0;
function deep(n) { depth = n; return n >= 250 ? n : deep(n + 1); }
trace("250 levels ok: " + deep(1));
function forever(n) { depth = n; return forever(n + 1); }
trace("before");
forever(1);
trace("after (not reached)");
//// frame 2
trace("frame 2: depth reached " + depth);
//// frame 3
trace("frame 3");
stop();
