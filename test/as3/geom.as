// Point と Rectangle、座標の変換と外接矩形、当たり判定
var p:Point = new Point(3, 4);
trace(p, p.x, p.y, p.length, new Point(), p.clone().equals(p), p.equals(new Point(3, 5)), p.add(new Point(1, 1)), p.subtract(new Point(1, 1)));
p.offset(1, -1); trace(p); p.normalize(10); trace(p.x, p.y, p.length); p.setTo(0.5, -2); trace(p);
trace(Point.distance(new Point(0, 0), new Point(3, 4)), Point.interpolate(new Point(0, 0), new Point(10, 20), 0.25), Point.polar(2, 0), Point.polar(2, Math.PI / 2).y);
var q:Point = new Point(); q.copyFrom(p); q.x += 1; trace(q, p);
trace("-- Rectangle");
var r:Rectangle = new Rectangle(10, 20, 30, 40);
trace(r, r.x, r.y, r.width, r.height, r.left, r.right, r.top, r.bottom, r.topLeft, r.bottomRight, r.size, new Rectangle());
trace(r.contains(10, 20), r.contains(40, 60), r.contains(39.9, 59.9), r.containsPoint(new Point(15, 25)), r.containsRect(new Rectangle(15, 25, 5, 5)), r.containsRect(new Rectangle(15, 25, 50, 5)), r.isEmpty(), new Rectangle(0, 0, 0, 5).isEmpty(), new Rectangle(0, 0, -1, 5).isEmpty());
trace(r.intersects(new Rectangle(35, 55, 10, 10)), r.intersects(new Rectangle(40, 60, 10, 10)), r.intersection(new Rectangle(35, 55, 10, 10)), r.intersection(new Rectangle(100, 100, 1, 1)), r.union(new Rectangle(0, 0, 5, 5)), r.union(new Rectangle()), new Rectangle().union(r));
var s:Rectangle = r.clone(); s.left = 0; trace(s); s.right = 100; trace(s); s.top = 30; trace(s); s.bottom = 35; trace(s);
s.inflate(5, 10); trace(s); s.offset(-5, 5); trace(s); s.topLeft = new Point(1, 2); trace(s); s.bottomRight = new Point(11, 12); trace(s); s.size = new Point(7, 8); trace(s);
s.inflatePoint(new Point(1, 1)); s.offsetPoint(new Point(1, 1)); trace(s, s.equals(r), r.equals(r.clone())); s.setEmpty(); trace(s, s.isEmpty()); s.setTo(1, 2, 3, 4); trace(s); s.copyFrom(r); trace(s);
trace("-- display");
var a:Sprite = new Sprite(); a.x = 100; a.y = 50; addChild(a);
var b:Sprite = new Sprite(); b.x = 10; b.y = 10; b.scaleX = 2; a.addChild(b);
b.graphics.beginFill(0); b.graphics.drawRect(5, 5, 20, 10); b.graphics.endFill();
trace(b.localToGlobal(new Point(0, 0)), b.localToGlobal(new Point(5, 5)), b.globalToLocal(new Point(120, 65)), a.globalToLocal(new Point(0, 0)), localToGlobal(new Point(1, 2)));
trace(b.getBounds(b), b.getBounds(a), b.getBounds(this), a.getBounds(this), a.getBounds(a), b.getRect(b), getBounds(this), new Sprite().getBounds(this));
b.rotation = 90; trace(b.getBounds(a), b.width, b.height); b.rotation = 0;
trace(b.hitTestPoint(121, 66), b.hitTestPoint(119, 66), b.hitTestPoint(159, 74), b.hitTestPoint(161, 74), a.hitTestPoint(130, 70, true), a.hitTestPoint(115, 62, true), a.hitTestPoint(115, 62, false));
var circle:Shape = new Shape(); circle.graphics.beginFill(0); circle.graphics.drawCircle(0, 0, 20); circle.x = 30; circle.y = 120; addChild(circle);
trace(circle.hitTestPoint(45, 135, false), circle.hitTestPoint(45, 135, true), circle.hitTestPoint(40, 130, true), circle.getBounds(this));
var d:Sprite = new Sprite(); d.graphics.beginFill(0); d.graphics.drawRect(0, 0, 10, 10); d.x = 155; d.y = 60; addChild(d);
trace(d.hitTestObject(b), b.hitTestObject(d), d.hitTestObject(circle), d.hitTestObject(d), a.hitTestObject(d));
var line:Shape = new Shape(); line.graphics.lineStyle(10); line.graphics.moveTo(0, 0); line.graphics.lineTo(100, 0); trace(line.getBounds(line), line.getRect(line), line.width, line.height);
try { b.getBounds(Object(5)); } catch (e1:TypeError) { trace("TypeError", e1.errorID); }
try { b.localToGlobal(null); } catch (e2:TypeError) { trace("TypeError", e2.errorID); }
