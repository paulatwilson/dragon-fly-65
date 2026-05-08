export type LovelaceDiagnosticSeverity = "error" | "warning" | "info";

export type LovelaceCompilerStage =
  | "compiler"
  | "lexer"
  | "parser"
  | "semantic"
  | "type-checker"
  | "ir"
  | "codegen"
  | "assembler"
  | "linker";

export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export interface LovelaceDiagnostic {
  code: string;
  message: string;
  severity: LovelaceDiagnosticSeverity;
  stage: LovelaceCompilerStage;
  span: SourceSpan;
  sourcePath?: string;
}

export interface LovelaceCompileOptions {
  sourcePath?: string;
  entryPoint?: string;
  emitAssembly?: boolean;
}

export interface LovelaceBuildOutput {
  assembly: string;
  binary: Uint8Array;
  entryPoint: string;
}

export type LovelaceTokenKind =
  | "keyword"
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "newline"
  | "eof";

export interface LovelaceToken {
  kind: LovelaceTokenKind;
  value: string;
  span: SourceSpan;
}

export interface LovelaceLexOptions {
  sourcePath?: string;
}

export interface LovelaceParseOptions extends LovelaceLexOptions {}

export interface LovelaceSemanticOptions extends LovelaceParseOptions {}

export interface LovelaceTypeCheckOptions extends LovelaceSemanticOptions {}

export interface LovelaceProgram {
  kind: "Program";
  body: LovelaceTopLevelNode[];
  span: SourceSpan;
}

export type LovelaceTopLevelNode =
  | LovelaceModuleDeclaration
  | LovelaceImportDeclaration
  | LovelaceFunctionDeclaration
  | LovelaceTypeDeclaration
  | LovelaceVariableDeclaration
  | LovelaceExpressionStatement;

export interface LovelaceModuleDeclaration {
  kind: "ModuleDeclaration";
  name: string;
  span: SourceSpan;
}

export interface LovelaceImportDeclaration {
  kind: "ImportDeclaration";
  moduleName: string;
  alias?: string;
  span: SourceSpan;
}

export interface LovelaceFunctionDeclaration {
  kind: "FunctionDeclaration";
  name: string;
  visibility: "public" | "private";
  parameters: LovelaceParameter[];
  returnType?: LovelaceTypeReference;
  body: LovelaceStatement[];
  span: SourceSpan;
}

