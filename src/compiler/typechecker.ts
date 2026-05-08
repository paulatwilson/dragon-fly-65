import { createDiagnostic } from "./diagnostics";
import { analyzeLovelace } from "./semantic";
import { compilerError, compilerOk } from "./result";
import type {
  CompilerResult,
  LovelaceArgument,
  LovelaceBinaryExpression,
  LovelaceCallExpression,
  LovelaceCastExpression,
  LovelaceCheckedType,
  LovelaceDiagnostic,
  LovelaceExpression,
  LovelaceForStatement,
  LovelaceFunctionDeclaration,
  LovelaceFunctionType,
  LovelaceIdentifierExpression,
  LovelaceLiteralExpression,
  LovelaceProgram,
  LovelaceSemanticModel,
  LovelaceStatement,
  LovelaceStructLiteralExpression,
  LovelaceSwitchCase,
  LovelaceTypeCheckModel,
  LovelaceTypeCheckOptions,
  LovelaceTypeDeclaration,
  LovelaceTypeReference,
  LovelaceUnaryExpression,
  LovelaceVariableDeclaration,
  SourceSpan,
} from "./types";

const UNKNOWN: LovelaceCheckedType = {
  kind: "unknown",
  name: "unknown",
  parameters: [],
};
const VOID = primitive("void");
const INT = primitive("int");
const UINT = primitive("uint");
const FLOAT = primitive("float32");
const BOOL = primitive("bool");
const STRING = primitive("string");
const CHAR = primitive("char");
const BYTE = primitive("byte");
const ERROR = structType("Error");

const INTEGER_TYPES = new Set([
  "byte",
  "char",
  "int",
  "int8",
  "int16",
  "int32",
  "uint",
  "uint8",
  "uint16",
  "uint32",
]);

const BUILTIN_FUNCTIONS = new Map<string, LovelaceFunctionType>([
  ["print", functionType("print", [UNKNOWN], VOID)],
  ["halt", functionType("halt", [], VOID)],
  ["len", functionType("len", [UNKNOWN], INT)],
  ["Error", functionType("Error", [INT, STRING], ERROR)],
]);

export function checkLovelaceTypes(
  source: string,
  options: LovelaceTypeCheckOptions = {},
): CompilerResult<LovelaceTypeCheckModel> {
  const analyzed = analyzeLovelace(source, options);
  if (!analyzed.ok) {
    return compilerError(analyzed.diagnostics);
  }

  const checker = new LovelaceTypeChecker(analyzed.value, options);
  return checker.check();
}

class TypeScope {
  private readonly values = new Map<string, LovelaceCheckedType>();

  public constructor(private readonly parent?: TypeScope) {}

  public define(name: string, type: LovelaceCheckedType): void {
    if (name !== "") {
      this.values.set(name, type);
    }
  }

  public resolve(name: string): LovelaceCheckedType | undefined {
    return this.values.get(name) ?? this.parent?.resolve(name);
  }
}

class LovelaceTypeChecker {
  private readonly diagnostics: LovelaceDiagnostic[] = [];
  private readonly expressionTypes = new Map<LovelaceExpression, LovelaceCheckedType>();
  private readonly globalValues = new Map<string, LovelaceCheckedType>();
  private readonly functions = new Map<string, LovelaceFunctionType>(BUILTIN_FUNCTIONS);
  private readonly structs = new Map<string, LovelaceTypeDeclaration>();
  private currentFunction: LovelaceFunctionDeclaration | undefined;
  private currentReturnType: LovelaceCheckedType = VOID;

  public constructor(
    private readonly semanticModel: LovelaceSemanticModel,
    private readonly options: LovelaceTypeCheckOptions,
  ) {}

  public check(): CompilerResult<LovelaceTypeCheckModel> {
    this.predeclare(this.semanticModel.program);
    this.checkProgram(this.semanticModel.program);

    if (this.diagnostics.length > 0) {
      return compilerError(this.diagnostics);
    }

    return compilerOk({
      semanticModel: this.semanticModel,
      expressionTypes: this.expressionTypes,
      globalValues: this.globalValues,
      functions: this.functions,
    });
  }

  private predeclare(program: LovelaceProgram): void {
    for (const node of program.body) {
      if (node.kind === "TypeDeclaration") {
        this.structs.set(node.name, node);
      }
    }

    for (const node of program.body) {
      if (node.kind === "FunctionDeclaration") {
        this.functions.set(node.name, this.functionTypeFromDeclaration(node));
      }
    }
  }

