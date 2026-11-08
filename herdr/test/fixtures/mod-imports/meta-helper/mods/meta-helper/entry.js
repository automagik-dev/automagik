const guardDirOf = (url) => url;

export const guard = guardDirOf(import.meta["url"]);
