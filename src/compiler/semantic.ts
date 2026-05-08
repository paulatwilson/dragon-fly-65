import { createDiagnostic } from "./diagnostics";
import { parseLovelace } from "./parser";
import { compilerError, compilerOk } from "./result";
import type {
  CompilerResult,
  LovelaceBinaryExpression,
  LovelaceCallExpression,
  LovelaceDiagnostic,
  LovelaceExpression,
  LovelaceForStatement,
  LovelaceFunctionDeclaration,
  LovelaceIdentifierExpression,
  LovelaceProgram,
  LovelaceScope,
  LovelaceSemanticModel,
  LovelaceSemanticOptions,
  LovelaceStatement,
  LovelaceStructType,
  LovelaceSymbol,
  LovelaceSymbolKind,
  LovelaceTopLevelNode,
  LovelaceTypeDeclaration,
  LovelaceTypeReference,
  LovelaceVariableDeclaration,
  SourceSpan,
} from "./types";

export const LOVELACE_BUILTINS = new Set([
  "halt",
  "len",
  "memory",
  "print",
]);

const PRIMITIVE_TYPES = new Set([
  "array",
  "bool",
  "byte",
  "char",
  "float",
  "float32",
  "int",
  "int8",
  "int16",
  "int32",
  "pointer",
  "string",
  "uint",
  "uint8",
  "uint16",
  "uint32",
]);

export function analyzeLovelace(
  source: string,
  options: LovelaceSemanticOptions = {},
): CompilerResult<LovelaceSemanticModel> {
  const parsed = parseLovelace(source, options);
  if (!parsed.ok) {
    return compilerError(parsed.diagnostics);
  }

  const analyzer = new LovelaceSemanticAnalyzer(parsed.value, options);
  return analyzer.analyze();
}

class LovelaceSemanticAnalyzer {
  private readonly diagnostics: LovelaceDiagnostic[] = [];
  private readonly scopes: LovelaceScope[] = [];
  private nextScopeId = 0;
  private currentFunction: LovelaceFunctionDeclaration | undefined;
  private loopDepth = 0;
  private switchDepth = 0;

  private readonly globalScope = this.createScope("global");

  public constructor(
    private readonly program: LovelaceProgram,
    private readonly options: LovelaceSemanticOptions,
  ) {}

  public analyze(): CompilerResult<LovelaceSemanticModel> {
    this.declareBuiltins();
    this.declareTopLevelSymbols();
    this.analyzeTopLevelNodes();

    if (this.diagnostics.length > 0) {
      return compilerError(this.diagnostics);
    }

    return compilerOk({
      program: this.program,
      globalScope: this.globalScope,
      scopes: this.scopes,
    });
  }

  private declareBuiltins(): void {
    for (const name of LOVELACE_BUILTINS) {
      this.declare(this.globalScope, {
        name,
        kind: "builtin",
        mutable: false,
        visibility: "public",
        span: this.program.span,
      });
    }
  }

  private declareTopLevelSymbols(): void {
    for (const node of this.program.body) {
      switch (node.kind) {
        case "ModuleDeclaration":
          this.declare(this.globalScope, {
            name: node.name,
            kind: "module",
            mutable: false,
            visibility: "public",
            span: node.span,
          });
          break;
        case "ImportDeclaration":
          this.declare(this.globalScope, {
            name: node.alias ?? lastModuleSegment(node.moduleName),
            kind: "import",
            mutable: false,
            visibility: "private",
            span: node.span,
          });
          break;
        case "FunctionDeclaration":
          this.declare(this.globalScope, {
            name: node.name,
            kind: "function",
            mutable: false,
            visibility: node.visibility,
            span: node.span,
          });
          break;
        case "TypeDeclaration":
          this.declare(this.globalScope, {
            name: node.name,
            kind: "type",
            mutable: false,
            visibility: node.visibility,
            span: node.span,
          });
          break;
        case "VariableDeclaration":
          this.declareVariableNames(this.globalScope, node, true);
          break;
        case "ExpressionStatement":
          break;
      }
    }
  }

  private analyzeTopLevelNodes(): void {
    for (const node of this.program.body) {
      switch (node.kind) {
        case "FunctionDeclaration":
          this.analyzeFunction(node);
          break;
        case "TypeDeclaration":
          this.analyzeTypeDeclaration(node);
          break;
        case "VariableDeclaration":
          this.analyzeVariableDeclaration(node, this.globalScope, true);
          break;
        case "ExpressionStatement":
          this.analyzeExpression(node.expression, this.globalScope);
          break;
        case "ModuleDeclaration":
        case "ImportDeclaration":
          break;
      }
    }
  }

