export const lazy = { f: () => import.meta.url, g: (base) => new URL(base, import.meta.url) };
export const later = () => import.meta.url;
export const nested = () => () => import.meta.url;
export const wrapped = () => (
  import.meta.url
);
const run = (make, value) => [make, value];
export const afterComma = run(() => 1, import.meta.url);
export const noSemicolon = () => 2
export const afterLine = import.meta.url;
export const afterBracket = [() => 3][0] ?? import.meta.url;
