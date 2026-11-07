// Search-form configuration (D-027, D-072, D-073). Read at build time by the index builder and at run
// time by the Worker and the browser island, so the index and the query always use the same rules.
//
// D-073 applies only the D-027 rules that need no qualified reviewer. The rules that the draft list
// marks for the D-012 reviewer (V-05, V-07, V-09, V-10, V-11, V-13, V-14, V-15, V-17, V-18) stay OFF
// until the reviewer and Hamzeh approve them by decision ID. OFF means the characters those rules
// cover are left exactly as they are in the search form: they are neither removed nor folded.
//
// Do not change this to true without a decision ID from Hamzeh. Changing it changes the search
// index, which then records the setting in its header (search-core.ts checks that they match).
export const RULES_AWAITING_D012_REVIEWER_ENABLED: boolean = false;
