// The popup layout model (popup-layout.mjs) held to what a live Herdr drew, case by case. Each case
// is a control mod run in a scratch Herdr app home on Linux for #938, built here with the same
// builder calls (its theme colours left out: the model reads none), and each expected number was
// measured in the saved frame, down a pixel column inside the 320 px card. The frames are
// published with the follow-up's pull request (pr-assets/herdr-938-panel).
//
// What these cover, and what they do not. They calibrate the model's overflow_y_scrollbar rule on
// their own: drop the rule and the first two cases fail, whatever any mod does. The panel's own
// tests (am-automations-panel.test.mjs) lay the panel out through this model, so without the rule
// they are held by their structure checks alone; the zero height is pinned here, from what was
// seen, and nowhere else. Not here, because not seen: a pure overflow_y_scroll control (the fixed
// panel's shots and #239's fix are that evidence, held by create.test.mjs and the panel's tests).
import test from "node:test";
import assert from "node:assert/strict";
import { div, h_flex, v_flex, index, nodes } from "./gpui-stub.mjs";
import { layoutPopup } from "./popup-layout.mjs";

// am-footer's PANEL_POPUP share (0.6) of the 820 px window the controls ran in.
const POPUP_H = 492;

/** The control: a 42 px header over a flex_1().min_h(0).overflow_y_scrollbar() body of 40 rows. */
function scrollbarControl() {
  const rows = Array.from({ length: 40 }, (_, i) => div().h(20).child(`row ${i + 1}`));
  return index(v_flex().size_full().child(div().h(42).child("header 42px"))
    .child(div().id("b").flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().children(rows))));
}

test("a content-sized popup gives an overflow_y_scrollbar body no height: the header alone (#938)", () => {
  // Seen on Herdr 0.1.15 and 0.1.13, as a popup of height 0.6: header 42 px, body 0 px.
  const pop = layoutPopup(scrollbarControl(), { height: POPUP_H }, nodes);
  assert.equal(pop.box("b").h, 0, "the body measures 0");
  assert.equal(pop.height, 42, "the popup is its header alone");
});

/** The shipped Automations panel's own frame, as its render() built it before #1131 (e6bc1a64):
 *  a 1 px border, the 42 px header with its bottom border, one overflow_y_scrollbar block holding
 *  the list. The list's rows are stand-ins: the block measured 0 whatever it held. */
function shippedPanel() {
  const list = v_flex().pb(10).children(Array.from({ length: 12 }, (_, i) => div().h(30).child(`automation ${i + 1}`)));
  return index(v_flex().id("automations").size_full().min_h(0).rounded(10).overflow_hidden().border_1().text_size(13)
    .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).child(div().child("Automations")))
    .child(div().id("automations-body").flex_1().min_h(0).overflow_y_scrollbar().child(list)));
}

test("the shipped Automations panel's single block, as the footer's popup: its header alone (#938)", () => {
  // Seen on Herdr 0.1.15, light and dark, the shipped panel opened as am-footer opens it: inside
  // the popup's 1 px frame the panel was 44 px (its border, the 42 px header, its border) and
  // drew no body.
  const pop = layoutPopup(shippedPanel(), { height: POPUP_H }, nodes);
  assert.equal(pop.box("automations-body").h, 0, "the block measures 0");
  assert.equal(pop.height, 44, "the panel is its border and header alone");
});

test("the same overflow_y_scrollbar body in a set height fills what the header leaves (#938)", () => {
  // Seen on Herdr 0.1.15, the same spec opened as a window: header 42 px, body 448 px, in a
  // content box of 490 (the window's 0.6, less its 1 px frame each side).
  const pop = layoutPopup(scrollbarControl(), { height: 490, fixed: true }, nodes);
  assert.equal(pop.box("b").h, 448, "the rule is for content-sized boxes only");
});

test("a content-sized popup gives a plain flex_1().min_h(0) body its content's height (#938)", () => {
  // Seen on Herdr 0.1.15, as a popup of height 0.6: header 42 px, body 26 px, its one line of
  // text. The model's line is 16 px, so the case asserts the content's height, not the 26.
  const root = index(v_flex().size_full().child(div().h(42).child("header 42px"))
    .child(div().id("b").flex_1().min_h(0).child("flex_1 body")));
  const pop = layoutPopup(root, { height: POPUP_H }, nodes);
  const body = pop.box("b").h;
  assert.ok(body > 0, `the body has a height (got ${body})`);
  assert.equal(body, pop.contentOf("b"), "its content's height, not 0");
  assert.equal(pop.height, 42 + body, "the popup is the header and that body");
});
