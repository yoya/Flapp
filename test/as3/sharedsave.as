// unverified: 実機は SharedObject をディスクに保存する（サンドボックスでは書けない）。storage を渡したときの動作は test/shared.test.js で確かめる
var so:SharedObject = SharedObject.getLocal("save1");
if (so.data.n == undefined) {
  so.data.n = 0;
  so.data.list = [1, "a", true, null, undefined];
  so.data.when = new Date(86400000);
  so.data.nested = {x: 1, y: {z: "deep"}};
  so.data.nan = NaN; so.data.inf = -Infinity; so.data.neg0 = 0 * -1;
  so.data.fn = function():void {};
  so.data.sprite = new Sprite();
}
so.data.n++;
var keys:Array = [];
for (var k:String in so.data) keys.push(k);
trace("n=" + so.data.n + " keys=" + keys);
trace("list=" + so.data.list.length + " " + so.data.list[1] + " " + so.data.list[2] + " " + so.data.list[3] + " " + typeof so.data.list[4]);
trace("when=" + so.data.when.time + " " + (so.data.when is Date) + " nested=" + so.data.nested.y.z + so.data.nested.x);
trace("nan=" + so.data.nan + " inf=" + so.data.inf + " neg0=" + (1 / so.data.neg0) + " fn=" + typeof so.data.fn + " sprite=" + typeof so.data.sprite);
trace("flush=" + so.flush());
var other:SharedObject = SharedObject.getLocal("save2");
trace("other=" + other.data.n);
other.data.n = 5;
other.flush();
other.clear();
trace("cleared=" + other.data.n);
