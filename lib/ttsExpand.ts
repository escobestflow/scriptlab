// Expands common screenwriting abbreviations into spoken form before we
// send text to TTS. Otherwise the model reads things like "INT." as
// "eye-enn-tee dot" or "V.O." as letters.
//
// Order matters — longer/compound patterns run before their shorter
// siblings (e.g. "SMASH CUT TO:" before "CUT TO:").
//
// Word-boundary-anchored where safe. Some terms (MORE, BEAT, CONT'D) are
// common English words in lowercase, so we only expand them in unambiguous
// contexts (wrapped in parentheses, all-caps, or alongside an apostrophe).

const EXPANSIONS: [RegExp, string][] = [
  // ── Compound heading prefixes (must precede INT./EXT. singletons)
  [/\bINT\.?\s*\/\s*EXT\.?\b/g, "Interior / Exterior"],
  [/\bEXT\.?\s*\/\s*INT\.?\b/g, "Exterior / Interior"],
  [/\bI\/E\.?\b/g, "Interior / Exterior"],

  // ── Scene heading prefixes
  [/\bINT\.(?=\s)/g, "Interior"],
  [/\bEXT\.(?=\s)/g, "Exterior"],
  [/\bEST\.(?=\s)/g, "Establishing"],

  // ── Camera / source tags (character cue suffixes, stage directions)
  [/\bV\.O\.?/g, "voice over"],
  [/\bO\.S\.?/g, "off screen"],
  [/\bO\.C\.?/g, "off camera"],
  [/\bO\.F\.F\.?/g, "off screen"],
  [/\bP\.O\.V\.?/g, "point of view"],

  // ── Sound / picture planes
  [/\bSFX\b/g, "sound effects"],
  [/\bB\.G\.?/g, "background"],
  [/\bF\.G\.?/g, "foreground"],

  // ── Transitions (colon-terminated — longer first)
  [/\bSMASH CUT TO:?/g, "smash cut to"],
  [/\bMATCH CUT TO:?/g, "match cut to"],
  [/\bJUMP CUT TO:?/g, "jump cut to"],
  [/\bDISSOLVE TO:?/g, "dissolve to"],
  [/\bWIPE TO:?/g, "wipe to"],
  [/\bCUT TO:?/g, "cut to"],
  [/\bFADE IN:?/g, "fade in"],
  [/\bFADE OUT:?/g, "fade out"],

  // ── Camera instructions
  [/\bSERIES OF SHOTS\b/g, "series of shots"],
  [/\bMEDIUM SHOT\b/g, "medium shot"],
  [/\bWIDE SHOT\b/g, "wide shot"],
  [/\bCLOSE UP\b/g, "close up"],
  [/\bCLOSEUP\b/g, "close up"],
  [/\bECU\b/g, "extreme close up"],
  [/\bANGLE ON\b/g, "angle on"],
  [/\bCLOSE ON\b/g, "close on"],
  [/\bFLASH FORWARD\b/g, "flash forward"],
  [/\bFLASHBACK\b/g, "flashback"],
  [/\bINTERCUT\b/g, "intercut"],
  [/\bMONTAGE\b/g, "montage"],
  [/\bSUPER:/g, "superimpose,"],
  [/\bINSERT:/g, "insert,"],

  // ── Cue metadata
  [/\bCONT'?D\b/g, "continued"],
  [/\bCONTINUED\b/g, "continued"],

  // ── Parenthetical beats (only expand inside parens to avoid hitting
  //    the common words "more"/"beat"/"same" in normal prose).
  [/\(\s*MORE\s*\)/g, "more"],
  [/\(\s*BEAT\s*\)/g, "beat"],
  [/\(\s*CONT'?D\s*\)/g, "continued"],
  [/\(\s*SAME\s*\)/g, "same time"],
];

export function expandScreenwritingAbbreviations(text: string): string {
  let out = text;
  for (const [re, repl] of EXPANSIONS) out = out.replace(re, repl);
  return out;
}