  private checkProgram(program: LovelaceProgram): void {
    const globalScope = new TypeScope();
    for (const [name, fn] of this.functions) {
      globalScope.define(name, fn.returnType);
    }
    globalScope.define("memory", UNKNOWN);

    for (const node of program.body) {
      switch (node.kind) {
        case "ImportDeclaration":
          globalScope.define(node.alias ?? lastModuleSegment(node.moduleName), UNKNOWN);
          break;
        case "VariableDeclaration":
          this.checkVariableDeclaration(node, globalScope, true);
          break;
        case "FunctionDeclaration":
          this.checkFunction(node, globalScope);
          break;
        case "ExpressionStatement":
          this.inferExpression(node.expression, globalScope);
          break;
        case "TypeDeclaration":
        case "ModuleDeclaration":
          break;
      }
    }
  }

  private checkFunction(node: LovelaceFunctionDeclaration, parent: TypeScope): void {
    const previousFunction = this.currentFunction;
    const previousReturnType = this.currentReturnType;
    this.currentFunction = node;
    this.currentReturnType = node.returnType === undefined ? VOID : this.resolveType(node.returnType);
    const scope = new TypeScope(parent);

    for (const parameter of node.parameters) {
      const type = this.resolveType(parameter.type);
      scope.define(parameter.name, type);
      if (parameter.defaultValue !== undefined) {
        const defaultType = this.inferExpression(parameter.defaultValue, scope);
        this.expectAssignable(type, defaultType, parameter.defaultValue.span);
      }
    }

    this.checkStatements(node.body, scope);
    this.currentFunction = previousFunction;
    this.currentReturnType = previousReturnType;
  }

  private checkStatements(statements: LovelaceStatement[], scope: TypeScope): void {
    for (const statement of statements) {
      this.checkStatement(statement, scope);
    }
  }

  private checkStatement(statement: LovelaceStatement, scope: TypeScope): void {
    switch (statement.kind) {
      case "VariableDeclaration":
        this.checkVariableDeclaration(statement, scope, false);
        break;
      case "ReturnStatement":
        if (statement.values.length === 0) {
          this.expectAssignable(this.currentReturnType, VOID, statement.span);
        } else {
          this.expectAssignable(
            this.currentReturnType,
            this.inferExpression(statement.values[0]!, scope),
            statement.values[0]!.span,
          );
        }
        break;
      case "IfStatement":
        this.expectBool(this.inferExpression(statement.test, scope), statement.test.span);
        this.checkStatements(statement.consequent, new TypeScope(scope));
        this.checkStatements(statement.alternate, new TypeScope(scope));
        break;
      case "WhileStatement":
        this.expectBool(this.inferExpression(statement.test, scope), statement.test.span);
        this.checkStatements(statement.body, new TypeScope(scope));
        break;
      case "ForStatement":
        this.checkForStatement(statement, scope);
        break;
      case "SwitchStatement": {
        const discriminant = this.inferExpression(statement.discriminant, scope);
        for (const switchCase of statement.cases) {
          this.checkSwitchCase(switchCase, discriminant, scope);
        }
        this.checkStatements(statement.defaultCase, new TypeScope(scope));
        break;
      }
      case "ExpressionStatement":
        this.inferExpression(statement.expression, scope);
        break;
      case "AsmStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "UnsafeStatement":
        break;
    }
  }

  private checkForStatement(statement: LovelaceForStatement, scope: TypeScope): void {
    const child = new TypeScope(scope);
    const loopType = statement.variableType === undefined
      ? INT
      : this.resolveType(statement.variableType);
    child.define(statement.variable, loopType);

    if (statement.start !== undefined) {
      this.expectAssignable(loopType, this.inferExpression(statement.start, scope), statement.start.span);
    }
    if (statement.end !== undefined) {
      this.expectAssignable(loopType, this.inferExpression(statement.end, scope), statement.end.span);
    }
    if (statement.iterable !== undefined) {
      this.inferExpression(statement.iterable, scope);
    }

    this.checkStatements(statement.body, child);
  }

  private checkSwitchCase(
    switchCase: LovelaceSwitchCase,
    discriminant: LovelaceCheckedType,
    scope: TypeScope,
  ): void {
    const test = this.inferExpression(switchCase.test, scope);
    this.expectComparable(discriminant, test, switchCase.test.span);
    this.checkStatements(switchCase.body, new TypeScope(scope));
  }

