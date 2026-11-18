// タイムラインの制御
// label: 5 five
// frames: 8
trace("f1 " + _currentframe + "/" + _totalframes + " " + _framesloaded);
var count = 0;
//// frame 2
trace("f2");
//// frame 3
count++;
trace("f3 count=" + count);
if (count < 2) {
  gotoAndPlay(2);
  trace("after goto " + _currentframe);
}
//// frame 4
trace("f4");
gotoAndStop("five");
trace("after label goto " + _currentframe);
//// frame 5
trace("f5 (label)");
nextFrame();
//// frame 6
trace("f6 " + _currentframe);
prevFrame();
trace("f6 after prevFrame " + _currentframe);
gotoAndStop(8);
//// frame 7
trace("f7 never");
//// frame 8
trace("f8");
gotoAndStop(100);
trace("clamped " + _currentframe);
gotoAndStop("nolabel");
trace("no label " + _currentframe);
gotoAndStop(0);
trace("zero " + _currentframe);
gotoAndStop(8);
stop();
