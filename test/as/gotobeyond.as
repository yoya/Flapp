// 存在しないフレームへの gotoAndPlay: 最後のフレームへ移るが、そのフレームのスクリプトは動かない。再生が続くので、先頭へ戻る
// swf: 8
if (k == undefined) k = 0;
k++;
trace("m1 k=" + k + " total=" + _totalframes);
if (k < 4) { gotoAndPlay(10); } else { stop(); }
//// frame 2
trace("m2 (not reached)");
//// frame 3
trace("m3 (not reached)");
//// frame 4
trace("m4 (not reached)");
