// /dev/quote-check/ counts (kept apart from the island so unit tests can read them).
// Kit v35 (B4): the English work's display letters are N for every phrase with no Arabic letters
// as well as for unclosed ones. The "Reader display N" row counts unclosed phrases only: N minus
// the closed phrases with no Arabic letters (those have their own rows). Only the English work
// uses this; the Arabic row is unchanged.
export const displayN = (c: Record<string, number | undefined>) => (c.dN ?? 0) - ((c.otherPhrases ?? 0) - (c.otherUnclosed ?? 0));