  private analyzeFunction(node: LovelaceFunctionDeclaration): void {
    const previousFunction = this.currentFunction;
    this.currentFunction = node;
    const scope = this.createScope("function", this.globalScope);

    for (const parameter of node.parameters) {
      this.declare(scope, {
        name: parameter.name,
        kind: "parameter",
        mutable: false,
        visibility: "private",
        span: parameter.span,
      });
      this.analyzeTypeReference(parameter.type, scope);
      if (parameter.defaultValue !== undefined) {
        this.analyzeExpression(parameter.defaultValue, scope);
      }
    }

    if (node.returnType !== undefined) {
      this.analyzeTypeReference(node.returnType, scope);
    }

    this.analyzeStatements(node.body, scope);
    this.currentFunction = previousFunction;
  }

  private analyzeTypeDeclaration(node: LovelaceTypeDeclaration): void {
    const scope = this.createScope("type", this.globalScope);
    this.analyzeStructType(node.value, scope);
  }

  private analyzeStructType(node: LovelaceStructType, scope: LovelaceScope): void {
    for (const field of node.fields) {
      this.declare(scope, {
        name: field.name,
        kind: "field",
        mutable: false,
        visibility: "private",
        span: field.span,
      });
      this.analyzeTypeReference(field.type, scope);
    }
  }

  private analyzeStatements(statements: LovelaceStatement[], scope: LovelaceScope): void {
    for (const statement of statements) {
      this.analyzeStatement(statement, scope);
    }
  }

  private analyzeStatement(statement: LovelaceStatement, scope: LovelaceScope): void {
    switch (statement.kind) {
      case "VariableDeclaration":
        this.analyzeVariableDeclaration(statement, scope, false);
        break;
      case "ReturnStatement":
        if (this.currentFunction === undefined) {
          this.addDiagnostic("LACE3001", "'return' is only valid inside a function.", statement.span);
        }
        for (const value of statement.values) {
          this.analyzeExpression(value, scope);
        }
        break;
      case "IfStatement":
        this.analyzeExpression(statement.test, scope);
        this.analyzeStatements(statement.consequent, this.createScope("block", scope));
        this.analyzeStatements(statement.alternate, this.createScope("block", scope));
        break;
      case "WhileStatement":
        this.analyzeExpression(statement.test, scope);
        this.loopDepth += 1;
        this.analyzeStatements(statement.body, this.createScope("block", scope));
        this.loopDepth -= 1;
        break;
      case "ForStatement":
        this.analyzeForStatement(statement, scope);
        break;
      case "SwitchStatement":
        this.analyzeExpression(statement.discriminant, scope);
        this.switchDepth += 1;
        for (const switchCase of statement.cases) {
          this.analyzeExpression(switchCase.test, scope);
          this.analyzeStatements(switchCase.body, this.createScope("block", scope));
        }
        this.analyzeStatements(statement.defaultCase, this.createScope("block", scope));
        this.switchDepth -= 1;
        break;
      case "BreakStatement":
        if (this.loopDepth === 0 && this.switchDepth === 0) {
          this.addDiagnostic("LACE3002", "'break' is only valid inside a loop or switch.", statement.span);
        }
        break;
      case "ContinueStatement":
        if (this.loopDepth === 0) {
          this.addDiagnostic("LACE3003", "'continue' is only valid inside a loop.", statement.span);
        }
        break;
      case "UnsafeStatement":
      case "AsmStatement":
        break;
      case "ExpressionStatement":
        this.analyzeExpression(statement.expression, scope);
        break;
    }
  }

  private analyzeForStatement(statement: LovelaceForStatement, scope: LovelaceScope): void {
    const loopScope = this.createScope("block", scope);
    this.declare(loopScope, {
      name: statement.variable,
      kind: "loop",
      mutable: false,
      visibility: "private",
      span: statement.span,
    });
    if (statement.variableType !== undefined) {
      this.analyzeTypeReference(statement.variableType, loopScope);
    }
    if (statement.start !== undefined) {
      this.analyzeExpression(statement.start, scope);
    }
    if (statement.end !== undefined) {
      this.analyzeExpression(statement.end, scope);
    }
    if (statement.iterable !== undefined) {
      this.analyzeExpression(statement.iterable, scope);
    }

    this.loopDepth += 1;
    this.analyzeStatements(statement.body, loopScope);
    this.loopDepth -= 1;
  }

  private analyzeVariableDeclaration(
    node: LovelaceVariableDeclaration,
    scope: LovelaceScope,
    isTopLevel: boolean,
  ): void {
    if (isTopLevel && node.mutable) {
      this.addDiagnostic("LACE3004", "Global mutable variables are not permitted.", node.span);
    }
    if (!isTopLevel) {
      this.declareVariableNames(scope, node, isTopLevel);
    }
    if (node.type !== undefined) {
      this.analyzeTypeReference(node.type, scope);
    }
    if (node.initializer !== undefined) {
      this.analyzeExpression(node.initializer, scope);
    }
  }

  private declareVariableNames(
    scope: LovelaceScope,
    node: LovelaceVariableDeclaration,
    isTopLevel: boolean,
  ): void {
    for (const name of node.names) {
      this.declare(scope, {
        name,
        kind: node.mutable ? "var" : "const",
        mutable: node.mutable,
        visibility: isTopLevel ? "private" : "private",
        span: node.span,
      });
    }
  }

