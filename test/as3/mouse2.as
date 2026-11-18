// sprite: Leaf
// place: Leaf name=leaf x=190 y=10
// マウスのイベントの相手の決まり方（図形だけの入れ物、mouseEnabled、重なり、非表示）。入力は test/fixtures/as3-mouse2.input.json
// イベントの保持と rollOver / rollOut のリスナーは、as3-mouse と同じ理由。
var kept:Array = [];
var log:Function = function(e:MouseEvent):void {
  kept.push(e);
  if (e.eventPhase == 2 && (e.type == MouseEvent.CLICK || e.type == MouseEvent.ROLL_OVER)) trace(e.type, e.target.name, e.localX, e.localY);
};
var all:Array = [MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_UP, MouseEvent.CLICK, MouseEvent.MOUSE_OVER, MouseEvent.MOUSE_OUT, MouseEvent.ROLL_OVER, MouseEvent.ROLL_OUT];
var listen:Function = function(o:InteractiveObject):void { for each (var t:String in all) o.addEventListener(t, log); };
var rect:Function = function(g:Graphics, x:Number, y:Number, w:Number, h:Number):void { g.beginFill(0x336699); g.drawRect(x, y, w, h); g.endFill(); };
var sprite:Function = function(name:String, x:Number, y:Number, parent:DisplayObjectContainer, filled:Boolean):Sprite {
  var sp:Sprite = new Sprite(); sp.name = name; sp.x = x; sp.y = y;
  if (filled) rect(sp.graphics, 0, 0, 30, 30);
  listen(sp); parent.addChild(sp);
  return sp;
};
listen(this); listen(stage); listen(leaf);
// A: 図形の子だけを持つスプライト
var p:Sprite = sprite("p", 10, 10, this, false);
var ps:Shape = new Shape(); rect(ps.graphics, 0, 0, 30, 30); p.addChild(ps);
// B: ルートに直接描いた図形   C: ルートの子の図形
rect(graphics, 50, 10, 30, 30);
var cs:Shape = new Shape(); cs.x = 90; cs.y = 10; rect(cs.graphics, 0, 0, 30, 30); addChild(cs);
// E: mouseEnabled が偽のスプライトを、中に持つスプライト
var outer:Sprite = sprite("outer", 130, 10, this, false);
var inner:Sprite = sprite("inner", 0, 0, outer, true); inner.mouseEnabled = false;
// F: mouseEnabled が偽のスプライトが、別のスプライトに重なっている
var under:Sprite = sprite("under", 10, 60, this, true);
var over:Sprite = sprite("over", 10, 60, this, true); over.mouseEnabled = false;
// G: 非表示のスプライトが重なっている   H: mouseChildren が偽で、自分は mouseEnabled も偽
var shown:Sprite = sprite("shown", 50, 60, this, true);
var hidden:Sprite = sprite("hidden", 50, 60, this, true); hidden.visible = false;
var deaf:Sprite = sprite("deaf", 90, 60, this, false); deaf.mouseChildren = false; deaf.mouseEnabled = false;
var deafChild:Sprite = sprite("deafChild", 0, 0, deaf, true);
var below:Sprite = sprite("below", 130, 60, this, true);
var glass:Sprite = sprite("glass", 130, 60, this, true); glass.alpha = 0;
// I: mouseEnabled が偽で、子は反応する
var shell:Sprite = sprite("shell", 10, 110, this, true); shell.mouseEnabled = false;
var core:Sprite = sprite("core", 40, 0, shell, true);
trace(leaf.name, leaf.numChildren, numChildren);
//// members
public var leaf:MovieClip;
//// class
class Leaf extends MovieClip {
  public function Leaf() { super(); }
}
