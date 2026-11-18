// frames: 4
// フレームの移動 (gotoAndStop / gotoAndPlay / nextFrame / prevFrame) と、イベント・フレームスクリプトの順序
var n:int = 0;
addEventListener(Event.ENTER_FRAME, function(e:Event):void {
  n++;
  if (n > 7) return;
  trace("enterFrame", n, currentFrame, isPlaying);
  if (n == 1) { trace("goto 3"); gotoAndStop(3); trace("after", currentFrame, isPlaying); }
  if (n == 2) { trace("goto 2 play"); gotoAndPlay(2); trace("after", currentFrame, isPlaying); }
  if (n == 5) {
    stop(); nextFrame(); trace("nextFrame", currentFrame); prevFrame(); trace("prevFrame", currentFrame);
    gotoAndStop(99); trace("clamp", currentFrame); gotoAndStop(0); trace("zero", currentFrame); gotoAndStop(-5); trace("negative", currentFrame);
    gotoAndStop(2); gotoAndStop(2); trace("same", currentFrame); gotoAndStop("3"); trace("string number", currentFrame);
    try { gotoAndStop("nolabel"); } catch (err:ArgumentError) { trace("no label", err.errorID, currentFrame); }
    nextFrame(); nextFrame(); nextFrame(); trace("past end", currentFrame); gotoAndStop(1); prevFrame(); trace("before start", currentFrame);
  }
});
addEventListener(Event.FRAME_CONSTRUCTED, function(e:Event):void { if (n <= 7) trace("frameConstructed", currentFrame); });
addEventListener(Event.EXIT_FRAME, function(e:Event):void { if (n <= 7) trace("exitFrame", currentFrame); });
addFrameScript(0, function():void { if (n <= 7) trace("script 1", currentFrame); },
  1, function():void { if (n <= 7) trace("script 2", currentFrame); },
  2, function():void { if (n > 7) return; trace("script 3", currentFrame); if (n == 1) { trace("script goto 4"); gotoAndStop(4); trace("script after", currentFrame); gotoAndStop(2); trace("script after 2", currentFrame); } },
  3, function():void { if (n <= 7) trace("script 4", currentFrame); });
trace("constructor goto 2"); gotoAndStop(2); trace("constructor after", currentFrame, isPlaying); play(); trace(isPlaying);
