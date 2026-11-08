const meta = import.meta;
export const url = new URL("./x", meta.url).href;
