import { compilerError, compilerOk } from "./result";
import { checkLovelaceTypes } from "./typechecker";
import type {
  CompilerResult,
  LovelaceArgument,
  LovelaceBinaryExpression,
  LovelaceCallExpression,
  LovelaceCastExpression,
  LovelaceCheckedType,
  LovelaceExpression,
  LovelaceForStatement,
  LovelaceFunctionDeclaration,
  LovelaceIrFunction,
  LovelaceIrGlobal,
  LovelaceIrInstruction,
  LovelaceIrModule,
  LovelaceIrOptions,
  LovelaceIrValue,
  LovelaceLiteralExpression,
  LovelaceStatement,
  LovelaceStructLiteralExpression,
  LovelaceSwitchCase,
  LovelaceTopLevelNode,
  LovelaceTypeCheckModel,
  LovelaceTypeReference,
  LovelaceVariableDeclaration,
  SourceSpan,
} from "./types";

const UNKNOWN_TYPE: LovelaceCheckedType = {
  kind: "unknown",
  name: "unknown",
  parameters: [],
};

export function lowerLovelaceToIr(
  source: string,
  options: LovelaceIrOptions = {},
): CompilerResult<LovelaceIrModule> {
  const checked = checkLovelaceTypes(source, options);
  if (!checked.ok) {
    return compilerError(checked.diagnostics);
  }

  return compilerOk(new LovelaceIrLowerer(checked.value).lower());
}

class LovelaceIrLowerer {
  private tempId = 0;
  private labelId = 0;
  private readonly globals = new Map<string, LovelaceCheckedType>();
  private readonly functionReturns = new Map<string, LovelaceCheckedType>();

  public constructor(private readonly model: LovelaceTypeCheckModel) {}

  public lower(): LovelaceIrModule {
    for (const [name, type] of this.model.globalValues) {
      this.globals.set(name, type);
    }
    for (const [name, fn] of this.model.functions) {
      this.functionReturns.set(name, fn.returnType);
    }

    const globals: LovelaceIrGlobal[] = [];
    const functions: LovelaceIrFunction[] = [];
    const initializers: LovelaceIrInstruction[] = [];

    for (const node of this.model.semanticModel.program.body) {
      switch (node.kind) {
        case "VariableDeclaration":
          globals.push(...this.lowerGlobal(node, initializers));
          break;
        case "FunctionDeclaration":
          functions.push(this.lowerFunction(node));
          break;
        case "ExpressionStatement": {
          const context = this.createContext(initializers, new Map(), []);
          this.lowerExpression(node.expression, context);
          break;
        }
        case "ImportDeclaration":
        case "ModuleDeclaration":
        case "TypeDeclaration":
          break;
      }
    }

    return {
      kind: "IrModule",
      globals,
      functions,
      initializers,
    };
  }

  private lowerGlobal(
    node: LovelaceVariableDeclaration,
    initializers: LovelaceIrInstruction[],
  ): LovelaceIrGlobal[] {
    const context = this.createContext(initializers, new Map(), []);
    const initializer = node.initializer === undefined
      ? undefined
      : this.lowerExpression(node.initializer, context);

    return node.names.map((name, index) => {
      const type = this.model.globalValues.get(name) ?? UNKNOWN_TYPE;
      const global: LovelaceIrValue = { kind: "global", name, type };
      if (initializer !== undefined && index === 0) {
        initializers.push({
          op: "assign",
          target: global,
          value: initializer,
          span: node.initializer?.span ?? node.span,
        });
      }
      return {
        name,
        mutable: node.mutable,
        type,
        ...(initializer === undefined || index > 0 ? {} : { initializer }),
        span: node.span,
      };
    });
  }

