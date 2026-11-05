// Western digits in every locale (matches the Arabic Figma screens). Must be explicit: server ICU
// and browser ICU disagree on the default numbering system for "ar", which breaks hydration.
export const LATN = { numberingSystem: "latn" } as const;
