// place: Square x=10 y=10
// マウスのイベントの相手: メインタイムラインに置かれた図形と、ステージに直接入れたスプライト。入力は test/fixtures/as3-mouse3.input.json
var kept:Array = [];
var log:Function = function(e:MouseEvent):void {
  kept.push(e);
  if (e.eventPhase == 2 && (e.type == MouseEvent.CLICK || e.type == MouseEvent.ROLL_OVER)) trace(e.type, e.target.name, e.localX, e.localY, e.target.parent ? e.target.parent.name : "-");
};
var all:Array = [MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_UP, MouseEvent.CLICK, MouseEvent.MOUSE_OVER, MouseEvent.MOUSE_OUT, MouseEvent.ROLL_OVER, MouseEvent.ROLL_OUT];
var listen:Function = function(o:InteractiveObject):void { for each (var t:String in all) o.addEventListener(t, log); };
listen(this); listen(stage);
var top:Sprite = new Sprite(); top.name = "top"; top.x = 60; top.y = 10;
top.graphics.beginFill(0x993333); top.graphics.drawRect(0, 0, 40, 40); top.graphics.endFill();
listen(top); stage.addChild(top);
var holder:Sprite = new Sprite(); holder.name = "holder"; holder.x = 110; holder.y = 10; listen(holder); addChild(holder);
var nested:Sprite = new Sprite(); nested.name = "nested"; listen(nested); holder.addChild(nested);
nested.graphics.beginFill(0x339933); nested.graphics.drawRect(0, 0, 40, 40); nested.graphics.endFill();
nested.mouseEnabled = false; holder.mouseEnabled = false;
trace(numChildren, stage.numChildren, top.parent == stage, top.root, top.stage == stage, stage.getChildAt(0) == this, stage.getChildAt(1) == top, getChildAt(0), getChildAt(0).name);
