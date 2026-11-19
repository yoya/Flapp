// フレーム 1 とフレーム 2 が、互いに gotoAndPlay し合う（実機が、移動先のスクリプトをその場で続けて実行するのか、次の拍まで待つのか）
// swf: 8
if (ticks == undefined) { ticks = 0; n = 0; onEnterFrame = function() { ticks++; }; }
trace("f1 n=" + n + " ticks=" + ticks);
gotoAndPlay(2);
//// frame 2
n++;
trace("f2 n=" + n + " ticks=" + ticks);
if (n < 6) { gotoAndPlay(1); } else { stop(); }
