// 定義の無いクラスを参照したとき（完全修飾名の new）の例外。実機は、最初の名前（org）を変数として読んで #1065 にする
// frames: 1
trace("start");
try {
  var o:* = new org.nosuch.pkg.Missing();
  trace("after new");
} catch (err:Error) {
  trace("caught " + err.name + " " + err.errorID);
}
trace("end");
