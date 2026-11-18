// Timer。setTimeout / setInterval は test/as3/timeout.as（実機のデバッガ版では、それらを使うと落ちるので照合できない）。
var kept:Array = [];
var t:Timer = new Timer(100, 3);
trace(t.delay, t.repeatCount, t.currentCount, t.running);
t.addEventListener(TimerEvent.TIMER, function(e:TimerEvent):void { kept.push(e); trace("timer", t.currentCount, t.running, e.type, e.target == t, e.bubbles, e.eventPhase); });
var completed:int = 0;
t.addEventListener(TimerEvent.TIMER_COMPLETE, function(e:TimerEvent):void {
  kept.push(e); completed++; trace("complete", completed, t.currentCount, t.running);
  t.reset(); trace("reset", t.currentCount, t.running);
});
t.start(); t.start(); trace(t.running, t.currentCount);
trace(getTimer() >= 0, getTimer() < 2000);
try { new Timer(-1); } catch (e1:RangeError) { trace("RangeError", e1.errorID); }
try { new Timer(NaN); } catch (e2:RangeError) { trace("RangeError", e2.errorID); }
var stopped:Timer = new Timer(50); stopped.addEventListener(TimerEvent.TIMER, function(e:TimerEvent):void { kept.push(e); trace("stopped timer", stopped.currentCount); stopped.stop(); trace(stopped.running, stopped.currentCount); });
stopped.start();
