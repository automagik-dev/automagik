// A small vertical layout model for gpui-stub trees (create.test.mjs): enough to tell whether
// a popup that is as tall as its content (Herdr's openOverlay, its height only the most) shows
// the rows of a scroll area. It reads each node's builder calls (h, size_full, flex_1, min_h,
// p/py/pt/pb, gap, border_1/border_t/border_b, overflow_y_scroll[bar], absolute) and lays out the
// height axis only; widths, text wrapping and alignment are not modelled.
//
// The rule it is built on was seen in a live Herdr, not derived: in a box sized by its content
// (a popup, a flex item measured for its basis, the inside of a scroll area) a percentage
// height (size_full, h_full) has nothing to resolve against and measures 0. overflow_y_scrollbar's
// wrapper (#239) and #327's relative wrapper both held a size_full scroll area and both drew
// only the popup's title and Cancel (#397). A flex_1 item there takes its content's height:
// #239's fix, a flex_1().min_h(0).overflow_y_scroll() body, showed its items live. The popup's
// root is the exception: its size_full is the popup's own box.

export const LINE = 16; // a line of text

function style(node) {
  const s = { pt: 0, pb: 0, bt: 0, bb: 0, gap: 0, row: node.kind === "h_flex" || node.kind === "button" };
  for (const [name, a] of node.calls) {
    if (name === "h" || name === "size") s.h = a;
    else if (name === "size_full" || name === "h_full") s.pct = 1;
    else if (name === "min_h") s.minH = a;
    else if (name === "max_h") s.maxH = a;
    else if (name === "flex_1") { s.grow = 1; s.basis0 = true; }
    else if (name === "flex_none") s.none = true;
    else if (name === "p" || name === "py") { s.pt = a; s.pb = a; }
    else if (name === "pt") s.pt = a;
    else if (name === "pb") s.pb = a;
    else if (name === "gap") s.gap = a;
    else if (name === "border_1") { s.bt = 1; s.bb = 1; }
    else if (name === "border_t") s.bt = a ?? 1;
    else if (name === "border_b") s.bb = a ?? 1;
    else if (name === "overflow_y_scroll") s.scroll = true;
    else if (name === "overflow_y_scrollbar") { s.scroll = true; s.wrapped = true; }
    else if (name === "absolute") s.abs = true;
  }
  return s;
}

const kidsOf = (node) => node.kids.filter((k) => k !== null && k !== undefined && typeof k !== "boolean")
  .map((k) => (typeof k === "object" ? k.__node : k));
const inFlow = (node) => kidsOf(node).filter((k) => typeof k !== "object" || !style(k).abs);
const clamp = (v, s) => Math.min(s.maxH ?? Infinity, Math.max(s.minH ?? 0, v));
const chrome = (s) => s.pt + s.pb + s.bt + s.bb;

// Its content's height: the box's own children stacked (a row: the tallest), padding and borders.
function contentOf(node) {
  const s = style(node);
  const hs = inFlow(node).map((k) => (typeof k === "object" ? outerInContentSized(k) : LINE));
  const inner = s.row ? Math.max(0, ...hs) : hs.reduce((a, b) => a + b, 0) + s.gap * Math.max(0, hs.length - 1);
  return inner + chrome(s);
}

// Its height inside a box sized by its content: a set height, 0 for a percentage (the rule
// above), 0 for an overflow_y_scrollbar box, else its content's. The scrollbar rule is what was
// seen, nothing wider: #239's bot menu drew its title alone on a Mac, and in a scratch Herdr
// 0.1.13 and 0.1.15 on Linux (#938) a control mod, a 42 px header over a
// flex_1().min_h(0).overflow_y_scrollbar() body of 40 rows, drew its header alone as a popup
// (height 0.6) and filled the same spec opened as a window. Only boxes sized by their content
// take it; in a set height such a box is a flex item as any other (place() below).
// popup-layout.test.mjs holds the rule to those observations, case by case.
function outerInContentSized(node) {
  const s = style(node);
  if (s.h !== undefined) return clamp(s.h, s);
  if (s.pct || s.wrapped) return 0;
  return clamp(contentOf(node), s);
}

