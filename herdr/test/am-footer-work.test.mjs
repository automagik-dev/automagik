// The footer's Work button (am-footer/work.js): the link it opens, the opener per OS, and the one
// notice when no app takes automagik://. A fake exec only: the stub's exec runs real commands, so
// nothing here clicks the drawn tab. The live click is the owner's (RECIPE, "Done when").
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { NOT_REGISTERED, opener, openWork, workUrl } from "../mods/am-footer/work.js";

function fakeIo(platform, answer) {
  const io = { platform, calls: [], notes: [] };
  io.exec = async (cmd, args) => { io.calls.push([cmd, args]); return answer(); };
  io.notify = (n) => { io.notes.push(n); };
  return io;
}

test("the Work link is automagik://open", () => {
  assert.equal(workUrl(), "automagik://open");
});

test("the opener per OS, as argv", () => {
  const url = workUrl();
  assert.deepEqual(opener("macos", url), ["open", [url]]);
  assert.deepEqual(opener("linux", url), ["xdg-open", [url]]);
  // start is cmd's builtin; its "" is the window title, so the URL is not taken for one.
  assert.deepEqual(opener("windows", url), ["cmd", ["/c", "start", "", url]]);
  assert.deepEqual(opener(undefined, url), ["xdg-open", [url]]);
});

test("Work hands the link to the platform's opener and posts nothing when it opens", async () => {
  for (const [platform, cmd] of [["macos", "open"], ["linux", "xdg-open"], ["windows", "cmd"]]) {
    const io = fakeIo(platform, () => ({ code: 0, stdout: "", stderr: "" }));
    assert.equal(await openWork(io), true);
    assert.equal(io.calls.length, 1);
    assert.equal(io.calls[0][0], cmd);
    assert.equal(io.calls[0][1].at(-1), "automagik://open");
    assert.deepEqual(io.notes, []);
  }
});

test("no app for automagik:// (the opener exits non-zero): one notice in plain words", async () => {
  const io = fakeIo("macos", () => ({ code: 1, stdout: "", stderr: "no application" }));
  assert.equal(await openWork(io), false);
  assert.equal(io.notes.length, 1);
  assert.equal(io.notes[0].body, NOT_REGISTERED);
  assert.equal(NOT_REGISTERED, "Automagik isn't installed or didn't register automagik://");
});

test("an opener that can't start, or a notice that fails, never throws", async () => {
  const io = fakeIo("linux", () => { throw new Error("spawn xdg-open ENOENT"); });
  assert.equal(await openWork(io), false);
  assert.equal(io.notes.length, 1);
  io.notify = () => { throw new Error("no notices"); };
  assert.equal(await openWork(io), false);
});

test("the rail draws Work after Mods, with its tooltip, without running it", async () => {
  const here = (f) => new URL(f, import.meta.url).href;
  const gpui = here("./gpui-stub.mjs");
  const stubs = { herdr: here("./footer-herdr.mjs"), "gpui-kit": gpui, "gpui-base": gpui };
  const ours = (context) => context.parentURL?.includes("/mods/am-footer/");
  registerHooks({
    resolve: (specifier, context, next) => (stubs[specifier] && ours(context)
      ? { url: stubs[specifier], shortCircuit: true }
      : next(specifier, context)),
  });
  const { ui } = await import(stubs.herdr);
  const { default: Footer } = await import("../mods/am-footer/main.js");
  const { all, index, nodes } = await import(stubs["gpui-kit"]);
  ui.props = { footer: true };
  const view = new Footer();
  // init's state before its first look: no Bots, panel or Pocket Link tab, nothing contributed.
  Object.assign(view, { bots: false, on: {}, pocket: false, phone: false, contributed: [] });
  const drawn = view.render();
  index(drawn);
  const ids = all(drawn).map((n) => n.id).filter((id) => id !== undefined);
  assert.equal(ids.indexOf("work"), ids.indexOf("mods") + 1);
  assert.equal(nodes.get("work").props.tooltip, "Open Automagik");
  assert.equal(nodes.get("work").kids[0].__node.arg, "mods/am-footer/briefcase.svg");
  assert.equal(typeof nodes.get("work").click, "function");
});
