// DefineBinaryData: クラスに結び付いたバイナリデータ（[Embed] の ByteArray）
// binary: Blob text=Hello,Flapp!
// binary: Other text=xyz
var b:ByteArray = new Blob();
trace(b.length, b.position, b.bytesAvailable, b.endian, b is Blob, b is ByteArray, getQualifiedClassName(b));
trace(b.readUTFBytes(5), b.position, b.readByte(), b.toString());
var c:ByteArray = new Blob();
c[0] = 104; c.writeUTFBytes("ZZ");
trace(b[0], c[0], c.toString(), c.position, new Blob().toString());
var s:ByteArray = new SubBlob();
trace(s.length, s.toString(), s is Blob);
var o:ByteArray = new Other();
trace(o.length, o.toString(), new Plain().length);
//// class
class Blob extends ByteArray { }
class SubBlob extends Blob { }
class Other extends ByteArray { }
class Plain extends ByteArray { }