export interface LovelaceParameter {
  name: string;
  type: LovelaceTypeReference;
  defaultValue?: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceTypeReference {
  kind: "TypeReference";
  name: string;
  parameters: LovelaceTypeReference[];
  span: SourceSpan;
}

export interface LovelaceTypeDeclaration {
  kind: "TypeDeclaration";
  name: string;
  visibility: "public" | "private";
  value: LovelaceStructType;
  span: SourceSpan;
}

export interface LovelaceStructType {
  kind: "StructType";
  fields: LovelaceStructField[];
  span: SourceSpan;
}

export interface LovelaceStructField {
  kind: "StructField";
  name: string;
  type: LovelaceTypeReference;
  span: SourceSpan;
}

export type LovelaceStatement =
  | LovelaceVariableDeclaration
  | LovelaceReturnStatement
  | LovelaceIfStatement
  | LovelaceWhileStatement
  | LovelaceForStatement
  | LovelaceSwitchStatement
  | LovelaceBreakStatement
  | LovelaceContinueStatement
  | LovelaceAsmStatement
  | LovelaceUnsafeStatement
  | LovelaceExpressionStatement;

export interface LovelaceVariableDeclaration {
  kind: "VariableDeclaration";
  mutable: boolean;
  names: string[];
  type?: LovelaceTypeReference;
  initializer?: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceReturnStatement {
  kind: "ReturnStatement";
  values: LovelaceExpression[];
  span: SourceSpan;
}

export interface LovelaceIfStatement {
  kind: "IfStatement";
  test: LovelaceExpression;
  consequent: LovelaceStatement[];
  alternate: LovelaceStatement[];
  span: SourceSpan;
}

export interface LovelaceWhileStatement {
  kind: "WhileStatement";
  test: LovelaceExpression;
  body: LovelaceStatement[];
  span: SourceSpan;
}

export interface LovelaceForStatement {
  kind: "ForStatement";
  variable: string;
  variableType?: LovelaceTypeReference;
  iterable?: LovelaceExpression;
  start?: LovelaceExpression;
  end?: LovelaceExpression;
  body: LovelaceStatement[];
  span: SourceSpan;
}

export interface LovelaceSwitchStatement {
  kind: "SwitchStatement";
  discriminant: LovelaceExpression;
  cases: LovelaceSwitchCase[];
  defaultCase: LovelaceStatement[];
  span: SourceSpan;
}

export interface LovelaceSwitchCase {
  kind: "SwitchCase";
  test: LovelaceExpression;
  body: LovelaceStatement[];
  span: SourceSpan;
}

export interface LovelaceBreakStatement {
  kind: "BreakStatement";
  span: SourceSpan;
}

export interface LovelaceContinueStatement {
  kind: "ContinueStatement";
  span: SourceSpan;
}

export interface LovelaceAsmStatement {
  kind: "AsmStatement";
  body: string;
  span: SourceSpan;
}

export interface LovelaceUnsafeStatement {
  kind: "UnsafeStatement";
  enabled: boolean;
  span: SourceSpan;
}

export interface LovelaceExpressionStatement {
  kind: "ExpressionStatement";
  expression: LovelaceExpression;
  span: SourceSpan;
}

export type LovelaceExpression =
  | LovelaceIdentifierExpression
  | LovelaceLiteralExpression
  | LovelaceUnaryExpression
  | LovelaceBinaryExpression
  | LovelaceCallExpression
  | LovelaceMemberExpression
  | LovelaceIndexExpression
  | LovelaceCastExpression
  | LovelaceStructLiteralExpression;

export interface LovelaceIdentifierExpression {
  kind: "Identifier";
  name: string;
  span: SourceSpan;
}

export interface LovelaceLiteralExpression {
  kind: "Literal";
  value: string;
  literalKind: "number" | "string" | "boolean" | "null";
  span: SourceSpan;
}

export interface LovelaceUnaryExpression {
  kind: "UnaryExpression";
  operator: string;
  argument: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceBinaryExpression {
  kind: "BinaryExpression";
  operator: string;
  left: LovelaceExpression;
  right: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceCallExpression {
  kind: "CallExpression";
  callee: LovelaceExpression;
  typeArguments: LovelaceTypeReference[];
  arguments: LovelaceArgument[];
  span: SourceSpan;
}

export interface LovelaceArgument {
  name?: string;
  value: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceMemberExpression {
  kind: "MemberExpression";
  object: LovelaceExpression;
  property: string;
  span: SourceSpan;
}

export interface LovelaceIndexExpression {
  kind: "IndexExpression";
  object: LovelaceExpression;
  index: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceCastExpression {
  kind: "CastExpression";
  targetType: LovelaceTypeReference;
  value: LovelaceExpression;
  span: SourceSpan;
}

export interface LovelaceStructLiteralExpression {
  kind: "StructLiteral";
  typeName: LovelaceExpression;
  fields: LovelaceStructLiteralField[];
  span: SourceSpan;
}

export interface LovelaceStructLiteralField {
  name: string;
  value: LovelaceExpression;
  span: SourceSpan;
}

export type LovelaceSymbolKind =
  | "builtin"
  | "module"
  | "import"
  | "function"
  | "type"
  | "const"
  | "var"
  | "parameter"
  | "field"
  | "loop";

export interface LovelaceSymbol {
  name: string;
  kind: LovelaceSymbolKind;
  mutable: boolean;
  visibility: "public" | "private";
  span: SourceSpan;
}

export interface LovelaceScope {
  id: number;
  kind: "global" | "function" | "block" | "type";
  symbols: Map<string, LovelaceSymbol>;
  parent?: LovelaceScope;
}

export interface LovelaceSemanticModel {
  program: LovelaceProgram;
  globalScope: LovelaceScope;
  scopes: LovelaceScope[];
}

export type LovelaceCheckedTypeKind =
  | "primitive"
  | "struct"
  | "pointer"
  | "array"
  | "function"
  | "unknown";

export interface LovelaceCheckedType {
  kind: LovelaceCheckedTypeKind;
  name: string;
  parameters: LovelaceCheckedType[];
}

export interface LovelaceFunctionType {
  kind: "function";
  name: string;
  parameters: LovelaceCheckedType[];
  returnType: LovelaceCheckedType;
}

export interface LovelaceTypeCheckModel {
  semanticModel: LovelaceSemanticModel;
  expressionTypes: Map<LovelaceExpression, LovelaceCheckedType>;
  globalValues: Map<string, LovelaceCheckedType>;
  functions: Map<string, LovelaceFunctionType>;
}

export type CompilerResult<T> =
  | { ok: true; value: T; diagnostics: LovelaceDiagnostic[] }
  | { ok: false; diagnostics: LovelaceDiagnostic[] };
