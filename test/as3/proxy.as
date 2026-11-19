// flash.utils.Proxy を継承したクラス。存在しない名前の読み書き・呼び出し・in・delete・列挙が、flash_proxy の関数に回るか
var t:Function = function(name:String, f:Function):void { try { trace(name, f()); } catch (e:Error) { trace(name, "ERR", e.errorID); } };
var p:Dyn = new Dyn();
t("get", function():* { return p.foo; });
t("set", function():* { p.bar = 5; return p.log.join("|"); });
t("get2", function():* { return p.bar; });
t("call", function():* { return p.hello(1, 2); });
t("in", function():* { return ["x" in p, "bar" in p, "zzz" in p].join(","); });
t("delete", function():* { return [delete p.bar, p.log[p.log.length - 1]].join(","); });
t("forin", function():* { var a:Array = []; for (var k:String in p) a.push(k); return a.join(","); });
t("foreach", function():* { var a:Array = []; for each (var v:* in p) a.push(v); return a.join(","); });
t("real prop", function():* { p.real = 7; return [p.real, p.log[p.log.length - 1]].join(","); });
t("method", function():* { return p.own(3); });
t("index", function():* { return [p[0], p["k k"]].join(","); });
t("typeof", function():* { return [p is Proxy, p is Dyn, typeof p].join(","); });
t("descendants", function():* { return p..name; });
t("attr", function():* { return p.@attr; });
t("qname", function():* { var ns:Namespace = new Namespace("urn:x"); return p.ns::q; });
trace(p.log.join("|"));
trace("done");
//// class
class Dyn extends Proxy {
  public var log:Array = [];
  public var real:int = 0;
  public function own(x:int):int { return x * 2; }
  override flash_proxy function getProperty(name:*):* { log.push("get:" + name); return "G" + name; }
  override flash_proxy function setProperty(name:*, value:*):void { log.push("set:" + name + "=" + value); }
  override flash_proxy function callProperty(name:*, ...args):* { log.push("call:" + name + "(" + args + ")"); return "C" + name; }
  override flash_proxy function hasProperty(name:*):Boolean { log.push("has:" + name); return name == "bar"; }
  override flash_proxy function deleteProperty(name:*):Boolean { log.push("del:" + name); return true; }
  override flash_proxy function nextNameIndex(index:int):int { return index < 3 ? index + 1 : 0; }
  override flash_proxy function nextName(index:int):String { return "n" + index; }
  override flash_proxy function nextValue(index:int):* { return "v" + index; }
  override flash_proxy function getDescendants(name:*):* { return "D" + name; }
  override flash_proxy function isAttribute(name:*):Boolean { return false; }
}
