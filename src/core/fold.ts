// Word splitting shared by the index builder, the island and the Worker page, and the old
// placeholder form.
//
// The search form itself is in variants.ts (D-027 rules approved under D-072 and D-073).
// foldPlaceholder is the round 1 placeholder. Search no longer uses it. It is kept only for the
// public repository check (scripts/check-no-quran.ts), where removing every mark is the wider net.
// No Unicode normalization is used anywhere. Code points are written as escapes so that this file
// holds no Arabic-script characters.
export const PLACEHOLDER_MARKS = /[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
export const foldPlaceholder = (s: string): string => s.replace(PLACEHOLDER_MARKS, '');

// Word splitting used by the index builder, the island and the Worker page: ASCII space and
// no-break space. Tokens that are only Arabic-Indic digits (the ayah number) or the rub el hizb
// sign are not words.
export const WORD_SPLIT = /[ \u00a0]/;
export const WORD_SPLIT_KEEP = /([ \u00a0])/;
export const NOT_WORD = /^(?:[\u0660-\u0669]+|\u06de)$/;
