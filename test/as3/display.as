// 表示リストの操作（addChild など）と、そのときのイベント、描画 API
var a:Sprite = new Sprite(); a.name = "a";
var b:Sprite = new Sprite(); b.name = "b";
var s:Shape = new Shape(); s.name = "s";
trace(a, b, s, a.parent, a.stage, a.root, numChildren, a.numChildren, name);
// 実機のデバッガ版は、どのスクリプトにも保持されなかったイベントを片付けるときに落ちる。それを避けるため、
// イベントは必ず保持し、出し入れするオブジェクトの全部にリスナーを付ける（リスナーを持つのが親だけだと、
// バブリングしない addedToStage などが誰にも届かないまま片付けられる）。
var kept:Array = [];
var log:Function = function(e:Event):void { kept.push(e); trace(" event", e.type, e.target.name, e.currentTarget.name, e.eventPhase, e.bubbles, e.cancelable); };
for each (var type:String in [Event.ADDED, Event.ADDED_TO_STAGE, Event.REMOVED, Event.REMOVED_FROM_STAGE]) {
  a.addEventListener(type, log); b.addEventListener(type, log); s.addEventListener(type, log); addEventListener(type, log);
}
trace("-- add");
b.addChild(s);
a.addChild(b);
trace(addChild(a) == a);
trace(numChildren, a.numChildren, a.parent == this, b.parent == a, s.stage == stage, s.root == this, a.getChildAt(0) == b, getChildIndex(a), a.contains(s), contains(s), contains(this), s.parent.parent.name);
trace("-- reorder");
var c:Sprite = new Sprite(); c.name = "c";
var d:Sprite = new Sprite(); d.name = "d";
for each (type in [Event.ADDED, Event.ADDED_TO_STAGE, Event.REMOVED, Event.REMOVED_FROM_STAGE]) { c.addEventListener(type, log); d.addEventListener(type, log); }
addChild(c); addChildAt(d, 0); trace(names(this));
setChildIndex(d, 2); trace(names(this));
swapChildren(a, c); trace(names(this));
swapChildrenAt(0, 2); trace(names(this));
addChild(a); trace(names(this));
addChildAt(c, 0); trace(names(this));
addChildAt(c, 2); trace(names(this));
trace(getChildByName("c") == c, getChildByName("zz"), getChildIndex(c));
trace("-- reparent");
c.addChild(b); trace(names(a), names(c), b.parent.name);
trace("-- remove");
trace(removeChild(c) == c, c.parent, c.stage, b.stage, b.parent.name, names(this));
trace(removeChildAt(0).name, names(this));
trace("-- errors");
try { removeChild(c); } catch (e1:ArgumentError) { trace(e1.errorID); }
try { addChild(null); } catch (e2:TypeError) { trace(e2.errorID); }
try { a.addChild(a); } catch (e3:ArgumentError) { trace(e3.errorID); }
try { b.addChild(c); } catch (e4:ArgumentError) { trace(e4.errorID); }
try { getChildAt(99); } catch (e5:RangeError) { trace(e5.errorID); }
try { addChildAt(c, 99); } catch (e6:RangeError) { trace(e6.errorID); }
try { setChildIndex(a, 99); } catch (e7:RangeError) { trace(e7.errorID); }
try { getChildIndex(c); } catch (e8:ArgumentError) { trace(e8.errorID); }
try { removeChildAt(-1); } catch (e9:RangeError) { trace(e9.errorID); }
trace(names(this));
trace("-- graphics");
var g:Sprite = new Sprite();
g.graphics.beginFill(0xff0000); g.graphics.drawRect(10, 20, 100, 50); g.graphics.endFill();
trace(g.width, g.height, g.x, g.y);
g.x = 5; g.y = 7.33; g.scaleX = 2; trace(g.width, g.height, g.x, g.y, g.scaleX, g.scaleY, g.rotation);
g.width = 50; trace(g.scaleX, g.width); g.height = 10; trace(g.scaleY, g.height);
g.scaleX = g.scaleY = 1; g.rotation = 90; trace(g.width, g.height, g.rotation); g.rotation = 270; trace(g.rotation); g.rotation = -190; trace(g.rotation); g.rotation = 45; trace(g.width, g.height);
g.alpha = 0.5; g.visible = false; trace(g.alpha, g.visible); g.alpha = 2; trace(g.alpha); g.alpha = -1; trace(g.alpha);
var circle:Shape = new Shape();
circle.graphics.lineStyle(2, 0); circle.graphics.drawCircle(0, 0, 10); trace(circle.width, circle.height);
circle.graphics.clear(); trace(circle.width, circle.height);
circle.graphics.beginFill(0); circle.graphics.drawEllipse(0, 0, 30, 20); trace(circle.width, circle.height);
circle.graphics.clear(); circle.graphics.lineStyle(4); circle.graphics.moveTo(0, 0); circle.graphics.lineTo(10, 0); trace(circle.width, circle.height);
circle.graphics.clear(); circle.graphics.lineStyle(0); circle.graphics.moveTo(0, 0); circle.graphics.lineTo(10, 10); trace(circle.width, circle.height);
circle.graphics.clear(); circle.graphics.beginFill(0, 0); circle.graphics.moveTo(0, 0); circle.graphics.curveTo(50, 100, 100, 0); trace(circle.width, circle.height);
var empty:Sprite = new Sprite(); trace(empty.width, empty.height); empty.width = 100; trace(empty.width, empty.scaleX);
g.rotation = 0; g.addChild(circle); circle.x = 200; trace(g.width, g.height, g.numChildren);
var mc:MovieClip = new MovieClip(); trace(mc.currentFrame, mc.totalFrames, mc.numChildren, mc.isPlaying, mc is Sprite, mc.name.substr(0, 8));
mc.custom = 5; trace(mc.custom, mc["custom"]);
//// members
public function names(o:DisplayObjectContainer):String { var out:Array = []; for (var i:int = 0; i < o.numChildren; i++) out.push(o.getChildAt(i).name); return out.join(","); }
