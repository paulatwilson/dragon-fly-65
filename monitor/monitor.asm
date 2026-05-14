; =============================================================================
; DragonFly 65 Monitor
;
; A basic machine monitor for the W65C832 emulator.
;
; Memory map
; ----------
;   $0000–$01FF   Zero page + hardware stack
;   $0200–$0293   Monitor work RAM (input buffer, register save area,
;                  native assembler label/fixup tables)
;   $0300–$BFFF   Free RAM (user programs)
;   $C000–$EFFF   Monitor ROM  ← loaded here
;   $F000–$F002   Memory-mapped I/O
;   $FFFA–$FFFF   Interrupt vectors
;
; I/O registers
; -------------
;   $F000  CHAR_OUT   write: send byte to terminal
;   $F001  CHAR_IN    read:  next input byte ($FF if none queued)
;   $F002  CHAR_STS   read:  1 if input available, 0 otherwise
;
; Commands  (no spaces — address and data packed as hex digits)
; --------
;   H              Help
;   MAAAA          Memory dump — 16 bytes starting at address AAAA
;   SAAAADD...     Set memory  — store bytes DD… at address AAAA
;   GAAAA          Go          — JSR to address AAAA; program returns with RTS
;   R              Registers   — show registers saved from last G execution
;   AAAAA          Assemble    — enter assembly mode at address AAAA
;   DAAAA          Disassemble — show 8 instructions starting at address AAAA
;
; CPU conventions used in this monitor
; -------------------------------------
;   Accumulator  : 8-bit  (M flag = 1, SEP #$20 at boot)
;   Index (X, Y) : 16-bit (X flag = 0, REP #$10 at boot)
;   Data bank    : 0
;   Stack        : $0100–$01FF
;
; Zero-page layout
;   $00–$01  ZP_PTR   16-bit pointer used by PRINT_ZP
;   $02–$03  ZP_ADDR  16-bit working address (PARSE_HEX4 target, dump address)
;   $04      ZP_TMP   temporary byte
;   $05      ZP_TMP2  temporary byte
;   $06–$07  ZP_OPER  parsed operand word for assembly mode
;   $08      ZP_ERR   non-zero when assembly parsing fails
;   $0257    ASM_LABEL_COUNT
;   $0258    ASM_LABEL_HASHES  8 one-byte label hashes
;   $0260    ASM_LABEL_ADDRS   8 two-byte label addresses
;   $0270    ASM_FIXUP_COUNT
;   $0271    ASM_PENDING_KIND  pending operand kind: 0 none, 1 abs16, 2 branch
;   $0272    ASM_PENDING_HASH
;   $0273    ASM_FIXUP_HASHES  8 one-byte unresolved label hashes
;   $027B    ASM_FIXUP_ADDRS   8 two-byte patch addresses
;   $028B    ASM_FIXUP_KINDS   8 one-byte patch kinds
;
; Register save area (written by DO_GO_RETURNED)
;   $0250    A_SAVE    A register from last G return
;   $0251    X_SAVE+0  X register low byte
;   $0252    X_SAVE+1  X register high byte
;   $0253    Y_SAVE+0  Y register low byte
;   $0254    Y_SAVE+1  Y register high byte
;   $0255    P_SAVE    processor status byte
;   $0256    REG_VALID 0 = no program run yet, 1 = valid
; =============================================================================

    .65816
    .org $C000

; ---------------------------------------------------------------------------
; I/O addresses
; ---------------------------------------------------------------------------
CHAR_OUT    .equ $F000
CHAR_IN     .equ $F001
CHAR_STS    .equ $F002

; ---------------------------------------------------------------------------
; Zero-page variables
; ---------------------------------------------------------------------------
ZP_PTR      .equ $00
ZP_ADDR     .equ $02
ZP_TMP      .equ $04
ZP_TMP2     .equ $05
ZP_OPER     .equ $06
ZP_ERR      .equ $08

; ---------------------------------------------------------------------------
; RAM buffers
; ---------------------------------------------------------------------------
INBUF       .equ $0200          ; 64-byte input line buffer
INBUF_LEN   .equ $0240          ; length of last input line (1 byte)

; Register save area
A_SAVE      .equ $0250
X_SAVE      .equ $0251          ; 2 bytes
Y_SAVE      .equ $0253          ; 2 bytes
P_SAVE      .equ $0255
REG_VALID   .equ $0256
ASM_LABEL_COUNT  .equ $0257
ASM_LABEL_HASHES .equ $0258
ASM_LABEL_ADDRS  .equ $0260
ASM_FIXUP_COUNT  .equ $0270
ASM_PENDING_KIND .equ $0271
ASM_PENDING_HASH .equ $0272
ASM_FIXUP_HASHES .equ $0273
ASM_FIXUP_ADDRS  .equ $027B
ASM_FIXUP_KINDS  .equ $028B

; ---------------------------------------------------------------------------
; Boot / monitor entry
;
; Called at reset.  Switches to native mode, sets register widths, initialises
; stack and data bank, then falls into MAIN_LOOP.
; ---------------------------------------------------------------------------
MONITOR_ENTRY:
    clc
    xce                         ; switch to W65C816 native mode

    rep     #$30                ; A=16, I=16 (needed to load 16-bit SP)
    .a16
    .i16
    lda     #$01FF
    tcs                         ; SP = $01FF

    sep     #$20                ; A=8 (keep I=16 for the rest of the monitor)
    .a8
    lda     #$00
    pha
    plb                         ; data bank = 0

    ldx     #STR_BANNER
    stx     ZP_PTR
    jsr     PRINT_ZP

; ---------------------------------------------------------------------------
; Main loop
; ---------------------------------------------------------------------------
MAIN_LOOP:
    ldx     #STR_PROMPT
    stx     ZP_PTR
    jsr     PRINT_ZP

    jsr     READLINE            ; fill INBUF, set INBUF_LEN

    lda     INBUF_LEN
    beq     MAIN_LOOP           ; empty line — re-prompt

    ; Point X at INBUF; read command char, advance past it
    ldx     #INBUF
    lda     $0000,x
    inx                         ; X now points to char after command

    ; Upcase the command character
    cmp     #$61                ; < 'a' → already upper (or non-alpha)
    bcc     DISPATCH
    and     #$DF                ; clear bit 5 → upper case

DISPATCH:
    cmp     #'H'
    beq     DO_HELP
    cmp     #'M'
    beq     DO_MEMORY
    cmp     #'S'
    bne     DISPATCH_NOT_S
    jmp     DO_SET
DISPATCH_NOT_S:
    cmp     #'G'
    bne     DISPATCH_NOT_G
    jmp     DO_GO
DISPATCH_NOT_G:
    cmp     #'R'
    bne     DISPATCH_NOT_R
    jmp     DO_REGS
DISPATCH_NOT_R:
    cmp     #'A'
    bne     DISPATCH_NOT_A
    jmp     DO_ASSEMBLE
DISPATCH_NOT_A:
    cmp     #'D'
    bne     DISPATCH_UNKNOWN
    jmp     DO_DISASSEMBLE
DISPATCH_UNKNOWN:
    ldx     #STR_UNKNOWN
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; H — Help
; ---------------------------------------------------------------------------
DO_HELP:
    ldx     #STR_HELP
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; MAAAA — Memory dump, 16 bytes at address AAAA
; On entry: X = INBUF+1 (parse pointer)
; ---------------------------------------------------------------------------
DO_MEMORY:
    jsr     PARSE_HEX4          ; ZP_ADDR ← address, X consumed

    jsr     CRLF

    ; Print "AAAA: " address label
    rep     #$20
    .a16
    lda     ZP_ADDR
    tax
    sep     #$20
    .a8
    jsr     PUT_HEX4_X
    lda     #':'
    sta     CHAR_OUT
    lda     #' '
    sta     CHAR_OUT

    ; Print 16 hex bytes
    ldy     #0
MEM_HEX_LOOP:
    lda     (ZP_ADDR),y
    jsr     PUT_HEX2
    lda     #' '
    sta     CHAR_OUT
    iny
    cpy     #16
    bcc     MEM_HEX_LOOP

    ; Print " |" separator before ASCII
    lda     #' '
    sta     CHAR_OUT
    lda     #'|'
    sta     CHAR_OUT

    ; Print 16 ASCII chars (dot for non-printable)
    ldy     #0
MEM_ASCII_LOOP:
    lda     (ZP_ADDR),y
    cmp     #$20
    bcc     MEM_ASCII_DOT
    cmp     #$7F
    bcs     MEM_ASCII_DOT
    sta     CHAR_OUT
    bra     MEM_ASCII_NEXT
MEM_ASCII_DOT:
    lda     #'.'
    sta     CHAR_OUT
MEM_ASCII_NEXT:
    iny
    cpy     #16
    bcc     MEM_ASCII_LOOP

    lda     #'|'
    sta     CHAR_OUT
    jsr     CRLF
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; SAAAADD... — Set memory, store bytes at address AAAA
; On entry: X = INBUF+1 (parse pointer)
; ---------------------------------------------------------------------------
DO_SET:
    jsr     PARSE_HEX4          ; ZP_ADDR ← address, X advanced by 4

    ldy     #0                  ; Y = byte store offset

DO_SET_LOOP:
    ; Remaining input chars = INBUF_LEN - (X - INBUF)
    rep     #$20
    .a16
    txa
    sec
    sbc     #INBUF              ; A = chars consumed
    sep     #$20
    .a8
    sta     ZP_TMP
    lda     INBUF_LEN
    sec
    sbc     ZP_TMP              ; A = chars remaining
    cmp     #2
    bcc     DO_SET_DONE         ; < 2 chars left — nothing more to parse

    jsr     PARSE_HEX2          ; A ← next byte
    sta     (ZP_ADDR),y
    iny
    bra     DO_SET_LOOP

DO_SET_DONE:
    ldx     #STR_OK
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; GAAAA — Run user code at address AAAA via RTS-stack trick
;
; The stack is arranged so that:
;   1. RTS here jumps to user code (AAAA)
;   2. When user code does RTS, execution continues at DO_GO_RETURNED
;
; On entry: X = INBUF+1 (parse pointer)
; ---------------------------------------------------------------------------
DO_GO:
    jsr     PARSE_HEX4          ; ZP_ADDR ← address

    ; Push (DO_GO_RETURNED - 1) — where user RTS will land
    rep     #$20
    .a16
    lda     #DO_GO_RETURNED-1
    sta     ZP_TMP              ; ZP_TMP = lo, ZP_TMP+1 = hi
    sep     #$20
    .a8
    lda     ZP_TMP+1            ; high byte first
    pha
    lda     ZP_TMP              ; low byte
    pha

    ; Push (target - 1) — where our RTS will jump
    rep     #$20
    .a16
    lda     ZP_ADDR
    dec
    sta     ZP_TMP              ; ZP_TMP = lo, ZP_TMP+1 = hi
    sep     #$20
    .a8
    lda     ZP_TMP+1
    pha
    lda     ZP_TMP
    pha

    rts                         ; "jump" to user code

DO_GO_RETURNED:
    ; Save the user program's registers before touching anything
    sta     A_SAVE
    rep     #$20
    .a16
    stx     X_SAVE
    sty     Y_SAVE
    sep     #$20
    .a8
    php
    pla
    sta     P_SAVE
    lda     #1
    sta     REG_VALID

    ldx     #STR_RETURNED
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; R — Show registers saved from last G run
; ---------------------------------------------------------------------------
DO_REGS:
    lda     REG_VALID
    bne     DO_REGS_SHOW

    ldx     #STR_NO_PROG
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     MAIN_LOOP

DO_REGS_SHOW:
    ; A=XX  X=XXXX  Y=XXXX  P=XX
    ldx     #STR_REG_A
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     A_SAVE
    jsr     PUT_HEX2

    ldx     #STR_REG_X
    stx     ZP_PTR
    jsr     PRINT_ZP
    rep     #$20
    .a16
    ldx     X_SAVE
    sep     #$20
    .a8
    jsr     PUT_HEX4_X

    ldx     #STR_REG_Y
    stx     ZP_PTR
    jsr     PRINT_ZP
    rep     #$20
    .a16
    ldx     Y_SAVE
    sep     #$20
    .a8
    jsr     PUT_HEX4_X

    ldx     #STR_REG_P
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     P_SAVE
    jsr     PUT_HEX2

    jsr     CRLF
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; AAAAA — Assemble source lines into memory starting at address AAAA.
;
; This is a monitor-resident mini assembler. It intentionally supports only a
; small first subset:
;   lda #imm8
;   lda dp
;   lda dp,x
;   lda abs
;   lda abs,x
;   lda abs,y
;   sta dp
;   sta dp,x
;   sta abs
;   sta abs,x
;   sta abs,y
;   rts
;   nop
;   sep #imm8
;   rep #imm8
;   jsr abs
;   jmp abs
;   cmp #imm8
;   and #imm8
;   ora #imm8
;   eor #imm8
;   adc #imm8
;   sbc #imm8
;   cmp dp
;   cmp dp,x
;   cmp abs
;   cmp abs,x
;   cmp abs,y
;   and dp
;   and dp,x
;   and abs
;   and abs,x
;   and abs,y
;   ora dp
;   ora dp,x
;   ora abs
;   ora abs,x
;   ora abs,y
;   eor dp
;   eor dp,x
;   eor abs
;   eor abs,x
;   eor abs,y
;   adc dp
;   adc dp,x
;   adc abs
;   adc abs,x
;   adc abs,y
;   sbc dp
;   sbc dp,x
;   sbc abs
;   sbc abs,x
;   sbc abs,y
;   ldx #imm8
;   ldx dp
;   ldx dp,y
;   ldx abs
;   ldx abs,y
;   ldy #imm8
;   ldy dp
;   ldy dp,x
;   ldy abs
;   ldy abs,x
;   stx dp
;   stx dp,y
;   stx abs
;   sty dp
;   sty dp,x
;   sty abs
;   tax
;   tay
;   txa
;   tya
;   tsx
;   txs
;   inx
;   dex
;   iny
;   dey
;   clc
;   sec
;   cli
;   sei
;   clv
;   cld
;   sed
;   beq abs
;   bne abs
;   bcc abs
;   bcs abs
;   bmi abs
;   bpl abs
;   .byte value[,value...]
;   db value[,value...]
;   labels on label-only lines, e.g. loop:
;
; On entry: X = INBUF+1 (parse pointer)
; ---------------------------------------------------------------------------
DO_ASSEMBLE:
    jsr     PARSE_HEX4          ; ZP_ADDR ← current assembly address
    lda     #0
    sta     ASM_LABEL_COUNT      ; labels are scoped to one A session
    sta     ASM_FIXUP_COUNT
    sta     ASM_PENDING_KIND

ASM_LOOP:
    jsr     CRLF
    rep     #$20
    .a16
    ldx     ZP_ADDR
    sep     #$20
    .a8
    jsr     PUT_HEX4_X
    lda     #'>'
    sta     CHAR_OUT
    lda     #' '
    sta     CHAR_OUT

    jsr     READLINE
    lda     INBUF_LEN
    beq     ASM_LOOP

    ldx     #INBUF
    jsr     ASM_LINE_IS_END
    cmp     #1
    beq     ASM_DONE

    ldx     #INBUF
    jsr     ASM_PARSE_LINE
    lda     ZP_ERR
    beq     ASM_LOOP

    ldx     #STR_UNKNOWN
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     ASM_LOOP

ASM_DONE:
    jsr     ASM_CHECK_UNRESOLVED
    lda     ZP_ERR
    beq     ASM_DONE_OK
    ldx     #STR_UNKNOWN
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     ASM_LOOP
ASM_DONE_OK:
    ldx     #STR_OK
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     MAIN_LOOP

; ---------------------------------------------------------------------------
; DAAAA — Disassemble 8 instructions starting at address AAAA.
;
; This is the matching mini disassembler for the monitor assembler subset.
; Keep it in lockstep with assembly mode as new native assembler opcodes are
; added.
;
; On entry: X = INBUF+1 (parse pointer)
; ---------------------------------------------------------------------------
DO_DISASSEMBLE:
    jsr     PARSE_HEX4          ; ZP_ADDR ← current disassembly address
    lda     #8
    sta     ZP_ERR

DISASM_LOOP:
    jsr     CRLF
    rep     #$20
    .a16
    ldx     ZP_ADDR
    sep     #$20
    .a8
    jsr     PUT_HEX4_X
    lda     #' '
    sta     CHAR_OUT

    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER

    lda     ZP_OPER
    cmp     #$A9
    bne     DISASM_NOT_LDA_IMM
    jmp     DISASM_LDA_IMM
DISASM_NOT_LDA_IMM:
    cmp     #$C9
    bne     DISASM_NOT_CMP_IMM
    jmp     DISASM_CMP_IMM
DISASM_NOT_CMP_IMM:
    cmp     #$29
    bne     DISASM_NOT_AND_IMM
    jmp     DISASM_AND_IMM
DISASM_NOT_AND_IMM:
    cmp     #$09
    bne     DISASM_NOT_ORA_IMM
    jmp     DISASM_ORA_IMM
DISASM_NOT_ORA_IMM:
    cmp     #$49
    bne     DISASM_NOT_EOR_IMM
    jmp     DISASM_EOR_IMM
DISASM_NOT_EOR_IMM:
    cmp     #$69
    bne     DISASM_NOT_ADC_IMM
    jmp     DISASM_ADC_IMM
DISASM_NOT_ADC_IMM:
    cmp     #$E9
    bne     DISASM_NOT_SBC_IMM
    jmp     DISASM_SBC_IMM
DISASM_NOT_SBC_IMM:
    cmp     #$A5
    bne     DISASM_NOT_LDA_DP
    jmp     DISASM_LDA_DP
DISASM_NOT_LDA_DP:
    cmp     #$B5
    bne     DISASM_NOT_LDA_DPX
    jmp     DISASM_LDA_DPX
DISASM_NOT_LDA_DPX:
    cmp     #$AD
    bne     DISASM_NOT_LDA_ABS
    jmp     DISASM_LDA_ABS
DISASM_NOT_LDA_ABS:
    cmp     #$BD
    bne     DISASM_NOT_LDA_ABSX
    jmp     DISASM_LDA_ABSX
DISASM_NOT_LDA_ABSX:
    cmp     #$B9
    bne     DISASM_NOT_LDA_ABSY
    jmp     DISASM_LDA_ABSY
DISASM_NOT_LDA_ABSY:
    cmp     #$C5
    bne     DISASM_NOT_CMP_DP
    jmp     DISASM_CMP_DP
DISASM_NOT_CMP_DP:
    cmp     #$D5
    bne     DISASM_NOT_CMP_DPX
    jmp     DISASM_CMP_DPX
DISASM_NOT_CMP_DPX:
    cmp     #$CD
    bne     DISASM_NOT_CMP_ABS
    jmp     DISASM_CMP_ABS
DISASM_NOT_CMP_ABS:
    cmp     #$DD
    bne     DISASM_NOT_CMP_ABSX
    jmp     DISASM_CMP_ABSX
DISASM_NOT_CMP_ABSX:
    cmp     #$D9
    bne     DISASM_NOT_CMP_ABSY
    jmp     DISASM_CMP_ABSY
DISASM_NOT_CMP_ABSY:
    cmp     #$25
    bne     DISASM_NOT_AND_DP
    jmp     DISASM_AND_DP
DISASM_NOT_AND_DP:
    cmp     #$35
    bne     DISASM_NOT_AND_DPX
    jmp     DISASM_AND_DPX
DISASM_NOT_AND_DPX:
    cmp     #$2D
    bne     DISASM_NOT_AND_ABS
    jmp     DISASM_AND_ABS
DISASM_NOT_AND_ABS:
    cmp     #$3D
    bne     DISASM_NOT_AND_ABSX
    jmp     DISASM_AND_ABSX
DISASM_NOT_AND_ABSX:
    cmp     #$39
    bne     DISASM_NOT_AND_ABSY
    jmp     DISASM_AND_ABSY
DISASM_NOT_AND_ABSY:
    cmp     #$05
    bne     DISASM_NOT_ORA_DP
    jmp     DISASM_ORA_DP
DISASM_NOT_ORA_DP:
    cmp     #$15
    bne     DISASM_NOT_ORA_DPX
    jmp     DISASM_ORA_DPX
DISASM_NOT_ORA_DPX:
    cmp     #$0D
    bne     DISASM_NOT_ORA_ABS
    jmp     DISASM_ORA_ABS
DISASM_NOT_ORA_ABS:
    cmp     #$1D
    bne     DISASM_NOT_ORA_ABSX
    jmp     DISASM_ORA_ABSX
DISASM_NOT_ORA_ABSX:
    cmp     #$19
    bne     DISASM_NOT_ORA_ABSY
    jmp     DISASM_ORA_ABSY
DISASM_NOT_ORA_ABSY:
    cmp     #$45
    bne     DISASM_NOT_EOR_DP
    jmp     DISASM_EOR_DP
DISASM_NOT_EOR_DP:
    cmp     #$55
    bne     DISASM_NOT_EOR_DPX
    jmp     DISASM_EOR_DPX
DISASM_NOT_EOR_DPX:
    cmp     #$4D
    bne     DISASM_NOT_EOR_ABS
    jmp     DISASM_EOR_ABS
DISASM_NOT_EOR_ABS:
    cmp     #$5D
    bne     DISASM_NOT_EOR_ABSX
    jmp     DISASM_EOR_ABSX
DISASM_NOT_EOR_ABSX:
    cmp     #$59
    bne     DISASM_NOT_EOR_ABSY
    jmp     DISASM_EOR_ABSY
DISASM_NOT_EOR_ABSY:
    cmp     #$65
    bne     DISASM_NOT_ADC_DP
    jmp     DISASM_ADC_DP
DISASM_NOT_ADC_DP:
    cmp     #$75
    bne     DISASM_NOT_ADC_DPX
    jmp     DISASM_ADC_DPX
DISASM_NOT_ADC_DPX:
    cmp     #$6D
    bne     DISASM_NOT_ADC_ABS
    jmp     DISASM_ADC_ABS
DISASM_NOT_ADC_ABS:
    cmp     #$7D
    bne     DISASM_NOT_ADC_ABSX
    jmp     DISASM_ADC_ABSX
DISASM_NOT_ADC_ABSX:
    cmp     #$79
    bne     DISASM_NOT_ADC_ABSY
    jmp     DISASM_ADC_ABSY
DISASM_NOT_ADC_ABSY:
    cmp     #$E5
    bne     DISASM_NOT_SBC_DP
    jmp     DISASM_SBC_DP
DISASM_NOT_SBC_DP:
    cmp     #$F5
    bne     DISASM_NOT_SBC_DPX
    jmp     DISASM_SBC_DPX
DISASM_NOT_SBC_DPX:
    cmp     #$ED
    bne     DISASM_NOT_SBC_ABS
    jmp     DISASM_SBC_ABS
DISASM_NOT_SBC_ABS:
    cmp     #$FD
    bne     DISASM_NOT_SBC_ABSX
    jmp     DISASM_SBC_ABSX
DISASM_NOT_SBC_ABSX:
    cmp     #$F9
    bne     DISASM_NOT_SBC_ABSY
    jmp     DISASM_SBC_ABSY
DISASM_NOT_SBC_ABSY:
    cmp     #$A2
    bne     DISASM_NOT_LDX_IMM
    jmp     DISASM_LDX_IMM
DISASM_NOT_LDX_IMM:
    cmp     #$A6
    bne     DISASM_NOT_LDX_DP
    jmp     DISASM_LDX_DP
DISASM_NOT_LDX_DP:
    cmp     #$B6
    bne     DISASM_NOT_LDX_DPY
    jmp     DISASM_LDX_DPY
DISASM_NOT_LDX_DPY:
    cmp     #$AE
    bne     DISASM_NOT_LDX_ABS
    jmp     DISASM_LDX_ABS
DISASM_NOT_LDX_ABS:
    cmp     #$BE
    bne     DISASM_NOT_LDX_ABSY
    jmp     DISASM_LDX_ABSY
DISASM_NOT_LDX_ABSY:
    cmp     #$A0
    bne     DISASM_NOT_LDY_IMM
    jmp     DISASM_LDY_IMM
DISASM_NOT_LDY_IMM:
    cmp     #$A4
    bne     DISASM_NOT_LDY_DP
    jmp     DISASM_LDY_DP
DISASM_NOT_LDY_DP:
    cmp     #$B4
    bne     DISASM_NOT_LDY_DPX
    jmp     DISASM_LDY_DPX
DISASM_NOT_LDY_DPX:
    cmp     #$AC
    bne     DISASM_NOT_LDY_ABS
    jmp     DISASM_LDY_ABS
DISASM_NOT_LDY_ABS:
    cmp     #$BC
    bne     DISASM_NOT_LDY_ABSX
    jmp     DISASM_LDY_ABSX
DISASM_NOT_LDY_ABSX:
    cmp     #$F0
    bne     DISASM_NOT_BEQ
    jmp     DISASM_BEQ
DISASM_NOT_BEQ:
    cmp     #$D0
    bne     DISASM_NOT_BNE
    jmp     DISASM_BNE
DISASM_NOT_BNE:
    cmp     #$90
    bne     DISASM_NOT_BCC
    jmp     DISASM_BCC
DISASM_NOT_BCC:
    cmp     #$B0
    bne     DISASM_NOT_BCS
    jmp     DISASM_BCS
DISASM_NOT_BCS:
    cmp     #$30
    bne     DISASM_NOT_BMI
    jmp     DISASM_BMI
DISASM_NOT_BMI:
    cmp     #$10
    bne     DISASM_NOT_BPL
    jmp     DISASM_BPL
DISASM_NOT_BPL:
    cmp     #$85
    bne     DISASM_NOT_STA_DP
    jmp     DISASM_STA_DP
DISASM_NOT_STA_DP:
    cmp     #$95
    bne     DISASM_NOT_STA_DPX
    jmp     DISASM_STA_DPX
DISASM_NOT_STA_DPX:
    cmp     #$8D
    bne     DISASM_NOT_STA_ABS
    jmp     DISASM_STA_ABS
DISASM_NOT_STA_ABS:
    cmp     #$9D
    bne     DISASM_NOT_STA_ABSX
    jmp     DISASM_STA_ABSX
DISASM_NOT_STA_ABSX:
    cmp     #$99
    bne     DISASM_NOT_STA_ABSY
    jmp     DISASM_STA_ABSY
DISASM_NOT_STA_ABSY:
    cmp     #$86
    bne     DISASM_NOT_STX_DP
    jmp     DISASM_STX_DP
DISASM_NOT_STX_DP:
    cmp     #$96
    bne     DISASM_NOT_STX_DPY
    jmp     DISASM_STX_DPY
DISASM_NOT_STX_DPY:
    cmp     #$8E
    bne     DISASM_NOT_STX_ABS
    jmp     DISASM_STX_ABS
DISASM_NOT_STX_ABS:
    cmp     #$84
    bne     DISASM_NOT_STY_DP
    jmp     DISASM_STY_DP
DISASM_NOT_STY_DP:
    cmp     #$94
    bne     DISASM_NOT_STY_DPX
    jmp     DISASM_STY_DPX
DISASM_NOT_STY_DPX:
    cmp     #$8C
    bne     DISASM_NOT_STY_ABS
    jmp     DISASM_STY_ABS
DISASM_NOT_STY_ABS:
    cmp     #$AA
    bne     DISASM_NOT_TAX
    jmp     DISASM_TAX
DISASM_NOT_TAX:
    cmp     #$A8
    bne     DISASM_NOT_TAY
    jmp     DISASM_TAY
DISASM_NOT_TAY:
    cmp     #$8A
    bne     DISASM_NOT_TXA
    jmp     DISASM_TXA
DISASM_NOT_TXA:
    cmp     #$98
    bne     DISASM_NOT_TYA
    jmp     DISASM_TYA
DISASM_NOT_TYA:
    cmp     #$BA
    bne     DISASM_NOT_TSX
    jmp     DISASM_TSX
DISASM_NOT_TSX:
    cmp     #$9A
    bne     DISASM_NOT_TXS
    jmp     DISASM_TXS
DISASM_NOT_TXS:
    cmp     #$E8
    bne     DISASM_NOT_INX
    jmp     DISASM_INX
DISASM_NOT_INX:
    cmp     #$CA
    bne     DISASM_NOT_DEX
    jmp     DISASM_DEX
DISASM_NOT_DEX:
    cmp     #$C8
    bne     DISASM_NOT_INY
    jmp     DISASM_INY
DISASM_NOT_INY:
    cmp     #$88
    bne     DISASM_NOT_DEY
    jmp     DISASM_DEY
DISASM_NOT_DEY:
    cmp     #$18
    bne     DISASM_NOT_CLC
    jmp     DISASM_CLC
DISASM_NOT_CLC:
    cmp     #$38
    bne     DISASM_NOT_SEC
    jmp     DISASM_SEC
DISASM_NOT_SEC:
    cmp     #$58
    bne     DISASM_NOT_CLI
    jmp     DISASM_CLI
DISASM_NOT_CLI:
    cmp     #$78
    bne     DISASM_NOT_SEI
    jmp     DISASM_SEI
DISASM_NOT_SEI:
    cmp     #$B8
    bne     DISASM_NOT_CLV
    jmp     DISASM_CLV
DISASM_NOT_CLV:
    cmp     #$D8
    bne     DISASM_NOT_CLD
    jmp     DISASM_CLD
DISASM_NOT_CLD:
    cmp     #$F8
    bne     DISASM_NOT_SED
    jmp     DISASM_SED
DISASM_NOT_SED:
    cmp     #$60
    bne     DISASM_NOT_RTS
    jmp     DISASM_RTS
DISASM_NOT_RTS:
    cmp     #$EA
    bne     DISASM_NOT_NOP
    jmp     DISASM_NOP
DISASM_NOT_NOP:
    cmp     #$E2
    bne     DISASM_NOT_SEP_IMM
    jmp     DISASM_SEP_IMM
DISASM_NOT_SEP_IMM:
    cmp     #$C2
    bne     DISASM_NOT_REP_IMM
    jmp     DISASM_REP_IMM
DISASM_NOT_REP_IMM:
    cmp     #$20
    bne     DISASM_NOT_JSR_ABS
    jmp     DISASM_JSR_ABS
DISASM_NOT_JSR_ABS:
    cmp     #$4C
    bne     DISASM_NOT_JMP_ABS
    jmp     DISASM_JMP_ABS
DISASM_NOT_JMP_ABS:
    jmp     DISASM_UNKNOWN

DISASM_LDA_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_LDA
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_CMP_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_CMP
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_AND_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_AND
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_ORA_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_ORA
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_EOR_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_EOR
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_ADC_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_ADC
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_SBC_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_SBC
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_LDA_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_LDA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_LDA_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_LDA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_LDA_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDA_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_LDA_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_LDA_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_CMP_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_CMP_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_CMP_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_CMP_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_CMP_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_CMP_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_CMP_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_CMP_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_CMP_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_CMP_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_AND_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_AND_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_AND_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_AND_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_AND_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_AND_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_AND_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_AND_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_AND_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_AND_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_ORA_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_ORA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_ORA_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_ORA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_ORA_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_ORA_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_ORA_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_ORA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_ORA_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_ORA_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_EOR_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_EOR_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_EOR_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_EOR_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_EOR_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_EOR_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_EOR_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_EOR_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_EOR_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_EOR_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_ADC_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_ADC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_ADC_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_ADC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_ADC_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_ADC_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_ADC_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_ADC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_ADC_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_ADC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_SBC_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_SBC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_SBC_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_SBC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_SBC_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_SBC_ABS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT
DISASM_SBC_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_SBC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_SBC_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_SBC_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_LDX_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_LDX
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT
DISASM_LDX_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_LDX_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_LDX_DPY:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_LDX_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPY_NEXT
DISASM_LDX_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDX_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABS_NEXT
DISASM_LDX_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDX_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_LDY_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_LDY
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT
DISASM_LDY_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_LDY_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_LDY_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_LDY_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_LDY_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDY_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABS_NEXT
DISASM_LDY_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_LDY_ABS
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT

DISASM_BEQ:
    jsr     DISASM_FETCH_BRANCH
    ldx     #STR_D_BEQ
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_BNE:
    jsr     DISASM_FETCH_BRANCH
    ldx     #STR_D_BNE
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_BCC:
    jsr     DISASM_FETCH_BRANCH
    ldx     #STR_D_BCC
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_BCS:
    jsr     DISASM_FETCH_BRANCH
    ldx     #STR_D_BCS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_BMI:
    jsr     DISASM_FETCH_BRANCH
    ldx     #STR_D_BMI
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_BPL:
    jsr     DISASM_FETCH_BRANCH
    ldx     #STR_D_BPL
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_SEP_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_SEP
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_REP_IMM:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    ldx     #STR_D_REP
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2
    jmp     DISASM_NEXT

DISASM_STA_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_STA
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_STA_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_STA
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_STA_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_STA
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABS_NEXT
DISASM_STA_ABSX:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_STA
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSX_NEXT
DISASM_STA_ABSY:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_STA
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABSY_NEXT

DISASM_STX_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_STX
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_STX_DPY:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_STX
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPY_NEXT
DISASM_STX_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_STX
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABS_NEXT

DISASM_STY_DP:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_STY
    stx     ZP_PTR
    jmp     DISASM_PRINT_DP_NEXT
DISASM_STY_DPX:
    jsr     DISASM_FETCH_DP
    ldx     #STR_D_STY
    stx     ZP_PTR
    jmp     DISASM_PRINT_DPX_NEXT
DISASM_STY_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_STY
    stx     ZP_PTR
    jmp     DISASM_PRINT_ABS_NEXT

DISASM_TAX:
    ldx     #STR_D_TAX
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_TAY:
    ldx     #STR_D_TAY
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_TXA:
    ldx     #STR_D_TXA
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_TYA:
    ldx     #STR_D_TYA
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_TSX:
    ldx     #STR_D_TSX
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_TXS:
    ldx     #STR_D_TXS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_INX:
    ldx     #STR_D_INX
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_DEX:
    ldx     #STR_D_DEX
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_INY:
    ldx     #STR_D_INY
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_DEY:
    ldx     #STR_D_DEY
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_CLC:
    ldx     #STR_D_CLC
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_SEC:
    ldx     #STR_D_SEC
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_CLI:
    ldx     #STR_D_CLI
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_SEI:
    ldx     #STR_D_SEI
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_CLV:
    ldx     #STR_D_CLV
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_CLD:
    ldx     #STR_D_CLD
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT
DISASM_SED:
    ldx     #STR_D_SED
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

DISASM_JSR_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_JSR
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_JMP_ABS:
    jsr     DISASM_FETCH_ABS
    ldx     #STR_D_JMP
    stx     ZP_PTR
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_RTS:
    ldx     #STR_D_RTS
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

DISASM_NOP:
    ldx     #STR_D_NOP
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

DISASM_UNKNOWN:
    ldx     #STR_D_DB
    stx     ZP_PTR
    jsr     PRINT_ZP
    lda     ZP_OPER
    jsr     PUT_HEX2

DISASM_NEXT:
    dec     ZP_ERR
    beq     DISASM_DONE
    jmp     DISASM_LOOP

DISASM_DONE:
    jsr     CRLF
    jmp     MAIN_LOOP

; =============================================================================
; Subroutines
; =============================================================================

; ---------------------------------------------------------------------------
; READLINE — Read one line from terminal into INBUF, set INBUF_LEN.
; Echoes characters.  Handles backspace ($08 or $7F).
; Terminated by CR ($0D); LF ($0A) is ignored.
; ---------------------------------------------------------------------------
READLINE:
    ldx     #0                  ; X = char count
READLINE_LOOP:
    jsr     GETCHAR
    cmp     #$0D                ; CR → done
    beq     READLINE_DONE
    cmp     #$0A                ; LF → ignore
    beq     READLINE_LOOP
    cmp     #$08                ; backspace
    beq     READLINE_BS
    cmp     #$7F                ; DEL (also backspace)
    beq     READLINE_BS

    cpx     #63                 ; buffer full?
    bcs     READLINE_LOOP       ; yes — discard char
    sta     INBUF,x             ; store char in buffer
    inx
    sta     CHAR_OUT            ; echo
    bra     READLINE_LOOP

READLINE_BS:
    cpx     #0                  ; nothing to delete?
    beq     READLINE_LOOP
    dex
    lda     #$08
    sta     CHAR_OUT            ; backspace
    lda     #' '
    sta     CHAR_OUT            ; erase
    lda     #$08
    sta     CHAR_OUT            ; backspace again
    bra     READLINE_LOOP

READLINE_DONE:
    txa                         ; X (count) → A low byte (fits in 8 bits)
    sta     INBUF_LEN
    jsr     CRLF
    rts

; ---------------------------------------------------------------------------
; GETCHAR — Blocking read of one character.  Returns char in A.
; ---------------------------------------------------------------------------
GETCHAR:
    lda     CHAR_STS
    and     #$01
    beq     GETCHAR
    lda     CHAR_IN
    rts

; ---------------------------------------------------------------------------
; CRLF — Print carriage-return + line-feed.
; ---------------------------------------------------------------------------
CRLF:
    lda     #$0D
    sta     CHAR_OUT
    lda     #$0A
    sta     CHAR_OUT
    rts

; ---------------------------------------------------------------------------
; PRINT_ZP — Print null-terminated string whose address is in ZP_PTR ($00–$01).
; ---------------------------------------------------------------------------
PRINT_ZP:
    ldy     #0
PRINT_ZP_LOOP:
    lda     (ZP_PTR),y
    beq     PRINT_ZP_DONE
    sta     CHAR_OUT
    iny
    bra     PRINT_ZP_LOOP
PRINT_ZP_DONE:
    rts

; ---------------------------------------------------------------------------
; PUT_HEX2 — Print accumulator as two hex digits.  A=8, I=16.
; ---------------------------------------------------------------------------
PUT_HEX2:
    pha                         ; save original byte
    lsr
    lsr
    lsr
    lsr
    jsr     PUT_NIBBLE          ; high nibble
    pla
    and     #$0F
    jsr     PUT_NIBBLE          ; low nibble
    rts

; PUT_NIBBLE — Print low 4 bits of A as a single hex digit.
PUT_NIBBLE:
    cmp     #10
    bcc     PUT_NIBBLE_DIGIT
    ; carry is set (A >= 10), adc #$36 → adc #($37-1) + carry
    adc     #$36                ; 10→'A' (adc adds $36 + 1 carry = $37)
    bra     PUT_NIBBLE_OUT
PUT_NIBBLE_DIGIT:
    adc     #'0'                ; carry clear → adds '0' exactly
PUT_NIBBLE_OUT:
    sta     CHAR_OUT
    rts

; ---------------------------------------------------------------------------
; PUT_HEX4_X — Print X register as four hex digits.  A=8 in/out, I=16.
; ---------------------------------------------------------------------------
PUT_HEX4_X:
    rep     #$20
    .a16
    txa                         ; A = X (16-bit)
    sta     ZP_TMP              ; ZP_TMP = lo byte, ZP_TMP+1 = hi byte
    sep     #$20
    .a8
    lda     ZP_TMP+1            ; high byte first
    jsr     PUT_HEX2
    lda     ZP_TMP              ; low byte
    jsr     PUT_HEX2
    rts

; ---------------------------------------------------------------------------
; Assembly-mode helpers
; ---------------------------------------------------------------------------

ASM_PARSE_LINE:
    sep     #$20
    .a8
    lda     #0
    sta     ZP_ERR
    jsr     ASM_SKIP_SPACES
    rep     #$20
    .a16
    txa
    sta     ZP_PTR              ; restore point if this is not a label
    sep     #$20
    .a8
    jsr     ASM_PARSE_LABEL_DEF
    cmp     #1
    bne     ASM_PARSE_LINE_NOT_LABEL
    rts
ASM_PARSE_LINE_NOT_LABEL:
    rep     #$20
    .a16
    ldx     ZP_PTR
    sep     #$20
    .a8
    jsr     ASM_READ_UPPER
    cmp     #'.'
    bne     ASM_PARSE_LINE_NOT_DOT
    jmp     ASM_PARSE_DOT
ASM_PARSE_LINE_NOT_DOT:
    cmp     #'A'
    bne     ASM_PARSE_LINE_NOT_A
    jmp     ASM_PARSE_A
ASM_PARSE_LINE_NOT_A:
    cmp     #'B'
    bne     ASM_PARSE_LINE_NOT_B
    jmp     ASM_PARSE_B
ASM_PARSE_LINE_NOT_B:
    cmp     #'C'
    bne     ASM_PARSE_LINE_NOT_C
    jmp     ASM_PARSE_C
ASM_PARSE_LINE_NOT_C:
    cmp     #'D'
    bne     ASM_PARSE_LINE_NOT_D
    jmp     ASM_PARSE_D
ASM_PARSE_LINE_NOT_D:
    cmp     #'E'
    bne     ASM_PARSE_LINE_NOT_E
    jmp     ASM_PARSE_E
ASM_PARSE_LINE_NOT_E:
    cmp     #'I'
    bne     ASM_PARSE_LINE_NOT_I
    jmp     ASM_PARSE_I
ASM_PARSE_LINE_NOT_I:
    cmp     #'L'
    bne     ASM_PARSE_LINE_NOT_L
    jmp     ASM_PARSE_L
ASM_PARSE_LINE_NOT_L:
    cmp     #'O'
    bne     ASM_PARSE_LINE_NOT_O
    jmp     ASM_PARSE_O
ASM_PARSE_LINE_NOT_O:
    cmp     #'S'
    bne     ASM_PARSE_LINE_NOT_S
    jmp     ASM_PARSE_S
ASM_PARSE_LINE_NOT_S:
    cmp     #'R'
    bne     ASM_PARSE_LINE_NOT_R
    jmp     ASM_PARSE_R
ASM_PARSE_LINE_NOT_R:
    cmp     #'T'
    bne     ASM_PARSE_LINE_NOT_T
    jmp     ASM_PARSE_T
ASM_PARSE_LINE_NOT_T:
    cmp     #'N'
    bne     ASM_PARSE_LINE_NOT_N
    jmp     ASM_PARSE_N
ASM_PARSE_LINE_NOT_N:
    cmp     #'J'
    bne     ASM_PARSE_LINE_NOT_J
    jmp     ASM_PARSE_J
ASM_PARSE_LINE_NOT_J:
    jmp     ASM_FAIL

ASM_PARSE_DOT:
    jsr     ASM_READ_UPPER
    cmp     #'B'
    beq     ASM_PARSE_DOT_B
    jmp     ASM_FAIL
ASM_PARSE_DOT_B:
    jsr     ASM_READ_UPPER
    cmp     #'Y'
    beq     ASM_PARSE_DOT_BY
    jmp     ASM_FAIL
ASM_PARSE_DOT_BY:
    jsr     ASM_READ_UPPER
    cmp     #'T'
    beq     ASM_PARSE_DOT_BYT
    jmp     ASM_FAIL
ASM_PARSE_DOT_BYT:
    jsr     ASM_READ_UPPER
    cmp     #'E'
    bne     ASM_PARSE_DOT_BYT_NOT_E
    jmp     ASM_PARSE_BYTE_LIST
ASM_PARSE_DOT_BYT_NOT_E:
    jmp     ASM_FAIL

ASM_PARSE_D:
    jsr     ASM_READ_UPPER
    cmp     #'B'
    bne     ASM_PARSE_D_NOT_B
    jmp     ASM_PARSE_BYTE_LIST
ASM_PARSE_D_NOT_B:
    cmp     #'E'
    bne     ASM_PARSE_D_NOT_E
    jsr     ASM_READ_UPPER
    cmp     #'X'
    beq     ASM_PARSE_DEX
    cmp     #'Y'
    beq     ASM_PARSE_DEY
    jmp     ASM_FAIL
ASM_PARSE_DEX:
    lda     #$CA                ; DEX
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_DEY:
    lda     #$88                ; DEY
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_D_NOT_E:
    jmp     ASM_FAIL

ASM_PARSE_B:
    jsr     ASM_READ_UPPER
    cmp     #'E'
    beq     ASM_PARSE_BEQ
    cmp     #'N'
    beq     ASM_PARSE_BNE
    cmp     #'C'
    beq     ASM_PARSE_BC
    cmp     #'M'
    beq     ASM_PARSE_BMI
    cmp     #'P'
    beq     ASM_PARSE_BPL
    jmp     ASM_FAIL

ASM_PARSE_BEQ:
    jsr     ASM_READ_UPPER
    cmp     #'Q'
    beq     ASM_PARSE_BEQ_OK
    jmp     ASM_FAIL
ASM_PARSE_BEQ_OK:
    lda     #$F0                ; BEQ rel8, source uses absolute target
    jsr     ASM_PARSE_BRANCH_OPER
    rts

ASM_PARSE_BNE:
    jsr     ASM_READ_UPPER
    cmp     #'E'
    beq     ASM_PARSE_BNE_OK
    jmp     ASM_FAIL
ASM_PARSE_BNE_OK:
    lda     #$D0                ; BNE rel8, source uses absolute target
    jsr     ASM_PARSE_BRANCH_OPER
    rts

ASM_PARSE_BC:
    jsr     ASM_READ_UPPER
    cmp     #'C'
    beq     ASM_PARSE_BCC_OK
    cmp     #'S'
    beq     ASM_PARSE_BCS_OK
    jmp     ASM_FAIL
ASM_PARSE_BCC_OK:
    lda     #$90                ; BCC rel8, source uses absolute target
    jsr     ASM_PARSE_BRANCH_OPER
    rts
ASM_PARSE_BCS_OK:
    lda     #$B0                ; BCS rel8, source uses absolute target
    jsr     ASM_PARSE_BRANCH_OPER
    rts

ASM_PARSE_BMI:
    jsr     ASM_READ_UPPER
    cmp     #'I'
    beq     ASM_PARSE_BMI_OK
    jmp     ASM_FAIL
ASM_PARSE_BMI_OK:
    lda     #$30                ; BMI rel8, source uses absolute target
    jsr     ASM_PARSE_BRANCH_OPER
    rts

ASM_PARSE_BPL:
    jsr     ASM_READ_UPPER
    cmp     #'L'
    beq     ASM_PARSE_BPL_OK
    jmp     ASM_FAIL
ASM_PARSE_BPL_OK:
    lda     #$10                ; BPL rel8, source uses absolute target
    jsr     ASM_PARSE_BRANCH_OPER
    rts

ASM_PARSE_A:
    jsr     ASM_READ_UPPER
    cmp     #'D'
    beq     ASM_PARSE_ADC
    cmp     #'N'
    beq     ASM_PARSE_AND
    jmp     ASM_FAIL

ASM_PARSE_ADC:
    jsr     ASM_READ_UPPER
    cmp     #'C'
    beq     ASM_PARSE_ADC_GOT_C
    jmp     ASM_FAIL
ASM_PARSE_ADC_GOT_C:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_ADC_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_ADC_OK
    rts
ASM_PARSE_ADC_OK:
    lda     #$69                ; ADC #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_ADC_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_ADC_ADDR_OK
    rts
ASM_PARSE_ADC_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_ADC_DP
    cmp     #1
    beq     ASM_PARSE_ADC_ABS_OK
    cmp     #2
    beq     ASM_PARSE_ADC_DPX
    cmp     #4
    beq     ASM_PARSE_ADC_ABSX
    cmp     #5
    beq     ASM_PARSE_ADC_ABSY
    jmp     ASM_FAIL
ASM_PARSE_ADC_DP:
    lda     #$65                ; ADC dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_ADC_DPX:
    lda     #$75                ; ADC dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_ADC_ABS_OK:
    lda     #$6D                ; ADC abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_ADC_ABSX:
    lda     #$7D                ; ADC abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_ADC_ABSY:
    lda     #$79                ; ADC abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_AND:
    jsr     ASM_READ_UPPER
    cmp     #'D'
    beq     ASM_PARSE_AND_GOT_D
    jmp     ASM_FAIL
ASM_PARSE_AND_GOT_D:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_AND_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_AND_OK
    rts
ASM_PARSE_AND_OK:
    lda     #$29                ; AND #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_AND_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_AND_ADDR_OK
    rts
ASM_PARSE_AND_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_AND_DP
    cmp     #1
    beq     ASM_PARSE_AND_ABS_OK
    cmp     #2
    beq     ASM_PARSE_AND_DPX
    cmp     #4
    beq     ASM_PARSE_AND_ABSX
    cmp     #5
    beq     ASM_PARSE_AND_ABSY
    jmp     ASM_FAIL
ASM_PARSE_AND_DP:
    lda     #$25                ; AND dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_AND_DPX:
    lda     #$35                ; AND dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_AND_ABS_OK:
    lda     #$2D                ; AND abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_AND_ABSX:
    lda     #$3D                ; AND abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_AND_ABSY:
    lda     #$39                ; AND abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_C:
    jsr     ASM_READ_UPPER
    cmp     #'M'
    beq     ASM_PARSE_C_GOT_M
    cmp     #'L'
    beq     ASM_PARSE_CL
    jmp     ASM_FAIL
ASM_PARSE_CL:
    jsr     ASM_READ_UPPER
    cmp     #'C'
    beq     ASM_PARSE_CLC
    cmp     #'V'
    beq     ASM_PARSE_CLV
    cmp     #'D'
    beq     ASM_PARSE_CLD
    cmp     #'I'
    beq     ASM_PARSE_CLI
    jmp     ASM_FAIL
ASM_PARSE_CLC:
    lda     #$18                ; CLC
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_CLV:
    lda     #$B8                ; CLV
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_CLD:
    lda     #$D8                ; CLD
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_CLI:
    lda     #$58                ; CLI
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_C_GOT_M:
    jsr     ASM_READ_UPPER
    cmp     #'P'
    beq     ASM_PARSE_C_GOT_P
    jmp     ASM_FAIL
ASM_PARSE_C_GOT_P:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_C_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_C_OK
    rts
ASM_PARSE_C_OK:
    lda     #$C9                ; CMP #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_C_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_C_ADDR_OK
    rts
ASM_PARSE_C_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_C_DP
    cmp     #1
    beq     ASM_PARSE_C_ABS_OK
    cmp     #2
    beq     ASM_PARSE_C_DPX
    cmp     #4
    beq     ASM_PARSE_C_ABSX
    cmp     #5
    beq     ASM_PARSE_C_ABSY
    jmp     ASM_FAIL
ASM_PARSE_C_DP:
    lda     #$C5                ; CMP dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_C_DPX:
    lda     #$D5                ; CMP dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_C_ABS_OK:
    lda     #$CD                ; CMP abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_C_ABSX:
    lda     #$DD                ; CMP abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_C_ABSY:
    lda     #$D9                ; CMP abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_E:
    jsr     ASM_READ_UPPER
    cmp     #'O'
    beq     ASM_PARSE_E_GOT_O
    jmp     ASM_FAIL
ASM_PARSE_E_GOT_O:
    jsr     ASM_READ_UPPER
    cmp     #'R'
    beq     ASM_PARSE_E_GOT_R
    jmp     ASM_FAIL
ASM_PARSE_E_GOT_R:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_E_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_E_OK
    rts
ASM_PARSE_E_OK:
    lda     #$49                ; EOR #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_E_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_E_ADDR_OK
    rts
ASM_PARSE_E_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_E_DP
    cmp     #1
    beq     ASM_PARSE_E_ABS_OK
    cmp     #2
    beq     ASM_PARSE_E_DPX
    cmp     #4
    beq     ASM_PARSE_E_ABSX
    cmp     #5
    beq     ASM_PARSE_E_ABSY
    jmp     ASM_FAIL
ASM_PARSE_E_DP:
    lda     #$45                ; EOR dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_E_DPX:
    lda     #$55                ; EOR dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_E_ABS_OK:
    lda     #$4D                ; EOR abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_E_ABSX:
    lda     #$5D                ; EOR abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_E_ABSY:
    lda     #$59                ; EOR abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_I:
    jsr     ASM_READ_UPPER
    cmp     #'N'
    beq     ASM_PARSE_IN
    jmp     ASM_FAIL
ASM_PARSE_IN:
    jsr     ASM_READ_UPPER
    cmp     #'X'
    beq     ASM_PARSE_INX
    cmp     #'Y'
    beq     ASM_PARSE_INY
    jmp     ASM_FAIL
ASM_PARSE_INX:
    lda     #$E8                ; INX
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_INY:
    lda     #$C8                ; INY
    jmp     ASM_EMIT_IMPLIED

ASM_PARSE_O:
    jsr     ASM_READ_UPPER
    cmp     #'R'
    beq     ASM_PARSE_O_GOT_R
    jmp     ASM_FAIL
ASM_PARSE_O_GOT_R:
    jsr     ASM_READ_UPPER
    cmp     #'A'
    beq     ASM_PARSE_O_GOT_A
    jmp     ASM_FAIL
ASM_PARSE_O_GOT_A:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_O_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_O_OK
    rts
ASM_PARSE_O_OK:
    lda     #$09                ; ORA #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_O_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_O_ADDR_OK
    rts
ASM_PARSE_O_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_O_DP
    cmp     #1
    beq     ASM_PARSE_O_ABS_OK
    cmp     #2
    beq     ASM_PARSE_O_DPX
    cmp     #4
    beq     ASM_PARSE_O_ABSX
    cmp     #5
    beq     ASM_PARSE_O_ABSY
    jmp     ASM_FAIL
ASM_PARSE_O_DP:
    lda     #$05                ; ORA dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_O_DPX:
    lda     #$15                ; ORA dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_O_ABS_OK:
    lda     #$0D                ; ORA abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_O_ABSX:
    lda     #$1D                ; ORA abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_O_ABSY:
    lda     #$19                ; ORA abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_L:
    jsr     ASM_READ_UPPER
    cmp     #'D'
    beq     ASM_PARSE_L_GOT_D
    jmp     ASM_FAIL
ASM_PARSE_L_GOT_D:
    jsr     ASM_READ_UPPER
    cmp     #'A'
    beq     ASM_PARSE_L_GOT_A
    cmp     #'X'
    beq     ASM_PARSE_LDX
    cmp     #'Y'
    bne     ASM_PARSE_L_NOT_Y
    jmp     ASM_PARSE_LDY
ASM_PARSE_L_NOT_Y:
    jmp     ASM_FAIL
ASM_PARSE_L_GOT_A:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_L_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_L_OK
    rts
ASM_PARSE_L_OK:
    lda     #$A9                ; LDA #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_L_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_L_ADDR_OK
    rts
ASM_PARSE_L_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_L_DP
    cmp     #1
    beq     ASM_PARSE_L_ABS_OK
    cmp     #2
    beq     ASM_PARSE_L_DPX
    cmp     #4
    beq     ASM_PARSE_L_ABSX
    cmp     #5
    beq     ASM_PARSE_L_ABSY
    jmp     ASM_FAIL
ASM_PARSE_L_DP:
    lda     #$A5                ; LDA dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_L_DPX:
    lda     #$B5                ; LDA dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_L_ABS_OK:
    lda     #$AD                ; LDA abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_L_ABSX:
    lda     #$BD                ; LDA abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_L_ABSY:
    lda     #$B9                ; LDA abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_LDX:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_LDX_ADDR
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_LDX_IMM_OK
    rts
ASM_PARSE_LDX_IMM_OK:
    lda     #$A2                ; LDX #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_LDX_ADDR:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_LDX_ADDR_OK
    rts
ASM_PARSE_LDX_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_LDX_DP
    cmp     #1
    beq     ASM_PARSE_LDX_ABS
    cmp     #3
    beq     ASM_PARSE_LDX_DPY
    cmp     #5
    beq     ASM_PARSE_LDX_ABSY
    jmp     ASM_FAIL
ASM_PARSE_LDX_DP:
    lda     #$A6                ; LDX dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_LDX_DPY:
    lda     #$B6                ; LDX dp,y
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_LDX_ABS:
    lda     #$AE                ; LDX abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_LDX_ABSY:
    lda     #$BE                ; LDX abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_LDY:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_LDY_ADDR
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_LDY_IMM_OK
    rts
ASM_PARSE_LDY_IMM_OK:
    lda     #$A0                ; LDY #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_LDY_ADDR:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_LDY_ADDR_OK
    rts
ASM_PARSE_LDY_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_LDY_DP
    cmp     #1
    beq     ASM_PARSE_LDY_ABS
    cmp     #2
    beq     ASM_PARSE_LDY_DPX
    cmp     #4
    beq     ASM_PARSE_LDY_ABSX
    jmp     ASM_FAIL
ASM_PARSE_LDY_DP:
    lda     #$A4                ; LDY dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_LDY_DPX:
    lda     #$B4                ; LDY dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_LDY_ABS:
    lda     #$AC                ; LDY abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_LDY_ABSX:
    lda     #$BC                ; LDY abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_S:
    jsr     ASM_READ_UPPER
    cmp     #'B'
    bne     ASM_PARSE_S_NOT_B
    jmp     ASM_PARSE_SBC
ASM_PARSE_S_NOT_B:
    cmp     #'T'
    beq     ASM_PARSE_STA
    cmp     #'E'
    bne     ASM_PARSE_S_NOT_E
    jmp     ASM_PARSE_SEP
ASM_PARSE_S_NOT_E:
    jmp     ASM_FAIL

ASM_PARSE_STA:
    jsr     ASM_READ_UPPER
    cmp     #'A'
    beq     ASM_PARSE_STA_GOT_A
    cmp     #'X'
    beq     ASM_PARSE_STX
    cmp     #'Y'
    bne     ASM_PARSE_ST_NOT_Y
    jmp     ASM_PARSE_STY
ASM_PARSE_ST_NOT_Y:
    jmp     ASM_FAIL
ASM_PARSE_STA_GOT_A:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_STA_OK
    rts
ASM_PARSE_STA_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_STA_DP
    cmp     #1
    beq     ASM_PARSE_STA_ABS
    cmp     #2
    beq     ASM_PARSE_STA_DPX
    cmp     #4
    beq     ASM_PARSE_STA_ABSX
    cmp     #5
    beq     ASM_PARSE_STA_ABSY
    jmp     ASM_FAIL
ASM_PARSE_STA_DP:
    lda     #$85                ; STA dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_STA_DPX:
    lda     #$95                ; STA dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_STA_ABS:
    lda     #$8D                ; STA abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_STA_ABSX:
    lda     #$9D                ; STA abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_STA_ABSY:
    lda     #$99                ; STA abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_STX:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_STX_OK
    rts
ASM_PARSE_STX_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_STX_DP
    cmp     #1
    beq     ASM_PARSE_STX_ABS
    cmp     #3
    beq     ASM_PARSE_STX_DPY
    jmp     ASM_FAIL
ASM_PARSE_STX_DP:
    lda     #$86                ; STX dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_STX_DPY:
    lda     #$96                ; STX dp,y
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_STX_ABS:
    lda     #$8E                ; STX abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_STY:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_STY_OK
    rts
ASM_PARSE_STY_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_STY_DP
    cmp     #1
    beq     ASM_PARSE_STY_ABS
    cmp     #2
    beq     ASM_PARSE_STY_DPX
    jmp     ASM_FAIL
ASM_PARSE_STY_DP:
    lda     #$84                ; STY dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_STY_DPX:
    lda     #$94                ; STY dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_STY_ABS:
    lda     #$8C                ; STY abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_SEP:
    jsr     ASM_READ_UPPER
    cmp     #'P'
    beq     ASM_PARSE_SEP_GOT_P
    cmp     #'C'
    beq     ASM_PARSE_SEC
    cmp     #'I'
    beq     ASM_PARSE_SEI
    cmp     #'D'
    beq     ASM_PARSE_SED
    jmp     ASM_FAIL
ASM_PARSE_SEC:
    lda     #$38                ; SEC
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_SEI:
    lda     #$78                ; SEI
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_SED:
    lda     #$F8                ; SED
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_SEP_GOT_P:
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_SEP_OK
    rts
ASM_PARSE_SEP_OK:
    lda     #$E2                ; SEP #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts

ASM_PARSE_SBC:
    jsr     ASM_READ_UPPER
    cmp     #'C'
    beq     ASM_PARSE_SBC_GOT_C
    jmp     ASM_FAIL
ASM_PARSE_SBC_GOT_C:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    bne     ASM_PARSE_SBC_ABS
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_SBC_OK
    rts
ASM_PARSE_SBC_OK:
    lda     #$E9                ; SBC #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_PARSE_SBC_ABS:
    jsr     ASM_PARSE_ADDR_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_SBC_ADDR_OK
    rts
ASM_PARSE_SBC_ADDR_OK:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_SBC_DP
    cmp     #1
    beq     ASM_PARSE_SBC_ABS_OK
    cmp     #2
    beq     ASM_PARSE_SBC_DPX
    cmp     #4
    beq     ASM_PARSE_SBC_ABSX
    cmp     #5
    beq     ASM_PARSE_SBC_ABSY
    jmp     ASM_FAIL
ASM_PARSE_SBC_DP:
    lda     #$E5                ; SBC dp
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_SBC_DPX:
    lda     #$F5                ; SBC dp,x
    jsr     ASM_EMIT_A
    jmp     ASM_EMIT_OPER_BYTE
ASM_PARSE_SBC_ABS_OK:
    lda     #$ED                ; SBC abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_SBC_ABSX:
    lda     #$FD                ; SBC abs,x
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts
ASM_PARSE_SBC_ABSY:
    lda     #$F9                ; SBC abs,y
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_R:
    jsr     ASM_READ_UPPER
    cmp     #'T'
    bne     ASM_PARSE_REP
    jsr     ASM_READ_UPPER
    cmp     #'S'
    beq     ASM_PARSE_RTS_OK
    jmp     ASM_FAIL
ASM_PARSE_RTS_OK:
    lda     #$60                ; RTS
    jsr     ASM_EMIT_A
    rts

ASM_PARSE_REP:
    cmp     #'E'
    beq     ASM_PARSE_REP_GOT_E
    jmp     ASM_FAIL
ASM_PARSE_REP_GOT_E:
    jsr     ASM_READ_UPPER
    cmp     #'P'
    beq     ASM_PARSE_REP_GOT_P
    jmp     ASM_FAIL
ASM_PARSE_REP_GOT_P:
    jsr     ASM_PARSE_HASH_VALUE8
    sta     ZP_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_REP_OK
    rts
ASM_PARSE_REP_OK:
    lda     #$C2                ; REP #imm8
    jsr     ASM_EMIT_A
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts

ASM_PARSE_N:
    jsr     ASM_READ_UPPER
    cmp     #'O'
    beq     ASM_PARSE_N_GOT_O
    jmp     ASM_FAIL
ASM_PARSE_N_GOT_O:
    jsr     ASM_READ_UPPER
    cmp     #'P'
    beq     ASM_PARSE_NOP_OK
    jmp     ASM_FAIL
ASM_PARSE_NOP_OK:
    lda     #$EA                ; NOP
    jsr     ASM_EMIT_A
    rts

ASM_PARSE_J:
    jsr     ASM_READ_UPPER
    cmp     #'S'
    beq     ASM_PARSE_JSR
    cmp     #'M'
    beq     ASM_PARSE_JMP
    jmp     ASM_FAIL

ASM_PARSE_JSR:
    jsr     ASM_READ_UPPER
    cmp     #'R'
    beq     ASM_PARSE_JSR_GOT_R
    jmp     ASM_FAIL
ASM_PARSE_JSR_GOT_R:
    jsr     ASM_PARSE_ABS_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_JSR_OK
    rts
ASM_PARSE_JSR_OK:
    lda     #$20                ; JSR abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_JMP:
    jsr     ASM_READ_UPPER
    cmp     #'P'
    bne     ASM_FAIL
    jsr     ASM_PARSE_ABS_OPER
    lda     ZP_ERR
    bne     ASM_PARSE_DONE
    lda     #$4C                ; JMP abs
    jsr     ASM_EMIT_A
    jsr     ASM_EMIT_OPER_WORD
    rts

ASM_PARSE_T:
    jsr     ASM_READ_UPPER
    cmp     #'A'
    beq     ASM_PARSE_TA
    cmp     #'S'
    beq     ASM_PARSE_TS
    cmp     #'X'
    beq     ASM_PARSE_TX
    cmp     #'Y'
    beq     ASM_PARSE_TY
    jmp     ASM_FAIL
ASM_PARSE_TA:
    jsr     ASM_READ_UPPER
    cmp     #'X'
    beq     ASM_PARSE_TAX
    cmp     #'Y'
    beq     ASM_PARSE_TAY
    jmp     ASM_FAIL
ASM_PARSE_TAX:
    lda     #$AA                ; TAX
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_TAY:
    lda     #$A8                ; TAY
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_TS:
    jsr     ASM_READ_UPPER
    cmp     #'X'
    beq     ASM_PARSE_TSX
    jmp     ASM_FAIL
ASM_PARSE_TSX:
    lda     #$BA                ; TSX
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_TX:
    jsr     ASM_READ_UPPER
    cmp     #'A'
    beq     ASM_PARSE_TXA
    cmp     #'S'
    beq     ASM_PARSE_TXS
    jmp     ASM_FAIL
ASM_PARSE_TXA:
    lda     #$8A                ; TXA
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_TXS:
    lda     #$9A                ; TXS
    jmp     ASM_EMIT_IMPLIED
ASM_PARSE_TY:
    jsr     ASM_READ_UPPER
    cmp     #'A'
    beq     ASM_PARSE_TYA
    jmp     ASM_FAIL
ASM_PARSE_TYA:
    lda     #$98                ; TYA
    jmp     ASM_EMIT_IMPLIED

ASM_FAIL:
    lda     #1
    sta     ZP_ERR
ASM_PARSE_DONE:
    rts

ASM_EMIT_IMPLIED:
    jsr     ASM_EMIT_A
    rts

ASM_LINE_IS_END:
    sep     #$20
    .a8
    jsr     ASM_SKIP_SPACES
    jsr     ASM_READ_UPPER
    cmp     #'E'
    bne     ASM_NOT_END
    jsr     ASM_READ_UPPER
    cmp     #'N'
    bne     ASM_NOT_END
    jsr     ASM_READ_UPPER
    cmp     #'D'
    bne     ASM_NOT_END
    lda     #1
    rts
ASM_NOT_END:
    lda     #0
    rts

ASM_SKIP_SPACES:
    lda     $0000,x
    cmp     #' '
    bne     ASM_SKIP_DONE
    inx
    bra     ASM_SKIP_SPACES
ASM_SKIP_DONE:
    rts

ASM_AT_EOL:
    rep     #$20
    .a16
    txa
    sec
    sbc     #INBUF
    sta     ZP_TMP
    sep     #$20
    .a8
    lda     ZP_TMP
    cmp     INBUF_LEN
    bcs     ASM_AT_EOL_YES
    lda     #0
    rts
ASM_AT_EOL_YES:
    lda     #1
    rts

ASM_READ_UPPER:
    lda     $0000,x
    inx
    cmp     #'a'
    bcc     ASM_READ_UPPER_DONE
    and     #$DF
ASM_READ_UPPER_DONE:
    rts

ASM_PARSE_HASH_VALUE8:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'#'
    beq     ASM_HASH_OK
    jmp     ASM_FAIL
ASM_HASH_OK:
    inx
    jsr     ASM_PARSE_VALUE8
    rts

ASM_PARSE_VALUE8:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'$'
    beq     ASM_PARSE_HEX8
    cmp     #$27                ; single quote
    beq     ASM_PARSE_CHAR8
    jmp     ASM_PARSE_DEC8

ASM_PARSE_HEX8:
    inx
    jsr     PARSE_HEX2
    rts

ASM_PARSE_CHAR8:
    inx
    lda     $0000,x
    pha
    inx
    lda     $0000,x
    cmp     #$27
    beq     ASM_CHAR_CLOSE
    lda     #1
    sta     ZP_ERR
ASM_CHAR_CLOSE:
    inx
    pla
    rts

ASM_PARSE_DEC8:
    lda     $0000,x
    cmp     #'0'
    bcc     ASM_PARSE_DEC8_FAIL
    cmp     #'9'+1
    bcs     ASM_PARSE_DEC8_FAIL
    sec
    sbc     #'0'
    sta     ZP_OPER             ; first digit
    inx

    lda     $0000,x
    cmp     #'0'
    bcc     ASM_PARSE_DEC8_ONE
    cmp     #'9'+1
    bcs     ASM_PARSE_DEC8_ONE
    sec
    sbc     #'0'
    sta     ZP_TMP2             ; second digit
    lda     ZP_OPER
    tay
    lda     DEC_TENS,y
    clc
    inx
    adc     ZP_TMP2
    rts

ASM_PARSE_DEC8_ONE:
    lda     ZP_OPER
    rts

ASM_PARSE_DEC8_FAIL:
    lda     #1
    sta     ZP_ERR
    lda     #0
    rts

ASM_PARSE_BYTE_LIST:
    jsr     ASM_PARSE_VALUE8
    pha
    lda     ZP_ERR
    beq     ASM_PARSE_BYTE_LIST_OK
    pla
    rts
ASM_PARSE_BYTE_LIST_OK:
    pla
    jsr     ASM_EMIT_A
    jsr     ASM_SKIP_SPACES
    jsr     ASM_AT_EOL
    cmp     #1
    beq     ASM_PARSE_BYTE_LIST_DONE
    lda     $0000,x
    cmp     #','
    beq     ASM_PARSE_BYTE_LIST_MORE
    jmp     ASM_FAIL
ASM_PARSE_BYTE_LIST_MORE:
    inx
    jmp     ASM_PARSE_BYTE_LIST
ASM_PARSE_BYTE_LIST_DONE:
    rts

ASM_X_AT_EOL:
    rep     #$20
    .a16
    txa
    sec
    sbc     #INBUF
    sep     #$20
    .a8
    cmp     INBUF_LEN
    bcs     ASM_X_AT_EOL_YES
    lda     #0
    rts
ASM_X_AT_EOL_YES:
    lda     #1
    rts

ASM_PARSE_LABEL_DEF:
    lda     #0
    sta     ZP_TMP              ; label hash
    lda     $0000,x
    jsr     ASM_IS_LABEL_START
    cmp     #1
    beq     ASM_LABEL_DEF_LOOP
    lda     #0                  ; not a label definition
    rts
ASM_LABEL_DEF_LOOP:
    jsr     ASM_X_AT_EOL
    cmp     #1
    beq     ASM_LABEL_DEF_NOT_LABEL
    lda     $0000,x
    cmp     #':'
    beq     ASM_LABEL_DEF_FOUND
    jsr     ASM_IS_LABEL_CHAR
    cmp     #1
    beq     ASM_LABEL_DEF_ADD
ASM_LABEL_DEF_NOT_LABEL:
    lda     #0                  ; identifier without ':' is a mnemonic
    rts
ASM_LABEL_DEF_ADD:
    lda     $0000,x
    jsr     ASM_UPPER_A
    clc
    adc     ZP_TMP
    sta     ZP_TMP
    inx
    jmp     ASM_LABEL_DEF_LOOP
ASM_LABEL_DEF_FOUND:
    inx
    lda     ZP_TMP
    sta     ZP_OPER
    jsr     ASM_SKIP_SPACES
    jsr     ASM_AT_EOL
    cmp     #1
    beq     ASM_LABEL_DEF_STORE
    jmp     ASM_FAIL
ASM_LABEL_DEF_STORE:
    lda     ZP_OPER
    sta     ZP_TMP
    lda     ASM_LABEL_COUNT
    tay
    tya
    cmp     #8
    bcc     ASM_LABEL_DEF_ROOM
    jmp     ASM_FAIL
ASM_LABEL_DEF_ROOM:
    lda     ZP_TMP
    sta     ASM_LABEL_HASHES,y
    rep     #$20
    .a16
    tya
    asl     a
    tay
    sep     #$20
    .a8
    lda     ZP_ADDR
    sta     ASM_LABEL_ADDRS,y
    lda     ZP_ADDR+1
    sta     ASM_LABEL_ADDRS+1,y
    inc     ASM_LABEL_COUNT
    lda     ZP_ADDR
    sta     ZP_OPER
    lda     ZP_ADDR+1
    sta     ZP_OPER+1
    jsr     ASM_RESOLVE_FIXUPS_FOR_LABEL
    lda     ZP_ERR
    beq     ASM_LABEL_DEF_OK
    rts
ASM_LABEL_DEF_OK:
    lda     #1
    rts

ASM_PARSE_ABS_OPER:
    jsr     ASM_SKIP_SPACES
    lda     $0000,x
    cmp     #'$'
    beq     ASM_PARSE_ABS_HEX
    jmp     ASM_PARSE_LABEL_REF
ASM_PARSE_ABS_HEX:
    lda     #0
    sta     ASM_PENDING_KIND
    inx
    jsr     PARSE_HEX2
    sta     ZP_OPER+1
    jsr     PARSE_HEX2
    sta     ZP_OPER
    rts

; Address modes emitted in ZP_TMP2:
;   0 dp, 1 abs, 2 dp,x, 3 dp,y, 4 abs,x, 5 abs,y
ASM_PARSE_ADDR_OPER:
    jsr     ASM_SKIP_SPACES
    lda     #0
    sta     ASM_PENDING_KIND
    lda     $0000,x
    cmp     #'$'
    beq     ASM_PARSE_ADDR_HEX
    jsr     ASM_PARSE_LABEL_REF
    lda     ZP_ERR
    beq     ASM_PARSE_ADDR_LABEL_OK
    rts
ASM_PARSE_ADDR_LABEL_OK:
    lda     #1                  ; labels are absolute-address operands
    sta     ZP_TMP2
    jmp     ASM_PARSE_ADDR_SUFFIX
ASM_PARSE_ADDR_HEX:
    inx
    jsr     PARSE_HEX2
    sta     ZP_OPER
    sta     ZP_OPER+1
    lda     #0
    sta     ZP_TMP2             ; one-byte hex defaults to direct page
    jsr     ASM_X_AT_EOL
    cmp     #1
    bne     ASM_PARSE_ADDR_NOT_EOL
    jmp     ASM_PARSE_ADDR_DONE
ASM_PARSE_ADDR_NOT_EOL:
    lda     $0000,x
    cmp     #','
    beq     ASM_PARSE_ADDR_SUFFIX
    jsr     ASM_IS_HEX_CHAR
    cmp     #1
    beq     ASM_PARSE_ADDR_HEX_HIGH
    jmp     ASM_FAIL
ASM_PARSE_ADDR_HEX_HIGH:
    jsr     PARSE_HEX2
    sta     ZP_OPER
    lda     #1
    sta     ZP_TMP2             ; two-byte hex is absolute
ASM_PARSE_ADDR_SUFFIX:
    jsr     ASM_SKIP_SPACES
    jsr     ASM_X_AT_EOL
    cmp     #1
    beq     ASM_PARSE_ADDR_DONE
    lda     $0000,x
    cmp     #','
    beq     ASM_PARSE_ADDR_COMMA
    jmp     ASM_FAIL
ASM_PARSE_ADDR_COMMA:
    inx
    jsr     ASM_SKIP_SPACES
    jsr     ASM_READ_UPPER
    cmp     #'X'
    beq     ASM_PARSE_ADDR_INDEX_X
    cmp     #'Y'
    beq     ASM_PARSE_ADDR_INDEX_Y
    jmp     ASM_FAIL
ASM_PARSE_ADDR_INDEX_X:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_ADDR_DPX
    cmp     #1
    beq     ASM_PARSE_ADDR_ABSX
    jmp     ASM_FAIL
ASM_PARSE_ADDR_DPX:
    lda     #2
    sta     ZP_TMP2
    jmp     ASM_PARSE_ADDR_SUFFIX_EOL
ASM_PARSE_ADDR_ABSX:
    lda     #4
    sta     ZP_TMP2
    jmp     ASM_PARSE_ADDR_SUFFIX_EOL
ASM_PARSE_ADDR_INDEX_Y:
    lda     ZP_TMP2
    cmp     #0
    beq     ASM_PARSE_ADDR_DPY
    cmp     #1
    beq     ASM_PARSE_ADDR_ABSY
    jmp     ASM_FAIL
ASM_PARSE_ADDR_DPY:
    lda     #3
    sta     ZP_TMP2
    jmp     ASM_PARSE_ADDR_SUFFIX_EOL
ASM_PARSE_ADDR_ABSY:
    lda     #5
    sta     ZP_TMP2
ASM_PARSE_ADDR_SUFFIX_EOL:
    jsr     ASM_SKIP_SPACES
    jsr     ASM_X_AT_EOL
    cmp     #1
    beq     ASM_PARSE_ADDR_DONE
    jmp     ASM_FAIL
ASM_PARSE_ADDR_DONE:
    rts

ASM_PARSE_LABEL_REF:
    lda     #0
    sta     ZP_TMP
    lda     $0000,x
    jsr     ASM_IS_LABEL_START
    cmp     #1
    beq     ASM_LABEL_REF_LOOP
    jmp     ASM_FAIL
ASM_LABEL_REF_LOOP:
    jsr     ASM_X_AT_EOL
    cmp     #1
    beq     ASM_LABEL_REF_LOOKUP
    lda     $0000,x
    jsr     ASM_IS_LABEL_CHAR
    cmp     #1
    beq     ASM_LABEL_REF_ADD
    jmp     ASM_LABEL_REF_LOOKUP
ASM_LABEL_REF_ADD:
    lda     $0000,x
    jsr     ASM_UPPER_A
    clc
    adc     ZP_TMP
    sta     ZP_TMP
    inx
    jmp     ASM_LABEL_REF_LOOP
ASM_LABEL_REF_LOOKUP:
    ldy     #0
ASM_LABEL_REF_SEARCH:
    tya
    cmp     ASM_LABEL_COUNT
    bcc     ASM_LABEL_REF_CHECK
    lda     ZP_TMP
    sta     ASM_PENDING_HASH
    lda     #1
    sta     ASM_PENDING_KIND      ; unresolved abs16 until caller narrows it
    lda     #0
    sta     ZP_OPER
    sta     ZP_OPER+1
    rts
ASM_LABEL_REF_CHECK:
    lda     ASM_LABEL_HASHES,y
    cmp     ZP_TMP
    beq     ASM_LABEL_REF_FOUND
    iny
    jmp     ASM_LABEL_REF_SEARCH
ASM_LABEL_REF_FOUND:
    lda     #0
    sta     ASM_PENDING_KIND
    rep     #$20
    .a16
    tya
    asl     a
    tay
    sep     #$20
    .a8
    lda     ASM_LABEL_ADDRS,y
    sta     ZP_OPER
    lda     ASM_LABEL_ADDRS+1,y
    sta     ZP_OPER+1
    rts

ASM_UPPER_A:
    cmp     #'a'
    bcc     ASM_UPPER_DONE
    cmp     #'z'+1
    bcs     ASM_UPPER_DONE
    and     #$DF
ASM_UPPER_DONE:
    rts

ASM_IS_LABEL_START:
    jsr     ASM_UPPER_A
    cmp     #'_'
    beq     ASM_IS_LABEL_YES
    cmp     #'A'
    bcc     ASM_IS_LABEL_NO
    cmp     #'Z'+1
    bcc     ASM_IS_LABEL_YES
    jmp     ASM_IS_LABEL_NO

ASM_IS_LABEL_CHAR:
    jsr     ASM_UPPER_A
    cmp     #'_'
    beq     ASM_IS_LABEL_YES
    cmp     #'A'
    bcc     ASM_IS_LABEL_DIGIT
    cmp     #'Z'+1
    bcc     ASM_IS_LABEL_YES
ASM_IS_LABEL_DIGIT:
    cmp     #'0'
    bcc     ASM_IS_LABEL_NO
    cmp     #'9'+1
    bcc     ASM_IS_LABEL_YES
ASM_IS_LABEL_NO:
    lda     #0
    rts
ASM_IS_LABEL_YES:
    lda     #1
    rts

ASM_IS_HEX_CHAR:
    jsr     ASM_UPPER_A
    cmp     #'0'
    bcc     ASM_IS_HEX_NO
    cmp     #'9'+1
    bcc     ASM_IS_HEX_YES
    cmp     #'A'
    bcc     ASM_IS_HEX_NO
    cmp     #'F'+1
    bcc     ASM_IS_HEX_YES
ASM_IS_HEX_NO:
    lda     #0
    rts
ASM_IS_HEX_YES:
    lda     #1
    rts

ASM_ADD_FIXUP:
    lda     ASM_FIXUP_COUNT
    tay
    tya
    cmp     #8
    bcc     ASM_ADD_FIXUP_ROOM
    jmp     ASM_FAIL
ASM_ADD_FIXUP_ROOM:
    lda     ASM_PENDING_HASH
    sta     ASM_FIXUP_HASHES,y
    lda     ASM_PENDING_KIND
    sta     ASM_FIXUP_KINDS,y
    rep     #$20
    .a16
    tya
    asl     a
    tay
    sep     #$20
    .a8
    lda     ZP_ADDR
    sta     ASM_FIXUP_ADDRS,y
    lda     ZP_ADDR+1
    sta     ASM_FIXUP_ADDRS+1,y
    inc     ASM_FIXUP_COUNT
    rts

ASM_CHECK_UNRESOLVED:
    lda     #0
    sta     ZP_ERR
    ldy     #0
ASM_CHECK_UNRESOLVED_LOOP:
    tya
    cmp     ASM_FIXUP_COUNT
    bcc     ASM_CHECK_UNRESOLVED_KIND
    rts
ASM_CHECK_UNRESOLVED_KIND:
    lda     ASM_FIXUP_KINDS,y
    beq     ASM_CHECK_UNRESOLVED_NEXT
    jmp     ASM_FAIL
ASM_CHECK_UNRESOLVED_NEXT:
    iny
    jmp     ASM_CHECK_UNRESOLVED_LOOP

ASM_RESOLVE_FIXUPS_FOR_LABEL:
    lda     ZP_TMP
    sta     ASM_PENDING_HASH
    ldy     #0
ASM_RESOLVE_FIXUPS_LOOP:
    tya
    cmp     ASM_FIXUP_COUNT
    bcc     ASM_RESOLVE_FIXUPS_CHECK
    rts
ASM_RESOLVE_FIXUPS_CHECK:
    lda     ASM_FIXUP_KINDS,y
    beq     ASM_RESOLVE_FIXUPS_NEXT
    lda     ASM_FIXUP_HASHES,y
    cmp     ASM_PENDING_HASH
    bne     ASM_RESOLVE_FIXUPS_NEXT
    lda     ASM_FIXUP_KINDS,y
    cmp     #1
    beq     ASM_RESOLVE_FIXUP_ABS
    cmp     #2
    beq     ASM_RESOLVE_FIXUP_BRANCH
    jmp     ASM_FAIL
ASM_RESOLVE_FIXUPS_NEXT:
    iny
    jmp     ASM_RESOLVE_FIXUPS_LOOP

ASM_RESOLVE_FIXUP_LOAD_ADDR:
    phy
    rep     #$20
    .a16
    tya
    asl     a
    tay
    sep     #$20
    .a8
    lda     ASM_FIXUP_ADDRS,y
    sta     ZP_PTR
    lda     ASM_FIXUP_ADDRS+1,y
    sta     ZP_PTR+1
    ply
    rts

ASM_RESOLVE_FIXUP_ABS:
    jsr     ASM_RESOLVE_FIXUP_LOAD_ADDR
    phy
    ldy     #0
    lda     ZP_OPER
    sta     (ZP_PTR),y
    iny
    lda     ZP_OPER+1
    sta     (ZP_PTR),y
    ply
    lda     #0
    sta     ASM_FIXUP_KINDS,y
    jmp     ASM_RESOLVE_FIXUPS_NEXT

ASM_RESOLVE_FIXUP_BRANCH:
    jsr     ASM_RESOLVE_FIXUP_LOAD_ADDR
    rep     #$20
    .a16
    lda     ZP_OPER             ; target
    sec
    sbc     ZP_PTR              ; target - branch operand address
    sec
    sbc     #1                  ; target - address after branch operand
    sta     ZP_TMP
    sep     #$20
    .a8
    jsr     ASM_VALIDATE_BRANCH_TMP
    lda     ZP_ERR
    beq     ASM_RESOLVE_FIXUP_BRANCH_OK
    rts
ASM_RESOLVE_FIXUP_BRANCH_OK:
    phy
    ldy     #0
    lda     ZP_TMP
    sta     (ZP_PTR),y
    ply
    lda     #0
    sta     ASM_FIXUP_KINDS,y
    jmp     ASM_RESOLVE_FIXUPS_NEXT

ASM_VALIDATE_BRANCH_TMP:
    lda     ZP_TMP2
    beq     ASM_VALIDATE_BRANCH_POSITIVE
    cmp     #$FF
    beq     ASM_VALIDATE_BRANCH_NEGATIVE
    jmp     ASM_FAIL
ASM_VALIDATE_BRANCH_POSITIVE:
    lda     ZP_TMP
    cmp     #$80
    bcc     ASM_VALIDATE_BRANCH_OK
    jmp     ASM_FAIL
ASM_VALIDATE_BRANCH_NEGATIVE:
    lda     ZP_TMP
    cmp     #$80
    bcs     ASM_VALIDATE_BRANCH_OK
    jmp     ASM_FAIL
ASM_VALIDATE_BRANCH_OK:
    rts

ASM_PARSE_BRANCH_OPER:
    pha                         ; save opcode
    jsr     ASM_PARSE_ABS_OPER
    lda     ZP_ERR
    beq     ASM_PARSE_BRANCH_OK
    pla
    rts
ASM_PARSE_BRANCH_OK:
    lda     ASM_PENDING_KIND
    beq     ASM_PARSE_BRANCH_RESOLVED
    pla
    jsr     ASM_EMIT_A
    lda     #2
    sta     ASM_PENDING_KIND
    jsr     ASM_ADD_FIXUP
    lda     ZP_ERR
    beq     ASM_PARSE_BRANCH_FORWARD_OK
    rts
ASM_PARSE_BRANCH_FORWARD_OK:
    lda     #0
    jsr     ASM_EMIT_A
    sta     ASM_PENDING_KIND
    rts
ASM_PARSE_BRANCH_RESOLVED:
    rep     #$20
    .a16
    lda     ZP_OPER             ; target
    sec
    sbc     ZP_ADDR             ; target - branch opcode address
    sec
    sbc     #2                  ; target - address after branch operand
    sta     ZP_TMP              ; low byte is emitted as rel8
    sep     #$20
    .a8
    jsr     ASM_VALIDATE_BRANCH_TMP
    lda     ZP_ERR
    beq     ASM_PARSE_BRANCH_RANGE_OK
    pla
    rts
ASM_PARSE_BRANCH_RANGE_OK:
    pla
    jsr     ASM_EMIT_A
    lda     ZP_TMP
    jsr     ASM_EMIT_A
    rts

ASM_EMIT_OPER_WORD:
    lda     ASM_PENDING_KIND
    beq     ASM_EMIT_OPER_WORD_RESOLVED
    lda     #1
    sta     ASM_PENDING_KIND
    jsr     ASM_ADD_FIXUP
    lda     ZP_ERR
    beq     ASM_EMIT_OPER_WORD_FORWARD_OK
    rts
ASM_EMIT_OPER_WORD_FORWARD_OK:
    lda     #0
    sta     ZP_OPER
    sta     ZP_OPER+1
ASM_EMIT_OPER_WORD_RESOLVED:
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    lda     ZP_OPER+1
    jsr     ASM_EMIT_A
    lda     #0
    sta     ASM_PENDING_KIND
    rts

    .org $F003                  ; skip memory-mapped I/O at $F000-$F002

ASM_EMIT_OPER_BYTE:
    lda     ASM_PENDING_KIND
    bne     ASM_EMIT_OPER_BYTE_FAIL
    lda     ZP_OPER
    jsr     ASM_EMIT_A
    rts
ASM_EMIT_OPER_BYTE_FAIL:
    jmp     ASM_FAIL

ASM_EMIT_A:
    sep     #$20
    .a8
    ldy     #0
    sta     (ZP_ADDR),y
    inc     ZP_ADDR
    bne     ASM_EMIT_DONE
    inc     ZP_ADDR+1
ASM_EMIT_DONE:
    rts

; ---------------------------------------------------------------------------
; Disassembly-mode helpers
; ---------------------------------------------------------------------------

DISASM_FETCH_PRINT:
    sep     #$20
    .a8
    ldy     #0
    lda     (ZP_ADDR),y
    pha
    jsr     PUT_HEX2
    lda     #' '
    sta     CHAR_OUT
    inc     ZP_ADDR
    bne     DISASM_FETCH_DONE
    inc     ZP_ADDR+1
DISASM_FETCH_DONE:
    pla
    rts

DISASM_FETCH_DP:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    lda     #0
    sta     ZP_OPER+1
    rts

DISASM_FETCH_ABS:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER
    jsr     DISASM_FETCH_PRINT
    sta     ZP_OPER+1
    rts

DISASM_FETCH_BRANCH:
    jsr     DISASM_FETCH_PRINT
    sta     ZP_TMP
    lda     #0
    sta     ZP_TMP2
    lda     ZP_TMP
    cmp     #$80
    bcc     DISASM_BRANCH_POSITIVE
    lda     #$FF
    sta     ZP_TMP2
DISASM_BRANCH_POSITIVE:
    rep     #$20
    .a16
    lda     ZP_ADDR             ; address after branch operand
    clc
    adc     ZP_TMP              ; add signed offset in ZP_TMP/ZP_TMP2
    sta     ZP_OPER
    sep     #$20
    .a8
    rts

DISASM_PRINT_OPER:
    lda     ZP_OPER+1
    jsr     PUT_HEX2
    lda     ZP_OPER
    jsr     PUT_HEX2
    rts

DISASM_PRINT_DP_OPER:
    lda     ZP_OPER
    jsr     PUT_HEX2
    rts

DISASM_PRINT_ABS_NEXT:
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    jmp     DISASM_NEXT

DISASM_PRINT_DP_NEXT:
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_DP_OPER
    jmp     DISASM_NEXT

DISASM_PRINT_DPX_NEXT:
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_DP_OPER
    ldx     #STR_D_SUFFIX_X
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

DISASM_PRINT_DPY_NEXT:
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_DP_OPER
    ldx     #STR_D_SUFFIX_Y
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

DISASM_PRINT_ABSX_NEXT:
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    ldx     #STR_D_SUFFIX_X
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

DISASM_PRINT_ABSY_NEXT:
    jsr     PRINT_ZP
    jsr     DISASM_PRINT_OPER
    ldx     #STR_D_SUFFIX_Y
    stx     ZP_PTR
    jsr     PRINT_ZP
    jmp     DISASM_NEXT

; ---------------------------------------------------------------------------
; PARSE_HEX4 — Parse 4 hex chars from INBUF[X..X+3].
; Result stored in ZP_ADDR ($02–$03).  X advanced by 4.
; ---------------------------------------------------------------------------
PARSE_HEX4:
    jsr     PARSE_HEX2
    sta     ZP_ADDR+1           ; high byte of address
    jsr     PARSE_HEX2
    sta     ZP_ADDR             ; low byte of address
    rts

; ---------------------------------------------------------------------------
; PARSE_HEX2 — Parse 2 hex chars from INBUF[X..X+1].
; Returns byte in A.  X advanced by 2.
; ---------------------------------------------------------------------------
PARSE_HEX2:
    jsr     PARSE_NIBBLE
    asl
    asl
    asl
    asl
    sta     ZP_TMP
    jsr     PARSE_NIBBLE
    ora     ZP_TMP
    rts

; ---------------------------------------------------------------------------
; PARSE_NIBBLE — Read one hex character from $0000[X], advance X.
; Returns nibble value 0–15 in A.
; ---------------------------------------------------------------------------
PARSE_NIBBLE:
    lda     $0000,x             ; read char at absolute address X
    inx
    cmp     #'a'
    bcc     PN_UPPER
    and     #$DF                ; to uppercase
PN_UPPER:
    cmp     #'A'
    bcc     PN_DIGIT            ; < 'A' → decimal digit
    sec
    sbc     #'A'-10             ; 'A'→10 … 'F'→15  (carry set by cmp, so sbc = sub)
    rts
PN_DIGIT:
    sec
    sbc     #'0'                ; '0'→0 … '9'→9
    rts

; =============================================================================
; String data
; =============================================================================

STR_BANNER:
    .byte $0D,$0A
    .ascii "DragonFly 65 Monitor"
    .byte $0D,$0A
    .ascii "Type H for help"
    .byte $0D,$0A,0

STR_PROMPT:
    .byte $0D,$0A
    .ascii "* "
    .byte 0

STR_HELP:
    .byte $0D,$0A
    .ascii "H           help"
    .byte $0D,$0A
    .ascii "MAAAA       memory dump (16 bytes at AAAA)"
    .byte $0D,$0A
    .ascii "SAAAADD..   set bytes at AAAA"
    .byte $0D,$0A
    .ascii "GAAAA       run at AAAA (program returns with RTS)"
    .byte $0D,$0A
    .ascii "R           show registers from last G"
    .byte $0D,$0A
    .ascii "AAAAA       assemble at AAAA, end to finish"
    .byte $0D,$0A
    .ascii "DAAAA       disassemble 8 instructions at AAAA"
    .byte $0D,$0A,0

STR_UNKNOWN:
    .ascii "?"
    .byte $0D,$0A,0

STR_OK:
    .byte $0D,$0A
    .ascii "OK"
    .byte $0D,$0A,0

STR_RETURNED:
    .byte $0D,$0A
    .ascii "Returned"
    .byte $0D,$0A,0

STR_NO_PROG:
    .byte $0D,$0A
    .ascii "No program run yet"
    .byte $0D,$0A,0

STR_REG_A:
    .byte $0D,$0A
    .ascii "A="
    .byte 0

STR_REG_X:
    .ascii "  X="
    .byte 0

STR_REG_Y:
    .ascii "  Y="
    .byte 0

STR_REG_P:
    .ascii "  P="
    .byte 0

DEC_TENS:
    .byte 0,10,20,30,40,50,60,70,80,90

STR_D_LDA:
    .ascii "LDA #$"
    .byte 0

STR_D_LDA_ABS:
    .ascii "LDA $"
    .byte 0

STR_D_LDX:
    .ascii "LDX #$"
    .byte 0

STR_D_LDX_ABS:
    .ascii "LDX $"
    .byte 0

STR_D_LDY:
    .ascii "LDY #$"
    .byte 0

STR_D_LDY_ABS:
    .ascii "LDY $"
    .byte 0

STR_D_CMP:
    .ascii "CMP #$"
    .byte 0

STR_D_CMP_ABS:
    .ascii "CMP $"
    .byte 0

STR_D_AND:
    .ascii "AND #$"
    .byte 0

STR_D_AND_ABS:
    .ascii "AND $"
    .byte 0

STR_D_ORA:
    .ascii "ORA #$"
    .byte 0

STR_D_ORA_ABS:
    .ascii "ORA $"
    .byte 0

STR_D_EOR:
    .ascii "EOR #$"
    .byte 0

STR_D_EOR_ABS:
    .ascii "EOR $"
    .byte 0

STR_D_ADC:
    .ascii "ADC #$"
    .byte 0

STR_D_ADC_ABS:
    .ascii "ADC $"
    .byte 0

STR_D_SBC:
    .ascii "SBC #$"
    .byte 0

STR_D_SBC_ABS:
    .ascii "SBC $"
    .byte 0

STR_D_BEQ:
    .ascii "BEQ $"
    .byte 0

STR_D_BNE:
    .ascii "BNE $"
    .byte 0

STR_D_BCC:
    .ascii "BCC $"
    .byte 0

STR_D_BCS:
    .ascii "BCS $"
    .byte 0

STR_D_BMI:
    .ascii "BMI $"
    .byte 0

STR_D_BPL:
    .ascii "BPL $"
    .byte 0

STR_D_STA:
    .ascii "STA $"
    .byte 0

STR_D_STX:
    .ascii "STX $"
    .byte 0

STR_D_STY:
    .ascii "STY $"
    .byte 0

STR_D_TAX:
    .ascii "TAX"
    .byte 0

STR_D_TAY:
    .ascii "TAY"
    .byte 0

STR_D_TXA:
    .ascii "TXA"
    .byte 0

STR_D_TYA:
    .ascii "TYA"
    .byte 0

STR_D_TSX:
    .ascii "TSX"
    .byte 0

STR_D_TXS:
    .ascii "TXS"
    .byte 0

STR_D_INX:
    .ascii "INX"
    .byte 0

STR_D_DEX:
    .ascii "DEX"
    .byte 0

STR_D_INY:
    .ascii "INY"
    .byte 0

STR_D_DEY:
    .ascii "DEY"
    .byte 0

STR_D_CLC:
    .ascii "CLC"
    .byte 0

STR_D_SEC:
    .ascii "SEC"
    .byte 0

STR_D_CLI:
    .ascii "CLI"
    .byte 0

STR_D_SEI:
    .ascii "SEI"
    .byte 0

STR_D_CLV:
    .ascii "CLV"
    .byte 0

STR_D_CLD:
    .ascii "CLD"
    .byte 0

STR_D_SED:
    .ascii "SED"
    .byte 0

STR_D_RTS:
    .ascii "RTS"
    .byte 0

STR_D_NOP:
    .ascii "NOP"
    .byte 0

STR_D_SEP:
    .ascii "SEP #$"
    .byte 0

STR_D_REP:
    .ascii "REP #$"
    .byte 0

STR_D_JSR:
    .ascii "JSR $"
    .byte 0

STR_D_JMP:
    .ascii "JMP $"
    .byte 0

STR_D_DB:
    .ascii "DB $"
    .byte 0

STR_D_SUFFIX_X:
    .ascii ",X"
    .byte 0

STR_D_SUFFIX_Y:
    .ascii ",Y"
    .byte 0

; =============================================================================
; Unused-interrupt handler (RTI back to caller)
; =============================================================================
DUMMY_IRQ:
    rti

; =============================================================================
; Interrupt vectors
; =============================================================================

    .org $FFE4                  ; native mode vectors
    .dw DUMMY_IRQ               ; COP
    .dw DUMMY_IRQ               ; BRK
    .dw DUMMY_IRQ               ; ABORT
    .dw DUMMY_IRQ               ; NMI
    .dw $0000                   ; (reserved)
    .dw DUMMY_IRQ               ; IRQ

    .org $FFFA                  ; emulation mode vectors
    .dw DUMMY_IRQ               ; NMI
    .dw MONITOR_ENTRY           ; RESET
    .dw DUMMY_IRQ               ; IRQ/BRK
