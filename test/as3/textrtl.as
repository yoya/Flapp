// size: 320x200
// 右から左へ書く文字（ヘブライ文字・アラビア文字）と、左から右の文字が混ざったときの並び。画面で測る
var mk:Function = function(y:int, s:String, align:String):TextField { var f:TextField = new TextField(); f.x = 10; f.y = y; f.width = 300; f.height = 22; f.border = true; var fmt:TextFormat = new TextFormat(); fmt.size = 16; fmt.align = align; f.defaultTextFormat = fmt; f.text = s; addChild(f); trace(f.text.length, f.text.charCodeAt(0)); return f; };
mk(5, "abc שלום def", "left");
mk(32, "שלום 123 עולם", "left");
mk(59, "مرحبا abc", "left");
mk(86, "שלום", "right");
mk(113, "aאבגb", "left");
mk(140, "(אב) [x]", "left");