  private lowerFunction(node: LovelaceFunctionDeclaration): LovelaceIrFunction {
    const body: LovelaceIrInstruction[] = [];
    const locals = new Map<string, LovelaceIrValue>();
    const parameters = node.parameters.map(parameter => {
      const type = this.resolveExpressionType(parameter.defaultValue) ?? UNKNOWN_TYPE;
      const declaredType = this.model.functions.get(node.name)?.parameters[node.parameters.indexOf(parameter)] ?? type;
      locals.set(parameter.name, { kind: "local", name: parameter.name, type: declaredType });
      return { name: parameter.name, type: declaredType };
    });

    const context = this.createContext(body, locals, []);
    this.lowerStatements(node.body, context);

    return {
      name: node.name,
      visibility: node.visibility,
      parameters,
      returnType: this.model.functions.get(node.name)?.returnType ?? UNKNOWN_TYPE,
      body,
      span: node.span,
    };
  }

  private lowerStatements(statements: LovelaceStatement[], context: LowerContext): void {
    for (const statement of statements) {
      this.lowerStatement(statement, context);
    }
  }

  private lowerStatement(statement: LovelaceStatement, context: LowerContext): void {
    switch (statement.kind) {
      case "VariableDeclaration":
        this.lowerLocalDeclaration(statement, context);
        break;
      case "ReturnStatement":
        context.instructions.push({
          op: "return",
          values: statement.values.map(value => this.lowerExpression(value, context)),
          span: statement.span,
        });
        break;
      case "ExpressionStatement":
        this.lowerExpression(statement.expression, context);
        break;
      case "IfStatement":
        this.lowerIf(statement.test, statement.consequent, statement.alternate, statement.span, context);
        break;
      case "WhileStatement":
        this.lowerWhile(statement.test, statement.body, statement.span, context);
        break;
      case "ForStatement":
        this.lowerFor(statement, context);
        break;
      case "SwitchStatement":
        this.lowerSwitch(statement.discriminant, statement.cases, statement.defaultCase, statement.span, context);
        break;
      case "BreakStatement":
        context.instructions.push({ op: "jump", label: context.control.at(-1)?.breakLabel ?? "", span: statement.span });
        break;
      case "ContinueStatement":
        context.instructions.push({ op: "jump", label: context.control.at(-1)?.continueLabel ?? "", span: statement.span });
        break;
      case "AsmStatement":
        context.instructions.push({ op: "asm", body: statement.body, span: statement.span });
        break;
      case "UnsafeStatement":
        break;
    }
  }

  private lowerLocalDeclaration(node: LovelaceVariableDeclaration, context: LowerContext): void {
    const initializer = node.initializer === undefined
      ? undefined
      : this.lowerExpression(node.initializer, context);

    for (const [index, name] of node.names.entries()) {
      const type = this.inferDeclarationType(node, index, initializer);
      const local: LovelaceIrValue = { kind: "local", name, type };
      context.locals.set(name, local);
      context.instructions.push({ op: "declare", target: local, mutable: node.mutable, span: node.span });
      if (initializer !== undefined && index === 0) {
        context.instructions.push({
          op: "assign",
          target: local,
          value: initializer,
          span: node.initializer?.span ?? node.span,
        });
      }
    }
  }

  private lowerIf(
    testExpression: LovelaceExpression,
    consequent: LovelaceStatement[],
    alternate: LovelaceStatement[],
    span: SourceSpan,
    context: LowerContext,
  ): void {
    const elseLabel = this.nextLabel("if_else");
    const endLabel = this.nextLabel("if_end");
    const test = this.lowerExpression(testExpression, context);
    context.instructions.push({ op: "jumpIfFalse", test, label: elseLabel, span: testExpression.span });
    this.lowerStatements(consequent, context);
    context.instructions.push({ op: "jump", label: endLabel, span });
    context.instructions.push({ op: "label", name: elseLabel, span });
    this.lowerStatements(alternate, context);
    context.instructions.push({ op: "label", name: endLabel, span });
  }

  private lowerWhile(
    testExpression: LovelaceExpression,
    body: LovelaceStatement[],
    span: SourceSpan,
    context: LowerContext,
  ): void {
    const startLabel = this.nextLabel("while_start");
    const endLabel = this.nextLabel("while_end");
    context.instructions.push({ op: "label", name: startLabel, span });
    const test = this.lowerExpression(testExpression, context);
    context.instructions.push({ op: "jumpIfFalse", test, label: endLabel, span: testExpression.span });
    context.control.push({ breakLabel: endLabel, continueLabel: startLabel });
    this.lowerStatements(body, context);
    context.control.pop();
    context.instructions.push({ op: "jump", label: startLabel, span });
    context.instructions.push({ op: "label", name: endLabel, span });
  }

