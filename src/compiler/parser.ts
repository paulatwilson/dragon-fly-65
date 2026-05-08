import { createDiagnostic } from "./diagnostics";
import { lexLovelace } from "./lexer";
import { compilerError, compilerOk } from "./result";
import type {
  CompilerResult,
  LovelaceArgument,
  LovelaceDiagnostic,
  LovelaceExpression,
  LovelaceExpressionStatement,
  LovelaceParseOptions,
  LovelaceParameter,
  LovelaceProgram,
  LovelaceStatement,
  LovelaceStructField,
  LovelaceStructLiteralField,
  LovelaceSwitchCase,
  LovelaceToken,
  LovelaceTopLevelNode,
  LovelaceTypeReference,
  LovelaceVariableDeclaration,
  SourceSpan,
} from "./types";

const BINARY_PRECEDENCE = new Map([
  ["=", 1],
  ["+=", 1],
  ["-=", 1],
  ["*=", 1],
  ["/=", 1],
  ["%=", 1],
  ["&=", 1],
  ["|=", 1],
  ["^=", 1],
  ["<<=", 1],
  [">>=", 1],
  ["or", 2],
  ["and", 3],
  ["==", 4],
  ["!=", 4],
  ["<", 5],
  [">", 5],
  ["<=", 5],
  [">=", 5],
  ["|", 6],
  ["^", 7],
  ["&", 8],
  ["<<", 9],
  [">>", 9],
  ["+", 10],
  ["-", 10],
  ["*", 11],
  ["/", 11],
  ["%", 11],
]);

const RIGHT_ASSOCIATIVE = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
]);

export function parseLovelace(
  source: string,
  options: LovelaceParseOptions = {},
): CompilerResult<LovelaceProgram> {
  const lexed = lexLovelace(source, options);
  if (!lexed.ok) {
    return compilerError(lexed.diagnostics);
  }

  const parser = new LovelaceParser(lexed.value, options);
  return parser.parseProgram();
}

class LovelaceParser {
  private index = 0;
  private readonly diagnostics: LovelaceDiagnostic[] = [];

  public constructor(
    private readonly tokens: LovelaceToken[],
    private readonly options: LovelaceParseOptions,
  ) {}

  public parseProgram(): CompilerResult<LovelaceProgram> {
    const start = this.current().span.start;
    const body: LovelaceTopLevelNode[] = [];

    this.skipNewlines();
    while (!this.isAtEnd()) {
      const node = this.parseTopLevelNode();
      if (node !== undefined) {
        body.push(node);
      }
      this.consumeStatementBoundary();
      this.skipNewlines();
    }

    const eof = this.current();
    const program: LovelaceProgram = {
      kind: "Program",
      body,
      span: { start, end: eof.span.end },
    };

    if (this.diagnostics.length > 0) {
      return compilerError(this.diagnostics);
    }

    return compilerOk(program);
  }

  private parseTopLevelNode(): LovelaceTopLevelNode | undefined {
    const visibility = this.matchKeyword("pub") ? "public" : "private";

    if (this.matchKeyword("module")) {
      return this.parseModuleDeclaration();
    }
    if (this.matchKeyword("import")) {
      return this.parseImportDeclaration();
    }
    if (this.matchKeyword("func")) {
      return this.parseFunctionDeclaration(visibility);
    }
    if (this.matchKeyword("type")) {
      return this.parseTypeDeclaration(visibility);
    }
    if (this.checkKeyword("const") || this.checkKeyword("var")) {
      return this.parseVariableDeclaration();
    }

    if (visibility === "public") {
      this.addDiagnostic("LACE2001", "Expected declaration after 'pub'.", this.previous().span);
      return undefined;
    }

    return this.parseExpressionStatement();
  }

  private parseModuleDeclaration(): LovelaceTopLevelNode {
    const start = this.previous();
    const name = this.consumeName("Expected module name.");
    return {
      kind: "ModuleDeclaration",
      name: name?.value ?? "",
      span: this.spanFrom(start.span, name?.span ?? start.span),
    };
  }

  private parseImportDeclaration(): LovelaceTopLevelNode {
    const start = this.previous();
    const moduleName = this.consumeName("Expected import module name.");
    let alias: string | undefined;
    if (this.matchValue(":")) {
      alias = this.consumeIdentifier("Expected import alias.")?.value;
    }

    return {
      kind: "ImportDeclaration",
      moduleName: moduleName?.value ?? "",
      ...(alias === undefined ? {} : { alias }),
      span: this.spanFrom(start.span, this.previous().span),
    };
  }

