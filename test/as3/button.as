// SimpleButton（スクリプトが作ったもの）。マウスでの見た目の切り替えは test/avm2.test.js で確かめる
var rect:Function = function(name:String, w:Number, h:Number):Shape { var s:Shape = new Shape(); s.name = name; s.graphics.beginFill(0x336699); s.graphics.drawRect(0, 0, w, h); return s; };
var up:Shape = rect("up", 40, 20); var over:Shape = rect("over", 50, 30); var down:Shape = rect("down", 60, 40); var hit:Shape = rect("hit", 40, 20);
var b:SimpleButton = new SimpleButton(up, over, down, hit); b.x = 20; b.y = 30; b.name = "b"; addChild(b);
trace(b, b is SimpleButton, b is InteractiveObject, b is DisplayObjectContainer, b.upState == up, b.overState == over, b.downState == down, b.hitTestState == hit, b.enabled, b.useHandCursor, b.trackAsMenu, b.mouseEnabled, getQualifiedClassName(b));
trace(b.width, b.height, b.getBounds(this), up.parent, over.parent, hit.parent, up.stage, up.root, b.parent == this, numChildren, b.soundTransform.volume);
var empty:SimpleButton = new SimpleButton(); trace(empty.upState, empty.overState, empty.downState, empty.hitTestState, empty.width, empty.height, empty.getBounds(empty), empty.name.indexOf("instance") == 0);
b.upState = down; trace(b.upState == down, b.downState == down, b.width, b.height); b.upState = null; trace(b.upState, b.width, b.getBounds(this)); b.upState = up; trace(b.width);
b.enabled = false; b.useHandCursor = false; b.trackAsMenu = true; trace(b.enabled, b.useHandCursor, b.trackAsMenu); b.enabled = true;
trace(b.hitTestPoint(30, 40), b.hitTestPoint(70, 40), b.hitTestPoint(5, 5), b.hitTestPoint(30, 40, true));
var placed:Sprite = new Sprite(); placed.name = "placed"; addChild(placed); var count:int = numChildren; var b2:SimpleButton = new SimpleButton(placed); trace(placed.parent, numChildren == count - 1, b2.upState == placed);
try { addChild(up); trace("addChild", up.parent == this, b.upState, b.width); } catch (e:Error) { trace("Error", e.errorID); }
up.x = 5; over.scaleX = 2; b.overState = over; trace(b.getBounds(this), b.overState.scaleX);
try { b.downState = Object("text") as DisplayObject; trace(b.downState); } catch (e2:Error) { trace("Error", e2.errorID); }
var e1:Sprite = new Sprite(); trace(e1.getBounds(e1), e1.getBounds(null), e1.getBounds(this)); e1.x = 10; e1.y = 30; trace(e1.getBounds(e1), e1.getBounds(this), e1.getRect(this)); e1.scaleX = 2; e1.scaleY = 0.5; trace(e1.getBounds(this)); addChild(e1); trace(e1.getBounds(this), e1.getBounds(e1), e1.getBounds(stage));
trace(empty.getBounds(this), empty.getBounds(null)); empty.x = 20; trace(empty.getBounds(this), empty.getBounds(empty)); var sh:Shape = new Shape(); sh.x = 7; trace(sh.getBounds(sh), sh.getBounds(this)); e1.rotation = 90; trace(e1.getBounds(this)); e1.rotation = 0; e1.x = -1000; e1.y = 123456; trace(e1.getBounds(this));
