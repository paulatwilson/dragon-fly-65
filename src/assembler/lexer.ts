import type { AssemblerError } from "./types";

export type TokenKind =
  | "number"
  | "identifier"
  | "string"
  | "hash"
  | "comma"
  | "colon"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "dot"
  | "lt"
  | "gt"
  | "bang"
  | "caret"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "newline"
  | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

export function tokenize(source: string, errors: AssemblerError[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;

  // Use charAt() throughout so we never get undefined from indexed access
  const ch = () => source.charAt(i);

  while (i < source.length) {
    const c = ch();

    // skip whitespace (not newlines)
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }

    // newline
    if (c === "\n") {
      tokens.push({ kind: "newline", value: "\n", line });
      line++;
      i++;
      continue;
    }

    // comment — ; to end of line
    if (c === ";") {
      while (i < source.length && ch() !== "\n") i++;
      continue;
    }

    // string literal
    if (c === '"' || c === "'") {
      const quote = c;
      const start = line;
      i++;
      let value = "";
      while (i < source.length && ch() !== quote) {
        if (ch() === "\\") {
          i++;
          const esc = ch();
          switch (esc) {
            case "n":  value += "\n"; break;
            case "r":  value += "\r"; break;
            case "t":  value += "\t"; break;
            case "0":  value += "\0"; break;
            default:   value += esc; break;
          }
        } else {
          value += ch();
        }
        i++;
      }
      if (i >= source.length) {
        errors.push({ line: start, message: "unterminated string literal" });
      } else {
        i++; // closing quote
      }
      tokens.push({ kind: "string", value, line: start });
      continue;
    }

    // hex number: $xxxx
    if (c === "$") {
      i++;
      let hex = "";
      while (i < source.length && /[0-9a-fA-F]/.test(ch())) hex += source.charAt(i++);
      if (hex.length === 0) {
        errors.push({ line, message: "expected hex digits after $" });
        continue;
      }
      tokens.push({ kind: "number", value: String(parseInt(hex, 16)), line });
      continue;
    }

    // binary number: %bbbbbbbb
    if (c === "%") {
      i++;
      let bin = "";
      while (i < source.length && (ch() === "0" || ch() === "1")) bin += source.charAt(i++);
      if (bin.length === 0) {
        errors.push({ line, message: "expected binary digits after %" });
        continue;
      }
      tokens.push({ kind: "number", value: String(parseInt(bin, 2)), line });
      continue;
    }

    // decimal or hex (0x) number
    if (/[0-9]/.test(c)) {
      if (c === "0" && i + 1 < source.length && (source.charAt(i + 1) === "x" || source.charAt(i + 1) === "X")) {
        i += 2;
        let hex = "";
        while (i < source.length && /[0-9a-fA-F]/.test(ch())) hex += source.charAt(i++);
        tokens.push({ kind: "number", value: String(parseInt(hex, 16)), line });
      } else {
        let dec = "";
        while (i < source.length && /[0-9]/.test(ch())) dec += source.charAt(i++);
        tokens.push({ kind: "number", value: dec, line });
      }
      continue;
    }

    // identifier or keyword
    if (/[a-zA-Z_]/.test(c)) {
      let id = "";
      while (i < source.length && /[a-zA-Z0-9_]/.test(ch())) id += source.charAt(i++);
      tokens.push({ kind: "identifier", value: id.toLowerCase(), line });
      continue;
    }

    // single-character tokens
    const singleMap: Record<string, TokenKind> = {
      "#": "hash",
      ",": "comma",
      ":": "colon",
      "(": "lparen",
      ")": "rparen",
      "[": "lbracket",
      "]": "rbracket",
      ".": "dot",
      "<": "lt",
      ">": "gt",
      "!": "bang",
      "^": "caret",
      "+": "plus",
      "-": "minus",
      "*": "star",
      "/": "slash",
    };

    const kind = singleMap[c];
    if (kind !== undefined) {
      tokens.push({ kind, value: c, line });
      i++;
      continue;
    }

    errors.push({ line, message: `unexpected character: ${c}` });
    i++;
  }

  tokens.push({ kind: "eof", value: "", line });
  return tokens;
}