  private lowerFor(statement: LovelaceForStatement, context: LowerContext): void {
    const loopType = statement.variableType === undefined ? UNKNOWN_TYPE : this.typeFromReference(statement.variableType);
    const local: LovelaceIrValue = { kind: "local", name: statement.variable, type: loopType };
    context.locals.set(statement.variable, local);
    context.instructions.push({ op: "declare", target: local, mutable: false, span: statement.span });

    if (statement.start !== undefined && statement.end !== undefined) {
      const startValue = this.lowerExpression(statement.start, context);
      const endValue = this.lowerExpression(statement.end, context);
      const startLabel = this.nextLabel("for_start");
      const endLabel = this.nextLabel("for_end");
      context.instructions.push({ op: "assign", target: local, value: startValue, span: statement.start.span });
      context.instructions.push({ op: "label", name: startLabel, span: statement.span });
      const comparison = this.nextTemp(this.boolType(), statement.span);
      context.instructions.push({
        op: "binary",
        target: comparison,
        operator: "<=",
        left: local,
        right: endValue,
        span: statement.span,
      });
      context.instructions.push({ op: "jumpIfFalse", test: comparison, label: endLabel, span: statement.span });
      context.control.push({ breakLabel: endLabel, continueLabel: startLabel });
      this.lowerStatements(statement.body, context);
      context.control.pop();
      const one: LovelaceIrValue = { kind: "literal", value: "1", literalKind: "number", type: this.intType() };
      const next = this.nextTemp(local.type, statement.span);
      context.instructions.push({ op: "binary", target: next, operator: "+", left: local, right: one, span: statement.span });
      context.instructions.push({ op: "assign", target: local, value: next, span: statement.span });
      context.instructions.push({ op: "jump", label: startLabel, span: statement.span });
      context.instructions.push({ op: "label", name: endLabel, span: statement.span });
      return;
    }

    if (statement.iterable !== undefined) {
      this.lowerExpression(statement.iterable, context);
    }
    this.lowerStatements(statement.body, context);
  }

  private lowerSwitch(
    discriminantExpression: LovelaceExpression,
    cases: LovelaceSwitchCase[],
    defaultCase: LovelaceStatement[],
    span: SourceSpan,
    context: LowerContext,
  ): void {
    const discriminant = this.lowerExpression(discriminantExpression, context);
    const endLabel = this.nextLabel("switch_end");
    const defaultLabel = this.nextLabel("switch_default");

    for (const switchCase of cases) {
      const nextTestLabel = this.nextLabel("switch_next");
      const test = this.lowerExpression(switchCase.test, context);
      const comparison = this.nextTemp(this.boolType(), switchCase.test.span);
      context.instructions.push({
        op: "binary",
        target: comparison,
        operator: "==",
        left: discriminant,
        right: test,
        span: switchCase.test.span,
      });
      context.instructions.push({
        op: "jumpIfFalse",
        test: comparison,
        label: nextTestLabel,
        span: switchCase.test.span,
      });
      context.control.push({ breakLabel: endLabel, continueLabel: endLabel });
      this.lowerStatements(switchCase.body, context);
      context.control.pop();
      context.instructions.push({ op: "jump", label: endLabel, span: switchCase.span });
      context.instructions.push({ op: "label", name: nextTestLabel, span: switchCase.span });
    }

    context.instructions.push({ op: "jump", label: defaultLabel, span });
    context.instructions.push({ op: "label", name: defaultLabel, span });
    this.lowerStatements(defaultCase, context);
    context.instructions.push({ op: "label", name: endLabel, span });
  }

