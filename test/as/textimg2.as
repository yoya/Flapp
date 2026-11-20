// <img> タグの配置（画面を測る）。loaded 後の画面を撮る
// swf: 8
// size: 320x240
// frames: 1
stop();
this.createTextField("a", 1, 10, 10, 300, 70); a.html = true; a.multiline = true; a.wordWrap = true; a.border = true;
this.createTextField("b", 2, 10, 90, 150, 70); b.html = true; b.multiline = true; b.wordWrap = true; b.border = true;
this.createTextField("c", 3, 170, 90, 140, 70); c.html = true; c.multiline = true; c.wordWrap = true; c.border = true;
this.createTextField("d", 4, 10, 170, 300, 60); d.html = true; d.multiline = true; d.wordWrap = true; d.border = true;
a.htmlText = 'abc<img src="pic.png" width="32" height="24">def<img src="pic.png">ghi<img src="pic.png" width="64" height="48">jkl mno pqr stu';
b.htmlText = 'left<img src="pic.png" align="left" hspace="8" vspace="6">text text text text text text text text text text text text text';
c.htmlText = 'right<img src="pic.png" align="right" hspace="8" vspace="6">text text text text text text text text text text text text text';
d.htmlText = '<p align="center">center<img src="pic.png" vspace="10"> <b>bold</b><img src="pic.png" hspace="10">x</p>';