  private checkVariableDeclaration(
    node: LovelaceVariableDeclaration,
    scope: TypeScope,
    isGlobal: boolean,
  ): void {
    const explicitType = node.type === undefined ? undefined : this.resolveType(node.type);
    const initializerType = node.initializer === undefined
      ? undefined
      : this.inferExpression(node.initializer, scope);

    if (explicitType !== undefined && initializerType !== undefined) {
      this.expectAssignable(explicitType, initializerType, node.initializer?.span ?? node.span);
    }

    for (const [index, name] of node.names.entries()) {
      const inferred = this.inferBindingType(index, explicitType, initializerType, node);
      scope.define(name, inferred);
      if (isGlobal) {
        this.globalValues.set(name, inferred);
      }
    }
  }

  private inferBindingType(
    index: number,
    explicitType: LovelaceCheckedType | undefined,
    initializerType: LovelaceCheckedType | undefined,
    node: LovelaceVariableDeclaration,
  ): LovelaceCheckedType {
    if (explicitType !== undefined) {
      return explicitType;
    }
    if (node.names.length > 1 && node.initializer?.kind === "CallExpression") {
      return index === 0 ? initializerType ?? UNKNOWN : ERROR;
    }
    if (initializerType !== undefined) {
      return initializerType;
    }
    this.addDiagnostic("LACE4001", `Cannot infer type for '${node.names[index] ?? ""}'.`, node.span);
    return UNKNOWN;
  }

  private inferExpression(expression: LovelaceExpression, scope: TypeScope): LovelaceCheckedType {
    const type = this.inferExpressionInner(expression, scope);
    this.expressionTypes.set(expression, type);
    return type;
  }

  private inferExpressionInner(expression: LovelaceExpression, scope: TypeScope): LovelaceCheckedType {
    switch (expression.kind) {
      case "Literal":
        return this.inferLiteral(expression);
      case "Identifier":
        return this.inferIdentifier(expression, scope);
      case "UnaryExpression":
        return this.inferUnary(expression, scope);
      case "BinaryExpression":
        return this.inferBinary(expression, scope);
      case "CallExpression":
        return this.inferCall(expression, scope);
      case "MemberExpression":
        return UNKNOWN;
      case "IndexExpression": {
        const object = this.inferExpression(expression.object, scope);
        this.expectAssignable(INT, this.inferExpression(expression.index, scope), expression.index.span);
        if (object.kind === "array" || object.kind === "pointer") {
          return object.parameters[0] ?? UNKNOWN;
        }
        if (sameType(object, STRING)) {
          return CHAR;
        }
        return UNKNOWN;
      }
      case "CastExpression":
        return this.inferCast(expression, scope);
      case "StructLiteral":
        return this.inferStructLiteral(expression, scope);
    }
  }

  private inferLiteral(expression: LovelaceLiteralExpression): LovelaceCheckedType {
    switch (expression.literalKind) {
      case "boolean":
        return BOOL;
      case "null":
        return UNKNOWN;
      case "number":
        return inferNumberType(expression.value);
      case "string":
        return STRING;
    }
  }

  private inferIdentifier(
    expression: LovelaceIdentifierExpression,
    scope: TypeScope,
  ): LovelaceCheckedType {
    return scope.resolve(expression.name)
      ?? scope.resolve(expression.name.split(".")[0] ?? expression.name)
      ?? UNKNOWN;
  }

  private inferUnary(expression: LovelaceUnaryExpression, scope: TypeScope): LovelaceCheckedType {
    const argument = this.inferExpression(expression.argument, scope);
    if (expression.operator === "not") {
      this.expectBool(argument, expression.argument.span);
      return BOOL;
    }
    if (expression.operator === "&") {
      return { kind: "pointer", name: "pointer", parameters: [argument] };
    }
    if (expression.operator === "-" || expression.operator === "~") {
      this.expectNumeric(argument, expression.argument.span);
      return argument;
    }
    return UNKNOWN;
  }

  private inferBinary(expression: LovelaceBinaryExpression, scope: TypeScope): LovelaceCheckedType {
    const left = this.inferExpression(expression.left, scope);
    const right = this.inferExpression(expression.right, scope);

    if (isAssignmentOperator(expression.operator)) {
      this.expectAssignable(left, right, expression.right.span);
      return left;
    }

    if (isComparisonOperator(expression.operator)) {
      this.expectComparable(left, right, expression.right.span);
      return BOOL;
    }

    if (expression.operator === "and" || expression.operator === "or") {
      this.expectBool(left, expression.left.span);
      this.expectBool(right, expression.right.span);
      return BOOL;
    }

    if (isNumericOperator(expression.operator)) {
      this.expectNumeric(left, expression.left.span);
      this.expectNumeric(right, expression.right.span);
      return widenNumeric(left, right);
    }

    return UNKNOWN;
  }

