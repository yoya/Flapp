// キーボードのイベント（入力は test/fixtures/as3-key.input.json）
// イベントは保持しておく（実機のデバッガ版は、誰にも保持されなかったイベントを片付けるときに落ちる）。
var kept:Array = [];
var log:Function = function(e:KeyboardEvent):void {
  kept.push(e);
  trace(e.type, e.keyCode, e.charCode, e.target == stage, e.currentTarget == stage, e.eventPhase, e.bubbles, e.cancelable, e.ctrlKey, e.altKey, e.shiftKey, e.keyLocation);
};
stage.addEventListener(KeyboardEvent.KEY_DOWN, log);
stage.addEventListener(KeyboardEvent.KEY_UP, log);
addEventListener(KeyboardEvent.KEY_DOWN, function(e:KeyboardEvent):void { kept.push(e); trace("root", e.type, e.keyCode, e.target == stage, e.eventPhase); });
trace(stage.focus, KeyboardEvent.KEY_DOWN, KeyboardEvent.KEY_UP);
