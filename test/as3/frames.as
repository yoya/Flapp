// frames: 3
// フレームごとのイベント（enterFrame / frameConstructed / exitFrame）とフレームスクリプトの順序
var self:MovieClip = this;
var n:int = 0;
var orphan:Sprite = new Sprite();
stage.addEventListener(Event.ENTER_FRAME, function(e:Event):void { if (n < 3) trace("stage enterFrame", e.target == stage, e.eventPhase); });
addEventListener(Event.ENTER_FRAME, function(e:Event):void { n++; if (n <= 8) trace("enterFrame", n, currentFrame, e.target == self, e.currentTarget == self, e.eventPhase, e.bubbles, e.type); });
orphan.addEventListener(Event.ENTER_FRAME, function(e:Event):void { if (n <= 3) trace("orphan enterFrame", e.target == orphan, orphan.stage, orphan.parent); });
addEventListener(Event.FRAME_CONSTRUCTED, function(e:Event):void { if (n <= 8) trace("frameConstructed", currentFrame); });
addEventListener(Event.EXIT_FRAME, function(e:Event):void { if (n <= 8) trace("exitFrame", currentFrame); });
addFrameScript(0, function():void { if (n <= 8) trace("script 1", currentFrame, isPlaying); if (n == 7) { trace("play"); play(); } },
  1, function():void { if (n <= 8) trace("script 2", currentFrame); },
  2, function():void {
    if (n > 8) return;
    trace("script 3", currentFrame);
    if (n == 2) { trace("before gotoAndPlay"); gotoAndPlay(2); trace("after gotoAndPlay", currentFrame); }
    if (n == 4) { trace("before gotoAndStop"); gotoAndStop(1); trace("after gotoAndStop", currentFrame, isPlaying); }
  });
trace("constructor end", currentFrame, totalFrames, framesLoaded, isPlaying, currentLabel, currentFrameLabel);
