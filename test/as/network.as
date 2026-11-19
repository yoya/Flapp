// LoadVars、XML、loadVariables の読み込みが成功する場合: tools/assets/net-vars.txt と net-data.xml を読む
// sprite: 1 frames 1 name box depth 1
var frame = 0;
onEnterFrame = function() { frame++; };
var lv = new LoadVars();
lv.onLoad = function(ok) { trace("lv onLoad " + ok + " loaded=" + this.loaded + " name=" + this.name + " n=" + this.n + " " + typeof this.n + " msg=[" + this.msg + "] bytes=" + this.getBytesLoaded() + "/" + this.getBytesTotal() + " later=" + (frame > 0)); };
trace("load " + lv.load("../../tools/assets/net-vars.txt") + " loaded=" + lv.loaded + " bytes=" + lv.getBytesLoaded() + "/" + lv.getBytesTotal());
var raw = new LoadVars();
raw.onData = function(text) { trace("raw onData [" + text + "] " + typeof text + " loaded=" + this.loaded); };
raw.load("../../tools/assets/net-vars.txt");
var x = new XML();
x.ignoreWhite = true;
x.onLoad = function(ok) { trace("xml onLoad " + ok + " loaded=" + this.loaded + " status=" + this.status + " root=" + this.firstChild.nodeName + " items=" + this.firstChild.childNodes.length + " first=" + this.firstChild.firstChild.attributes.id + " [" + this.firstChild.lastChild.firstChild.nodeValue + "]"); };
trace("xml load " + x.load("../../tools/assets/net-data.xml") + " loaded=" + x.loaded);
box.onData = function() { trace("box onData name=" + this.name + " n=" + this.n + " msg=" + this.msg); };
box.loadVariables("../../tools/assets/net-vars.txt");
trace("box before name=" + box.name);
