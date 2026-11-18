// ムービークリップのプロパティ
// sprite: 1 frames 1 name box depth 1 square 40
// sprite: 2 frames 1 name other depth 2 square 20
trace("-- initial");
trace(box._x + " " + box._y + " " + box._xscale + " " + box._yscale + " " + box._rotation + " " + box._alpha + " " + box._visible);
trace(box._width + " " + box._height + " " + box._name + " " + box._target + " " + box._currentframe + " " + box._totalframes);
trace(_x + " " + _width + " " + _height + " " + _name + " [" + _target + "] " + _parent + " " + (_root == this) + " " + _level0);
trace("-- set");
box._x = 100; box._y = 50.5;
trace(box._x + " " + box._y);
box._xscale = 200; box._yscale = 50;
trace(box._xscale + " " + box._yscale + " " + box._width + " " + box._height);
box._rotation = 90;
trace(box._rotation + " " + box._xscale + " " + box._yscale + " " + box._width + " " + box._height);
box._rotation = 45;
trace(box._rotation + " " + Math.round(box._width * 100) / 100 + " " + Math.round(box._height * 100) / 100);
box._rotation = 270;
trace(box._rotation);
box._rotation = -400;
trace(box._rotation);
box._rotation = 0;
box._width = 100; box._height = 10;
trace(box._width + " " + box._height + " " + box._xscale + " " + box._yscale);
box._alpha = 50;
trace(box._alpha);
box._alpha = 150;
trace(box._alpha);
box._visible = false;
trace(box._visible + " " + typeof box._visible);
box._visible = 1;
trace(box._visible);
box._x = "abc";
box._y = "12";
trace(box._x + " " + box._y);
box._x = undefined;
trace(box._x);
box._name = "renamed";
trace(box._name + " " + renamed + " " + typeof box + " " + renamed._target);
trace("-- read only");
renamed._currentframe = 5;
renamed._totalframes = 9;
trace(renamed._currentframe + " " + renamed._totalframes);
trace("-- depth");
trace(renamed.getDepth() + " " + other.getDepth());
renamed.swapDepths(other);
trace(renamed.getDepth() + " " + other.getDepth());
renamed.swapDepths(10);
trace(renamed.getDepth() + " " + getInstanceAtDepth(10) + " " + getInstanceAtDepth(-16382));
trace("-- bounds");
var bounds = other.getBounds(this);
trace(bounds.xMin + " " + bounds.xMax + " " + bounds.yMin + " " + bounds.yMax);
other._x = 10; other._y = 20;
bounds = other.getBounds(_root);
trace(bounds.xMin + " " + bounds.xMax + " " + bounds.yMin + " " + bounds.yMax);
bounds = other.getBounds(other);
trace(bounds.xMin + " " + bounds.xMax + " " + bounds.yMin + " " + bounds.yMax);
trace("-- getProperty / setProperty / paths");
setProperty("other", _x, 33);
trace(getProperty("other", _x) + " " + getProperty(other, _y) + " " + getProperty("/other", _name) + " " + getProperty("", _name));
trace(eval("other") + " " + eval("/other") + " " + eval("_root.other") + " " + eval("other._x") + " " + eval("/other:_x") + " " + eval("nothing"));
trace(targetPath(other) + " " + other + " " + String(other) + " " + (other == eval("other")));
tellTarget("other") {
  trace("in tellTarget " + _name + " " + _x);
}
with (other) {
  trace("in with " + _name + " " + _x);
}
trace("-- variables on clips");
other.myVar = "hello";
trace(other.myVar + " " + eval("other.myVar") + " " + other["myVar"] + " " + _root.other.myVar);
var out = "";
for (var k in other) out += k + " ";
trace(out);
out = "";
for (var k2 in this) out += k2 + " ";
trace(out);