// Lays `node` out at height `h`, top at `y` (window coordinates), into `boxes`.
function place(node, h, y, boxes, clip) {
  boxes.set(node, { y, h, clip });
  const s = style(node);
  const kids = kidsOf(node).filter((k) => typeof k === "object");
  const view = s.scroll ? { top: y, bottom: y + h } : clip;
  for (const k of kids.filter((k) => style(k).abs)) place(k, h, y, boxes, view); // inset_0
  const flow = inFlow(node);
  const top = y + s.pt + s.bt;
  if (s.row) {
    for (const k of flow) if (typeof k === "object") place(k, outerInContentSized(k), top, boxes, view);
    return;
  }
  // A scroll area's rows are as tall as their content: its inside is sized by its content.
  if (s.scroll) {
    let at = top;
    for (const k of flow) {
      const kh = typeof k === "object" ? outerInContentSized(k) : LINE;
      if (typeof k === "object") place(k, kh, at, boxes, view);
      at += kh + s.gap;
    }
    return;
  }
  // A column of a set height: set heights and percentages first, flex_1 items from 0 sharing
  // what is left, the rest at their content's height, shrinking (not below min_h) on overflow.
  const inner = h - chrome(s);
  const items = flow.map((k) => {
    if (typeof k !== "object") return { k, base: LINE, fixed: true };
    const ks = style(k);
    if (ks.h !== undefined) return { k, base: clamp(ks.h, ks), fixed: true };
    if (ks.pct) return { k, base: clamp(inner * ks.pct, ks), fixed: true };
    if (ks.basis0) return { k, base: 0, grow: ks.grow, min: ks.minH ?? contentOf(k) };
    return { k, base: clamp(contentOf(k), ks), fixed: Boolean(ks.none), min: ks.minH ?? (ks.scroll ? 0 : contentOf(k)) };
  });
  const gaps = s.gap * Math.max(0, items.length - 1);
  let free = inner - gaps - items.reduce((a, i) => a + i.base, 0);
  const growers = items.filter((i) => i.grow);
  if (free > 0 && growers.length) { for (const i of growers) i.base += free / growers.length; free = 0; }
  for (const i of items) if (i.min !== undefined && i.base < i.min && !i.grow) i.base = i.min;
  if (free < 0) {
    for (const i of items.filter((i) => !i.fixed)) {
      const give = Math.min(-free, i.base - (i.min ?? 0));
      if (give > 0) { i.base -= give; free += give; }
    }
  }
  let at = top;
  for (const i of items) {
    if (typeof i.k === "object") place(i.k, Math.max(0, i.base), at, boxes, view);
    at += Math.max(0, i.base) + s.gap;
  }
}

/** Lays out a rendered root as Herdr's popup: as tall as its content, `height` the most.
 *  A dialog with a set height: pass `{ height, fixed: true }`. Returns the popup's height and
 *  `box(nodeOrId)`: { y, h, visible } (visible: the part not clipped by a scroll area). */
export function layoutPopup(root, { height, fixed = false }, nodes) {
  const node = root.__node ?? root;
  const h = fixed ? height : Math.min(height, contentOf(node));
  const boxes = new Map();
  place(node, h, 0, boxes, null);
  const box = (x) => {
    const n = typeof x === "string" ? nodes.get(x) : (x.__node ?? x);
    const b = boxes.get(n);
    if (!b) return null;
    const top = Math.max(b.y, b.clip?.top ?? -Infinity), bottom = Math.min(b.y + b.h, b.clip?.bottom ?? Infinity);
    return { y: b.y, h: b.h, visible: Math.max(0, bottom - top) };
  };
  return { height: h, box, contentOf: (x) => contentOf(typeof x === "string" ? nodes.get(x) : (x.__node ?? x)) };
}
