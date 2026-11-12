export const load = () => import("./target.js" /* why this one */);
export const other = () => import(
  "./other.js" // and why this one
);
const suffix = "";
export const computed = () => import("./target.js" /* a comment changes nothing */ + suffix);
