// BitmapData.draw にテキストフィールドを渡す（AS2）。実機は描ける（文字の幅は端末のフォント次第なので、描く処理に渡ったことだけを確かめる）
// unverified: node には端末のフォントで描く処理が無いので、描画側の代わりを渡して確かめる
// frames: 1
stop();
this.createTextField("t", 1, 0, 0, 100, 20);
t.text = "abc";
var b = new flash.display.BitmapData(4, 4, false, 0xffffff);
b.draw(t, new flash.geom.Matrix(2, 0, 0, 2, 1, 0));
trace(b.getPixel(0, 0).toString(16));
