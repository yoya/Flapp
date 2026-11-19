// 読み込まれる側の AS3 のムービー（test/as3/loader.as が読み込む）。単独で再生しても動く
// frames: 2
// document: ChildMain
trace("child constructor", this, root == this, stage != null, loaderInfo != null, totalFrames);
childVar = "hello";
var box:Shape = new Shape();
box.graphics.beginFill(0x3366cc);
box.graphics.drawRect(0, 0, 40, 20);
addChild(box);
addFrameScript(1, function():void { trace("child frame 2", currentFrame, root == this); stop(); });
addEventListener(Event.ADDED_TO_STAGE, function(e:Event):void { kept.push(e); trace("child addedToStage", parent != null, stage != null); });
//// members
public var kept:Array = [];
public var childVar:String;
