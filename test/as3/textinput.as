// unverified: 実機へはキー入力を送れない。入力の動き（打鍵・BackSpace・矢印・restrict・maxChars・イベント）は test/textinput.test.js で確かめる
// size: 300x200
var a:TextField = new TextField(); a.name = "a"; a.type = "input"; a.border = true; a.width = 200; a.height = 24; addChild(a);
var b:TextField = new TextField(); b.name = "b"; b.type = "input"; b.multiline = true; b.wordWrap = true; b.border = true; b.y = 40; b.width = 100; b.height = 60; addChild(b);
var c:TextField = new TextField(); c.name = "c"; c.text = "static"; c.y = 110; c.width = 100; c.height = 24; addChild(c);
a.addEventListener("focusIn", function(e:FocusEvent):void { trace("focusIn", e.target.name); });
a.addEventListener("focusOut", function(e:FocusEvent):void { trace("focusOut", e.target.name, e.relatedObject ? e.relatedObject.name : "null"); });
a.addEventListener("textInput", function(e:TextEvent):void { trace("textInput", e.text); if (e.text == "x") e.preventDefault(); });
a.addEventListener("change", function(e:Event):void { trace("change", a.text); });
stage.addEventListener("keyDown", function(e:KeyboardEvent):void { trace("keyDown", e.keyCode, e.target.name, e.ctrlKey, e.shiftKey); });