  private inferCall(expression: LovelaceCallExpression, scope: TypeScope): LovelaceCheckedType {
    const functionName = callName(expression);
    const fn = functionName === undefined ? undefined : this.functions.get(functionName);

    if (fn === undefined) {
      for (const argument of expression.arguments) {
        this.inferExpression(argument.value, scope);
      }
      return UNKNOWN;
    }

    this.checkCallArguments(expression.arguments, fn, scope, expression.span);
    return fn.returnType;
  }

  private checkCallArguments(
    args: LovelaceArgument[],
    fn: LovelaceFunctionType,
    scope: TypeScope,
    span: SourceSpan,
  ): void {
    if (fn.parameters.length > 0 && fn.parameters[0] !== UNKNOWN && args.length > fn.parameters.length) {
      this.addDiagnostic("LACE4002", `Too many arguments for '${fn.name}'.`, span);
    }
    for (const [index, argument] of args.entries()) {
      const valueType = this.inferExpression(argument.value, scope);
      const expected = fn.parameters[index] ?? UNKNOWN;
      if (expected !== UNKNOWN) {
        this.expectAssignable(expected, valueType, argument.value.span);
      }
    }
  }

  private inferCast(expression: LovelaceCastExpression, scope: TypeScope): LovelaceCheckedType {
    this.inferExpression(expression.value, scope);
    return this.resolveType(expression.targetType);
  }

  private inferStructLiteral(
    expression: LovelaceStructLiteralExpression,
    scope: TypeScope,
  ): LovelaceCheckedType {
    if (expression.typeName.kind !== "Identifier") {
      return UNKNOWN;
    }
    const declaration = this.structs.get(expression.typeName.name);
    if (declaration === undefined) {
      return UNKNOWN;
    }
    const fieldTypes = new Map(
      declaration.value.fields.map(field => [field.name, this.resolveType(field.type)]),
    );
    for (const field of expression.fields) {
      const expected = fieldTypes.get(field.name);
      const actual = this.inferExpression(field.value, scope);
      if (expected === undefined) {
        this.addDiagnostic("LACE4003", `Unknown field '${field.name}' on '${expression.typeName.name}'.`, field.span);
      } else {
        this.expectAssignable(expected, actual, field.value.span);
      }
    }
    return structType(expression.typeName.name);
  }

  private functionTypeFromDeclaration(node: LovelaceFunctionDeclaration): LovelaceFunctionType {
    return functionType(
      node.name,
      node.parameters.map(parameter => this.resolveType(parameter.type)),
      node.returnType === undefined ? VOID : this.resolveType(node.returnType),
    );
  }

  private resolveType(type: LovelaceTypeReference): LovelaceCheckedType {
    if (type.name === "pointer") {
      return {
        kind: "pointer",
        name: "pointer",
        parameters: [type.parameters[0] === undefined ? UNKNOWN : this.resolveType(type.parameters[0])],
      };
    }
    if (type.name === "array") {
      return {
        kind: "array",
        name: "array",
        parameters: type.parameters.map(parameter => this.resolveType(parameter)),
      };
    }
    if (/^\d+$/.test(type.name)) {
      return primitive(type.name);
    }
    if (this.structs.has(type.name) || type.name === "Error") {
      return structType(type.name);
    }
    if (isPrimitiveType(type.name)) {
      return primitive(normalizeTypeName(type.name));
    }
    return UNKNOWN;
  }

  private expectAssignable(
    expected: LovelaceCheckedType,
    actual: LovelaceCheckedType,
    span: SourceSpan,
  ): void {
    if (expected.kind === "unknown" || actual.kind === "unknown") {
      return;
    }
    if (sameType(expected, actual)) {
      return;
    }
    if (isInteger(expected) && isInteger(actual)) {
      return;
    }
    this.addDiagnostic(
      "LACE4004",
      `Cannot assign '${typeToString(actual)}' to '${typeToString(expected)}'.`,
      span,
    );
  }

