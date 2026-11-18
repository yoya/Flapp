// RegExp と、正規表現を使う String のメソッド
var re:RegExp = /b+(c)?/g;
trace(re, re.source, re.global, re.ignoreCase, re.multiline, re.dotall, re.extended, re.lastIndex, new RegExp("a/b", "xsmig"), new RegExp("x"), new RegExp(""), re is RegExp, typeof re);
var r:Array = re.exec("abbcabd"); trace(r, r.length, r.index, r.input, r[0], r[1], re.lastIndex); r = re.exec("abbcabd"); trace(r, r.index, r[1], r[1] === undefined, r[1] === null, re.lastIndex); trace(re.exec("abbcabd"), re.lastIndex);
trace(/a/.test("cat"), /a/.test("dog"), /^c/.test("cat"), /t$/.test("cat"), /T/i.test("cat"), /c.t/.test("c\nt"), /c.t/s.test("c\nt"), /a b # c\n c/x.test("abc"), /^b/m.test("a\nb"), /^b/.test("a\nb"), /a$/.test("a\n"), /a$/.test("a\n\n"), /a$/m.test("a\nb"));
trace("-- syntax");
trace(/\d+/.exec("ab123c"), /\w+/.exec("  héllo_1 x"), /\s+/.exec("a \t\n\r\fb").index, /\s/.test("\v"), /[a-c]+/.exec("xxabcabd"), /[^a-c]+/.exec("abxyzc"), /[\d\-x]+/.exec("a1-x2b"), /[]a]+/.exec("b]a]"), /[\]]/.test("]"), /\bcat\b/.test("a cat b"), /\bcat\b/.test("concat"), /\Bcat/.test("concat"));
trace(/a{2}/.exec("aaaa"), /a{2,}/.exec("aaaa"), /a{1,3}/.exec("aaaa"), /a{2,3}?/.exec("aaaa"), /a+?/.exec("aaa"), /a*?b/.exec("aab"), /a{,2}/.test("a{,2}"), /a{x/.test("a{x"), /x*/.exec("abc").index, /(a|ab)(c|bcd)(d*)/.exec("abcd"));
trace(/(a)|(b)/.exec("b"), /(?:a)(b)/.exec("ab"), /a(?=b)/.exec("acab").index, /a(?!b)/.exec("abac").index, /(?<=x)a/.exec("axa").index, /(?<!x)a/.exec("xaa").index, /(a)\1/.exec("baab"), /(a)?\1b/.test("b"), /(?P<first>\w)(?P<second>\w)/.exec("xy").first, /(?P<n>a)\k<n>/.test("aa"));
trace(/\x41B\t\n/.test("AB\t\n"), /\./.test("a"), /\//.test("/"), /a\+b/.test("a+b"), /[\b]/.test("\b"), /\0/.test("\x00"), /é+/i.exec("xÉéy"), /[a-z]+/i.exec("12AbC3"), /(?>a+)ab/.test("aaab"), /a++b/.test("aab"), /^(a+)+$/.test("aaaaaaaaaaaaaaaaaaaaaaaaab"));
trace("-- bad");
var bad:Array = ["(", ")", "a**", "[a", "\\", "a{2,1}", "(?<n", "\\2(a)", "*a", "(?i)A", "(?#c)a"];
for each (var b:String in bad) { try { var br:RegExp = new RegExp(b); trace(b, br.test("a"), br.exec("aa"), br.source); } catch (e:Error) { trace(b, "error", e.errorID); } }
trace("-- lastIndex");
var g:RegExp = /a*/g; var seen:Array = []; for (var n:int = 0; n < 6; n++) { var x:Array = g.exec("baac"); seen.push(x == null ? "null" : x.index + ":" + x[0] + ":" + g.lastIndex); } trace(seen);
g = /a/g; g.lastIndex = 2; trace(g.test("aaa"), g.lastIndex, g.test("aaa"), g.lastIndex, g.test("aaa"), g.lastIndex); g.lastIndex = 10; trace(g.test("aaa"), g.lastIndex);
var ng:RegExp = /a/; ng.lastIndex = 2; trace(ng.exec("aaa").index, ng.lastIndex, RegExp(ng) === ng, new RegExp(ng) === ng, new RegExp(g).global);
trace("-- String");
trace("abcabc".match(/b/), "abcabc".match(/b/g), "abcabc".match(/x/), "abcabc".match(/x/g), "abcabc".match(/x/g) == null, "abcabc".match(/(b)(c)/g), "a.c".match("."), "abc".match("b").index, "aXbxc".match(/x/gi), "abc".match(/(?:)/g).length);
trace("abcabc".search(/c/), "abcabc".search(/x/), "abcabc".search("b"), "a.c".search("."), "abcabc".search(/c/g));
trace("abcabc".replace(/b/, "X"), "abcabc".replace(/b/g, "X"), "abcabc".replace("b", "X"), "a.c.".replace(".", "X"), "abc".replace(/(a)(b)/, "$2$1"), "abc".replace(/b/, "[$&]"), "abc".replace(/b/, "[$`]"), "abc".replace(/b/, "[$']"), "abc".replace(/b/, "$$"), "abc".replace(/b/, "$3"), "abc".replace(/(b)/, "$10"), "abc".replace("b", "[$&$`]"), "abc".replace(/x*/g, "-"));
trace("abcabc".replace(/b(c)/g, function():String { return "<" + arguments.join("|") + ">"; }), "abc".replace("b", function():String { return "<" + arguments.join("|") + ">"; }), "abc".replace(/(x)?b/, function():String { return String(arguments[1]) + arguments.length; }), "abc".replace(/(x)?b/, "[$1]"));
trace("a1b22c".split(/\d+/), "a1b22c".split(/(\d)+/), "abc".split(/(?:)/), "abc".split(""), "a,b,c".split(/,/, 2), "abc".split(/x/), "".split(/x/), "".split(/(?:)/).length, "a b  c".split(/\s*/), "abc".split(/(b)|(x)/));
trace("-- probes");
trace("baac".match(/a*/g), "aab".match(/a*/g).length, "aab".match(/a*/g), "aab".split(/a*/), "aXbXc".split(/(?=X)/), "aab".replace(/a*/g, "-"), "abc".replace(/(?=b)/g, "-"), "aab".split(/a/), "a,b,".split(/,/));
trace(/\w/.test("é"), /\w/.test("あ"), /\w/.test("Ω"), /\w/.test("×"), /\w/.test("ª"), /\w/.test("²"), /\d/.test("１"), /\s/.test(" "), /\s/.test("　"), /\W/.test("é"), /[\w]/.test("é"), /\bé/.test("xé"), /É/i.test("é"), /Ω/i.test("ω"), /[[:alpha:]]/.test("é"), /[[:alpha:]]+/.exec("ab1"), /[^]/.test("\n"), /[]/.test("a"));
trace(/(?i)a(?-i)b/.test("AB"), /(?i)a(?-i)b/.test("Ab"), /(?i:a)b/.test("Ab"), /(?i:a)b/.test("AB"), /a(?s).b/.test("a\nb"), /(a(?i)b)c/.test("aBC"), /(a(?i)b)c/.test("aBc"), /(?m)^b/.test("a\nb"), /(?x) a b/.test("ab"), /a(?#comment)b/.test("ab"), /a|(?i)b|c/.test("C"));