  private lowerExpression(expression: LovelaceExpression, context: LowerContext): LovelaceIrValue {
    switch (expression.kind) {
      case "Literal":
        return this.literalValue(expression);
      case "Identifier":
        return this.resolveValue(expression.name, context, expression.span);
      case "UnaryExpression": {
        const argument = this.lowerExpression(expression.argument, context);
        const target = this.nextTemp(this.expressionType(expression), expression.span);
        context.instructions.push({ op: "unary", target, operator: expression.operator, argument, span: expression.span });
        return target;
      }
      case "BinaryExpression":
        return this.lowerBinaryExpression(expression, context);
      case "CallExpression":
        return this.lowerCallExpression(expression, context);
      case "MemberExpression": {
        const object = this.lowerExpression(expression.object, context);
        const target = this.nextTemp(this.expressionType(expression), expression.span);
        context.instructions.push({ op: "member", target, object, property: expression.property, span: expression.span });
        return target;
      }
      case "IndexExpression": {
        const object = this.lowerExpression(expression.object, context);
        const index = this.lowerExpression(expression.index, context);
        const target = this.nextTemp(this.expressionType(expression), expression.span);
        context.instructions.push({ op: "index", target, object, index, span: expression.span });
        return target;
      }
      case "CastExpression":
        return this.lowerCastExpression(expression, context);
      case "StructLiteral":
        return this.lowerStructLiteral(expression, context);
    }
  }

  private lowerBinaryExpression(
    expression: LovelaceBinaryExpression,
    context: LowerContext,
  ): LovelaceIrValue {
    if (isAssignmentOperator(expression.operator)) {
      const target = this.lowerAssignable(expression.left, context);
      const value = this.lowerExpression(expression.right, context);
      context.instructions.push({ op: "assign", target, value, span: expression.span });
      return target;
    }

    const left = this.lowerExpression(expression.left, context);
    const right = this.lowerExpression(expression.right, context);
    const target = this.nextTemp(this.expressionType(expression), expression.span);
    context.instructions.push({
      op: "binary",
      target,
      operator: expression.operator,
      left,
      right,
      span: expression.span,
    });
    return target;
  }

  private lowerCallExpression(
    expression: LovelaceCallExpression,
    context: LowerContext,
  ): LovelaceIrValue {
    const callee = callName(expression) ?? "<anonymous>";
    const args = expression.arguments.map(argument => this.lowerArgument(argument, context));
    const type = this.functionReturns.get(callee) ?? this.expressionType(expression);
    const returnsValue = type.name !== "<none>";
    const target = returnsValue ? this.nextTemp(type, expression.span) : undefined;
    context.instructions.push({
      op: "call",
      ...(target === undefined ? {} : { target }),
      callee,
      args,
      span: expression.span,
    });
    return target ?? { kind: "temp", name: "<discard>", type };
  }

  private lowerArgument(argument: LovelaceArgument, context: LowerContext): LovelaceIrValue {
    return this.lowerExpression(argument.value, context);
  }

  private lowerCastExpression(
    expression: LovelaceCastExpression,
    context: LowerContext,
  ): LovelaceIrValue {
    const value = this.lowerExpression(expression.value, context);
    const target = this.nextTemp(this.expressionType(expression), expression.span);
    context.instructions.push({
      op: "cast",
      target,
      value,
      toType: target.type,
      span: expression.span,
    });
    return target;
  }

  private lowerStructLiteral(
    expression: LovelaceStructLiteralExpression,
    context: LowerContext,
  ): LovelaceIrValue {
    const target = this.nextTemp(this.expressionType(expression), expression.span);
    const fields = expression.fields.map(field => ({
      name: field.name,
      value: this.lowerExpression(field.value, context),
    }));
    context.instructions.push({
      op: "struct",
      target,
      typeName: expression.typeName.kind === "Identifier" ? expression.typeName.name : "<anonymous>",
      fields,
      span: expression.span,
    });
    return target;
  }

  private lowerAssignable(
    expression: LovelaceExpression,
    context: LowerContext,
  ): LovelaceIrValue {
    if (expression.kind === "Identifier") {
      return this.resolveValue(expression.name, context, expression.span);
    }
    return this.lowerExpression(expression, context);
  }