  private parseFunctionDeclaration(
    visibility: "public" | "private",
  ): LovelaceTopLevelNode {
    const start = this.previous();
    const name = this.consumeIdentifier("Expected function name.");
    this.consumeValue("(", "Expected '(' after function name.");
    const parameters = this.parseParameterList();
    this.consumeValue(")", "Expected ')' after function parameters.");

    const returnType = this.matchValue(":") ? this.parseTypeReference() : undefined;

    this.consumeStatementBoundary();
    const body = this.parseBlock(["end"]);
    const end = this.consumeKeyword("end", "Expected 'end' after function body.");

    return {
      kind: "FunctionDeclaration",
      name: name?.value ?? "",
      visibility,
      parameters,
      ...(returnType === undefined ? {} : { returnType }),
      body,
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseParameterList(): LovelaceParameter[] {
    const parameters: LovelaceParameter[] = [];
    if (this.checkValue(")")) {
      return parameters;
    }

    do {
      const start = this.current();
      const name = this.consumeIdentifier("Expected parameter name.");
      this.consumeValue(":", "Expected ':' after parameter name.");
      const type = this.parseTypeReference();
      const defaultValue = this.matchValue("=") ? this.parseExpression() : undefined;
      parameters.push({
        name: name?.value ?? "",
        type,
        ...(defaultValue === undefined ? {} : { defaultValue }),
        span: this.spanFrom(start.span, this.previous().span),
      });
    } while (this.matchValue(","));

    return parameters;
  }

  private parseTypeDeclaration(
    visibility: "public" | "private",
  ): LovelaceTopLevelNode {
    const start = this.previous();
    const name = this.consumeIdentifier("Expected type name.");
    this.consumeValue("=", "Expected '=' after type name.");
    this.consumeKeyword("struct", "Expected 'struct' type body.");
    const structStart = this.previous();
    this.consumeStatementBoundary();

    const fields: LovelaceStructField[] = [];
    this.skipNewlines();
    while (!this.checkKeyword("end") && !this.isAtEnd()) {
      const fieldStart = this.current();
      const fieldName = this.consumeIdentifier("Expected struct field name.");
      this.consumeValue(":", "Expected ':' after struct field name.");
      const type = this.parseTypeReference();
      fields.push({
        kind: "StructField",
        name: fieldName?.value ?? "",
        type,
        span: this.spanFrom(fieldStart.span, this.previous().span),
      });
      this.consumeStatementBoundary();
      this.skipNewlines();
    }

    const end = this.consumeKeyword("end", "Expected 'end' after struct type.");
    return {
      kind: "TypeDeclaration",
      name: name?.value ?? "",
      visibility,
      value: {
        kind: "StructType",
        fields,
        span: this.spanFrom(structStart.span, end?.span ?? this.previous().span),
      },
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseStatement(): LovelaceStatement | undefined {
    if (this.checkKeyword("const") || this.checkKeyword("var")) {
      return this.parseVariableDeclaration();
    }
    if (this.matchKeyword("return")) {
      return this.parseReturnStatement();
    }
    if (this.matchKeyword("if")) {
      return this.parseIfStatement();
    }
    if (this.matchKeyword("while")) {
      return this.parseWhileStatement();
    }
    if (this.matchKeyword("for")) {
      return this.parseForStatement();
    }
    if (this.matchKeyword("switch")) {
      return this.parseSwitchStatement();
    }
    if (this.matchKeyword("break")) {
      return { kind: "BreakStatement", span: this.previous().span };
    }
    if (this.matchKeyword("continue")) {
      return { kind: "ContinueStatement", span: this.previous().span };
    }
    if (this.matchKeyword("unsafe")) {
      return this.parseUnsafeStatement();
    }
    if (this.matchKeyword("asm")) {
      return this.parseAsmStatement();
    }
    return this.parseExpressionStatement();
  }

  private parseVariableDeclaration(): LovelaceVariableDeclaration {
    const start = this.current();
    const mutable = this.matchKeyword("var");
    if (!mutable) {
      this.consumeKeyword("const", "Expected 'const' or 'var'.");
    }

    const names = [this.consumeIdentifier("Expected binding name.")?.value ?? ""];
    while (this.matchValue(",")) {
      names.push(this.consumeIdentifier("Expected binding name.")?.value ?? "");
    }

    const type = this.matchValue(":") ? this.parseTypeReference() : undefined;
    const initializer = this.matchValue("=") ? this.parseExpression() : undefined;

    return {
      kind: "VariableDeclaration",
      mutable,
      names,
      ...(type === undefined ? {} : { type }),
      ...(initializer === undefined ? {} : { initializer }),
      span: this.spanFrom(start.span, this.previous().span),
    };
  }

  private parseReturnStatement(): LovelaceStatement {
    const start = this.previous();
    const values: LovelaceExpression[] = [];
    if (!this.isStatementBoundary()) {
      do {
        values.push(this.parseExpression());
      } while (this.matchValue(","));
    }
    return {
      kind: "ReturnStatement",
      values,
      span: this.spanFrom(start.span, this.previous().span),
    };
  }

  private parseIfStatement(): LovelaceStatement {
    const start = this.previous();
    const test = this.parseExpression();
    this.consumeKeyword("then", "Expected 'then' after if condition.");
    this.consumeStatementBoundary();

    const consequent = this.parseBlock(["else", "end"]);
    const alternate = this.matchKeyword("else") ? this.parseElseBlock() : [];
    const end = this.consumeKeyword("end", "Expected 'end' after if statement.");

    return {
      kind: "IfStatement",
      test,
      consequent,
      alternate,
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseElseBlock(): LovelaceStatement[] {
    this.consumeStatementBoundary();
    return this.parseBlock(["end"]);
  }

  private parseWhileStatement(): LovelaceStatement {
    const start = this.previous();
    const test = this.parseExpression();
    this.consumeStatementBoundary();
    const body = this.parseBlock(["end"]);
    const end = this.consumeKeyword("end", "Expected 'end' after while statement.");
    return {
      kind: "WhileStatement",
      test,
      body,
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseForStatement(): LovelaceStatement {
    const start = this.previous();
    const variable = this.consumeIdentifier("Expected loop variable.")?.value ?? "";
    const variableType = this.matchValue(":") ? this.parseTypeReference() : undefined;

    if (this.matchValue("=")) {
      const loopStart = this.parseExpression();
      this.consumeKeyword("to", "Expected 'to' in counting for loop.");
      const loopEnd = this.parseExpression();
      this.consumeStatementBoundary();
      const body = this.parseBlock(["end"]);
      const end = this.consumeKeyword("end", "Expected 'end' after for loop.");
      return {
        kind: "ForStatement",
        variable,
        ...(variableType === undefined ? {} : { variableType }),
        start: loopStart,
        end: loopEnd,
        body,
        span: this.spanFrom(start.span, end?.span ?? this.previous().span),
      };
    }

    this.consumeKeyword("in", "Expected '=' or 'in' in for loop.");
    const iterable = this.parseExpression();
    this.consumeStatementBoundary();
    const body = this.parseBlock(["end"]);
    const end = this.consumeKeyword("end", "Expected 'end' after for loop.");
    return {
      kind: "ForStatement",
      variable,
      ...(variableType === undefined ? {} : { variableType }),
      iterable,
      body,
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseSwitchStatement(): LovelaceStatement {
    const start = this.previous();
    const discriminant = this.parseExpression();
    this.consumeStatementBoundary();
    const cases: LovelaceSwitchCase[] = [];
    let defaultCase: LovelaceStatement[] = [];

    this.skipNewlines();
    while (!this.checkKeyword("end") && !this.isAtEnd()) {
      if (this.matchKeyword("case")) {
        const caseStart = this.previous();
        const test = this.parseExpression();
        this.consumeStatementBoundary();
        const body = this.parseBlock(["end"]);
        const endCase = this.consumeKeyword("end", "Expected 'end' after switch case.");
        cases.push({
          kind: "SwitchCase",
          test,
          body,
          span: this.spanFrom(caseStart.span, endCase?.span ?? this.previous().span),
        });
        this.consumeStatementBoundary();
        this.skipNewlines();
        continue;
      }

      if (this.matchKeyword("default")) {
        this.consumeStatementBoundary();
        defaultCase = this.parseBlock(["end"]);
        this.consumeKeyword("end", "Expected 'end' after switch default.");
        this.consumeStatementBoundary();
        this.skipNewlines();
        continue;
      }

      this.addDiagnostic("LACE2002", "Expected 'case', 'default', or 'end' in switch.", this.current().span);
      this.advance();
    }

    const end = this.consumeKeyword("end", "Expected 'end' after switch statement.");
    return {
      kind: "SwitchStatement",
      discriminant,
      cases,
      defaultCase,
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseUnsafeStatement(): LovelaceStatement {
    const start = this.previous();
    this.consumeValue("(", "Expected '(' after unsafe.");
    const enabled = this.matchKeyword("true");
    if (!enabled) {
      this.consumeKeyword("false", "Expected true or false in unsafe declaration.");
    }
    const end = this.consumeValue(")", "Expected ')' after unsafe declaration.");
    return {
      kind: "UnsafeStatement",
      enabled,
      span: this.spanFrom(start.span, end?.span ?? this.previous().span),
    };
  }

  private parseAsmStatement(): LovelaceStatement {
    const start = this.previous();
    this.consumeValue("{", "Expected '{' after asm.");
    let depth = 1;
    const parts: string[] = [];

    while (depth > 0 && !this.isAtEnd()) {
      if (this.matchValue("{")) {
        depth += 1;
        parts.push("{");
        continue;
      }
      if (this.matchValue("}")) {
        depth -= 1;
        if (depth > 0) {
          parts.push("}");
        }
        continue;
      }
      parts.push(this.advance().value);
    }

    if (depth > 0) {
      this.addDiagnostic("LACE2003", "Expected '}' after asm block.", start.span);
    }

    return {
      kind: "AsmStatement",
      body: parts.join(" ").trim(),
      span: this.spanFrom(start.span, this.previous().span),
    };
  }

  private parseExpressionStatement(): LovelaceExpressionStatement {
    const expression = this.parseExpression();
    return {
      kind: "ExpressionStatement",
      expression,
      span: expression.span,
    };
  }

  private parseBlock(stopKeywords: string[]): LovelaceStatement[] {
    const statements: LovelaceStatement[] = [];
    this.skipNewlines();
    while (!this.isAtEnd() && !this.isStopKeyword(stopKeywords)) {
      const statement = this.parseStatement();
      if (statement !== undefined) {
        statements.push(statement);
      }
      this.consumeStatementBoundary();
      this.skipNewlines();
    }
    return statements;
  }

  private parseExpression(minPrecedence = 0): LovelaceExpression {
    let expression = this.parseUnaryExpression();

    while (true) {
      const operator = this.current().value;
      const precedence = BINARY_PRECEDENCE.get(operator);
      if (precedence === undefined || precedence < minPrecedence) {
        break;
      }
      this.advance();
      const nextMin = RIGHT_ASSOCIATIVE.has(operator) ? precedence : precedence + 1;
      const right = this.parseExpression(nextMin);
      expression = {
        kind: "BinaryExpression",
        operator,
        left: expression,
        right,
        span: this.spanFrom(expression.span, right.span),
      };
    }

    return expression;
  }

  private parseUnaryExpression(): LovelaceExpression {
    if (this.matchKeyword("not") || this.matchValue("-") || this.matchValue("~") || this.matchValue("&")) {
      const start = this.previous();
      const operator = this.previous().value;
      const argument = this.parseUnaryExpression();
      return {
        kind: "UnaryExpression",
        operator,
        argument,
        span: this.spanFrom(start.span, argument.span),
      };
    }

    if (this.matchKeyword("cast")) {
      const start = this.previous();
      this.consumeValue("<", "Expected '<' after cast.");
      const targetType = this.parseTypeReference();
      this.consumeValue(">", "Expected '>' after cast type.");
      this.consumeValue("(", "Expected '(' after cast type.");
      const value = this.parseExpression();
      const end = this.consumeValue(")", "Expected ')' after cast value.");
      return {
        kind: "CastExpression",
        targetType,
        value,
        span: this.spanFrom(start.span, end?.span ?? value.span),
      };
    }

    return this.parsePostfixExpression();
  }

  private parsePostfixExpression(): LovelaceExpression {
    let expression = this.parsePrimaryExpression();

    while (true) {
      if (this.checkValue("<") && this.looksLikeGenericCall()) {
        const typeArguments = this.parseTypeArgumentList();
        const call = this.parseCallExpression(expression, typeArguments);
        expression = call;
        continue;
      }

      if (this.checkValue("(")) {
        expression = this.parseCallExpression(expression, []);
        continue;
      }

      if (this.matchValue(".")) {
        const property = this.consumeIdentifier("Expected property name after '.'.");
        expression = {
          kind: "MemberExpression",
          object: expression,
          property: property?.value ?? "",
          span: this.spanFrom(expression.span, property?.span ?? this.previous().span),
        };
        continue;
      }

      if (this.matchValue("[")) {
        const index = this.parseExpression();
        const end = this.consumeValue("]", "Expected ']' after index expression.");
        expression = {
          kind: "IndexExpression",
          object: expression,
          index,
          span: this.spanFrom(expression.span, end?.span ?? index.span),
        };
        continue;
      }

      if (this.checkValue("{")) {
        expression = this.parseStructLiteral(expression);
        continue;
      }

      break;
    }

    return expression;
  }

  private parseCallExpression(
    callee: LovelaceExpression,
    typeArguments: LovelaceTypeReference[],
  ): LovelaceExpression {
    this.consumeValue("(", "Expected '(' in call expression.");
    const args: LovelaceArgument[] = [];
    if (!this.checkValue(")")) {
      do {
        const start = this.current();
        let name: string | undefined;
        if (this.current().kind === "identifier" && this.peek().value === ":") {
          name = this.advance().value;
          this.consumeValue(":", "Expected ':' after argument name.");
        }
        const value = this.parseExpression();
        args.push({
          ...(name === undefined ? {} : { name }),
          value,
          span: this.spanFrom(start.span, value.span),
        });
      } while (this.matchValue(","));
    }
    const end = this.consumeValue(")", "Expected ')' after call arguments.");
    return {
      kind: "CallExpression",
      callee,
      typeArguments,
      arguments: args,
      span: this.spanFrom(callee.span, end?.span ?? this.previous().span),
    };
  }

  private parseStructLiteral(typeName: LovelaceExpression): LovelaceExpression {
    this.consumeValue("{", "Expected '{' in struct literal.");
    const fields: LovelaceStructLiteralField[] = [];
    if (!this.checkValue("}")) {
      do {
        const start = this.current();
        const name = this.consumeIdentifier("Expected struct literal field name.");
        this.consumeValue(":", "Expected ':' after struct literal field name.");
        const value = this.parseExpression();
        fields.push({
          name: name?.value ?? "",
          value,
          span: this.spanFrom(start.span, value.span),
        });
      } while (this.matchValue(","));
    }
    const end = this.consumeValue("}", "Expected '}' after struct literal.");
    return {
      kind: "StructLiteral",
      typeName,
      fields,
      span: this.spanFrom(typeName.span, end?.span ?? this.previous().span),
    };
  }

  private parsePrimaryExpression(): LovelaceExpression {
    if (this.matchKind("number")) {
      const token = this.previous();
      return {
        kind: "Literal",
        literalKind: "number",
        value: token.value,
        span: token.span,
      };
    }

    if (this.matchKind("string")) {
      const token = this.previous();
      return {
        kind: "Literal",
        literalKind: "string",
        value: token.value,
        span: token.span,
      };
    }

    if (this.matchKeyword("true") || this.matchKeyword("false")) {
      const token = this.previous();
      return {
        kind: "Literal",
        literalKind: "boolean",
        value: token.value,
        span: token.span,
      };
    }

    if (this.matchKeyword("null")) {
      const token = this.previous();
      return {
        kind: "Literal",
        literalKind: "null",
        value: token.value,
        span: token.span,
      };
    }

    if (this.matchKind("identifier")) {
      const token = this.previous();
      return {
        kind: "Identifier",
        name: token.value,
        span: token.span,
      };
    }

    if (this.matchValue("(")) {
      const expression = this.parseExpression();
      this.consumeValue(")", "Expected ')' after expression.");
      return expression;
    }

    const token = this.current();
    this.addDiagnostic("LACE2004", `Expected expression, found '${token.value}'.`, token.span);
    this.advance();
    return {
      kind: "Identifier",
      name: "",
      span: token.span,
    };
  }

  private parseTypeReference(): LovelaceTypeReference {
    const start = this.current();
    const name = this.consumeTypeName("Expected type name.");
    const parameters: LovelaceTypeReference[] = [];

    if (this.matchValue("<")) {
      if (!this.checkValue(">")) {
        do {
          parameters.push(this.parseTypeReference());
        } while (this.matchValue(","));
      }
      this.consumeValue(">", "Expected '>' after type parameters.");
    }

    return {
      kind: "TypeReference",
      name: name?.value ?? "",
      parameters,
      span: this.spanFrom(start.span, this.previous().span),
    };
  }

  private parseTypeArgumentList(): LovelaceTypeReference[] {
    this.consumeValue("<", "Expected '<' before type arguments.");
    const typeArguments: LovelaceTypeReference[] = [];
    if (!this.checkValue(">")) {
      do {
        typeArguments.push(this.parseTypeReference());
      } while (this.matchValue(","));
    }
    this.consumeValue(">", "Expected '>' after type arguments.");
    return typeArguments;
  }

  private looksLikeGenericCall(): boolean {
    let depth = 0;
    for (let offset = 0; this.index + offset < this.tokens.length; offset += 1) {
      const token = this.tokens[this.index + offset];
      if (token === undefined) {
        return false;
      }
      if (token.value === "<") {
        depth += 1;
      } else if (token.value === ">") {
        depth -= 1;
        if (depth === 0) {
          return this.tokens[this.index + offset + 1]?.value === "(";
        }
      } else if (token.kind === "newline" || token.kind === "eof") {
        return false;
      }
    }
    return false;
  }

  private consumeStatementBoundary(): void {
    if (this.isAtEnd() || this.matchKind("newline")) {
      this.skipNewlines();
      return;
    }
    if (this.checkKeyword("end") || this.checkKeyword("else") || this.checkKeyword("case") || this.checkKeyword("default")) {
      return;
    }
    this.addDiagnostic("LACE2005", "Expected end of statement.", this.current().span);
    while (!this.isAtEnd() && !this.isStatementBoundary()) {
      this.advance();
    }
    this.skipNewlines();
  }

  private isStatementBoundary(): boolean {
    return this.current().kind === "newline" || this.current().kind === "eof";
  }

  private skipNewlines(): void {
    while (this.matchKind("newline")) {}
  }

  private isStopKeyword(values: string[]): boolean {
    return this.current().kind === "keyword" && values.includes(this.current().value);
  }

  private consumeIdentifier(message: string): LovelaceToken | undefined {
    if (this.current().kind === "identifier") {
      return this.advance();
    }
    this.addDiagnostic("LACE2006", message, this.current().span);
    return undefined;
  }

  private consumeName(message: string): LovelaceToken | undefined {
    if (this.current().kind === "identifier" || this.current().kind === "keyword") {
      return this.advance();
    }
    this.addDiagnostic("LACE2007", message, this.current().span);
    return undefined;
  }

  private consumeTypeName(message: string): LovelaceToken | undefined {
    if (
      this.current().kind === "identifier" ||
      this.current().kind === "keyword" ||
      this.current().kind === "number"
    ) {
      return this.advance();
    }
    this.addDiagnostic("LACE2010", message, this.current().span);
    return undefined;
  }

  private consumeKeyword(value: string, message: string): LovelaceToken | undefined {
    if (this.matchKeyword(value)) {
      return this.previous();
    }
    this.addDiagnostic("LACE2008", message, this.current().span);
    return undefined;
  }

  private consumeValue(value: string, message: string): LovelaceToken | undefined {
    if (this.matchValue(value)) {
      return this.previous();
    }
    this.addDiagnostic("LACE2009", message, this.current().span);
    return undefined;
  }

  private matchKeyword(value: string): boolean {
    if (this.checkKeyword(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchKind(kind: LovelaceToken["kind"]): boolean {
    if (this.current().kind === kind) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchValue(value: string): boolean {
    if (this.checkValue(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkKeyword(value: string): boolean {
    return this.current().kind === "keyword" && this.current().value === value;
  }

  private checkValue(value: string): boolean {
    return this.current().value === value;
  }

  private addDiagnostic(code: string, message: string, span: SourceSpan): void {
    const sourcePath = this.options.sourcePath;
    this.diagnostics.push(
      createDiagnostic({
        code,
        message,
        severity: "error",
        stage: "parser",
        span,
        ...(sourcePath === undefined ? {} : { sourcePath }),
      }),
    );
  }

  private spanFrom(start: SourceSpan, end: SourceSpan): SourceSpan {
    return { start: start.start, end: end.end };
  }

  private current(): LovelaceToken {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): LovelaceToken {
    return this.tokens[this.index - 1] ?? this.current();
  }

  private peek(): LovelaceToken {
    return this.tokens[this.index + 1] ?? this.current();
  }

  private advance(): LovelaceToken {
    const token = this.current();
    if (!this.isAtEnd()) {
      this.index += 1;
    }
    return token;
  }

  private isAtEnd(): boolean {
    return this.current().kind === "eof";
  }
}