  private expectComparable(
    left: LovelaceCheckedType,
    right: LovelaceCheckedType,
    span: SourceSpan,
  ): void {
    if (left.kind === "unknown" || right.kind === "unknown") {
      return;
    }
    if (!sameType(left, right)) {
      this.addDiagnostic(
        "LACE4005",
        `Cannot compare '${typeToString(left)}' with '${typeToString(right)}'.`,
        span,
      );
    }
  }

  private expectBool(type: LovelaceCheckedType, span: SourceSpan): void {
    if (type.kind !== "unknown" && !sameType(type, BOOL)) {
      this.addDiagnostic("LACE4006", `Expected 'bool', got '${typeToString(type)}'.`, span);
    }
  }

  private expectNumeric(type: LovelaceCheckedType, span: SourceSpan): void {
    if (type.kind !== "unknown" && !isNumeric(type)) {
      this.addDiagnostic("LACE4007", `Expected numeric type, got '${typeToString(type)}'.`, span);
    }
  }

  private addDiagnostic(code: string, message: string, span: SourceSpan): void {
    const sourcePath = this.options.sourcePath;
    this.diagnostics.push(
      createDiagnostic({
        code,
        message,
        severity: "error",
        stage: "type-checker",
        span,
        ...(sourcePath === undefined ? {} : { sourcePath }),
      }),
    );
  }
}

function primitive(name: string): LovelaceCheckedType {
  return { kind: "primitive", name: normalizeTypeName(name), parameters: [] };
}

function structType(name: string): LovelaceCheckedType {
  return { kind: "struct", name, parameters: [] };
}

function functionType(
  name: string,
  parameters: LovelaceCheckedType[],
  returnType: LovelaceCheckedType,
): LovelaceFunctionType {
  return { kind: "function", name, parameters, returnType };
}

function inferNumberType(value: string): LovelaceCheckedType {
  if (value.includes(".")) {
    return FLOAT;
  }
  if (value.startsWith("$") || value.startsWith("0x") || value.startsWith("0X") || value.startsWith("%")) {
    return UINT;
  }
  return INT;
}

function normalizeTypeName(name: string): string {
  if (name === "float") {
    return "float32";
  }
  if (name === "byte") {
    return "uint8";
  }
  return name;
}

function sameType(left: LovelaceCheckedType, right: LovelaceCheckedType): boolean {
  if (left.kind === "unknown" || right.kind === "unknown") {
    return true;
  }
  if (left.kind !== right.kind || left.name !== right.name) {
    return false;
  }
  if (left.parameters.length !== right.parameters.length) {
    return false;
  }
  return left.parameters.every((parameter, index) => sameType(parameter, right.parameters[index] ?? UNKNOWN));
}

function typeToString(type: LovelaceCheckedType): string {
  if (type.parameters.length === 0) {
    return type.name;
  }
  return `${type.name}<${type.parameters.map(typeToString).join(", ")}>`;
}

function isPrimitiveType(name: string): boolean {
  return [
    "bool",
    "byte",
    "char",
    "float",
    "float32",
    "int",
    "int8",
    "int16",
    "int32",
    "string",
    "uint",
    "uint8",
    "uint16",
    "uint32",
    "void",
  ].includes(name);
}

function isNumeric(type: LovelaceCheckedType): boolean {
  return isInteger(type) || (type.kind === "primitive" && type.name === "float32");
}

function isInteger(type: LovelaceCheckedType): boolean {
  return type.kind === "primitive" && INTEGER_TYPES.has(type.name);
}

function widenNumeric(left: LovelaceCheckedType, right: LovelaceCheckedType): LovelaceCheckedType {
  if (sameType(left, FLOAT) || sameType(right, FLOAT)) {
    return FLOAT;
  }
  if (left.name.startsWith("uint") || right.name.startsWith("uint")) {
    return UINT;
  }
  return INT;
}

function isAssignmentOperator(operator: string): boolean {
  return [
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
  ].includes(operator);
}

function isComparisonOperator(operator: string): boolean {
  return ["==", "!=", "<", ">", "<=", ">="].includes(operator);
}

function isNumericOperator(operator: string): boolean {
  return ["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>"].includes(operator);
}

function callName(expression: LovelaceCallExpression): string | undefined {
  if (expression.callee.kind === "Identifier") {
    return expression.callee.name;
  }
  if (expression.callee.kind === "MemberExpression") {
    return expression.callee.property;
  }
  return undefined;
}

function lastModuleSegment(name: string): string {
  return name.split(".").at(-1) ?? name;
}
