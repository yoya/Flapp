// unverified: 実機のデバッガ版は setTimeout / setInterval が発火した後に落ちる（中で使うイベントが、誰にも保持されずに片付けられるため）。
// setTimeout / setInterval。期待する出力は test/avm2.test.js に書いてある（実機とは照合できていない）。
var once:uint = setTimeout(function(a:int, b:String):void { trace("timeout", a, b); }, 1000, 1, "two");
var cancelled:uint = setTimeout(function():void { trace("never"); }, 300);
clearTimeout(cancelled);
var n:int = 0;
var every:uint = 0;
every = setInterval(function():void { n++; trace("interval", n); if (n == 2) clearInterval(every); }, 400);
trace(once > 0, cancelled != once);
