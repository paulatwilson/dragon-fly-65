export type Width = 8 | 16 | 32;

// Assembler-level addressing modes (more granular than the emulator's AddressingMode)
export type AsmMode =
  | "implied"    // no operand (also covers explicit accumulator: asl a)
  | "imm8"       // #byte — fixed 8-bit immediate (REP, SEP, COP, WDM)
  | "imm"        // #value — M-width or X-width immediate
  | "dp"         // $nn
  | "abs"        // $nnnn
  | "long"       // $nnnnnn
  | "dp,x"       // $nn,x
  | "dp,y"       // $nn,y
  | "abs,x"      // $nnnn,x
  | "abs,y"      // $nnnn,y
  | "long,x"     // $nnnnnn,x
  | "(dp)"       // ($nn)
  | "[dp]"       // [$nn]
  | "(abs)"      // ($nnnn)
  | "[abs]"      // [$nnnn]
  | "(dp,x)"     // ($nn,x)
  | "(abs,x)"    // ($nnnn,x)
  | "(dp),y"     // ($nn),y
  | "[dp],y"     // [$nn],y
  | "block"      // srcBank,destBank
  | "rel8"       // signed 8-bit PC-relative
  | "rel16"      // signed 16-bit PC-relative
  | "sr"         // $nn,s
  | "(sr),y";    // ($nn,s),y

// An operand value: either a resolved number or a symbol reference
export type Expr = { kind: "num"; value: number } | { kind: "sym"; name: string };

// Syntactic shape of the operand (mode family, before size is resolved)
export type OperandKind =
  | "none"
  | "imm"         // #expr
  | "addr"        // expr — bare address, branch target, or accumulator
  | "addr,x"
  | "addr,y"
  | "addr,s"
  | "(addr)"
  | "[addr]"
  | "(addr,x)"
  | "(addr),y"
  | "[addr],y"
  | "(addr,s),y"
  | "block";      // expr,expr — for MVN/MVP

export interface ParsedOperand {
  kind: OperandKind;
  expr: Expr;
  expr2?: Expr;                          // block move: destination bank
  addrForce?: 8 | 16 | 24 | undefined;  // < = 8, ! = 16, > = 24
  immForce?: 8 | 16 | 32 | undefined;   // .b = 8, .w = 16, .l = 32
}

export type Statement =
  | { type: "label"; name: string; line: number }
  | { type: "instr"; mnemonic: string; operand: ParsedOperand; line: number }
  | { type: "org"; value: Expr; line: number }
  | { type: "db"; values: Expr[]; line: number }
  | { type: "dw"; values: Expr[]; line: number }
  | { type: "dl"; values: Expr[]; line: number }
  | { type: "ascii"; text: string; nul: boolean; line: number }
  | { type: "resb"; count: Expr; line: number }
  | { type: "equ"; name: string; value: Expr; line: number }
  | { type: "width"; reg: "acc" | "idx"; width: Width; line: number }
  | { type: "cpu"; mode: "65816" | "65832"; line: number };

export interface AssemblerError {
  line: number;
  message: string;
}

export interface AssemblerOutput {
  bytes: Uint8Array;
  origin: number;
  symbols: Map<string, number>;
  errors: AssemblerError[];
}

// Which register width an immediate operand uses
export type ImmKind = "acc" | "idx" | "fixed8";
