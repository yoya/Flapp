// TextField と TextFormat（文字の寸法のように端末のフォントで決まる値は比べない）
var tf:TextField = new TextField();
trace(tf, tf.text == "", tf.length, tf.width, tf.height, tf.x, tf.y, tf.type, tf.autoSize, tf.multiline, tf.wordWrap, tf.selectable, tf.border, tf.background, tf.borderColor, tf.backgroundColor, tf.textColor, tf.embedFonts, tf.displayAsPassword, tf.maxChars, tf.restrict, tf.htmlText == "", tf.numLines);
trace(tf.mouseEnabled, tf.name.indexOf("instance") == 0, tf is InteractiveObject, tf is DisplayObjectContainer, getQualifiedClassName(tf), tf.parent, tf.stage, tf.visible, tf.alpha, tf.scaleX, tf.rotation);
trace(tf.antiAliasType, tf.gridFitType, tf.sharpness, tf.thickness, tf.condenseWhite, tf.mouseWheelEnabled, tf.scrollH, tf.scrollV, tf.maxScrollH, tf.maxScrollV, tf.bottomScrollV, tf.selectionBeginIndex, tf.selectionEndIndex, tf.caretIndex, tf.styleSheet, tf.alwaysShowSelection, tf.useRichTextClipboard, tf.textWidth, tf.textHeight);
var show:Function = function(f:TextFormat):String { return [f.font, f.size, f.color, f.bold, f.italic, f.underline, f.url == "" ? "(empty)" : f.url, f.target == "" ? "(empty)" : f.target, f.align, f.leftMargin, f.rightMargin, f.indent, f.leading, f.bullet, f.blockIndent, f.kerning, f.letterSpacing, f.tabStops == null ? "null" : "[" + f.tabStops + "]"].join(" "); };
trace(show(tf.defaultTextFormat)); trace(show(tf.getTextFormat())); trace(show(new TextFormat()));
trace(show(new TextFormat("Arial", 20, 0xff0000, true, false, true, "http://example.com/", "_blank", "center", 1, 2, 3, 4)), new TextFormat(), getQualifiedClassName(new TextFormat()), tf.defaultTextFormat === tf.defaultTextFormat);
trace("-- text");
tf.text = "hello"; trace(tf.text, tf.length, tf.numLines, tf.htmlText);
tf.text = "a\nb\r\nc\rd"; trace(escape(tf.text), tf.length, tf.numLines, escape(tf.getLineText(0)), escape(tf.getLineText(1)), tf.getLineText(4), tf.getLineLength(0), tf.getLineLength(4), tf.getLineOffset(2), tf.getLineIndexOfChar(3));
tf.appendText("!"); trace(escape(tf.text)); tf.text = "x<b>&\"'"; trace(tf.text, tf.htmlText); tf.text = String(12); trace(tf.text, tf.length);
tf.text = "one"; tf.replaceText(1, 2, "NN"); trace(tf.text); tf.replaceText(0, 0, "<"); trace(tf.text); tf.replaceText(5, 5, ">"); trace(tf.text); tf.setSelection(1, 3); trace(tf.selectionBeginIndex, tf.selectionEndIndex, tf.caretIndex); tf.setSelection(9, -2); trace(tf.selectionBeginIndex, tf.selectionEndIndex);
try { tf.text = null; } catch (e1:TypeError) { trace("TypeError", e1.errorID); }
try { tf.htmlText = null; } catch (e2:TypeError) { trace("TypeError", e2.errorID); }
try { tf.replaceText(2, 99, "x"); trace("replaceText", tf.text); } catch (e3:RangeError) { trace("replaceText RangeError", e3.errorID); }
try { tf.getLineText(5); } catch (e4:RangeError) { trace("getLineText RangeError", e4.errorID); }
try { tf.replaceText(99, 100, "y"); trace("replaceText", tf.text); } catch (e11:RangeError) { trace("replaceText RangeError", e11.errorID); }
try { tf.replaceText(-1, 1, "z"); trace("replaceText", tf.text); } catch (e12:RangeError) { trace("replaceText RangeError", e12.errorID); }
try { tf.replaceText(3, 1, "w"); trace("replaceText", tf.text); } catch (e13:RangeError) { trace("replaceText RangeError", e13.errorID); }
tf.multiline = true; tf.htmlText = "<p>one</p><p>two</p>a<br>b"; trace(escape(tf.text), tf.numLines); tf.multiline = false;
trace("-- html");
tf.htmlText = "plain"; trace(tf.text, tf.htmlText);
tf.htmlText = "<p>one</p><p>two</p>"; trace(escape(tf.text), tf.numLines); tf.htmlText = "a<br>b<br/>c"; trace(escape(tf.text)); tf.htmlText = "x &amp; y &lt;z&gt; &quot;q&quot; &apos;s&apos; &nbsp;|"; trace(tf.text, tf.text.length);
tf.htmlText = "<b>bold</b> and <i>it</i>"; trace(tf.text); tf.htmlText = "<font color='#ff0000'>red</font>"; trace(tf.text);
trace("-- format");
tf.text = "styled"; tf.textColor = 0xff0000; trace(tf.textColor, tf.defaultTextFormat.color, tf.getTextFormat().color, tf.htmlText); tf.textColor = 0x12345678; trace(tf.textColor);
tf.defaultTextFormat = new TextFormat("Arial", 20, 0x00ff00, true, true, true); trace(show(tf.defaultTextFormat), "|", show(tf.getTextFormat())); tf.text = "x"; trace(show(tf.getTextFormat())); trace(tf.htmlText);
tf.setTextFormat(new TextFormat(null, 30, null, false)); trace(show(tf.getTextFormat()), "|", show(tf.defaultTextFormat)); trace(tf.htmlText);
tf.setTextFormat(new TextFormat("Courier", null, null, null, false, false, "http://a/", "t", "right", 5, 6, 7, 8)); trace(tf.htmlText); trace(show(tf.getTextFormat(0, 1)));
var partial:TextFormat = new TextFormat(); partial.bullet = true; partial.blockIndent = 9; partial.letterSpacing = 2; partial.kerning = true; tf.setTextFormat(partial); trace(show(tf.getTextFormat()));
try { tf.getTextFormat(5); } catch (e5:RangeError) { trace("RangeError", e5.errorID); }
try { tf.setTextFormat(null); } catch (e6:TypeError) { trace("TypeError", e6.errorID); }
try { tf.defaultTextFormat = null; } catch (e7:TypeError) { trace("TypeError", e7.errorID); }
tf.text = "after"; trace(show(tf.getTextFormat()));
trace("-- properties");
tf.width = 200; tf.height = 50; trace(tf.width, tf.height, tf.scaleX, tf.scaleY); tf.scaleX = 2; trace(tf.width, tf.height); tf.width = 100; trace(tf.width, tf.scaleX); tf.scaleX = 1; trace(tf.width);
tf.type = TextFieldType.INPUT; tf.multiline = tf.wordWrap = tf.border = tf.background = tf.embedFonts = tf.displayAsPassword = true; tf.selectable = false; tf.borderColor = 0x112233; tf.backgroundColor = 0xff445566; tf.maxChars = 3; tf.restrict = "a-z";
trace(tf.type, tf.multiline, tf.wordWrap, tf.border, tf.background, tf.embedFonts, tf.displayAsPassword, tf.selectable, tf.borderColor, tf.backgroundColor, tf.maxChars, tf.restrict, tf.text);
tf.restrict = null; tf.maxChars = 0; tf.antiAliasType = "advanced"; tf.gridFitType = "subpixel"; tf.sharpness = 100; tf.thickness = -50; tf.condenseWhite = true; tf.mouseWheelEnabled = false; trace(tf.restrict, tf.maxChars, tf.antiAliasType, tf.gridFitType, tf.sharpness, tf.thickness, tf.condenseWhite, tf.mouseWheelEnabled);
try { tf.type = "bogus"; } catch (e8:ArgumentError) { trace("ArgumentError", e8.errorID, tf.type); }
try { tf.autoSize = "bogus"; } catch (e9:ArgumentError) { trace("ArgumentError", e9.errorID, tf.autoSize); }
try { tf.antiAliasType = "bogus"; } catch (e10:ArgumentError) { trace("ArgumentError", e10.errorID); }
tf.autoSize = TextFieldAutoSize.LEFT; trace(tf.autoSize); tf.autoSize = "none";
trace("-- display");
var plain:TextField = new TextField(); plain.x = 10; plain.y = 20; addChild(plain);
trace(plain.parent == this, plain.stage != null, numChildren, getChildAt(numChildren - 1) == plain, plain.getBounds(this), plain.getRect(plain), getBounds(this), plain.hitTestPoint(15, 25), plain.hitTestPoint(5, 25), contains(plain));
plain.width = 30; trace(plain.getBounds(this), width, height); removeChild(plain); trace(plain.parent, numChildren);
trace(TextFieldType.DYNAMIC, TextFieldAutoSize.CENTER, TextFormatAlign.JUSTIFY, AntiAliasType.NORMAL, GridFitType.PIXEL);
