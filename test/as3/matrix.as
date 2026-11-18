// Matrix、ColorTransform、Transform
var m:Matrix = new Matrix();
trace(m, m.a, m.b, m.c, m.d, m.tx, m.ty, new Matrix(1, 2, 3, 4, 5, 6), new Matrix(2), m.clone() === m, getQualifiedClassName(m));
m.translate(10, 20); trace(m); m.scale(2, 3); trace(m); m.rotate(Math.PI / 2); trace(m.a < 1e-15, m.b, m.c, m.d < 1e-15, m.tx, m.ty); m.identity(); trace(m);
var k:Matrix = new Matrix(1, 2, 3, 4, 5, 6); k.concat(new Matrix(2, 0, 0, 2, 1, 1)); trace(k); k.concat(new Matrix(0, 1, -1, 0, 0, 0)); trace(k);
k = new Matrix(2, 1, 1, 3, 10, 20); var inverse:Matrix = k.clone(); inverse.invert(); trace(inverse); inverse.concat(k); trace(inverse);
var flat:Matrix = new Matrix(1, 2, 2, 4, 5, 6); flat.invert(); trace(flat); var zero:Matrix = new Matrix(0, 0, 0, 0, 3, 4); zero.invert(); trace(zero);
trace(k.transformPoint(new Point(1, 1)), k.deltaTransformPoint(new Point(1, 1)), k.transformPoint(new Point()));
m.createBox(2, 3); trace(m); m.createBox(2, 3, 0, 4, 5); trace(m); m.createBox(2, 3, Math.PI, 4, 5); trace(m.a, m.d, Math.abs(m.b) < 1e-15, Math.abs(m.c) < 1e-15, m.tx, m.ty);
m.createBox(1, 1, Math.PI / 6); trace(Math.round(m.a * 1e6), Math.round(m.b * 1e6), Math.round(m.c * 1e6), Math.round(m.d * 1e6));
m.createBox(2, 3, Math.PI / 2, 4, 5); trace(Math.round(m.a * 1e6), Math.round(m.b * 1e6), Math.round(m.c * 1e6), Math.round(m.d * 1e6), m.tx, m.ty);
m.createGradientBox(100, 50); trace(m); m.createGradientBox(100, 50, 0, 10, 20); trace(m); m.createGradientBox(1638.4, 819.2, 0, 0, 0); trace(m);
m.setTo(1, 2, 3, 4, 5, 6); trace(m); var copy:Matrix = new Matrix(); copy.copyFrom(m); copy.a = 9; trace(copy, m); m.a = "1.5" as Number; m.tx = NaN; trace(m);
try { m.concat(null); } catch (e1:TypeError) { trace("TypeError", e1.errorID); }
trace("-- ColorTransform");
var ct:ColorTransform = new ColorTransform();
trace(ct, ct.redMultiplier, ct.alphaOffset, ct.color, new ColorTransform(0.5, 0.25, 2, 1, 10, -20, 300, 0), getQualifiedClassName(ct));
ct.color = 0x123456; trace(ct, ct.color, ct.color.toString(16)); ct.color = 0xff000080; trace(ct.color.toString(16), ct.alphaMultiplier, ct.alphaOffset, ct.redMultiplier);
ct = new ColorTransform(1, 1, 1, 1, 300, -5, 0x1ff, 0); trace(ct.color, ct.color.toString(16));
var first:ColorTransform = new ColorTransform(0.5, 1, 2, 0.5, 10, 20, 30, 40); first.concat(new ColorTransform(2, 0.5, 1, 1, 1, 2, 3, 4)); trace(first);
trace("-- Transform");
var a:Sprite = new Sprite(); a.x = 100; a.y = 50; a.scaleX = 2; addChild(a);
var b:Sprite = new Sprite(); b.x = 10; b.y = 5; b.rotation = 90; a.addChild(b); b.graphics.beginFill(0); b.graphics.drawRect(0, 0, 20, 10);
var tr:Transform = b.transform;
trace(tr is Transform, b.transform === b.transform, a.transform.matrix, a.transform.matrix === a.transform.matrix, a.transform.colorTransform);
var bm:Matrix = b.transform.matrix; trace(Math.abs(bm.a) < 1e-4, bm.b, bm.c, Math.abs(bm.d) < 1e-4, bm.tx, bm.ty);
var cm:Matrix = b.transform.concatenatedMatrix; trace(Math.abs(cm.a) < 1e-4, cm.b, cm.c, Math.abs(cm.d) < 1e-4, cm.tx, cm.ty, a.transform.concatenatedMatrix, transform.concatenatedMatrix, b.transform.pixelBounds, a.transform.pixelBounds);
var changed:Matrix = a.transform.matrix; changed.tx = 7; trace(a.x); a.transform.matrix = changed; trace(a.x, a.y, a.scaleX, a.transform.matrix);
a.transform.matrix = new Matrix(0.5, 0, 0, 0.25, 3.14159, -2.71828); trace(a.transform.matrix, a.x, a.y, a.scaleX, a.scaleY, a.rotation, a.width);
a.transform.matrix = new Matrix(0.1, 0.2, 0.3, 0.4, 1.02, 1.03); trace(a.transform.matrix, a.x, a.y, a.scaleX, a.scaleY, a.rotation);
a.transform.matrix = new Matrix(0, 1, -1, 0, 0, 0); trace(a.rotation, a.scaleX, a.scaleY, a.transform.matrix); a.rotation = 45; var rm:Matrix = a.transform.matrix; trace(rm.a == rm.b, rm.c == -rm.b, Math.round(rm.a * 1000));
a.transform.colorTransform = new ColorTransform(0.5, 0.3, 1.5, 0.8, 10.6, -300, 255.4, 12); trace(a.transform.colorTransform, a.alpha);
a.alpha = 0.5; trace(a.transform.colorTransform.alphaMultiplier, a.alpha); b.transform.colorTransform = new ColorTransform(0.5, 1, 1, 1, 100, 0, 0, 0); trace(b.transform.concatenatedColorTransform, a.transform.concatenatedColorTransform);
var other:Sprite = new Sprite(); other.transform = a.transform; trace(other.transform.matrix, other.transform.colorTransform, other.alpha); other.x = 99; trace(a.x != 99);
try { a.transform.matrix = null; trace("matrix = null", a.transform.matrix); } catch (e2:TypeError) { trace("matrix TypeError", e2.errorID); }
try { a.transform.colorTransform = null; trace("colorTransform = null", a.transform.colorTransform); } catch (e3:TypeError) { trace("colorTransform TypeError", e3.errorID); }
try { m.transformPoint(null); } catch (e4:TypeError) { trace("TypeError", e4.errorID); }
try { ct.concat(null); } catch (e5:TypeError) { trace("TypeError", e5.errorID); }
var off:Sprite = new Sprite(); off.x = 10; off.scaleX = 2; var inner:Sprite = new Sprite(); inner.x = 3; inner.y = 4; off.addChild(inner); trace(off.transform.concatenatedMatrix, inner.transform.concatenatedMatrix, inner.transform.matrix);
var neg:Sprite = new Sprite(); neg.scaleX = -2; trace(neg.scaleX, neg.scaleY, neg.rotation, neg.transform.matrix); neg.scaleX = 1; neg.scaleY = -3; trace(neg.scaleX, neg.scaleY, neg.rotation, neg.transform.matrix); neg.rotation = 30; trace(neg.scaleX, neg.scaleY, neg.rotation, neg.transform.matrix);
neg.transform.matrix = new Matrix(-1, 0, 0, 1, 0, 0); trace(neg.scaleX, neg.scaleY, neg.rotation); neg.transform.matrix = new Matrix(1, 0, 0, -1, 0, 0); trace(neg.scaleX, neg.scaleY, neg.rotation); neg.transform.matrix = new Matrix(1, 0, 0.5, 1, 0, 0); trace(neg.scaleX, neg.scaleY, neg.rotation);
var fine:Sprite = new Sprite(); fine.scaleX = 0.1; fine.scaleY = 1 / 3; trace(fine.scaleX, fine.scaleY, fine.transform.matrix); fine.rotation = 10; trace(fine.transform.matrix); fine.scaleX = -0.1; fine.rotation = -100; trace(fine.transform.matrix);
trace(new Sprite().transform.matrix, new Sprite().transform.concatenatedMatrix, new Sprite().transform.pixelBounds, new Shape().transform.colorTransform.alphaMultiplier);
