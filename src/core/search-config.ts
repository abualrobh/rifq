// Search-form configuration (D-027, D-072, D-073). Read at build time by the index builder and at run
// time by the Worker and the browser island, so the index and the query always use the same rules.
//
// D-073 applies only the D-027 rules that need no qualified reviewer. The rules that the draft list
// marks for the D-012 reviewer (V-05, V-07, V-09, V-10, V-11, V-13, V-14, V-15, V-17, V-18) follow
// this mode:
//   'off'                  their characters are left exactly as they are in the search form;
//   'interim-placeholder'  INTERIM, approved by Hamzeh on 2026-11-07, AWAITING THE D-012 REVIEWER:
//                          the round 1 placeholder behaviour for those characters, the same as the
//                          test site before round 2. The marks of V-05, V-07, V-09, V-10 and V-11 are
//                          removed; no letter is mapped (V-13, V-14, V-15, V-17, V-18 keep);
//   'draft'                the draft list's proposals, for the reviewer to test.
// The mode applies to search input and index words only. Displayed text is never changed.
// Change it only with a decision ID from Hamzeh. The index records the mode in its header, and
// search-core.ts refuses an index built with another mode.
export type PendingMode = 'off' | 'interim-placeholder' | 'draft';
export const RULES_AWAITING_D012_REVIEWER: PendingMode = 'interim-placeholder';
