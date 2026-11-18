// ByteArray
var hex:Function = function(x:ByteArray):String { var s:String = ""; for (var i:int = 0; i < x.length; i++) s += (x[i] < 16 ? "0" : "") + x[i].toString(16); return s; };
var b:ByteArray = new ByteArray();
trace(b.length, b.position, b.bytesAvailable, b.endian, b.objectEncoding, b is IDataInput, b is IDataOutput, b is Object, getQualifiedClassName(b), b.toString() == "", "[" + b + "]");
b.writeByte(1); b.writeByte(-1); b.writeByte(300); b.writeShort(0x1234); b.writeShort(-2); b.writeInt(0x12345678); b.writeInt(-1); b.writeUnsignedInt(0xfedcba98); b.writeFloat(1.5); b.writeDouble(-0.1); b.writeBoolean(true); b.writeBoolean(false);
trace(b.length, b.position, b.bytesAvailable, hex(b));
b.position = 0; trace(b.readByte(), b.readByte(), b.readUnsignedByte(), b.readShort(), b.readShort(), b.readInt(), b.readInt(), b.readUnsignedInt(), b.readFloat(), b.readDouble(), b.readBoolean(), b.readBoolean(), b.position, b.bytesAvailable);
b.position = 1; trace(b.readUnsignedByte(), b.readByte(), b.readUnsignedShort(), b.readUnsignedShort(), b.readUnsignedInt(), b.readInt(), b.readInt(), b.readBoolean());
try { b.position = b.length - 1; b.readShort(); } catch (e1:EOFError) { trace("EOFError", e1.errorID, e1 is IOError, e1 is Error, b.position); }
try { b.position = 1000; trace(b.bytesAvailable, b.length); b.readByte(); } catch (e2:Error) { trace("Error", e2.errorID); }
trace("-- endian");
var le:ByteArray = new ByteArray(); le.endian = Endian.LITTLE_ENDIAN; le.writeShort(0x1234); le.writeInt(0x12345678); le.writeFloat(1.5); le.writeDouble(2); le.writeUTF("ab");
trace(le.endian, hex(le)); le.position = 0; trace(le.readShort(), le.readInt(), le.readFloat(), le.readDouble(), le.readUTF()); le.endian = "bigEndian"; le.position = 0; trace(le.readShort(), le.readInt());
try { le.endian = "middle"; } catch (e3:Error) { trace("Error", e3.errorID); } trace(le.endian);
trace("-- text");
var t:ByteArray = new ByteArray(); t.writeUTF("héllo あ"); t.writeUTFBytes("abc"); t.writeMultiByte("xyz", "us-ascii"); t.writeMultiByte("é", "iso-8859-1"); t.writeByte(0x82); t.writeByte(0xa0);
trace(hex(t), t.length); t.position = 0; trace(t.readUTF(), t.readUTFBytes(3), t.readMultiByte(3, "us-ascii"), t.readMultiByte(1, "iso-8859-1"), t.readMultiByte(2, "shift_jis"), t.position);
t.clear(); trace(t.length, t.position); t.writeByte(97); t.writeByte(0); t.writeByte(98); t.position = 0; var nul:String = t.readUTFBytes(3); trace(nul.length, nul.charCodeAt(0), t.position, t.toString().length);
t.clear(); t.writeShort(3); t.writeByte(97); t.writeByte(0); t.writeByte(98); t.position = 0; trace(t.readUTF().length, t.position); t.position = 2; trace(t.readMultiByte(3, "us-ascii").length, t.position);
t.clear(); t.writeUTFBytes("日本語 text"); trace(t.length, t.toString(), t, String(t), t.position); t.position = 0; trace(t.readUTFBytes(3), t.readUTFBytes(0) == "", t.bytesAvailable);
trace("-- index");
var x:ByteArray = new ByteArray(); x.writeByte(10); x.writeByte(20);
trace(x[0], x[1], x[2], x[100], x.length); x[2] = 5; trace(x.length, hex(x)); x[5] = 0x1ff; trace(x.length, hex(x), x.position); x[0] = -1; x[1] = 3.9; trace(hex(x));
x.length = 2; trace(x.length, hex(x), x.position); x.length = 4; trace(hex(x)); x.position = 4; x.length = 1; trace(x.position, x.length); x.position = 3; x.writeByte(7); trace(hex(x), x.position, x.length);
trace("-- bytes");
var src:ByteArray = new ByteArray(); for (var n:int = 1; n <= 6; n++) src.writeByte(n);
var dst:ByteArray = new ByteArray(); dst.writeBytes(src); trace(hex(dst), dst.position); dst.writeBytes(src, 4); trace(hex(dst)); dst.writeBytes(src, 1, 2); trace(hex(dst), dst.position); dst.writeBytes(src, 6); dst.writeBytes(src, 5, 1); trace(hex(dst));
try { dst.writeBytes(src, 5, 10); } catch (e8:RangeError) { trace("RangeError", e8.errorID, hex(dst)); }
try { dst.writeBytes(src, 7); } catch (e4:RangeError) { trace("RangeError", e4.errorID); }
src.position = 2; var got:ByteArray = new ByteArray(); src.readBytes(got); trace(hex(got), got.position, src.position); src.position = 0; src.readBytes(got, 6, 2); trace(hex(got), src.position, got.length); src.readBytes(got, 1, 1); trace(hex(got));
try { src.readBytes(got, 0, 10); } catch (e5:EOFError) { trace("EOFError", e5.errorID, src.position); }
dst.position = 2; dst.writeBytes(dst, 0, 4); trace(hex(dst));
trace("-- compress");
var z:ByteArray = new ByteArray(); z.writeUTFBytes("hello hello hello hello, hello! "); z.compress(); trace(z.length > 0, z.position == z.length, z[0]); z.uncompress(); trace(z.toString(), z.position, z.length);
z.deflate(); z.inflate(); trace(z.toString(), z.position);
var packed:ByteArray = new ByteArray(); for each (var v:int in [120, 218, 203, 72, 205, 201, 201, 87, 200, 64, 39, 117, 32, 148, 34, 166, 12, 137, 242, 0, 137, 37, 33, 244]) packed.writeByte(v);
packed.uncompress(); trace(packed.toString(), packed.length, packed.position);
var raw:ByteArray = new ByteArray(); for each (v in [75, 76, 74, 78, 132, 33, 133, 162, 196, 114, 133, 148, 212, 180, 156, 196, 146, 84, 0]) raw.writeByte(v);
raw.inflate(); trace(raw.toString(), raw.length);
var junk:ByteArray = new ByteArray(); junk.writeUTFBytes("not compressed");
try { junk.uncompress(); } catch (e6:IOError) { trace("IOError", e6.errorID, junk.toString(), junk.position); }
try { junk.inflate(); } catch (e7:IOError) { trace("IOError", e7.errorID, junk.toString()); }
var empty:ByteArray = new ByteArray(); empty.compress(); trace(empty.length > 0); empty.uncompress(); trace(empty.length);
