// unverified: ローカルのファイルへの送信（POST）は、実機では確かめられない
// LoadVars と XML の送信、クリップの変数を付けた getURL と loadVariables。通信はホストの network に任せる
// sprite: 1 frames 1 name box depth 1
var form = new LoadVars();
form.user = "yo ya";
form.score = 12;
var reply = new LoadVars();
reply.onLoad = function(ok) { trace("reply " + ok + " status=" + this.status + " echo=" + this.echo); };
trace("sendAndLoad " + form.sendAndLoad("echo.txt", reply, "POST"));
trace("send " + form.send("http://example.com/form", "_blank"));
var doc = new XML("<a b=\"1\">x</a>");
var answer = new XML();
answer.onLoad = function(ok) { trace("xml reply " + ok + " " + this.firstChild.nodeName); };
doc.sendAndLoad("xml-echo.txt", answer);
greeting = "hi there";
count = 3;
getURL("http://example.com/page", "_self", "GET");
getURL("FSCommand:quit", "");
getURL("next.swf", "_level1");
box.color = "red";
box.loadVariables("vars.txt", "POST");
box.onData = function() { trace("box onData answer=" + this.answer); };
