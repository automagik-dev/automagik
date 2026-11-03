// The Work button: the way back from Herdr to the Automagik app (RFC 0013 delivery 6). It hands
// automagik://open to the OS's link opener; the app registers the scheme.
// Pure: no Herdr import, so node tests and main.js share it. main.js passes Herdr's `exec`,
// `notify` and `window().platform`.

export const NOT_REGISTERED = "Automagik isn't installed or didn't register automagik://";

// The link to open. Delivery 8 (RFC 0014) adds ?bot=<id> for the focused pane's Bot here.
export function workUrl() {
  return "automagik://open";
}

// The opener per OS, as argv (never a shell string). Herdr's platforms: "macos", "windows",
// "linux"; anything else is taken for a freedesktop system. `start` is cmd's builtin, so it runs
// through cmd /c; its "" is the window title, which start would otherwise take from the URL.
// cmd still reads & % ^ in the URL: what delivery 8 adds must stay free of them.
export function opener(platform, url) {
  if (platform === "macos") return ["open", [url]];
  if (platform === "windows") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

// Opens the link. Never throws: an opener that can't start or exits non-zero (no app for the
// scheme) posts one notice. Resolves true when the opener said it opened.
export async function openWork({ exec, notify, platform }, url = workUrl()) {
  try {
    const [cmd, args] = opener(platform, url);
    const r = await exec(cmd, args);
    if (r?.code === 0) return true;
  } catch { /* the notice says it */ }
  try {
    notify({ title: "Automagik", level: "warning", body: NOT_REGISTERED });
  } catch { /* nothing more to say */ }
  return false;
}
