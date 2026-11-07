// PLACEHOLDER SEARCH FORM. This is NOT the D-027 variant list or the D-028 plain-spelling text.
// It removes Arabic marks, tatweel and Quranic annotation signs from a SEARCH-ONLY copy.
// No letter is mapped to another letter: no hamza, alef or ya variant is assumed.
// It is never applied to displayed text. No Unicode normalization is used anywhere.
// Code points are written as escapes so that this file holds no Arabic-script characters.
export const PLACEHOLDER_MARKS = /[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
export const foldPlaceholder = (s: string): string => s.replace(PLACEHOLDER_MARKS, '');

// Word splitting used by the index builder, the island and the Worker page: ASCII space and
// no-break space. Tokens that are only Arabic-Indic digits (the ayah number) or the rub el hizb
// sign are not words.
export const WORD_SPLIT = /[ \u00a0]/;
export const WORD_SPLIT_KEEP = /([ \u00a0])/;
export const NOT_WORD = /^(?:[\u0660-\u0669]+|\u06de)$/;
