// 存在しないフレームへの gotoAndStop / gotoAndPlay の前後の _currentframe と、そのフレームのスクリプトが動かないこと
// swf: 8
stop();
if (n == undefined) {
  n = 0;
  onEnterFrame = function() {
    n++;
    if (n == 2) { trace("n2 before cur=" + _currentframe); gotoAndStop(99); trace("n2 after gotoAndStop(99) cur=" + _currentframe); }
    if (n == 4) { trace("n4 cur=" + _currentframe); gotoAndPlay(99); trace("n4 after gotoAndPlay(99) cur=" + _currentframe); }
    if (n == 5) { trace("n5 cur=" + _currentframe); }
    if (n == 6) { trace("n6 cur=" + _currentframe); gotoAndStop(0); trace("n6 after gotoAndStop(0) cur=" + _currentframe); }
    if (n == 8) { trace("n8 cur=" + _currentframe); nextFrame(); trace("n8 after nextFrame cur=" + _currentframe); }
    if (n == 10) { trace("n10 cur=" + _currentframe); delete onEnterFrame; }
  };
}
//// frame 2
trace("script of frame 2");
//// frame 3
trace("script of frame 3");
//// frame 4
trace("script of frame 4 cur=" + _currentframe);
