const helpers = { guardDirOf: (url) => url };

export const guard = helpers.guardDirOf(import.meta.url);