  private analyzeExpression(expression: LovelaceExpression, scope: LovelaceScope): void {
    switch (expression.kind) {
      case "Identifier":
        this.analyzeIdentifier(expression, scope);
        break;
      case "Literal":
        break;
      case "UnaryExpression":
        this.analyzeExpression(expression.argument, scope);
        break;
      case "BinaryExpression":
        this.analyzeBinaryExpression(expression, scope);
        break;
      case "CallExpression":
        this.analyzeCallExpression(expression, scope);
        break;
      case "MemberExpression":
        this.analyzeExpression(expression.object, scope);
        break;
      case "IndexExpression":
        this.analyzeExpression(expression.object, scope);
        this.analyzeExpression(expression.index, scope);
        break;
      case "CastExpression":
        this.analyzeTypeReference(expression.targetType, scope);
        this.analyzeExpression(expression.value, scope);
        break;
      case "StructLiteral":
        this.analyzeExpression(expression.typeName, scope);
        for (const field of expression.fields) {
          this.analyzeExpression(field.value, scope);
        }
        break;
    }
  }

  private analyzeBinaryExpression(
    expression: LovelaceBinaryExpression,
    scope: LovelaceScope,
  ): void {
    if (isAssignmentOperator(expression.operator)) {
      if (expression.left.kind === "Identifier") {
        const symbol = this.resolveIdentifier(scope, expression.left.name);
        if (symbol === undefined) {
          this.addDiagnostic("LACE3005", `Unknown symbol '${expression.left.name}'.`, expression.left.span);
        } else if (!symbol.mutable) {
          this.addDiagnostic("LACE3006", `Cannot assign to immutable '${expression.left.name}'.`, expression.left.span);
        }
      } else {
        this.analyzeExpression(expression.left, scope);
      }
      this.analyzeExpression(expression.right, scope);
      return;
    }

    this.analyzeExpression(expression.left, scope);
    this.analyzeExpression(expression.right, scope);
  }

  private analyzeCallExpression(expression: LovelaceCallExpression, scope: LovelaceScope): void {
    this.analyzeExpression(expression.callee, scope);
    for (const typeArgument of expression.typeArguments) {
      this.analyzeTypeReference(typeArgument, scope);
    }
    for (const argument of expression.arguments) {
      this.analyzeExpression(argument.value, scope);
    }
  }

  private analyzeIdentifier(expression: LovelaceIdentifierExpression, scope: LovelaceScope): void {
    if (this.resolveIdentifier(scope, expression.name) === undefined) {
      this.addDiagnostic("LACE3005", `Unknown symbol '${expression.name}'.`, expression.span);
    }
  }

  private analyzeTypeReference(type: LovelaceTypeReference, scope: LovelaceScope): void {
    if (!PRIMITIVE_TYPES.has(type.name) && isNaN(Number(type.name)) && this.resolve(scope, type.name) === undefined) {
      this.addDiagnostic("LACE3007", `Unknown type '${type.name}'.`, type.span);
    }
    for (const parameter of type.parameters) {
      this.analyzeTypeReference(parameter, scope);
    }
  }

  private declare(scope: LovelaceScope, symbol: LovelaceSymbol): void {
    if (symbol.name === "") {
      return;
    }
    const existing = scope.symbols.get(symbol.name);
    if (existing !== undefined) {
      this.addDiagnostic(
        "LACE3008",
        `Duplicate ${symbol.kind} '${symbol.name}'.`,
        symbol.span,
      );
      return;
    }
    scope.symbols.set(symbol.name, symbol);
  }

  private resolve(scope: LovelaceScope, name: string): LovelaceSymbol | undefined {
    let current: LovelaceScope | undefined = scope;
    while (current !== undefined) {
      const symbol = current.symbols.get(name);
      if (symbol !== undefined) {
        return symbol;
      }
      current = current.parent;
    }
    return undefined;
  }

  private resolveIdentifier(scope: LovelaceScope, name: string): LovelaceSymbol | undefined {
    return this.resolve(scope, name) ?? this.resolve(scope, name.split(".")[0] ?? name);
  }

  private createScope(kind: LovelaceScope["kind"], parent?: LovelaceScope): LovelaceScope {
    const scope: LovelaceScope = {
      id: this.nextScopeId,
      kind,
      symbols: new Map(),
      ...(parent === undefined ? {} : { parent }),
    };
    this.nextScopeId += 1;
    this.scopes.push(scope);
    return scope;
  }

  private addDiagnostic(code: string, message: string, span: SourceSpan): void {
    const sourcePath = this.options.sourcePath;
    this.diagnostics.push(
      createDiagnostic({
        code,
        message,
        severity: "error",
        stage: "semantic",
        span,
        ...(sourcePath === undefined ? {} : { sourcePath }),
      }),
    );
  }
}

function lastModuleSegment(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function isAssignmentOperator(operator: string): boolean {
  return operator === "=" || operator.endsWith("=");
}
