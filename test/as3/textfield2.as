// タイムラインに置いたテキストフィールド
// field: name=label text=hello x=10 y=20
// field: name=other text=second x=10 y=60
// field: text=unnamed x=10 y=100
trace(label, label is TextField, label.text, label.name, label.parent == this, label.x, label.y, label.width, label.height, numChildren, getChildByName("label") == label, getChildAt(0) == label, getChildAt(1) == other);
trace(label.type, label.selectable, label.multiline, label.wordWrap, label.border, label.background, label.embedFonts, label.textColor, label.autoSize, label.maxChars, label.length, label.numLines, label.mouseEnabled);
var third:DisplayObject = getChildAt(2); trace(third, third is TextField, third.name, TextField(third).text, this["label"] == label, third.parent == this);
label.text = "changed"; trace(label.text, other.text, label.htmlText);
var f:TextFormat = label.defaultTextFormat; trace(f.font, f.size, f.color, f.bold, f.align, f.leading);
label.addEventListener(Event.ADDED_TO_STAGE, function(e:Event):void { kept.push(e); trace("addedToStage", e.target == label); });
label.addEventListener(Event.REMOVED, function(e:Event):void { kept.push(e); trace("removed", e.target == label, e.eventPhase); });
addEventListener(Event.REMOVED, function(e:Event):void { kept.push(e); trace("removed at root", e.target == label, e.eventPhase); });
removeChild(label); trace(label.parent, numChildren, getChildByName("label"), this.label == null); addChild(label); trace(getChildIndex(label), label.stage != null);
other.getBounds(this); trace(other.getBounds(this), other.hitTestPoint(20, 70), other.hitTestPoint(200, 70));
//// members
public var label:TextField;
public var other:TextField;
public var kept:Array = [];
