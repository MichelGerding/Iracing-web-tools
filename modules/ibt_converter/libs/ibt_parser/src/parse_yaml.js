/**
 * yaml-parser.js — minimal, high-performance YAML parser for the browser
 * Supports: mappings, sequences, scalars, nested structures, multi-line strings,
 * block/flow styles, comments, quoted strings, booleans, nulls, numbers, dates.
 * Does NOT support: anchors/aliases, tags, directives, merge keys.
 */

/**
 * @typedef {Object} YamlContext
 * @property {string[]} lines
 * @property {number} pos
 */

const YAML = (() => {
  //  Scalar casting 

  const BOOL_TRUE = /^(true|yes|on)$/i;
  const BOOL_FALSE = /^(false|no|off)$/i;
  const INT_RE = /^[-+]?(0x[\da-f]+|0o[0-7]+|0b[01]+|\d+)$/i;
  const FLOAT_RE =
    /^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?(\.inf|\.Inf|\.INF)$|^\.nan$/i;
  const DATE_RE =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

  /**
   * Casts a string value to a dynamic type.
   * @param {string} val - The string to cast
   * @returns {null|boolean|number|Date|string}
   */
  function castScalar(val) {
    if (val === "" || val === "~" || val === "null") return null;
    if (BOOL_TRUE.test(val)) return true;
    if (BOOL_FALSE.test(val)) return false;
    if (INT_RE.test(val)) return Number(val);
    if (FLOAT_RE.test(val)) return parseFloat(val);
    if (DATE_RE.test(val)) return new Date(val);
    return val;
  }

  /**
   * Removes quotes from a string and unescapes characters.
   * @param {string} str - The string to unquote
   * @returns {string}
   */
  function unquote(str) {
    const q = str[0];
    if (q === '"') {
      return str
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\u([\da-fA-F]{4})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        );
    }
    if (q === "'") return str.slice(1, -1).replace(/''/g, "'");
    return str;
  }

  /**
   * Parses YAML text into a JavaScript object.
   * @param {string} text - The YAML text to parse
   * @returns {any}
   */
  function parse(text) {
    const raw = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
    const lines = raw
      .split("\n")
      .filter((l) => !/^---/.test(l) && !/^\.\.\./.test(l));
    const ctx = { lines, pos: 0 };
    return parseValue(ctx, 0);
  }

  /**
   * Gets the current line from the context.
   * @param {YamlContext} ctx - The parser context
   * @returns {string|null}
   */
  function currentLine(ctx) {
    while (ctx.pos < ctx.lines.length) {
      const l = ctx.lines[ctx.pos];
      if (/^\s*#/.test(l) || /^\s*$/.test(l)) {
        ctx.pos++;
        continue;
      }
      return l;
    }
    return null;
  }

  /**
   * Gets the indentation level of a line.
   * @param {string} line - The line to check
   * @returns {number}
   */
  function indentOf(line) {
    return line.match(/^(\s*)/)[1].length;
  }

  /**
   * Parses a value from the current position.
   * @param {YamlContext} ctx - The parser context
   * @param {number} baseIndent - The current indentation level
   * @returns {any}
   */
  function parseValue(ctx, baseIndent) {
    const line = currentLine(ctx);
    if (line === null) return null;
    const t = line.trimStart();
    if (t.startsWith("{")) return parseFlowMapping(ctx);
    if (t.startsWith("[")) return parseFlowSequence(ctx);
    if (t.startsWith("- ") || t === "-") return parseSequence(ctx);
    if (isMapping(line)) return parseMapping(ctx);
    ctx.pos++;
    return castScalar(t.replace(/#.*$/, "").trim());
  }

  /**
   * Checks if a line is a mapping key.
   * @param {string} line - The line to check
   * @returns {boolean}
   */
  function isMapping(line) {
    return /^(?:"[^"]*"|'[^']*'|[^:\[\{'"#\-][^:]*)?:(\s|$)/.test(
      line.trimStart(),
    );
  }

  /**
   * Find key: separator respecting quotes
   * @param {string} str - The string to search in
   * @returns {number} The index of the colon, or -1 if not found
   */
  function findColon(str) {
    let inS = false,
      inD = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      else if (c === ":" && !inS && !inD) {
        const n = str[i + 1];
        if (n === " " || n === "\t" || n === undefined) return i;
      }
    }
    return -1;
  }

  /**
   * Parses a block mapping.
   * @param {YamlContext} ctx - The parser context
   * @returns {Object}
   */
  function parseMapping(ctx) {
    const obj = Object.create(null);
    const startIndent = indentOf(ctx.lines[ctx.pos]);

    while (ctx.pos < ctx.lines.length) {
      const line = currentLine(ctx);
      if (line === null) break;
      const ind = indentOf(line);
      if (ind < startIndent) break;
      if (ind > startIndent) {
        ctx.pos++;
        continue;
      }

      const t = line.trimStart();
      const ci = findColon(t);
      if (ci === -1) break;

      const rawKey = t.slice(0, ci).trim();
      const key =
        rawKey[0] === '"' || rawKey[0] === "'" ? unquote(rawKey) : rawKey;
      const rest = t
        .slice(ci + 1)
        .trim()
        .replace(/#.*$/, "")
        .trim();

      ctx.pos++;

      if (rest === "|" || rest === ">") {
        obj[key] = parseBlockScalar(ctx, startIndent, rest === ">");
      } else if (rest !== "") {
        if (rest[0] === "{") {
          ctx.pos--;
          ctx.lines[ctx.pos] = " ".repeat(ind) + rest;
          obj[key] = parseFlowMapping(ctx);
        } else if (rest[0] === "[") {
          ctx.pos--;
          ctx.lines[ctx.pos] = " ".repeat(ind) + rest;
          obj[key] = parseFlowSequence(ctx);
        } else if (rest[0] === '"' || rest[0] === "'") obj[key] = unquote(rest);
        else obj[key] = castScalar(rest);
      } else {
        const next = currentLine(ctx);
        if (next && indentOf(next) > ind)
          obj[key] = parseValue(ctx, indentOf(next));
        else obj[key] = null;
      }
    }
    return obj;
  }

  /**
   * Parses a block sequence.
   * @param {YamlContext} ctx - The parser context
   * @returns {any[]}
   */
  function parseSequence(ctx) {
    const arr = [];
    const startIndent = indentOf(ctx.lines[ctx.pos]);

    while (ctx.pos < ctx.lines.length) {
      const line = currentLine(ctx);
      if (line === null) break;
      const ind = indentOf(line);
      if (ind < startIndent) break;
      const t = line.trimStart();
      if (!t.startsWith("- ") && t !== "-") break;

      ctx.pos++;
      const after = t.slice(1).trimStart().replace(/#.*$/, "").trim();

      if (after === "") {
        const next = currentLine(ctx);
        arr.push(
          next && indentOf(next) > ind ? parseValue(ctx, indentOf(next)) : null,
        );
      } else if (after[0] === "{") {
        ctx.pos--;
        ctx.lines[ctx.pos] = " ".repeat(ind + 2) + after;
        arr.push(parseFlowMapping(ctx));
      } else if (after[0] === "[") {
        ctx.pos--;
        ctx.lines[ctx.pos] = " ".repeat(ind + 2) + after;
        arr.push(parseFlowSequence(ctx));
      } else if (isMapping(" ".repeat(ind + 2) + after)) {
        ctx.pos--;
        ctx.lines[ctx.pos] = " ".repeat(ind + 2) + after;
        arr.push(parseMapping(ctx));
      } else {
        arr.push(castScalar(after));
      }
    }
    return arr;
  }

  /**
   * Parses a block scalar (| or >).
   * @param {YamlContext} ctx - The parser context
   * @param {number} ownerIndent - The parent's indentation level
   * @param {boolean} fold - Whether to fold newlines
   * @returns {string}
   */
  function parseBlockScalar(ctx, ownerIndent, fold) {
    const chunks = [];
    let blockIndent = -1;
    while (ctx.pos < ctx.lines.length) {
      const line = ctx.lines[ctx.pos];
      if (/^\s*$/.test(line)) {
        chunks.push("");
        ctx.pos++;
        continue;
      }
      const ind = indentOf(line);
      if (blockIndent === -1) blockIndent = ind;
      if (ind < blockIndent || ind <= ownerIndent) break;
      chunks.push(line.slice(blockIndent));
      ctx.pos++;
    }
    while (chunks.length && chunks[chunks.length - 1] === "") chunks.pop();
    return fold ? chunks.join(" ") + "\n" : chunks.join("\n") + "\n";
  }

  /**
   * Collects content of a flow-style structure until its delimiters match.
   * @param {YamlContext} ctx - The parser context
   * @returns {string}
   */
  function collectFlow(ctx) {
    let src = "",
      depth = 0;
    while (ctx.pos < ctx.lines.length) {
      const line = ctx.lines[ctx.pos].trimStart();
      for (const ch of line) {
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth--;
      }
      src += (src ? " " : "") + line.replace(/#[^'"]*$/, "").trim();
      ctx.pos++;
      if (depth === 0) break;
    }
    return src;
  }

  /**
   * Parses a flow mapping ({...}).
   * @param {YamlContext} ctx - The parser context
   * @returns {Object}
   */
  function parseFlowMapping(ctx) {
    return flowMapStr(collectFlow(ctx));
  }

  /**
   * Parses a flow sequence ([...]).
   * @param {YamlContext} ctx - The parser context
   * @returns {any[]}
   */
  function parseFlowSequence(ctx) {
    return flowSeqStr(collectFlow(ctx));
  }

  /**
   * Parses a flow mapping string.
   * @param {string} src - The string to parse
   * @returns {Object}
   */
  function flowMapStr(src) {
    src = src.trim();
    if (src[0] !== "{") return {};
    src = src.slice(1, src.lastIndexOf("}")).trim();
    const obj = Object.create(null);
    for (const pair of splitFlow(src)) {
      const ci = findColon(pair.trim());
      if (ci === -1) continue;
      const k = pair.trim().slice(0, ci).trim();
      const v = pair
        .trim()
        .slice(ci + 1)
        .trim();
      obj[k[0] === '"' || k[0] === "'" ? unquote(k) : k] = flowVal(v);
    }
    return obj;
  }

  /**
   * Parses a flow sequence string.
   * @param {string} src - The string to parse
   * @returns {any[]}
   */
  function flowSeqStr(src) {
    src = src.trim();
    if (src[0] !== "[") return [];
    src = src.slice(1, src.lastIndexOf("]")).trim();
    return splitFlow(src).map(flowVal);
  }

  /**
   * Parses a value from a flow-style string.
   * @param {string} v - The value string to parse
   * @returns {any}
   */
  function flowVal(v) {
    v = v.trim();
    if (!v) return null;
    if (v[0] === "{") return flowMapStr(v);
    if (v[0] === "[") return flowSeqStr(v);
    if (v[0] === '"' || v[0] === "'") return unquote(v);
    return castScalar(v);
  }

  /**
   * Splits a flow-style CSV string into its top-level elements.
   * @param {string} src - The source string
   * @returns {string[]}
   */
  function splitFlow(src) {
    const items = [];
    let depth = 0,
      inS = false,
      inD = false,
      start = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      else if (!inS && !inD) {
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        else if (c === "," && depth === 0) {
          items.push(src.slice(start, i).trim());
          start = i + 1;
        }
      }
    }
    const last = src.slice(start).trim();
    if (last) items.push(last);
    return items;
  }

  return { parse };
})();

if (typeof module !== "undefined") module.exports = YAML;
if (typeof window !== "undefined") window.YAML = YAML;
