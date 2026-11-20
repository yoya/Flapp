// <img> の位置を測る（1 つのフィールドに 1 つの画像。画面で測る）
// swf: 8
// size: 640x400
// frames: 1
stop();
this.createTextField("f0", 1, 10, 10, 300, 44); f0.html = true; f0.multiline = true; f0.wordWrap = true; f0.border = true;
f0.htmlText = '<img src="pic.png">';
this.createTextField("f1", 2, 330, 10, 300, 44); f1.html = true; f1.multiline = true; f1.wordWrap = true; f1.border = true;
f1.htmlText = 'abc <img src="pic.png"> def';
this.createTextField("f2", 3, 10, 58, 300, 44); f2.html = true; f2.multiline = true; f2.wordWrap = true; f2.border = true;
f2.htmlText = '<img src="pic.png" hspace="0">';
this.createTextField("f3", 4, 330, 58, 300, 44); f3.html = true; f3.multiline = true; f3.wordWrap = true; f3.border = true;
f3.htmlText = '<img src="pic.png" hspace="20">';
this.createTextField("f4", 5, 10, 106, 300, 44); f4.html = true; f4.multiline = true; f4.wordWrap = true; f4.border = true;
f4.htmlText = '<img src="pic.png" vspace="0">';
this.createTextField("f5", 6, 330, 106, 300, 44); f5.html = true; f5.multiline = true; f5.wordWrap = true; f5.border = true;
f5.htmlText = '<img src="pic.png" vspace="20">';
this.createTextField("f6", 7, 10, 154, 300, 44); f6.html = true; f6.multiline = true; f6.wordWrap = true; f6.border = true;
f6.htmlText = '<img src="pic.png" align="left">';
this.createTextField("f7", 8, 330, 154, 300, 44); f7.html = true; f7.multiline = true; f7.wordWrap = true; f7.border = true;
f7.htmlText = '<img src="pic.png" align="right">';
this.createTextField("f8", 9, 10, 202, 300, 44); f8.html = true; f8.multiline = true; f8.wordWrap = true; f8.border = true;
f8.htmlText = '<img src="pic.png" width="16">';
this.createTextField("f9", 10, 330, 202, 300, 44); f9.html = true; f9.multiline = true; f9.wordWrap = true; f9.border = true;
f9.htmlText = '<img src="pic.png" height="12">';
this.createTextField("f10", 11, 10, 250, 300, 44); f10.html = true; f10.multiline = true; f10.wordWrap = true; f10.border = true;
f10.htmlText = '<img src="pic.png" width="60" height="10">';
this.createTextField("f11", 12, 330, 250, 300, 44); f11.html = true; f11.multiline = true; f11.wordWrap = true; f11.border = true;
f11.htmlText = '<img src="pic.png" align="baseline">';
this.createTextField("f12", 13, 10, 298, 300, 44); f12.html = true; f12.multiline = true; f12.wordWrap = true; f12.border = true;
f12.htmlText = '<img src="pic.png" align="middle">';
this.createTextField("f13", 14, 330, 298, 300, 44); f13.html = true; f13.multiline = true; f13.wordWrap = true; f13.border = true;
f13.htmlText = '<img src="pic.png" align="bottom">';
this.createTextField("f14", 15, 10, 346, 300, 44); f14.html = true; f14.multiline = true; f14.wordWrap = true; f14.border = true;
f14.htmlText = '<img src="pic.png" align="top">';
this.createTextField("f15", 16, 330, 346, 300, 44); f15.html = true; f15.multiline = true; f15.wordWrap = true; f15.border = true;
f15.htmlText = '<img src="pic.png" align="right" hspace="0" vspace="0">';