  private literalValue(expression: LovelaceLiteralExpression): LovelaceIrValue {
    return {
      kind: "literal",
      value: expression.value,
      literalKind: expression.literalKind,
      type: this.expressionType(expression),
    };
  }

  private resolveValue(name: string, context: LowerContext, span: SourceSpan): LovelaceIrValue {
    const local = context.locals.get(name);
    if (local !== undefined) {
      return local;
    }
    const root = name.split(".")[0] ?? name;
    const rootLocal = context.locals.get(root);
    if (rootLocal !== undefined) {
      return rootLocal;
    }
    const globalType = this.globals.get(name) ?? this.globals.get(root) ?? UNKNOWN_TYPE;
    return { kind: "global", name, type: globalType };
  }

  private inferDeclarationType(
    node: LovelaceVariableDeclaration,
    index: number,
    initializer: LovelaceIrValue | undefined,
  ): LovelaceCheckedType {
    if (node.type !== undefined) {
      return this.typeFromReference(node.type);
    }
    if (index > 0) {
      return { kind: "struct", name: "Error", parameters: [] };
    }
    return initializer?.type ?? UNKNOWN_TYPE;
  }

  private resolveExpressionType(expression: LovelaceExpression | undefined): LovelaceCheckedType | undefined {
    if (expression === undefined) {
      return undefined;
    }
    return this.model.expressionTypes.get(expression);
  }

  private expressionType(expression: LovelaceExpression): LovelaceCheckedType {
    return this.model.expressionTypes.get(expression) ?? UNKNOWN_TYPE;
  }

  private typeFromReference(type: LovelaceTypeReference): LovelaceCheckedType {
    if (type.name === "pointer") {
      return {
        kind: "pointer",
        name: "pointer",
        parameters: [type.parameters[0] === undefined ? UNKNOWN_TYPE : this.typeFromReference(type.parameters[0])],
      };
    }
    if (type.name === "array") {
      return {
        kind: "array",
        name: "array",
        parameters: type.parameters.map(parameter => this.typeFromReference(parameter)),
      };
    }
    if (/^\d+$/.test(type.name)) {
      return { kind: "primitive", name: type.name, parameters: [] };
    }
    const globalSymbol = this.model.semanticModel.globalScope.symbols.get(type.name);
    if (globalSymbol?.kind === "type") {
      return { kind: "struct", name: type.name, parameters: [] };
    }
    return { kind: "primitive", name: normalizeTypeName(type.name), parameters: [] };
  }

  private intType(): LovelaceCheckedType {
    return { kind: "primitive", name: "int", parameters: [] };
  }

  private boolType(): LovelaceCheckedType {
    return { kind: "primitive", name: "bool", parameters: [] };
  }

  private nextTemp(type: LovelaceCheckedType, span: SourceSpan): LovelaceIrValue {
    const name = `%t${this.tempId}`;
    this.tempId += 1;
    void span;
    return { kind: "temp", name, type };
  }

  private nextLabel(prefix: string): string {
    const name = `${prefix}_${this.labelId}`;
    this.labelId += 1;
    return name;
  }

  private createContext(
    instructions: LovelaceIrInstruction[],
    locals: Map<string, LovelaceIrValue>,
    control: ControlTarget[],
  ): LowerContext {
    return { instructions, locals, control };
  }
}

interface ControlTarget {
  breakLabel: string;
  continueLabel: string;
}

interface LowerContext {
  instructions: LovelaceIrInstruction[];
  locals: Map<string, LovelaceIrValue>;
  control: ControlTarget[];
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

function callName(expression: LovelaceCallExpression): string | undefined {
  if (expression.callee.kind === "Identifier") {
    return expression.callee.name;
  }
  if (expression.callee.kind === "MemberExpression") {
    return expression.callee.property;
  }
  return undefined;
}

function normalizeTypeName(name: string): string {
  if (name === "byte") {
    return "uint8";
  }
  if (name === "float") {
    return "float32";
  }
  return name;
}
