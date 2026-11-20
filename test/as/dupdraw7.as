// duplicateMovieClip が描画 API の中身を写すか（SWF 7）。実機の値を測る
// swf: 7
// frames: 1
stop();
this.createEmptyMovieClip("a", 1);
a.beginFill(0xff0000); a.moveTo(0, 0); a.lineTo(40, 0); a.lineTo(40, 30); a.lineTo(0, 30); a.endFill();
a._x = 10; a._y = 10;
a.duplicateMovieClip("b", 2);
b._x = 100;
trace("dup " + b._width + " " + b._height + " " + b._x);
a.createEmptyMovieClip("inner", 1);
a.inner.beginFill(0x00ff00); a.inner.moveTo(0, 0); a.inner.lineTo(10, 0); a.inner.lineTo(10, 10); a.inner.endFill();
a.duplicateMovieClip("c", 3);
c._y = 80;
trace("dup child " + c._width + " " + c._height + " " + (c.inner == undefined));
a.clear();
trace("after clear " + a._width + " " + b._width);
