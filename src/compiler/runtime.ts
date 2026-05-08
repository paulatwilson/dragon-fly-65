export interface LovelaceRuntimeFunction {
  name: string;
  parameters: string[];
  returnType: string;
  assembly: string[];
}

export const LOVELACE_RUNTIME_FUNCTIONS: LovelaceRuntimeFunction[] = [
  {
    name: "print",
    parameters: ["unknown"],
    returnType: "<none>",
    assembly: [
      "  ; runtime seed: console output will be wired to DF65 I/O later",
      "  rts",
    ],
  },
  {
    name: "halt",
    parameters: [],
    returnType: "<none>",
    assembly: [
      "  stp",
      "  rts",
    ],
  },
  {
    name: "len",
    parameters: ["unknown"],
    returnType: "int",
    assembly: [
      "  ; runtime seed: full string/array length support arrives with the standard library",
      "  lda #0.l",
      "  rts",
    ],
  },
  {
    name: "Error",
    parameters: ["int", "string"],
    returnType: "Error",
    assembly: [
      "  ; runtime seed: Error allocation/packing arrives with the standard library",
      "  lda #0.l",
      "  rts",
    ],
  },
  {
    name: "memory.read8",
    parameters: ["uint32"],
    returnType: "uint8",
    assembly: [
      "  ; runtime seed: memory read helpers will use the DF65 memory ABI",
      "  lda #0.l",
      "  rts",
    ],
  },
  {
    name: "memory.write8",
    parameters: ["uint32", "uint8"],
    returnType: "<none>",
    assembly: [
      "  ; runtime seed: memory write helpers will use the DF65 memory ABI",
      "  rts",
    ],
  },
  {
    name: "memory.read32",
    parameters: ["uint32"],
    returnType: "uint32",
    assembly: [
      "  ; runtime seed: memory read helpers will use the DF65 memory ABI",
      "  lda #0.l",
      "  rts",
    ],
  },
  {
    name: "memory.write32",
    parameters: ["uint32", "uint32"],
    returnType: "<none>",
    assembly: [
      "  ; runtime seed: memory write helpers will use the DF65 memory ABI",
      "  rts",
    ],
  },
];

export const LOVELACE_RUNTIME_FUNCTION_NAMES = new Set(
  LOVELACE_RUNTIME_FUNCTIONS.map(fn => fn.name),
);

export const LOVELACE_RUNTIME_GLOBALS = new Set([
  "memory",
  ...LOVELACE_RUNTIME_FUNCTION_NAMES,
]);

export function getLovelaceRuntimeFunction(name: string): LovelaceRuntimeFunction | undefined {
  return LOVELACE_RUNTIME_FUNCTIONS.find(fn => fn.name === name);
}
