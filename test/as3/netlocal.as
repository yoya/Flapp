// unverified: 受信サーバ（tmp/netlab/receiver.mjs）が要る。送った内容は、実機と Flapp の受信側の記録で照合する（test/avm1.test.js、test/avm2.test.js）
// 127.0.0.1:18123 の受信サーバ（tmp/netlab/receiver.mjs）へ sendToURL で送る。送った内容（メソッド・URL・本文・ヘッダ）は受信側の記録で照合する。
// 実機のデバッガ版は URLLoader の読み込みで落ちるので、返事を読まない sendToURL だけを使う。1 件ずつ try/catch で包み、エラー番号も出す
// network
var base:String = "http://127.0.0.1:18123/";
var v1:URLVariables = new URLVariables(); v1.a = "1"; v1.b = "x y&z=%"; v1.c = "日本";
var v2:URLVariables = new URLVariables(); v2.zeta = "1"; v2.alpha = "2"; v2.mid = "3"; v2.beta = "4"; v2.n1 = 5; v2.flag = true; v2.nothing = null;
var bytes:ByteArray = new ByteArray(); bytes.writeByte(0); bytes.writeByte(1); bytes.writeByte(-1); bytes.writeUTFBytes("ab");
go("g1", "u1?pre=1", null, v1, null, null);
go("g2", "u2", "POST", v1, null, null);
go("g3", "u3", "POST", "plain text body", "text/plain", null);
go("g4", "u4", "POST", bytes, "application/octet-stream", null);
go("g5", "u5", "POST", "k=v", null, [new URLRequestHeader("X-Flapp", "yes")]);
go("g6", "u6", null, "p=1&q=2", null, null);
go("g7", "u7?pre=1", "POST", v1, null, null);
go("g8", "u8", "POST", null, null, null);
go("g9", "u9", "POST", new URLVariables(), null, null);
go("g10", "u10", "POST", v2, null, null);
go("g11", "u11", "GET", v2, null, null);
go("g12", "u12", "POST", "raw=1&x=%41", "application/x-www-form-urlencoded; charset=UTF-8", null);
go("g13", "u13", "POST", "json", "application/json", null);
go("g14", "u14", "POST", bytes, null, null);
go("g15", "u15", "POST", "日本語", null, null);
go("g16", "u16", "POST", "k=v", null, [new URLRequestHeader("Content-Type", "text/plain")]);
go("g17", "u17", "POST", "k=v", null, [new URLRequestHeader("Accept", "text/html")]);
go("g18", "u18", "GET", null, null, null);
go("g19", "u19?q=1#frag", "GET", "x=1", null, null);
go("g20", "u 20/ü", "GET", null, null, null);
go("g21", "q1/p é", "GET", null, null, null);
go("g22", "q2?k=é&l=日本", "GET", null, null, null);
go("g23", "q3/日本/x", "GET", null, null, null);
go("g24", "q4?a%20b=c%2Fd&e f=g h", "GET", null, null, null);
go("g25", "q5", "GET", "k=é", null, null);
go("g26", "q6", "POST", "k=é", null, null);
var d:URLRequest = new URLRequest("x");
trace("defaults", d.method, d.contentType, d.requestHeaders == null ? "null" : "len" + d.requestHeaders.length, d.data, d.digest);
trace("sent");
//// members
public function go(label:String, path:String, method:String, data:Object, ctype:String, headers:Array):void {
  var r:URLRequest = new URLRequest("http://127.0.0.1:18123/" + path);
  try { if (method != null) r.method = method; if (data != null) r.data = data; } catch (e1:Error) { trace(label, "data", e1.errorID); }
  if (ctype != null) { try { r.contentType = ctype; } catch (e2:Error) { trace(label, "contentType", e2.errorID); } }
  if (headers != null) { try { r.requestHeaders = headers; } catch (e3:Error) { trace(label, "headers", e3.errorID); } }
  try { sendToURL(r); trace(label, "ok"); } catch (e4:Error) { trace(label, e4.name, e4.errorID); }
}
