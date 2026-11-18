// unverified: マウスの入力を実機へ送らずに確かめる（SimpleButton の見た目の切り替え。期待値は test/avm2.test.js）
var rect:Function = function(name:String, w:Number, h:Number):Shape { var s:Shape = new Shape(); s.name = name; s.graphics.beginFill(0x336699); s.graphics.drawRect(0, 0, w, h); return s; };
var b:SimpleButton = new SimpleButton(rect("up", 40, 20), rect("over", 50, 30), rect("down", 60, 40), rect("hit", 40, 20)); b.x = 20; b.y = 30; b.name = "b"; addChild(b);
var kept:Array = [];
var log:Function = function(e:MouseEvent):void { kept.push(e); trace(e.type, e.target.name, e.currentTarget.name); };
for each (var t:String in [MouseEvent.MOUSE_OVER, MouseEvent.MOUSE_OUT, MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_UP, MouseEvent.CLICK]) b.addEventListener(t, log);
stage.addEventListener(KeyboardEvent.KEY_DOWN, function(e:KeyboardEvent):void { kept.push(e); b.enabled = !b.enabled; trace("enabled", b.enabled); });
