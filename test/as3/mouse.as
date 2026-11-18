// マウスのイベント（入力は test/fixtures/as3-mouse.input.json）
// 実機のデバッガ版は、どのスクリプトにも保持されなかったイベントを片付けるときに落ちる。それを避けるため、イベントは必ず保持し、
// バブリングしない rollOver / rollOut は、マウスが乗りうるオブジェクトの全部で聞く。
var kept:Array = [];
var log:Function = function(e:MouseEvent):void {
  kept.push(e);
  if (e.eventPhase != 2 && e.currentTarget != stage) return; // target と、ステージに届いたときだけ書く
  trace(e.type, "target=" + e.target.name, "at=" + e.currentTarget.name, e.eventPhase, e.localX, e.localY, e.stageX, e.stageY, e.buttonDown, "related=" + (e.relatedObject ? e.relatedObject.name : null), e.bubbles);
};
var bubbling:Array = [MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_UP, MouseEvent.CLICK, MouseEvent.MOUSE_OVER, MouseEvent.MOUSE_OUT];
var all:Array = bubbling.concat(MouseEvent.ROLL_OVER, MouseEvent.ROLL_OUT);
var box:Function = function(name:String, x:Number, y:Number, w:Number, h:Number, parent:DisplayObjectContainer):Sprite {
  var sp:Sprite = new Sprite(); sp.name = name; sp.x = x; sp.y = y;
  sp.graphics.beginFill(0x336699); sp.graphics.drawRect(0, 0, w, h); sp.graphics.endFill();
  for each (var t:String in all) sp.addEventListener(t, log);
  parent.addChild(sp);
  return sp;
};
var type:String;
for each (type in all) addEventListener(type, log);
for each (type in bubbling) stage.addEventListener(type, log);
var a:Sprite = box("a", 20, 20, 80, 80, this);
var b:Sprite = box("b", 40, 40, 40, 40, a);
var s:Shape = new Shape(); s.name = "s"; s.x = 140; s.y = 20; s.graphics.beginFill(0x993333); s.graphics.drawRect(0, 0, 60, 50); addChild(s);
var c:Sprite = box("c", 140, 90, 60, 50, this);
var c1:Sprite = box("c1", 10, 10, 30, 30, c);
c.mouseChildren = false;
var capture:Function = function(e:MouseEvent):void { kept.push(e); trace("capture", e.type, e.target.name, e.currentTarget.name, e.eventPhase); };
addEventListener(MouseEvent.CLICK, capture, true);
trace(a.mouseEnabled, a.mouseChildren, c.mouseChildren, a.buttonMode, a.useHandCursor, mouseEnabled);
