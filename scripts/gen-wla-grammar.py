#!/usr/bin/env python3
"""Generate the WLA-DX 65816 TextMate grammar from the assembler's own parser.

The directive set is the source of truth in the WLA-DX assembler
(compiler/wla-dx/phase_1.c) — its directive-table string comparisons plus the
conditional-assembly family. WLA is case-insensitive, and several closers
(.ENDME/.ENDSNES/.ENDNATIVEVECTOR/...) are built dynamically, so they are
covered by a `.END*` catch-all rather than enumerated.

Usage:
    OPENSNES=/path/to/opensnes python3 scripts/gen-wla-grammar.py
    # default OPENSNES = ../opensnes relative to this repo
Writes: syntaxes/wla65816.tmLanguage.json
"""
import os
import re
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
OPENSNES = pathlib.Path(os.environ.get("OPENSNES", REPO.parent / "opensnes"))
PHASE1 = OPENSNES / "compiler" / "wla-dx" / "phase_1.c"
OUT = REPO / "syntaxes" / "wla65816.tmLanguage.json"

# WDC 65816 instruction set (full, standard).
MNEMONICS = (
    "ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRA BRK BRL BVC BVS CLC CLD CLI "
    "CLV CMP COP CPX CPY DEC DEX DEY EOR INC INX INY JMP JML JSR JSL LDA LDX "
    "LDY LSR MVN MVP NOP ORA PEA PEI PER PHA PHB PHD PHK PHP PHX PHY PLA PLB "
    "PLD PLP PLX PLY REP ROL ROR RTI RTL RTS SBC SEC SED SEI SEP STA STP STX "
    "STY STZ TAX TAY TCD TCS TDC TRB TSB TSC TSX TXA TXS TXY TYA TYX WAI WDM "
    "XBA XCE"
).split()


def directive_set() -> list[str]:
    src = PHASE1.read_text(errors="ignore")
    names = set(re.findall(r'str(?:case)?lesscmp\([A-Za-z_]+,\s*"([A-Z0-9]+)"\)', src))
    names |= set(re.findall(r'strcmp\(directive_upper,\s*"([A-Z0-9]+)"\)', src))
    names |= {"IF", "IFDEF", "IFNDEF", "IFEQ", "IFNEQ", "IFGR", "IFLE", "IFGREQ",
              "IFLEEQ", "IFDEFM", "IFNDEFM", "IFEXISTS", "ELIF", "ELSE", "ENDIF"}
    drop = {"A", "B", "D", "E", "M", "S", "U", "X", "Y", "CC", "DP", "PC", "SP",
            "ID", "CHANGEFILE", "INDLUDE", "BRK", "COP", "IRQ", "NMI", "RESET",
            "ABORT", "IRQBRK"}
    # .END* closers handled by a catch-all, not enumerated
    names = (n for n in names if n not in drop and len(n) >= 2 and not n.startswith("END"))
    return sorted(names, key=lambda s: (-len(s), s))


def build() -> dict:
    dir_alt = "|".join(directive_set())
    mn_alt = "|".join(sorted(set(MNEMONICS), key=lambda s: (-len(s), s)))
    return {
        "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
        "name": "WLA-DX 65816 Assembly",
        "scopeName": "source.wla65816",
        "fileTypes": ["asm", "inc"],
        "patterns": [{"include": f"#{k}"} for k in
                     ["comments", "strings", "labels", "directives", "mnemonics",
                      "registers", "numbers", "operators"]],
        "repository": {
            "comments": {"patterns": [
                {"name": "comment.line.semicolon.wla65816", "match": ";.*$"}]},
            "strings": {"patterns": [
                {"name": "string.quoted.double.wla65816", "begin": "\"", "end": "\"",
                 "patterns": [{"name": "constant.character.escape.wla65816", "match": "\\\\."}]},
                {"name": "string.quoted.single.wla65816", "begin": "'", "end": "'",
                 "patterns": [{"name": "constant.character.escape.wla65816", "match": "\\\\."}]}]},
            "labels": {"patterns": [
                {"match": r"^\s*([A-Za-z_.@][A-Za-z0-9_.@]*)(:)",
                 "captures": {"1": {"name": "entity.name.function.label.wla65816"},
                              "2": {"name": "punctuation.separator.label.wla65816"}}}]},
            "directives": {"patterns": [
                {"name": "keyword.control.directive.wla65816", "match": r"(?i)\.end[a-z0-9]+\b"},
                {"name": "keyword.control.directive.wla65816", "match": r"(?i)\.(?:" + dir_alt + r")\b"}]},
            "mnemonics": {"patterns": [
                {"match": r"(?i)\b(" + mn_alt + r")(\.[bwl])?\b",
                 "captures": {"1": {"name": "support.function.mnemonic.wla65816"},
                              "2": {"name": "keyword.operator.size.wla65816"}}}]},
            "registers": {"patterns": [
                {"match": r"(,)\s*(?i:x|y|s|b)\b",
                 "captures": {"1": {"name": "punctuation.separator.wla65816"},
                              "2": {"name": "variable.language.register.wla65816"}}}]},
            "numbers": {"patterns": [
                {"name": "constant.numeric.hex.wla65816", "match": r"\$[0-9A-Fa-f]+\b"},
                {"name": "constant.numeric.binary.wla65816", "match": r"%[01]+\b"},
                {"name": "constant.numeric.decimal.wla65816", "match": r"\b[0-9]+\b"}]},
            "operators": {"patterns": [
                {"name": "keyword.operator.immediate.wla65816", "match": r"#"},
                {"name": "keyword.operator.wla65816", "match": r"[+\-*/&|\^~<>=]"}]},
        },
    }


if __name__ == "__main__":
    if not PHASE1.exists():
        raise SystemExit(f"WLA parser not found: {PHASE1}\nSet OPENSNES=/path/to/opensnes")
    dirs = directive_set()
    OUT.write_text(json.dumps(build(), indent=2) + "\n")
    print(f"wrote {OUT}  ({len(dirs)} directives + .END* catch-all, {len(set(MNEMONICS))} mnemonics)")
