const numericKeys = new WeakMap();
const utf8Encoder = new TextEncoder();
// Lua strings are bytes. Preserve invalid UTF-8 bytes as low surrogate escapes.
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function decodeLuaBytes(bytes) {
  // Fast path: well-formed UTF-8 decodes identically to the loop below.
  try { return strictUtf8.decode(bytes); } catch { /* invalid bytes: use the lossless loop */ }
  let result = "";
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i];
    if (first < 128) { result += String.fromCharCode(first); i++; continue; }
    const length = first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
    let point = first & (length === 2 ? 31 : length === 3 ? 15 : 7);
    let valid = length > 0 && i + length <= bytes.length;
    for (let j = 1; valid && j < length; j++) {
      const next = bytes[i + j];
      if (next < 128 || next > 191) valid = false;
      else point = point * 64 + (next & 63);
    }
    if (valid && (point < (length === 2 ? 128 : length === 3 ? 2048 : 65536) || point > 1114111 || point >= 55296 && point <= 57343)) valid = false;
    if (valid) { result += String.fromCodePoint(point); i += length; }
    else { result += String.fromCharCode(56320 + first); i++; }
  }
  return result;
}
function encodeLuaString(value) {
  let result = '"';
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 56448 && point <= 56575) result += "\\" + String(point - 56320).padStart(3, "0");
    else if (point >= 55296 && point <= 57343) throw Error("Unsupported isolated Unicode surrogate");
    else if (character === "\\") result += "\\\\";
    else if (character === '"') result += '\\"';
    else if (point < 32 || point === 127) result += "\\" + String(point).padStart(3, "0");
    else result += character;
  }
  return result + '"';
}
// Restricted SavedVariables data grammar. This never evaluates Lua or JavaScript.
export function parseSavedVariables(input) {
  if (typeof input !== "string" || input.length > 20 * 1024 * 1024)
    throw Error("Choose a SavedVariables file smaller than 20 MB.");
  let i = 0,
    count = 0;
  const fail = (message) => {
    throw Error(`${message} at character ${i + 1}.`);
  };
  // Sticky patterns scan in place. Slicing or per-character allocation made a single
  // 20 MiB string block the server's event loop for about half a minute.
  const whitespace = /\s*/y;
  const keyName = /([A-Za-z_][A-Za-z_0-9]*)\s*=/y;
  const numberToken = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const stringRun = { '"': /[^"\\]*/y, "'": /[^'\\]*/y };
  const simpleEscapes = {
    n: "\n", r: "\r", t: "\t", a: "\x07", b: "\b", f: "\f", v: "\v",
    "\\": "\\", '"': '"', "'": "'",
  };
  function space() {
    for (;;) {
      whitespace.lastIndex = i;
      whitespace.exec(input);
      i = whitespace.lastIndex;
      if (input.startsWith("--", i)) {
        const end = input.indexOf("\n", i);
        i = end < 0 ? input.length : end + 1;
      } else break;
    }
  }
  function take(s) {
    space();
    if (!input.startsWith(s, i)) fail(`Expected ${s}`);
    i += s.length;
  }
  function string() {
    space();
    const quote = input[i++];
    const run = stringRun[quote];
    const pieces = [];
    let total = 0;
    const add = (piece) => { pieces.push(piece); total += piece.length; };
    const finish = () => {
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
      return decodeLuaBytes(bytes);
    };
    while (i < input.length) {
      // Copy the whole run of ordinary characters at once.
      run.lastIndex = i;
      const text = run.exec(input)[0];
      if (text) {
        const lone = /\p{Surrogate}/u.exec(text);
        if (lone) { i += lone.index + 1; fail("Unsupported isolated Unicode surrogate"); }
        add(utf8Encoder.encode(text));
        i += text.length;
        if (i >= input.length) break;
      }
      let c = input[i++];
      if (c === quote) return finish();
      // Otherwise c is a backslash.
      c = input[i++];
      if (c in simpleEscapes) add(utf8Encoder.encode(simpleEscapes[c]));
      else if (/[0-9]/.test(c || "")) {
        let n = c;
        while (n.length < 3 && /[0-9]/.test(input[i] || "")) n += input[i++];
        if (+n > 255) fail("Invalid byte escape");
        add(Uint8Array.of(+n));
      } else if (c === "\n") add(Uint8Array.of(10));
      else fail("Unsupported escape");
    }
    fail("Unterminated string");
  }
  function value(depth = 0) {
    space();
    if (depth > 100 || ++count > 1000000)
      fail("File nesting or item limit exceeded");
    if (input[i] === '"' || input[i] === "'") return string();
    if (input[i] === "{") {
      i++;
      const table = Object.create(null);
      const numeric = new Set();
      numericKeys.set(table, numeric);
      let sequence = 1;
      space();
      while (input[i] !== "}") {
        let key, v;
        if (input[i] === "[") {
          i++;
          key = value(depth + 1);
          if (!["string", "number"].includes(typeof key))
            fail("Invalid table key");
          take("]");
          take("=");
          v = value(depth + 1);
        } else {
          keyName.lastIndex = i;
          const m = keyName.exec(input);
          if (m) {
            key = m[1];
            i += m[0].length;
            v = value(depth + 1);
          } else {
            key = sequence++;
            v = value(depth + 1);
          }
        }
        if (typeof key === "number") numeric.add(String(key));
        if (Object.hasOwn(table, key)) fail("Duplicate table key");
        if (v !== null) table[key] = v;
        space();
        if (input[i] === "," || input[i] === ";") i++;
        else if (input[i] !== "}") fail("Expected table separator");
        space();
      }
      i++;
      return table;
    }
    for (const [name, v] of [
      ["true", true],
      ["false", false],
      ["nil", null],
    ])
      if (
        input.startsWith(name, i) &&
        !/[A-Za-z_0-9]/.test(input[i + name.length] || "")
      ) {
        i += name.length;
        return v;
      }
    numberToken.lastIndex = i;
    const number = numberToken.exec(input);
    if (number) {
      i += number[0].length;
      const n = Number(number[0]);
      if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)
        fail("Unsupported numeric range");
      return n;
    }
    fail("Expected a data value");
  }
  input = input.replace(/^\uFEFF/, "");
  take("SmartChatMsgSavedVars");
  take("=");
  const result = value();
  space();
  if (input[i] === ";") {
    i++;
    space();
  }
  if (i !== input.length) fail("Unexpected trailing code");
  if (!result || typeof result !== "object")
    fail("Expected SavedVariables table");
  return result;
}
export function writeSavedVariables(data) {
  function encode(v, depth = 0) {
    if (depth > 100) throw Error("Table nesting limit exceeded");
    if (v === null) return "nil";
    if (typeof v === "string") return encodeLuaString(v);
    if (typeof v === "boolean") return String(v);
    if (
      typeof v === "number" &&
      Number.isFinite(v) &&
      Math.abs(v) <= Number.MAX_SAFE_INTEGER
    )
      return String(v);
    if (!v || typeof v !== "object")
      throw Error("Unsupported SavedVariables value");
    const indent = "    ".repeat(depth);
    return (
      "{\n" +
      Object.entries(v)
        .map(
          ([k, x]) =>
            indent +
            "    [" +
            (numericKeys.get(v)?.has(k) ? String(Number(k)) : encode(k)) +
            "] = " +
            encode(x, depth + 1) +
            ",\n",
        )
        .join("") +
      indent +
      "}"
    );
  }
  return "SmartChatMsgSavedVars = " + encode(data) + "\n";
}
export function setLuaValue(table, key, value, numeric) {
  let keys = numericKeys.get(table);
  if (!keys) {
    keys = new Set();
    numericKeys.set(table, keys);
  }
  if (typeof key === "number" || numeric === true) keys.add(String(key));
  else if (numeric === false) keys.delete(String(key));
  if (value === undefined || value === null) delete table[key];
  else table[key] = value;
  return table;
}
export function isLuaNumericKey(table, key) {
  return numericKeys.get(table)?.has(String(key)) || false;
}
