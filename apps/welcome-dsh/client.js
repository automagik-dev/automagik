// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.
window.__ModuleLoader__.load({
  id: '@automagik/welcome-dsh',
  factory: (require) => {
const module = { exports: {} }
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn2, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn2 && (res = (0, fn2[__getOwnPropNames(fn2)[0]])(fn2 = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to2, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to2, key) && key !== except)
        __defProp(to2, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to2;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/@xterm/xterm/lib/xterm.mjs
var xterm_exports = {};
__export(xterm_exports, {
  Terminal: () => Dl
});
function Al(s15) {
  return s15.replace(/\r?\n/g, "\r");
}
function kl(s15, t) {
  return t ? "\x1B[200~" + s15 + "\x1B[201~" : s15;
}
function Vs(s15, t) {
  s15.clipboardData && s15.clipboardData.setData("text/plain", t.selectionText), s15.preventDefault();
}
function qs(s15, t, e, i) {
  if (s15.stopPropagation(), s15.clipboardData) {
    let r = s15.clipboardData.getData("text/plain");
    Cn(r, t, e, i);
  }
}
function Cn(s15, t, e, i) {
  s15 = Al(s15), s15 = kl(s15, e.decPrivateModes.bracketedPasteMode && i.rawOptions.ignoreBracketedPasteMode !== true), e.triggerDataEvent(s15, true), t.value = "";
}
function Mn(s15, t, e) {
  let i = e.getBoundingClientRect(), r = s15.clientX - i.left - 10, n = s15.clientY - i.top - 10;
  t.style.width = "20px", t.style.height = "20px", t.style.left = `${r}px`, t.style.top = `${n}px`, t.style.zIndex = "1000", t.focus();
}
function Pn(s15, t, e, i, r) {
  Mn(s15, t, e), r && i.rightClickSelect(s15), t.value = i.selectionText, t.select();
}
function Ce(s15) {
  return s15 > 65535 ? (s15 -= 65536, String.fromCharCode((s15 >> 10) + 55296) + String.fromCharCode(s15 % 1024 + 56320)) : String.fromCharCode(s15);
}
function It(s15, t = 0, e = s15.length) {
  let i = "";
  for (let r = t; r < e; ++r) {
    let n = s15[r];
    n > 65535 ? (n -= 65536, i += String.fromCharCode((n >> 10) + 55296) + String.fromCharCode(n % 1024 + 56320)) : i += String.fromCharCode(n);
  }
  return i;
}
function Xs(s15) {
  return s15[Hn] || [];
}
function ie(s15) {
  if (Fn.has(s15)) return Fn.get(s15);
  let t = function(e, i, r) {
    if (arguments.length !== 3) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
    Pl(t, e, r);
  };
  return t._id = s15, Fn.set(s15, t), t;
}
function Pl(s15, t, e) {
  t[js] === t ? t[Hn].push({ id: s15, index: e }) : (t[Hn] = [{ id: s15, index: e }], t[js] = t);
}
function Ol(s15, t) {
  if (confirm(`Do you want to navigate to ${t}?

WARNING: This link could potentially be dangerous`)) {
    let i = window.open();
    if (i) {
      try {
        i.opener = null;
      } catch {
      }
      i.location.href = t;
    } else console.warn("Opening link blocked as opener could not be cleared");
  }
}
function Lt(s15) {
  Nl(s15) || Bl.onUnexpectedError(s15);
}
function Nl(s15) {
  return s15 instanceof bi ? true : s15 instanceof Error && s15.name === Un && s15.message === Un;
}
function eo(s15) {
  return s15 ? new Error(`Illegal argument: ${s15}`) : new Error("Illegal argument");
}
function Fl(s15, t, e = 0, i = s15.length) {
  let r = e, n = i;
  for (; r < n; ) {
    let o = Math.floor((r + n) / 2);
    t(s15[o]) ? r = o + 1 : n = o;
  }
  return r - 1;
}
function Se(s15, t = 0) {
  return s15[s15.length - (1 + t)];
}
function no(s15, t) {
  return (e, i) => t(s15(e), s15(i));
}
function co(s15, t) {
  let e = /* @__PURE__ */ Object.create(null);
  for (let i of s15) {
    let r = t(i), n = e[r];
    n || (n = e[r] = []), n.push(i);
  }
  return e;
}
function Kn(s15, t) {
  let e = this, i = false, r;
  return function() {
    if (i) return r;
    if (i = true, t) try {
      r = s15.apply(e, arguments);
    } finally {
      t();
    }
    else r = s15.apply(e, arguments);
    return r;
  };
}
function Ul(s15) {
  dt = s15;
}
function fr(s15) {
  return dt?.trackDisposable(s15), s15;
}
function pr(s15) {
  dt?.markAsDisposed(s15);
}
function vi(s15, t) {
  dt?.setParent(s15, t);
}
function Kl(s15, t) {
  if (dt) for (let e of s15) dt.setParent(e, t);
}
function Gn(s15) {
  return dt?.markAsSingleton(s15), s15;
}
function Ne(s15) {
  if (zn.is(s15)) {
    let t = [];
    for (let e of s15) if (e) try {
      e.dispose();
    } catch (i) {
      t.push(i);
    }
    if (t.length === 1) throw t[0];
    if (t.length > 1) throw new AggregateError(t, "Encountered errors while disposing of store");
    return Array.isArray(s15) ? [] : s15;
  } else if (s15) return s15.dispose(), s15;
}
function ho(...s15) {
  let t = C(() => Ne(s15));
  return Kl(s15, t), t;
}
function C(s15) {
  let t = fr({ dispose: Kn(() => {
    pr(t), s15();
  }) });
  return t;
}
function Xl(s15, t, e) {
  typeof t == "string" && (t = s15.matchMedia(t)), t.addEventListener("change", e);
}
function mo(s15) {
  return Si.INSTANCE.getZoomFactor(s15);
}
function _o() {
  return vr;
}
function ca(s15) {
  if (s15.charCode) {
    let e = String.fromCharCode(s15.charCode).toUpperCase();
    return Qn.fromString(e);
  }
  let t = s15.keyCode;
  if (t === 3) return 7;
  if (Ei) switch (t) {
    case 59:
      return 85;
    case 60:
      if (Zn) return 97;
      break;
    case 61:
      return 86;
    case 107:
      return 109;
    case 109:
      return 111;
    case 173:
      return 88;
    case 224:
      if (Te) return 57;
      break;
  }
  else if (Bt) {
    if (Te && t === 93) return 57;
    if (!Te && t === 92) return 57;
  }
  return yo[t] || 0;
}
function pa(s15) {
  if (!s15.parent || s15.parent === s15) return null;
  try {
    let t = s15.location, e = s15.parent.location;
    if (t.origin !== "null" && e.origin !== "null" && t.origin !== e.origin) return null;
  } catch {
    return null;
  }
  return s15.parent;
}
function Lo(s15) {
  return 55296 <= s15 && s15 <= 56319;
}
function is(s15) {
  return 56320 <= s15 && s15 <= 57343;
}
function Ao(s15, t) {
  return (s15 - 55296 << 10) + (t - 56320) + 65536;
}
function Mo(s15) {
  return ns(s15, 0);
}
function ns(s15, t) {
  switch (typeof s15) {
    case "object":
      return s15 === null ? je(349, t) : Array.isArray(s15) ? Ea(s15, t) : Ta(s15, t);
    case "string":
      return Po(s15, t);
    case "boolean":
      return Sa(s15, t);
    case "number":
      return je(s15, t);
    case "undefined":
      return je(937, t);
    default:
      return je(617, t);
  }
}
function je(s15, t) {
  return (t << 5) - t + s15 | 0;
}
function Sa(s15, t) {
  return je(s15 ? 433 : 863, t);
}
function Po(s15, t) {
  t = je(149417, t);
  for (let e = 0, i = s15.length; e < i; e++) t = je(s15.charCodeAt(e), t);
  return t;
}
function Ea(s15, t) {
  return t = je(104579, t), s15.reduce((e, i) => ns(i, e), t);
}
function Ta(s15, t) {
  return t = je(181387, t), Object.keys(s15).sort().reduce((e, i) => (e = Po(i, e), ns(s15[i], e)), t);
}
function rs(s15, t, e = 32) {
  let i = e - t, r = ~((1 << i) - 1);
  return (s15 << t | (r & s15) >>> i) >>> 0;
}
function ko(s15, t = 0, e = s15.byteLength, i = 0) {
  for (let r = 0; r < e; r++) s15[t + r] = i;
}
function Ia(s15, t, e = "0") {
  for (; s15.length < t; ) s15 = e + s15;
  return s15;
}
function wi(s15, t = 32) {
  return s15 instanceof ArrayBuffer ? Array.from(new Uint8Array(s15)).map((e) => e.toString(16).padStart(2, "0")).join("") : Ia((s15 >>> 0).toString(16), t / 4);
}
function L(s15, t, e, i) {
  return new ss(s15, t, e, i);
}
function ya(s15, t) {
  return function(e) {
    return t(new qe(s15, e));
  };
}
function xa(s15) {
  return function(t) {
    return s15(new ft(t));
  };
}
function Fo(s15) {
  let t = s15.getBoundingClientRect(), e = be(s15);
  return { left: t.left + e.scrollX, top: t.top + e.scrollY, width: t.width, height: t.height };
}
function Ho(s15, t, e, ...i) {
  let r = Da.exec(t);
  if (!r) throw new Error("Bad use of emmet");
  let n = r[1] || "div", o;
  return s15 !== "http://www.w3.org/1999/xhtml" ? o = document.createElementNS(s15, n) : o = document.createElement(n), r[3] && (o.id = r[3]), r[4] && (o.className = r[4].replace(/\./g, " ").trim()), e && Object.entries(e).forEach(([l, a]) => {
    typeof a > "u" || (/^on\w+$/.test(l) ? o[l] = a : l === "selected" ? a && o.setAttribute(l, "true") : o.setAttribute(l, a));
  }), o.append(...i), o;
}
function Ra(s15, t, ...e) {
  return Ho("http://www.w3.org/1999/xhtml", s15, t, ...e);
}
function Ie(s15) {
  return typeof s15 == "number" ? `${s15}px` : s15;
}
function _t(s15) {
  return new ls(s15);
}
function Wo(s15, t, e) {
  let i = null, r = null;
  if (typeof e.value == "function" ? (i = "value", r = e.value, r.length !== 0 && console.warn("Memoize should only be used in functions with zero parameters")) : typeof e.get == "function" && (i = "get", r = e.get), !r) throw new Error("not supported");
  let n = `$memoize$${t}`;
  e[i] = function(...o) {
    return this.hasOwnProperty(n) || Object.defineProperty(this, n, { configurable: false, enumerable: false, writable: false, value: r.apply(this, o) }), this[n];
  };
}
function as(s15, t) {
  let e = t - s15;
  return function(i) {
    return s15 + e * ka(i);
  };
}
function La(s15, t, e) {
  return function(i) {
    return i < e ? s15(i / e) : t((i - e) / (1 - e));
  };
}
function Aa(s15) {
  return Math.pow(s15, 3);
}
function ka(s15) {
  return 1 - Aa(1 - s15);
}
function Pa(s15) {
  let t = { lazyRender: typeof s15.lazyRender < "u" ? s15.lazyRender : false, className: typeof s15.className < "u" ? s15.className : "", useShadows: typeof s15.useShadows < "u" ? s15.useShadows : true, handleMouseWheel: typeof s15.handleMouseWheel < "u" ? s15.handleMouseWheel : true, flipAxes: typeof s15.flipAxes < "u" ? s15.flipAxes : false, consumeMouseWheelIfScrollbarIsNeeded: typeof s15.consumeMouseWheelIfScrollbarIsNeeded < "u" ? s15.consumeMouseWheelIfScrollbarIsNeeded : false, alwaysConsumeMouseWheel: typeof s15.alwaysConsumeMouseWheel < "u" ? s15.alwaysConsumeMouseWheel : false, scrollYToX: typeof s15.scrollYToX < "u" ? s15.scrollYToX : false, mouseWheelScrollSensitivity: typeof s15.mouseWheelScrollSensitivity < "u" ? s15.mouseWheelScrollSensitivity : 1, fastScrollSensitivity: typeof s15.fastScrollSensitivity < "u" ? s15.fastScrollSensitivity : 5, scrollPredominantAxis: typeof s15.scrollPredominantAxis < "u" ? s15.scrollPredominantAxis : true, mouseWheelSmoothScroll: typeof s15.mouseWheelSmoothScroll < "u" ? s15.mouseWheelSmoothScroll : true, arrowSize: typeof s15.arrowSize < "u" ? s15.arrowSize : 11, listenOnDomNode: typeof s15.listenOnDomNode < "u" ? s15.listenOnDomNode : null, horizontal: typeof s15.horizontal < "u" ? s15.horizontal : 1, horizontalScrollbarSize: typeof s15.horizontalScrollbarSize < "u" ? s15.horizontalScrollbarSize : 10, horizontalSliderSize: typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : 0, horizontalHasArrows: typeof s15.horizontalHasArrows < "u" ? s15.horizontalHasArrows : false, vertical: typeof s15.vertical < "u" ? s15.vertical : 1, verticalScrollbarSize: typeof s15.verticalScrollbarSize < "u" ? s15.verticalScrollbarSize : 10, verticalHasArrows: typeof s15.verticalHasArrows < "u" ? s15.verticalHasArrows : false, verticalSliderSize: typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : 0, scrollByPage: typeof s15.scrollByPage < "u" ? s15.scrollByPage : false };
  return t.horizontalSliderSize = typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : t.horizontalScrollbarSize, t.verticalSliderSize = typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : t.verticalScrollbarSize, Te && (t.className += " mac"), t;
}
function vt(s15) {
  let t = s15.toString(16);
  return t.length < 2 ? "0" + t : t;
}
function Xe(s15, t) {
  return s15 < t ? (t + 0.05) / (s15 + 0.05) : (s15 + 0.05) / (t + 0.05);
}
function Oa(s15) {
  return 57508 <= s15 && s15 <= 57558;
}
function Ba(s15) {
  return 9472 <= s15 && s15 <= 9631;
}
function $o(s15) {
  return Oa(s15) || Ba(s15);
}
function Vo() {
  return { css: { canvas: qr(), cell: qr() }, device: { canvas: qr(), cell: qr(), char: { width: 0, height: 0, left: 0, top: 0 } } };
}
function qr() {
  return { width: 0, height: 0 };
}
function qo(s15, t, e) {
  for (; s15.length < e; ) s15 = t + s15;
  return s15;
}
function Yo() {
  return new ms();
}
function Ci(s15, t, e) {
  let i = e.getBoundingClientRect(), r = s15.getComputedStyle(e), n = parseInt(r.getPropertyValue("padding-left")), o = parseInt(r.getPropertyValue("padding-top"));
  return [t.clientX - i.left - n, t.clientY - i.top - o];
}
function Xo(s15, t, e, i, r, n, o, l, a) {
  if (!n) return;
  let u = Ci(s15, t, e);
  if (u) return u[0] = Math.ceil((u[0] + (a ? o / 2 : 0)) / o), u[1] = Math.ceil(u[1] / l), u[0] = Math.min(Math.max(u[0], 1), i + (a ? 1 : 0)), u[1] = Math.min(Math.max(u[1], 1), r), u;
}
function Ha() {
  if (!Zo) return 0;
  let s15 = Pi.match(/Version\/(\d+)/);
  return s15 === null || s15.length < 2 ? 0 : parseInt(s15[1]);
}
function Jo(s15, t, e, i) {
  let r = e.buffer.x, n = e.buffer.y;
  if (!e.buffer.hasScrollback) return Ga(r, n, s15, t, e, i) + sn(n, t, e, i) + $a(r, n, s15, t, e, i);
  let o;
  if (n === t) return o = r > s15 ? "D" : "C", Fi(Math.abs(r - s15), Ni(o, i));
  o = n > t ? "D" : "C";
  let l = Math.abs(n - t), a = za(n > t ? s15 : r, e) + (l - 1) * e.cols + 1 + Ka(n > t ? r : s15, e);
  return Fi(a, Ni(o, i));
}
function Ka(s15, t) {
  return s15 - 1;
}
function za(s15, t) {
  return t.cols - s15;
}
function Ga(s15, t, e, i, r, n) {
  return sn(t, i, r, n).length === 0 ? "" : Fi(el(s15, t, s15, t - gt(t, r), false, r).length, Ni("D", n));
}
function sn(s15, t, e, i) {
  let r = s15 - gt(s15, e), n = t - gt(t, e), o = Math.abs(r - n) - Va(s15, t, e);
  return Fi(o, Ni(Qo(s15, t), i));
}
function $a(s15, t, e, i, r, n) {
  let o;
  sn(t, i, r, n).length > 0 ? o = i - gt(i, r) : o = t;
  let l = i, a = qa(s15, t, e, i, r, n);
  return Fi(el(s15, o, e, l, a === "C", r).length, Ni(a, n));
}
function Va(s15, t, e) {
  let i = 0, r = s15 - gt(s15, e), n = t - gt(t, e);
  for (let o = 0; o < Math.abs(r - n); o++) {
    let l = Qo(s15, t) === "A" ? -1 : 1;
    e.buffer.lines.get(r + l * o)?.isWrapped && i++;
  }
  return i;
}
function gt(s15, t) {
  let e = 0, i = t.buffer.lines.get(s15), r = i?.isWrapped;
  for (; r && s15 >= 0 && s15 < t.rows; ) e++, i = t.buffer.lines.get(--s15), r = i?.isWrapped;
  return e;
}
function qa(s15, t, e, i, r, n) {
  let o;
  return sn(e, i, r, n).length > 0 ? o = i - gt(i, r) : o = t, s15 < e && o <= i || s15 >= e && o < i ? "C" : "D";
}
function Qo(s15, t) {
  return s15 > t ? "A" : "B";
}
function el(s15, t, e, i, r, n) {
  let o = s15, l = t, a = "";
  for (; (o !== e || l !== i) && l >= 0 && l < n.buffer.lines.length; ) o += r ? 1 : -1, r && o > n.cols - 1 ? (a += n.buffer.translateBufferLineToString(l, false, s15, o), o = 0, s15 = 0, l++) : !r && o < 0 && (a += n.buffer.translateBufferLineToString(l, false, 0, s15 + 1), o = n.cols - 1, s15 = o, l--);
  return a + n.buffer.translateBufferLineToString(l, false, s15, o);
}
function Ni(s15, t) {
  let e = t ? "O" : "[";
  return b.ESC + e + s15;
}
function Fi(s15, t) {
  s15 = Math.floor(s15);
  let e = "";
  for (let i = 0; i < s15; i++) e += t;
  return e;
}
function ws(s15, t) {
  if (s15.start.y > s15.end.y) throw new Error(`Buffer range end (${s15.end.x}, ${s15.end.y}) cannot be before start (${s15.start.x}, ${s15.start.y})`);
  return t * (s15.end.y - s15.start.y) + (s15.end.x - s15.start.x + 1);
}
function K(s15, t) {
  if (s15 !== void 0) try {
    return z.toColor(s15);
  } catch {
  }
  return t;
}
function sl(s15, t, e, i, r, n) {
  let o = [];
  for (let l = 0; l < s15.length - 1; l++) {
    let a = l, u = s15.get(++a);
    if (!u.isWrapped) continue;
    let h8 = [s15.get(l)];
    for (; a < s15.length && u.isWrapped; ) h8.push(u), u = s15.get(++a);
    if (!n && i >= l && i < a) {
      l += h8.length - 1;
      continue;
    }
    let c = 0, d = ri(h8, c, t), _ = 1, p = 0;
    for (; _ < h8.length; ) {
      let f = ri(h8, _, t), A = f - p, R = e - d, O = Math.min(A, R);
      h8[c].copyCellsFrom(h8[_], p, d, O, false), d += O, d === e && (c++, d = 0), p += O, p === f && (_++, p = 0), d === 0 && c !== 0 && h8[c - 1].getWidth(e - 1) === 2 && (h8[c].copyCellsFrom(h8[c - 1], e - 1, d++, 1, false), h8[c - 1].setCell(e - 1, r));
    }
    h8[c].replaceCells(d, e, r);
    let m = 0;
    for (let f = h8.length - 1; f > 0 && (f > c || h8[f].getTrimmedLength() === 0); f--) m++;
    m > 0 && (o.push(l + h8.length - m), o.push(m)), l += h8.length - 1;
  }
  return o;
}
function ol(s15, t) {
  let e = [], i = 0, r = t[i], n = 0;
  for (let o = 0; o < s15.length; o++) if (r === o) {
    let l = t[++i];
    s15.onDeleteEmitter.fire({ index: o - n, amount: l }), o += l - 1, n += l, r = t[++i];
  } else e.push(o);
  return { layout: e, countRemoved: n };
}
function ll(s15, t) {
  let e = [];
  for (let i = 0; i < t.length; i++) e.push(s15.get(t[i]));
  for (let i = 0; i < e.length; i++) s15.set(i, e[i]);
  s15.length = t.length;
}
function al(s15, t, e) {
  let i = [], r = s15.map((a, u) => ri(s15, u, t)).reduce((a, u) => a + u), n = 0, o = 0, l = 0;
  for (; l < r; ) {
    if (r - l < e) {
      i.push(r - l);
      break;
    }
    n += e;
    let a = ri(s15, o, t);
    n > a && (n -= a, o++);
    let u = s15[o].getWidth(n - 1) === 2;
    u && n--;
    let h8 = u ? e - 1 : e;
    i.push(h8), l += h8;
  }
  return i;
}
function ri(s15, t, e) {
  if (t === s15.length - 1) return s15[t].getTrimmedLength();
  let i = !s15[t].hasContent(e - 1) && s15[t].getWidth(e - 1) === 1, r = s15[t + 1].getWidth(0) === 2;
  return i && r ? e - 1 : e;
}
function sc(s15) {
  return s15 === "block" || s15 === "underline" || s15 === "bar";
}
function oi(s15, t = 5) {
  if (typeof s15 != "object") return s15;
  let e = Array.isArray(s15) ? [] : {};
  for (let i in s15) e[i] = t <= 1 ? s15[i] : s15[i] && oi(s15[i], t - 1);
  return e;
}
function Ms(s15, t) {
  let e = (s15.ctrl ? 16 : 0) | (s15.shift ? 4 : 0) | (s15.alt ? 8 : 0);
  return s15.button === 4 ? (e |= 64, e |= s15.action) : (e |= s15.button & 3, s15.button & 4 && (e |= 64), s15.button & 8 && (e |= 128), s15.action === 32 ? e |= 32 : s15.action === 0 && !t && (e |= 3)), e;
}
function cc(s15, t) {
  let e = 0, i = t.length - 1, r;
  if (s15 < t[0][0] || s15 > t[i][1]) return false;
  for (; i >= e; ) if (r = e + i >> 1, s15 > t[r][1]) e = r + 1;
  else if (s15 < t[r][0]) i = r - 1;
  else return true;
  return false;
}
function Bs(s15) {
  let e = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y - 1)?.get(s15.cols - 1), i = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y);
  i && e && (i.isWrapped = e[3] !== 0 && e[3] !== 32);
}
function Ws(s15) {
  if (!s15) return;
  let t = s15.toLowerCase();
  if (t.indexOf("rgb:") === 0) {
    t = t.slice(4);
    let e = dc.exec(t);
    if (e) {
      let i = e[1] ? 15 : e[4] ? 255 : e[7] ? 4095 : 65535;
      return [Math.round(parseInt(e[1] || e[4] || e[7] || e[10], 16) / i * 255), Math.round(parseInt(e[2] || e[5] || e[8] || e[11], 16) / i * 255), Math.round(parseInt(e[3] || e[6] || e[9] || e[12], 16) / i * 255)];
    }
  } else if (t.indexOf("#") === 0 && (t = t.slice(1), fc.exec(t) && [3, 6, 9, 12].includes(t.length))) {
    let e = t.length / 3, i = [0, 0, 0];
    for (let r = 0; r < 3; ++r) {
      let n = parseInt(t.slice(e * r, e * r + e), 16);
      i[r] = e === 1 ? n << 4 : e === 2 ? n : e === 3 ? n >> 4 : n >> 8;
    }
    return i;
  }
}
function Hs(s15, t) {
  let e = s15.toString(16), i = e.length < 2 ? "0" + e : e;
  switch (t) {
    case 4:
      return e[0];
    case 8:
      return i;
    case 12:
      return (i + i).slice(0, 3);
    default:
      return i + i;
  }
}
function ml(s15, t = 16) {
  let [e, i, r] = s15;
  return `rgb:${Hs(e, t)}/${Hs(i, t)}/${Hs(r, t)}`;
}
function bl(s15, t) {
  if (s15 > 24) return t.setWinLines || false;
  switch (s15) {
    case 1:
      return !!t.restoreWin;
    case 2:
      return !!t.minimizeWin;
    case 3:
      return !!t.setWinPosition;
    case 4:
      return !!t.setWinSizePixels;
    case 5:
      return !!t.raiseWin;
    case 6:
      return !!t.lowerWin;
    case 7:
      return !!t.refreshWin;
    case 8:
      return !!t.setWinSizeChars;
    case 9:
      return !!t.maximizeWin;
    case 10:
      return !!t.fullscreenWin;
    case 11:
      return !!t.getWinState;
    case 13:
      return !!t.getWinPosition;
    case 14:
      return !!t.getWinSizePixels;
    case 15:
      return !!t.getScreenSizePixels;
    case 16:
      return !!t.getCellSizePixels;
    case 18:
      return !!t.getWinSizeChars;
    case 19:
      return !!t.getScreenSizeChars;
    case 20:
      return !!t.getIconTitle;
    case 21:
      return !!t.getWinTitle;
    case 22:
      return !!t.pushTitle;
    case 23:
      return !!t.popTitle;
    case 24:
      return !!t.setWinLines;
  }
  return false;
}
function Sl(s15) {
  return 0 <= s15 && s15 < 256;
}
function Il(s15, t, e, i) {
  let r = { type: 0, cancel: false, key: void 0 }, n = (s15.shiftKey ? 1 : 0) | (s15.altKey ? 2 : 0) | (s15.ctrlKey ? 4 : 0) | (s15.metaKey ? 8 : 0);
  switch (s15.keyCode) {
    case 0:
      s15.key === "UIKeyInputUpArrow" ? t ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A" : s15.key === "UIKeyInputLeftArrow" ? t ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D" : s15.key === "UIKeyInputRightArrow" ? t ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C" : s15.key === "UIKeyInputDownArrow" && (t ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B");
      break;
    case 8:
      r.key = s15.ctrlKey ? "\b" : b.DEL, s15.altKey && (r.key = b.ESC + r.key);
      break;
    case 9:
      if (s15.shiftKey) {
        r.key = b.ESC + "[Z";
        break;
      }
      r.key = b.HT, r.cancel = true;
      break;
    case 13:
      r.key = s15.altKey ? b.ESC + b.CR : b.CR, r.cancel = true;
      break;
    case 27:
      r.key = b.ESC, s15.altKey && (r.key = b.ESC + b.ESC), r.cancel = true;
      break;
    case 37:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "D" : t ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D";
      break;
    case 39:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "C" : t ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C";
      break;
    case 38:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "A" : t ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A";
      break;
    case 40:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "B" : t ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B";
      break;
    case 45:
      !s15.shiftKey && !s15.ctrlKey && (r.key = b.ESC + "[2~");
      break;
    case 46:
      n ? r.key = b.ESC + "[3;" + (n + 1) + "~" : r.key = b.ESC + "[3~";
      break;
    case 36:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "H" : t ? r.key = b.ESC + "OH" : r.key = b.ESC + "[H";
      break;
    case 35:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "F" : t ? r.key = b.ESC + "OF" : r.key = b.ESC + "[F";
      break;
    case 33:
      s15.shiftKey ? r.type = 2 : s15.ctrlKey ? r.key = b.ESC + "[5;" + (n + 1) + "~" : r.key = b.ESC + "[5~";
      break;
    case 34:
      s15.shiftKey ? r.type = 3 : s15.ctrlKey ? r.key = b.ESC + "[6;" + (n + 1) + "~" : r.key = b.ESC + "[6~";
      break;
    case 112:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "P" : r.key = b.ESC + "OP";
      break;
    case 113:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "Q" : r.key = b.ESC + "OQ";
      break;
    case 114:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "R" : r.key = b.ESC + "OR";
      break;
    case 115:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "S" : r.key = b.ESC + "OS";
      break;
    case 116:
      n ? r.key = b.ESC + "[15;" + (n + 1) + "~" : r.key = b.ESC + "[15~";
      break;
    case 117:
      n ? r.key = b.ESC + "[17;" + (n + 1) + "~" : r.key = b.ESC + "[17~";
      break;
    case 118:
      n ? r.key = b.ESC + "[18;" + (n + 1) + "~" : r.key = b.ESC + "[18~";
      break;
    case 119:
      n ? r.key = b.ESC + "[19;" + (n + 1) + "~" : r.key = b.ESC + "[19~";
      break;
    case 120:
      n ? r.key = b.ESC + "[20;" + (n + 1) + "~" : r.key = b.ESC + "[20~";
      break;
    case 121:
      n ? r.key = b.ESC + "[21;" + (n + 1) + "~" : r.key = b.ESC + "[21~";
      break;
    case 122:
      n ? r.key = b.ESC + "[23;" + (n + 1) + "~" : r.key = b.ESC + "[23~";
      break;
    case 123:
      n ? r.key = b.ESC + "[24;" + (n + 1) + "~" : r.key = b.ESC + "[24~";
      break;
    default:
      if (s15.ctrlKey && !s15.shiftKey && !s15.altKey && !s15.metaKey) s15.keyCode >= 65 && s15.keyCode <= 90 ? r.key = String.fromCharCode(s15.keyCode - 64) : s15.keyCode === 32 ? r.key = b.NUL : s15.keyCode >= 51 && s15.keyCode <= 55 ? r.key = String.fromCharCode(s15.keyCode - 51 + 27) : s15.keyCode === 56 ? r.key = b.DEL : s15.keyCode === 219 ? r.key = b.ESC : s15.keyCode === 220 ? r.key = b.FS : s15.keyCode === 221 && (r.key = b.GS);
      else if ((!e || i) && s15.altKey && !s15.metaKey) {
        let l = gc[s15.keyCode]?.[s15.shiftKey ? 1 : 0];
        if (l) r.key = b.ESC + l;
        else if (s15.keyCode >= 65 && s15.keyCode <= 90) {
          let a = s15.ctrlKey ? s15.keyCode - 64 : s15.keyCode + 32, u = String.fromCharCode(a);
          s15.shiftKey && (u = u.toUpperCase()), r.key = b.ESC + u;
        } else if (s15.keyCode === 32) r.key = b.ESC + (s15.ctrlKey ? b.NUL : " ");
        else if (s15.key === "Dead" && s15.code.startsWith("Key")) {
          let a = s15.code.slice(3, 4);
          s15.shiftKey || (a = a.toLowerCase()), r.key = b.ESC + a, r.cancel = true;
        }
      } else e && !s15.altKey && !s15.ctrlKey && !s15.shiftKey && s15.metaKey ? s15.keyCode === 65 && (r.type = 1) : s15.key && !s15.ctrlKey && !s15.altKey && !s15.metaKey && s15.keyCode >= 48 && s15.key.length === 1 ? r.key = s15.key : s15.key && s15.ctrlKey && (s15.key === "_" && (r.key = b.US), s15.key === "@" && (r.key = b.NUL));
      break;
  }
  return r;
}
function Ec(s15, t) {
  return s15.text === t.text && s15.range.start.x === t.range.start.x && s15.range.start.y === t.range.start.y && s15.range.end.x === t.range.end.x && s15.range.end.y === t.range.end.y;
}
function Tc(s15) {
  return s15.keyCode === 16 || s15.keyCode === 17 || s15.keyCode === 18;
}
var zs, Rl, Ll, M, S, Gs, mi, $s, _i, er, tr, ir, we, De, rt, q, js, Hn, Fn, F, rr, ge, Zs, xt, nr, H, sr, Js, Be, wt, nt, ae, Dt, ce, Qs, or, Re, lr, Wn, Bl, Un, bi, ar, Rt, cr, to, ro, so, At, io, lo, ao, oo, ur, zn, Wl, dt, hr, uo, dr, Ee, D, ye, fe, kt, G, Ct, zl, mr, Gl, fo, $l, $, Mt, $n, po, br, Vn, gi, qn, Yn, Vl, Pt, ql, Yl, _r, v, jn, gr, Si, Eu, Tu, Ot, Ei, Bt, Ti, Sr, Iu, yu, vr, Nt, yr, xr, Ii, Zl, vo, go, Jl, Ql, ea, ta, Tr, Ir, bo, ia, $e, Ve, xe, So, ra, Xn, wr, Te, Zn, Dr, na, xu, Fe, st, sa, oa, Eo, la, wu, Du, Ru, Lu, ot, aa, yi, Jn, To, Io, yo, Qn, Rr, es, ua, ha, da, fa, ft, wo, Lr, qe, xi, Do, ma, ts, _a, Ye, kr, ba, Ar, va, _e, Ro, Cr, Co, Bh, be, Nh, Fh, Hh, Oo, Wh, Uh, No, Kh, zh, ss, os, wa, mt, Mr, Di, pt, Bo, Gh, Y, Da, ls, Wt, He, Q, Pr, lt, Uo, Or, cs, Ri, Br, Nr, Fr, Ca, Ut, Kt, Wr, Ur, Ma, Ko, zo, us, zr, hs, ds, Kr, zt, Gt, Gr, We, at, Li, bt, b, Ai, fs, $t, ue, he, de, J, ps, j, U, z, ve, $r, Vr, ct, Vt, Yr, ms, _s, Le, jr, jo, ki, Xr, Na, Yt, jt, Zr, bs, vs, Jr, gs, Qr, Xt, en, tn, Mi, Pi, Oi, Ss, Fa, Zo, Zt, Wa, Ua, Es, Bi, Ts, rn, Is, ys, Jt, nn, Qt, xs, on, Ds, Ya, ja, Xa, Za, Ja, ei, Hi, Wi, re, St, Ki, tl, il, Ui, Qa, ti, Rs, ln, ec, tc, ii, ic, zi, B, X, an, Ls, Ze, un, cn, ne, Je, cl, $i, hn, ks, Cs, ni, si, nc, dn, ul, hl, li, dl, Ps, fl, ai, Os, ac, se, fn, Ae, pn, Vi, uc, ci, qi, mn, pe, Yi, _n, ji, Xi, Fs, ke, hc, bn, dc, fc, mc, ut, _l, vl, gl, vn, Zi, _c, El, bc, gn, ui, Tl, Sn, gc, ee, En, Us, yl, Tn, Ks, Sc, In, xl, wl, Tt, hi, yn, xn, wn, Ji, Dn, Rn, Ln, Ic, Ue, Dl;
var init_xterm = __esm({
  "node_modules/@xterm/xterm/lib/xterm.mjs"() {
    zs = Object.defineProperty;
    Rl = Object.getOwnPropertyDescriptor;
    Ll = (s15, t) => {
      for (var e in t) zs(s15, e, { get: t[e], enumerable: true });
    };
    M = (s15, t, e, i) => {
      for (var r = i > 1 ? void 0 : i ? Rl(t, e) : t, n = s15.length - 1, o; n >= 0; n--) (o = s15[n]) && (r = (i ? o(t, e, r) : o(r)) || r);
      return i && r && zs(t, e, r), r;
    }, S = (s15, t) => (e, i) => t(e, i, s15);
    Gs = "Terminal input", mi = { get: () => Gs, set: (s15) => Gs = s15 }, $s = "Too much output to announce, navigate to rows manually to read", _i = { get: () => $s, set: (s15) => $s = s15 };
    er = class {
      constructor() {
        this._interim = 0;
      }
      clear() {
        this._interim = 0;
      }
      decode(t, e) {
        let i = t.length;
        if (!i) return 0;
        let r = 0, n = 0;
        if (this._interim) {
          let o = t.charCodeAt(n++);
          56320 <= o && o <= 57343 ? e[r++] = (this._interim - 55296) * 1024 + o - 56320 + 65536 : (e[r++] = this._interim, e[r++] = o), this._interim = 0;
        }
        for (let o = n; o < i; ++o) {
          let l = t.charCodeAt(o);
          if (55296 <= l && l <= 56319) {
            if (++o >= i) return this._interim = l, r;
            let a = t.charCodeAt(o);
            56320 <= a && a <= 57343 ? e[r++] = (l - 55296) * 1024 + a - 56320 + 65536 : (e[r++] = l, e[r++] = a);
            continue;
          }
          l !== 65279 && (e[r++] = l);
        }
        return r;
      }
    }, tr = class {
      constructor() {
        this.interim = new Uint8Array(3);
      }
      clear() {
        this.interim.fill(0);
      }
      decode(t, e) {
        let i = t.length;
        if (!i) return 0;
        let r = 0, n, o, l, a, u = 0, h8 = 0;
        if (this.interim[0]) {
          let _ = false, p = this.interim[0];
          p &= (p & 224) === 192 ? 31 : (p & 240) === 224 ? 15 : 7;
          let m = 0, f;
          for (; (f = this.interim[++m] & 63) && m < 4; ) p <<= 6, p |= f;
          let A = (this.interim[0] & 224) === 192 ? 2 : (this.interim[0] & 240) === 224 ? 3 : 4, R = A - m;
          for (; h8 < R; ) {
            if (h8 >= i) return 0;
            if (f = t[h8++], (f & 192) !== 128) {
              h8--, _ = true;
              break;
            } else this.interim[m++] = f, p <<= 6, p |= f & 63;
          }
          _ || (A === 2 ? p < 128 ? h8-- : e[r++] = p : A === 3 ? p < 2048 || p >= 55296 && p <= 57343 || p === 65279 || (e[r++] = p) : p < 65536 || p > 1114111 || (e[r++] = p)), this.interim.fill(0);
        }
        let c = i - 4, d = h8;
        for (; d < i; ) {
          for (; d < c && !((n = t[d]) & 128) && !((o = t[d + 1]) & 128) && !((l = t[d + 2]) & 128) && !((a = t[d + 3]) & 128); ) e[r++] = n, e[r++] = o, e[r++] = l, e[r++] = a, d += 4;
          if (n = t[d++], n < 128) e[r++] = n;
          else if ((n & 224) === 192) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 31) << 6 | o & 63, u < 128) {
              d--;
              continue;
            }
            e[r++] = u;
          } else if ((n & 240) === 224) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, r;
            if (l = t[d++], (l & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 15) << 12 | (o & 63) << 6 | l & 63, u < 2048 || u >= 55296 && u <= 57343 || u === 65279) continue;
            e[r++] = u;
          } else if ((n & 248) === 240) {
            if (d >= i) return this.interim[0] = n, r;
            if (o = t[d++], (o & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, r;
            if (l = t[d++], (l & 192) !== 128) {
              d--;
              continue;
            }
            if (d >= i) return this.interim[0] = n, this.interim[1] = o, this.interim[2] = l, r;
            if (a = t[d++], (a & 192) !== 128) {
              d--;
              continue;
            }
            if (u = (n & 7) << 18 | (o & 63) << 12 | (l & 63) << 6 | a & 63, u < 65536 || u > 1114111) continue;
            e[r++] = u;
          }
        }
        return r;
      }
    };
    ir = "";
    we = " ";
    De = class s {
      constructor() {
        this.fg = 0;
        this.bg = 0;
        this.extended = new rt();
      }
      static toColorRGB(t) {
        return [t >>> 16 & 255, t >>> 8 & 255, t & 255];
      }
      static fromColorRGB(t) {
        return (t[0] & 255) << 16 | (t[1] & 255) << 8 | t[2] & 255;
      }
      clone() {
        let t = new s();
        return t.fg = this.fg, t.bg = this.bg, t.extended = this.extended.clone(), t;
      }
      isInverse() {
        return this.fg & 67108864;
      }
      isBold() {
        return this.fg & 134217728;
      }
      isUnderline() {
        return this.hasExtendedAttrs() && this.extended.underlineStyle !== 0 ? 1 : this.fg & 268435456;
      }
      isBlink() {
        return this.fg & 536870912;
      }
      isInvisible() {
        return this.fg & 1073741824;
      }
      isItalic() {
        return this.bg & 67108864;
      }
      isDim() {
        return this.bg & 134217728;
      }
      isStrikethrough() {
        return this.fg & 2147483648;
      }
      isProtected() {
        return this.bg & 536870912;
      }
      isOverline() {
        return this.bg & 1073741824;
      }
      getFgColorMode() {
        return this.fg & 50331648;
      }
      getBgColorMode() {
        return this.bg & 50331648;
      }
      isFgRGB() {
        return (this.fg & 50331648) === 50331648;
      }
      isBgRGB() {
        return (this.bg & 50331648) === 50331648;
      }
      isFgPalette() {
        return (this.fg & 50331648) === 16777216 || (this.fg & 50331648) === 33554432;
      }
      isBgPalette() {
        return (this.bg & 50331648) === 16777216 || (this.bg & 50331648) === 33554432;
      }
      isFgDefault() {
        return (this.fg & 50331648) === 0;
      }
      isBgDefault() {
        return (this.bg & 50331648) === 0;
      }
      isAttributeDefault() {
        return this.fg === 0 && this.bg === 0;
      }
      getFgColor() {
        switch (this.fg & 50331648) {
          case 16777216:
          case 33554432:
            return this.fg & 255;
          case 50331648:
            return this.fg & 16777215;
          default:
            return -1;
        }
      }
      getBgColor() {
        switch (this.bg & 50331648) {
          case 16777216:
          case 33554432:
            return this.bg & 255;
          case 50331648:
            return this.bg & 16777215;
          default:
            return -1;
        }
      }
      hasExtendedAttrs() {
        return this.bg & 268435456;
      }
      updateExtended() {
        this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
      }
      getUnderlineColor() {
        if (this.bg & 268435456 && ~this.extended.underlineColor) switch (this.extended.underlineColor & 50331648) {
          case 16777216:
          case 33554432:
            return this.extended.underlineColor & 255;
          case 50331648:
            return this.extended.underlineColor & 16777215;
          default:
            return this.getFgColor();
        }
        return this.getFgColor();
      }
      getUnderlineColorMode() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? this.extended.underlineColor & 50331648 : this.getFgColorMode();
      }
      isUnderlineColorRGB() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 50331648 : this.isFgRGB();
      }
      isUnderlineColorPalette() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 16777216 || (this.extended.underlineColor & 50331648) === 33554432 : this.isFgPalette();
      }
      isUnderlineColorDefault() {
        return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 0 : this.isFgDefault();
      }
      getUnderlineStyle() {
        return this.fg & 268435456 ? this.bg & 268435456 ? this.extended.underlineStyle : 1 : 0;
      }
      getUnderlineVariantOffset() {
        return this.extended.underlineVariantOffset;
      }
    }, rt = class s2 {
      constructor(t = 0, e = 0) {
        this._ext = 0;
        this._urlId = 0;
        this._ext = t, this._urlId = e;
      }
      get ext() {
        return this._urlId ? this._ext & -469762049 | this.underlineStyle << 26 : this._ext;
      }
      set ext(t) {
        this._ext = t;
      }
      get underlineStyle() {
        return this._urlId ? 5 : (this._ext & 469762048) >> 26;
      }
      set underlineStyle(t) {
        this._ext &= -469762049, this._ext |= t << 26 & 469762048;
      }
      get underlineColor() {
        return this._ext & 67108863;
      }
      set underlineColor(t) {
        this._ext &= -67108864, this._ext |= t & 67108863;
      }
      get urlId() {
        return this._urlId;
      }
      set urlId(t) {
        this._urlId = t;
      }
      get underlineVariantOffset() {
        let t = (this._ext & 3758096384) >> 29;
        return t < 0 ? t ^ 4294967288 : t;
      }
      set underlineVariantOffset(t) {
        this._ext &= 536870911, this._ext |= t << 29 & 3758096384;
      }
      clone() {
        return new s2(this._ext, this._urlId);
      }
      isEmpty() {
        return this.underlineStyle === 0 && this._urlId === 0;
      }
    };
    q = class s3 extends De {
      constructor() {
        super(...arguments);
        this.content = 0;
        this.fg = 0;
        this.bg = 0;
        this.extended = new rt();
        this.combinedData = "";
      }
      static fromCharData(e) {
        let i = new s3();
        return i.setFromCharData(e), i;
      }
      isCombined() {
        return this.content & 2097152;
      }
      getWidth() {
        return this.content >> 22;
      }
      getChars() {
        return this.content & 2097152 ? this.combinedData : this.content & 2097151 ? Ce(this.content & 2097151) : "";
      }
      getCode() {
        return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : this.content & 2097151;
      }
      setFromCharData(e) {
        this.fg = e[0], this.bg = 0;
        let i = false;
        if (e[1].length > 2) i = true;
        else if (e[1].length === 2) {
          let r = e[1].charCodeAt(0);
          if (55296 <= r && r <= 56319) {
            let n = e[1].charCodeAt(1);
            56320 <= n && n <= 57343 ? this.content = (r - 55296) * 1024 + n - 56320 + 65536 | e[2] << 22 : i = true;
          } else i = true;
        } else this.content = e[1].charCodeAt(0) | e[2] << 22;
        i && (this.combinedData = e[1], this.content = 2097152 | e[2] << 22);
      }
      getAsCharData() {
        return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
      }
    };
    js = "di$target", Hn = "di$dependencies", Fn = /* @__PURE__ */ new Map();
    F = ie("BufferService"), rr = ie("CoreMouseService"), ge = ie("CoreService"), Zs = ie("CharsetService"), xt = ie("InstantiationService");
    nr = ie("LogService"), H = ie("OptionsService"), sr = ie("OscLinkService"), Js = ie("UnicodeService"), Be = ie("DecorationService");
    wt = class {
      constructor(t, e, i) {
        this._bufferService = t;
        this._optionsService = e;
        this._oscLinkService = i;
      }
      provideLinks(t, e) {
        let i = this._bufferService.buffer.lines.get(t - 1);
        if (!i) {
          e(void 0);
          return;
        }
        let r = [], n = this._optionsService.rawOptions.linkHandler, o = new q(), l = i.getTrimmedLength(), a = -1, u = -1, h8 = false;
        for (let c = 0; c < l; c++) if (!(u === -1 && !i.hasContent(c))) {
          if (i.loadCell(c, o), o.hasExtendedAttrs() && o.extended.urlId) if (u === -1) {
            u = c, a = o.extended.urlId;
            continue;
          } else h8 = o.extended.urlId !== a;
          else u !== -1 && (h8 = true);
          if (h8 || u !== -1 && c === l - 1) {
            let d = this._oscLinkService.getLinkData(a)?.uri;
            if (d) {
              let _ = { start: { x: u + 1, y: t }, end: { x: c + (!h8 && c === l - 1 ? 1 : 0), y: t } }, p = false;
              if (!n?.allowNonHttpProtocols) try {
                let m = new URL(d);
                ["http:", "https:"].includes(m.protocol) || (p = true);
              } catch {
                p = true;
              }
              p || r.push({ text: d, range: _, activate: (m, f) => n ? n.activate(m, f, _) : Ol(m, f), hover: (m, f) => n?.hover?.(m, f, _), leave: (m, f) => n?.leave?.(m, f, _) });
            }
            h8 = false, o.hasExtendedAttrs() && o.extended.urlId ? (u = c, a = o.extended.urlId) : (u = -1, a = -1);
          }
        }
        e(r);
      }
    };
    wt = M([S(0, F), S(1, H), S(2, sr)], wt);
    nt = ie("CharSizeService"), ae = ie("CoreBrowserService"), Dt = ie("MouseService"), ce = ie("RenderService"), Qs = ie("SelectionService"), or = ie("CharacterJoinerService"), Re = ie("ThemeService"), lr = ie("LinkProviderService");
    Wn = class {
      constructor() {
        this.listeners = [], this.unexpectedErrorHandler = function(t) {
          setTimeout(() => {
            throw t.stack ? ar.isErrorNoTelemetry(t) ? new ar(t.message + `

` + t.stack) : new Error(t.message + `

` + t.stack) : t;
          }, 0);
        };
      }
      addListener(t) {
        return this.listeners.push(t), () => {
          this._removeListener(t);
        };
      }
      emit(t) {
        this.listeners.forEach((e) => {
          e(t);
        });
      }
      _removeListener(t) {
        this.listeners.splice(this.listeners.indexOf(t), 1);
      }
      setUnexpectedErrorHandler(t) {
        this.unexpectedErrorHandler = t;
      }
      getUnexpectedErrorHandler() {
        return this.unexpectedErrorHandler;
      }
      onUnexpectedError(t) {
        this.unexpectedErrorHandler(t), this.emit(t);
      }
      onUnexpectedExternalError(t) {
        this.unexpectedErrorHandler(t);
      }
    }, Bl = new Wn();
    Un = "Canceled";
    bi = class extends Error {
      constructor() {
        super(Un), this.name = this.message;
      }
    };
    ar = class s4 extends Error {
      constructor(t) {
        super(t), this.name = "CodeExpectedError";
      }
      static fromError(t) {
        if (t instanceof s4) return t;
        let e = new s4();
        return e.message = t.message, e.stack = t.stack, e;
      }
      static isErrorNoTelemetry(t) {
        return t.name === "CodeExpectedError";
      }
    }, Rt = class s5 extends Error {
      constructor(t) {
        super(t || "An unexpected bug occurred."), Object.setPrototypeOf(this, s5.prototype);
      }
    };
    cr = class cr2 {
      constructor(t) {
        this._array = t;
        this._findLastMonotonousLastIdx = 0;
      }
      findLastMonotonous(t) {
        if (cr2.assertInvariants) {
          if (this._prevFindLastPredicate) {
            for (let i of this._array) if (this._prevFindLastPredicate(i) && !t(i)) throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.");
          }
          this._prevFindLastPredicate = t;
        }
        let e = Fl(this._array, t, this._findLastMonotonousLastIdx);
        return this._findLastMonotonousLastIdx = e + 1, e === -1 ? void 0 : this._array[e];
      }
    };
    cr.assertInvariants = false;
    to = cr;
    ((l) => {
      function s15(a) {
        return a < 0;
      }
      l.isLessThan = s15;
      function t(a) {
        return a <= 0;
      }
      l.isLessThanOrEqual = t;
      function e(a) {
        return a > 0;
      }
      l.isGreaterThan = e;
      function i(a) {
        return a === 0;
      }
      l.isNeitherLessOrGreaterThan = i, l.greaterThan = 1, l.lessThan = -1, l.neitherLessOrGreaterThan = 0;
    })(ro ||= {});
    so = (s15, t) => s15 - t;
    At = class At2 {
      constructor(t) {
        this.iterate = t;
      }
      forEach(t) {
        this.iterate((e) => (t(e), true));
      }
      toArray() {
        let t = [];
        return this.iterate((e) => (t.push(e), true)), t;
      }
      filter(t) {
        return new At2((e) => this.iterate((i) => t(i) ? e(i) : true));
      }
      map(t) {
        return new At2((e) => this.iterate((i) => e(t(i))));
      }
      some(t) {
        let e = false;
        return this.iterate((i) => (e = t(i), !e)), e;
      }
      findFirst(t) {
        let e;
        return this.iterate((i) => t(i) ? (e = i, false) : true), e;
      }
      findLast(t) {
        let e;
        return this.iterate((i) => (t(i) && (e = i), true)), e;
      }
      findLastMaxBy(t) {
        let e, i = true;
        return this.iterate((r) => ((i || ro.isGreaterThan(t(r, e))) && (i = false, e = r), true)), e;
      }
    };
    At.empty = new At((t) => {
    });
    io = At;
    oo = class {
      constructor(t, e) {
        this.toKey = e;
        this._map = /* @__PURE__ */ new Map();
        this[lo] = "SetWithKey";
        for (let i of t) this.add(i);
      }
      get size() {
        return this._map.size;
      }
      add(t) {
        let e = this.toKey(t);
        return this._map.set(e, t), this;
      }
      delete(t) {
        return this._map.delete(this.toKey(t));
      }
      has(t) {
        return this._map.has(this.toKey(t));
      }
      *entries() {
        for (let t of this._map.values()) yield [t, t];
      }
      keys() {
        return this.values();
      }
      *values() {
        for (let t of this._map.values()) yield t;
      }
      clear() {
        this._map.clear();
      }
      forEach(t, e) {
        this._map.forEach((i) => t.call(e, i, i, this));
      }
      [(ao = Symbol.iterator, lo = Symbol.toStringTag, ao)]() {
        return this.values();
      }
    };
    ur = class {
      constructor() {
        this.map = /* @__PURE__ */ new Map();
      }
      add(t, e) {
        let i = this.map.get(t);
        i || (i = /* @__PURE__ */ new Set(), this.map.set(t, i)), i.add(e);
      }
      delete(t, e) {
        let i = this.map.get(t);
        i && (i.delete(e), i.size === 0 && this.map.delete(t));
      }
      forEach(t, e) {
        let i = this.map.get(t);
        i && i.forEach(e);
      }
      get(t) {
        let e = this.map.get(t);
        return e || /* @__PURE__ */ new Set();
      }
    };
    ((O) => {
      function s15(I) {
        return I && typeof I == "object" && typeof I[Symbol.iterator] == "function";
      }
      O.is = s15;
      let t = Object.freeze([]);
      function e() {
        return t;
      }
      O.empty = e;
      function* i(I) {
        yield I;
      }
      O.single = i;
      function r(I) {
        return s15(I) ? I : i(I);
      }
      O.wrap = r;
      function n(I) {
        return I || t;
      }
      O.from = n;
      function* o(I) {
        for (let k = I.length - 1; k >= 0; k--) yield I[k];
      }
      O.reverse = o;
      function l(I) {
        return !I || I[Symbol.iterator]().next().done === true;
      }
      O.isEmpty = l;
      function a(I) {
        return I[Symbol.iterator]().next().value;
      }
      O.first = a;
      function u(I, k) {
        let P = 0;
        for (let oe of I) if (k(oe, P++)) return true;
        return false;
      }
      O.some = u;
      function h8(I, k) {
        for (let P of I) if (k(P)) return P;
      }
      O.find = h8;
      function* c(I, k) {
        for (let P of I) k(P) && (yield P);
      }
      O.filter = c;
      function* d(I, k) {
        let P = 0;
        for (let oe of I) yield k(oe, P++);
      }
      O.map = d;
      function* _(I, k) {
        let P = 0;
        for (let oe of I) yield* k(oe, P++);
      }
      O.flatMap = _;
      function* p(...I) {
        for (let k of I) yield* k;
      }
      O.concat = p;
      function m(I, k, P) {
        let oe = P;
        for (let Me of I) oe = k(oe, Me);
        return oe;
      }
      O.reduce = m;
      function* f(I, k, P = I.length) {
        for (k < 0 && (k += I.length), P < 0 ? P += I.length : P > I.length && (P = I.length); k < P; k++) yield I[k];
      }
      O.slice = f;
      function A(I, k = Number.POSITIVE_INFINITY) {
        let P = [];
        if (k === 0) return [P, I];
        let oe = I[Symbol.iterator]();
        for (let Me = 0; Me < k; Me++) {
          let Pe = oe.next();
          if (Pe.done) return [P, O.empty()];
          P.push(Pe.value);
        }
        return [P, { [Symbol.iterator]() {
          return oe;
        } }];
      }
      O.consume = A;
      async function R(I) {
        let k = [];
        for await (let P of I) k.push(P);
        return Promise.resolve(k);
      }
      O.asyncToArray = R;
    })(zn ||= {});
    Wl = false, dt = null, hr = class hr2 {
      constructor() {
        this.livingDisposables = /* @__PURE__ */ new Map();
      }
      getDisposableData(t) {
        let e = this.livingDisposables.get(t);
        return e || (e = { parent: null, source: null, isSingleton: false, value: t, idx: hr2.idx++ }, this.livingDisposables.set(t, e)), e;
      }
      trackDisposable(t) {
        let e = this.getDisposableData(t);
        e.source || (e.source = new Error().stack);
      }
      setParent(t, e) {
        let i = this.getDisposableData(t);
        i.parent = e;
      }
      markAsDisposed(t) {
        this.livingDisposables.delete(t);
      }
      markAsSingleton(t) {
        this.getDisposableData(t).isSingleton = true;
      }
      getRootParent(t, e) {
        let i = e.get(t);
        if (i) return i;
        let r = t.parent ? this.getRootParent(this.getDisposableData(t.parent), e) : t;
        return e.set(t, r), r;
      }
      getTrackedDisposables() {
        let t = /* @__PURE__ */ new Map();
        return [...this.livingDisposables.entries()].filter(([, i]) => i.source !== null && !this.getRootParent(i, t).isSingleton).flatMap(([i]) => i);
      }
      computeLeakingDisposables(t = 10, e) {
        let i;
        if (e) i = e;
        else {
          let a = /* @__PURE__ */ new Map(), u = [...this.livingDisposables.values()].filter((c) => c.source !== null && !this.getRootParent(c, a).isSingleton);
          if (u.length === 0) return;
          let h8 = new Set(u.map((c) => c.value));
          if (i = u.filter((c) => !(c.parent && h8.has(c.parent))), i.length === 0) throw new Error("There are cyclic diposable chains!");
        }
        if (!i) return;
        function r(a) {
          function u(c, d) {
            for (; c.length > 0 && d.some((_) => typeof _ == "string" ? _ === c[0] : c[0].match(_)); ) c.shift();
          }
          let h8 = a.source.split(`
`).map((c) => c.trim().replace("at ", "")).filter((c) => c !== "");
          return u(h8, ["Error", /^trackDisposable \(.*\)$/, /^DisposableTracker.trackDisposable \(.*\)$/]), h8.reverse();
        }
        let n = new ur();
        for (let a of i) {
          let u = r(a);
          for (let h8 = 0; h8 <= u.length; h8++) n.add(u.slice(0, h8).join(`
`), a);
        }
        i.sort(no((a) => a.idx, so));
        let o = "", l = 0;
        for (let a of i.slice(0, t)) {
          l++;
          let u = r(a), h8 = [];
          for (let c = 0; c < u.length; c++) {
            let d = u[c];
            d = `(shared with ${n.get(u.slice(0, c + 1).join(`
`)).size}/${i.length} leaks) at ${d}`;
            let p = n.get(u.slice(0, c).join(`
`)), m = co([...p].map((f) => r(f)[c]), (f) => f);
            delete m[u[c]];
            for (let [f, A] of Object.entries(m)) h8.unshift(`    - stacktraces of ${A.length} other leaks continue with ${f}`);
            h8.unshift(d);
          }
          o += `


==================== Leaking disposable ${l}/${i.length}: ${a.value.constructor.name} ====================
${h8.join(`
`)}
============================================================

`;
        }
        return i.length > t && (o += `


... and ${i.length - t} more leaking disposables

`), { leaks: i, details: o };
      }
    };
    hr.idx = 0;
    uo = hr;
    if (Wl) {
      let s15 = "__is_disposable_tracked__";
      Ul(new class {
        trackDisposable(t) {
          let e = new Error("Potentially leaked disposable").stack;
          setTimeout(() => {
            t[s15] || console.log(e);
          }, 3e3);
        }
        setParent(t, e) {
          if (t && t !== D.None) try {
            t[s15] = true;
          } catch {
          }
        }
        markAsDisposed(t) {
          if (t && t !== D.None) try {
            t[s15] = true;
          } catch {
          }
        }
        markAsSingleton(t) {
        }
      }());
    }
    dr = class dr2 {
      constructor() {
        this._toDispose = /* @__PURE__ */ new Set();
        this._isDisposed = false;
        fr(this);
      }
      dispose() {
        this._isDisposed || (pr(this), this._isDisposed = true, this.clear());
      }
      get isDisposed() {
        return this._isDisposed;
      }
      clear() {
        if (this._toDispose.size !== 0) try {
          Ne(this._toDispose);
        } finally {
          this._toDispose.clear();
        }
      }
      add(t) {
        if (!t) return t;
        if (t === this) throw new Error("Cannot register a disposable on itself!");
        return vi(t, this), this._isDisposed ? dr2.DISABLE_DISPOSED_WARNING || console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack) : this._toDispose.add(t), t;
      }
      delete(t) {
        if (t) {
          if (t === this) throw new Error("Cannot dispose a disposable on itself!");
          this._toDispose.delete(t), t.dispose();
        }
      }
      deleteAndLeak(t) {
        t && this._toDispose.has(t) && (this._toDispose.delete(t), vi(t, null));
      }
    };
    dr.DISABLE_DISPOSED_WARNING = false;
    Ee = dr, D = class {
      constructor() {
        this._store = new Ee();
        fr(this), vi(this._store, this);
      }
      dispose() {
        pr(this), this._store.dispose();
      }
      _register(t) {
        if (t === this) throw new Error("Cannot register a disposable on itself!");
        return this._store.add(t);
      }
    };
    D.None = Object.freeze({ dispose() {
    } });
    ye = class {
      constructor() {
        this._isDisposed = false;
        fr(this);
      }
      get value() {
        return this._isDisposed ? void 0 : this._value;
      }
      set value(t) {
        this._isDisposed || t === this._value || (this._value?.dispose(), t && vi(t, this), this._value = t);
      }
      clear() {
        this.value = void 0;
      }
      dispose() {
        this._isDisposed = true, pr(this), this._value?.dispose(), this._value = void 0;
      }
      clearAndLeak() {
        let t = this._value;
        return this._value = void 0, t && vi(t, null), t;
      }
    };
    fe = typeof window == "object" ? window : globalThis;
    kt = class kt2 {
      constructor(t) {
        this.element = t, this.next = kt2.Undefined, this.prev = kt2.Undefined;
      }
    };
    kt.Undefined = new kt(void 0);
    G = kt, Ct = class {
      constructor() {
        this._first = G.Undefined;
        this._last = G.Undefined;
        this._size = 0;
      }
      get size() {
        return this._size;
      }
      isEmpty() {
        return this._first === G.Undefined;
      }
      clear() {
        let t = this._first;
        for (; t !== G.Undefined; ) {
          let e = t.next;
          t.prev = G.Undefined, t.next = G.Undefined, t = e;
        }
        this._first = G.Undefined, this._last = G.Undefined, this._size = 0;
      }
      unshift(t) {
        return this._insert(t, false);
      }
      push(t) {
        return this._insert(t, true);
      }
      _insert(t, e) {
        let i = new G(t);
        if (this._first === G.Undefined) this._first = i, this._last = i;
        else if (e) {
          let n = this._last;
          this._last = i, i.prev = n, n.next = i;
        } else {
          let n = this._first;
          this._first = i, i.next = n, n.prev = i;
        }
        this._size += 1;
        let r = false;
        return () => {
          r || (r = true, this._remove(i));
        };
      }
      shift() {
        if (this._first !== G.Undefined) {
          let t = this._first.element;
          return this._remove(this._first), t;
        }
      }
      pop() {
        if (this._last !== G.Undefined) {
          let t = this._last.element;
          return this._remove(this._last), t;
        }
      }
      _remove(t) {
        if (t.prev !== G.Undefined && t.next !== G.Undefined) {
          let e = t.prev;
          e.next = t.next, t.next.prev = e;
        } else t.prev === G.Undefined && t.next === G.Undefined ? (this._first = G.Undefined, this._last = G.Undefined) : t.next === G.Undefined ? (this._last = this._last.prev, this._last.next = G.Undefined) : t.prev === G.Undefined && (this._first = this._first.next, this._first.prev = G.Undefined);
        this._size -= 1;
      }
      *[Symbol.iterator]() {
        let t = this._first;
        for (; t !== G.Undefined; ) yield t.element, t = t.next;
      }
    };
    zl = globalThis.performance && typeof globalThis.performance.now == "function", mr = class s6 {
      static create(t) {
        return new s6(t);
      }
      constructor(t) {
        this._now = zl && t === false ? Date.now : globalThis.performance.now.bind(globalThis.performance), this._startTime = this._now(), this._stopTime = -1;
      }
      stop() {
        this._stopTime = this._now();
      }
      reset() {
        this._startTime = this._now(), this._stopTime = -1;
      }
      elapsed() {
        return this._stopTime !== -1 ? this._stopTime - this._startTime : this._now() - this._startTime;
      }
    };
    Gl = false, fo = false, $l = false;
    ((Qe) => {
      Qe.None = () => D.None;
      function t(y) {
        if ($l) {
          let { onDidAddListener: T } = y, g = gi.create(), w = 0;
          y.onDidAddListener = () => {
            ++w === 2 && (console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"), g.print()), T?.();
          };
        }
      }
      function e(y, T) {
        return d(y, () => {
        }, 0, void 0, true, void 0, T);
      }
      Qe.defer = e;
      function i(y) {
        return (T, g = null, w) => {
          let E = false, x;
          return x = y((N) => {
            if (!E) return x ? x.dispose() : E = true, T.call(g, N);
          }, null, w), E && x.dispose(), x;
        };
      }
      Qe.once = i;
      function r(y, T, g) {
        return h8((w, E = null, x) => y((N) => w.call(E, T(N)), null, x), g);
      }
      Qe.map = r;
      function n(y, T, g) {
        return h8((w, E = null, x) => y((N) => {
          T(N), w.call(E, N);
        }, null, x), g);
      }
      Qe.forEach = n;
      function o(y, T, g) {
        return h8((w, E = null, x) => y((N) => T(N) && w.call(E, N), null, x), g);
      }
      Qe.filter = o;
      function l(y) {
        return y;
      }
      Qe.signal = l;
      function a(...y) {
        return (T, g = null, w) => {
          let E = ho(...y.map((x) => x((N) => T.call(g, N))));
          return c(E, w);
        };
      }
      Qe.any = a;
      function u(y, T, g, w) {
        let E = g;
        return r(y, (x) => (E = T(E, x), E), w);
      }
      Qe.reduce = u;
      function h8(y, T) {
        let g, w = { onWillAddFirstListener() {
          g = y(E.fire, E);
        }, onDidRemoveLastListener() {
          g?.dispose();
        } };
        T || t(w);
        let E = new v(w);
        return T?.add(E), E.event;
      }
      function c(y, T) {
        return T instanceof Array ? T.push(y) : T && T.add(y), y;
      }
      function d(y, T, g = 100, w = false, E = false, x, N) {
        let Z, te, Oe, ze = 0, le, et = { leakWarningThreshold: x, onWillAddFirstListener() {
          Z = y((ht) => {
            ze++, te = T(te, ht), w && !Oe && (me.fire(te), te = void 0), le = () => {
              let fi = te;
              te = void 0, Oe = void 0, (!w || ze > 1) && me.fire(fi), ze = 0;
            }, typeof g == "number" ? (clearTimeout(Oe), Oe = setTimeout(le, g)) : Oe === void 0 && (Oe = 0, queueMicrotask(le));
          });
        }, onWillRemoveListener() {
          E && ze > 0 && le?.();
        }, onDidRemoveLastListener() {
          le = void 0, Z.dispose();
        } };
        N || t(et);
        let me = new v(et);
        return N?.add(me), me.event;
      }
      Qe.debounce = d;
      function _(y, T = 0, g) {
        return Qe.debounce(y, (w, E) => w ? (w.push(E), w) : [E], T, void 0, true, void 0, g);
      }
      Qe.accumulate = _;
      function p(y, T = (w, E) => w === E, g) {
        let w = true, E;
        return o(y, (x) => {
          let N = w || !T(x, E);
          return w = false, E = x, N;
        }, g);
      }
      Qe.latch = p;
      function m(y, T, g) {
        return [Qe.filter(y, T, g), Qe.filter(y, (w) => !T(w), g)];
      }
      Qe.split = m;
      function f(y, T = false, g = [], w) {
        let E = g.slice(), x = y((te) => {
          E ? E.push(te) : Z.fire(te);
        });
        w && w.add(x);
        let N = () => {
          E?.forEach((te) => Z.fire(te)), E = null;
        }, Z = new v({ onWillAddFirstListener() {
          x || (x = y((te) => Z.fire(te)), w && w.add(x));
        }, onDidAddFirstListener() {
          E && (T ? setTimeout(N) : N());
        }, onDidRemoveLastListener() {
          x && x.dispose(), x = null;
        } });
        return w && w.add(Z), Z.event;
      }
      Qe.buffer = f;
      function A(y, T) {
        return (w, E, x) => {
          let N = T(new O());
          return y(function(Z) {
            let te = N.evaluate(Z);
            te !== R && w.call(E, te);
          }, void 0, x);
        };
      }
      Qe.chain = A;
      let R = /* @__PURE__ */ Symbol("HaltChainable");
      class O {
        constructor() {
          this.steps = [];
        }
        map(T) {
          return this.steps.push(T), this;
        }
        forEach(T) {
          return this.steps.push((g) => (T(g), g)), this;
        }
        filter(T) {
          return this.steps.push((g) => T(g) ? g : R), this;
        }
        reduce(T, g) {
          let w = g;
          return this.steps.push((E) => (w = T(w, E), w)), this;
        }
        latch(T = (g, w) => g === w) {
          let g = true, w;
          return this.steps.push((E) => {
            let x = g || !T(E, w);
            return g = false, w = E, x ? E : R;
          }), this;
        }
        evaluate(T) {
          for (let g of this.steps) if (T = g(T), T === R) break;
          return T;
        }
      }
      function I(y, T, g = (w) => w) {
        let w = (...Z) => N.fire(g(...Z)), E = () => y.on(T, w), x = () => y.removeListener(T, w), N = new v({ onWillAddFirstListener: E, onDidRemoveLastListener: x });
        return N.event;
      }
      Qe.fromNodeEventEmitter = I;
      function k(y, T, g = (w) => w) {
        let w = (...Z) => N.fire(g(...Z)), E = () => y.addEventListener(T, w), x = () => y.removeEventListener(T, w), N = new v({ onWillAddFirstListener: E, onDidRemoveLastListener: x });
        return N.event;
      }
      Qe.fromDOMEventEmitter = k;
      function P(y) {
        return new Promise((T) => i(y)(T));
      }
      Qe.toPromise = P;
      function oe(y) {
        let T = new v();
        return y.then((g) => {
          T.fire(g);
        }, () => {
          T.fire(void 0);
        }).finally(() => {
          T.dispose();
        }), T.event;
      }
      Qe.fromPromise = oe;
      function Me(y, T) {
        return y((g) => T.fire(g));
      }
      Qe.forward = Me;
      function Pe(y, T, g) {
        return T(g), y((w) => T(w));
      }
      Qe.runAndSubscribe = Pe;
      class Ke {
        constructor(T, g) {
          this._observable = T;
          this._counter = 0;
          this._hasChanged = false;
          let w = { onWillAddFirstListener: () => {
            T.addObserver(this);
          }, onDidRemoveLastListener: () => {
            T.removeObserver(this);
          } };
          g || t(w), this.emitter = new v(w), g && g.add(this.emitter);
        }
        beginUpdate(T) {
          this._counter++;
        }
        handlePossibleChange(T) {
        }
        handleChange(T, g) {
          this._hasChanged = true;
        }
        endUpdate(T) {
          this._counter--, this._counter === 0 && (this._observable.reportChanges(), this._hasChanged && (this._hasChanged = false, this.emitter.fire(this._observable.get())));
        }
      }
      function di(y, T) {
        return new Ke(y, T).emitter.event;
      }
      Qe.fromObservable = di;
      function V(y) {
        return (T, g, w) => {
          let E = 0, x = false, N = { beginUpdate() {
            E++;
          }, endUpdate() {
            E--, E === 0 && (y.reportChanges(), x && (x = false, T.call(g)));
          }, handlePossibleChange() {
          }, handleChange() {
            x = true;
          } };
          y.addObserver(N), y.reportChanges();
          let Z = { dispose() {
            y.removeObserver(N);
          } };
          return w instanceof Ee ? w.add(Z) : Array.isArray(w) && w.push(Z), Z;
        };
      }
      Qe.fromObservableLight = V;
    })($ ||= {});
    Mt = class Mt2 {
      constructor(t) {
        this.listenerCount = 0;
        this.invocationCount = 0;
        this.elapsedOverall = 0;
        this.durations = [];
        this.name = `${t}_${Mt2._idPool++}`, Mt2.all.add(this);
      }
      start(t) {
        this._stopWatch = new mr(), this.listenerCount = t;
      }
      stop() {
        if (this._stopWatch) {
          let t = this._stopWatch.elapsed();
          this.durations.push(t), this.elapsedOverall += t, this.invocationCount += 1, this._stopWatch = void 0;
        }
      }
    };
    Mt.all = /* @__PURE__ */ new Set(), Mt._idPool = 0;
    $n = Mt, po = -1;
    br = class br2 {
      constructor(t, e, i = (br2._idPool++).toString(16).padStart(3, "0")) {
        this._errorHandler = t;
        this.threshold = e;
        this.name = i;
        this._warnCountdown = 0;
      }
      dispose() {
        this._stacks?.clear();
      }
      check(t, e) {
        let i = this.threshold;
        if (i <= 0 || e < i) return;
        this._stacks || (this._stacks = /* @__PURE__ */ new Map());
        let r = this._stacks.get(t.value) || 0;
        if (this._stacks.set(t.value, r + 1), this._warnCountdown -= 1, this._warnCountdown <= 0) {
          this._warnCountdown = i * 0.5;
          let [n, o] = this.getMostFrequentStack(), l = `[${this.name}] potential listener LEAK detected, having ${e} listeners already. MOST frequent listener (${o}):`;
          console.warn(l), console.warn(n);
          let a = new qn(l, n);
          this._errorHandler(a);
        }
        return () => {
          let n = this._stacks.get(t.value) || 0;
          this._stacks.set(t.value, n - 1);
        };
      }
      getMostFrequentStack() {
        if (!this._stacks) return;
        let t, e = 0;
        for (let [i, r] of this._stacks) (!t || e < r) && (t = [i, r], e = r);
        return t;
      }
    };
    br._idPool = 1;
    Vn = br, gi = class s7 {
      constructor(t) {
        this.value = t;
      }
      static create() {
        let t = new Error();
        return new s7(t.stack ?? "");
      }
      print() {
        console.warn(this.value.split(`
`).slice(2).join(`
`));
      }
    }, qn = class extends Error {
      constructor(t, e) {
        super(t), this.name = "ListenerLeakError", this.stack = e;
      }
    }, Yn = class extends Error {
      constructor(t, e) {
        super(t), this.name = "ListenerRefusalError", this.stack = e;
      }
    }, Vl = 0, Pt = class {
      constructor(t) {
        this.value = t;
        this.id = Vl++;
      }
    }, ql = 2, Yl = (s15, t) => {
      if (s15 instanceof Pt) t(s15);
      else for (let e = 0; e < s15.length; e++) {
        let i = s15[e];
        i && t(i);
      }
    };
    if (Gl) {
      let s15 = [];
      setInterval(() => {
        s15.length !== 0 && (console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"), console.warn(s15.join(`
`)), s15.length = 0);
      }, 3e3), _r = new FinalizationRegistry((t) => {
        typeof t == "string" && s15.push(t);
      });
    }
    v = class {
      constructor(t) {
        this._size = 0;
        this._options = t, this._leakageMon = po > 0 || this._options?.leakWarningThreshold ? new Vn(t?.onListenerError ?? Lt, this._options?.leakWarningThreshold ?? po) : void 0, this._perfMon = this._options?._profName ? new $n(this._options._profName) : void 0, this._deliveryQueue = this._options?.deliveryQueue;
      }
      dispose() {
        if (!this._disposed) {
          if (this._disposed = true, this._deliveryQueue?.current === this && this._deliveryQueue.reset(), this._listeners) {
            if (fo) {
              let t = this._listeners;
              queueMicrotask(() => {
                Yl(t, (e) => e.stack?.print());
              });
            }
            this._listeners = void 0, this._size = 0;
          }
          this._options?.onDidRemoveLastListener?.(), this._leakageMon?.dispose();
        }
      }
      get event() {
        return this._event ??= (t, e, i) => {
          if (this._leakageMon && this._size > this._leakageMon.threshold ** 2) {
            let a = `[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;
            console.warn(a);
            let u = this._leakageMon.getMostFrequentStack() ?? ["UNKNOWN stack", -1], h8 = new Yn(`${a}. HINT: Stack shows most frequent listener (${u[1]}-times)`, u[0]);
            return (this._options?.onListenerError || Lt)(h8), D.None;
          }
          if (this._disposed) return D.None;
          e && (t = t.bind(e));
          let r = new Pt(t), n, o;
          this._leakageMon && this._size >= Math.ceil(this._leakageMon.threshold * 0.2) && (r.stack = gi.create(), n = this._leakageMon.check(r.stack, this._size + 1)), fo && (r.stack = o ?? gi.create()), this._listeners ? this._listeners instanceof Pt ? (this._deliveryQueue ??= new jn(), this._listeners = [this._listeners, r]) : this._listeners.push(r) : (this._options?.onWillAddFirstListener?.(this), this._listeners = r, this._options?.onDidAddFirstListener?.(this)), this._size++;
          let l = C(() => {
            _r?.unregister(l), n?.(), this._removeListener(r);
          });
          if (i instanceof Ee ? i.add(l) : Array.isArray(i) && i.push(l), _r) {
            let a = new Error().stack.split(`
`).slice(2, 3).join(`
`).trim(), u = /(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(a);
            _r.register(l, u?.[2] ?? a, l);
          }
          return l;
        }, this._event;
      }
      _removeListener(t) {
        if (this._options?.onWillRemoveListener?.(this), !this._listeners) return;
        if (this._size === 1) {
          this._listeners = void 0, this._options?.onDidRemoveLastListener?.(this), this._size = 0;
          return;
        }
        let e = this._listeners, i = e.indexOf(t);
        if (i === -1) throw console.log("disposed?", this._disposed), console.log("size?", this._size), console.log("arr?", JSON.stringify(this._listeners)), new Error("Attempted to dispose unknown listener");
        this._size--, e[i] = void 0;
        let r = this._deliveryQueue.current === this;
        if (this._size * ql <= e.length) {
          let n = 0;
          for (let o = 0; o < e.length; o++) e[o] ? e[n++] = e[o] : r && (this._deliveryQueue.end--, n < this._deliveryQueue.i && this._deliveryQueue.i--);
          e.length = n;
        }
      }
      _deliver(t, e) {
        if (!t) return;
        let i = this._options?.onListenerError || Lt;
        if (!i) {
          t.value(e);
          return;
        }
        try {
          t.value(e);
        } catch (r) {
          i(r);
        }
      }
      _deliverQueue(t) {
        let e = t.current._listeners;
        for (; t.i < t.end; ) this._deliver(e[t.i++], t.value);
        t.reset();
      }
      fire(t) {
        if (this._deliveryQueue?.current && (this._deliverQueue(this._deliveryQueue), this._perfMon?.stop()), this._perfMon?.start(this._size), this._listeners) if (this._listeners instanceof Pt) this._deliver(this._listeners, t);
        else {
          let e = this._deliveryQueue;
          e.enqueue(this, t, this._listeners.length), this._deliverQueue(e);
        }
        this._perfMon?.stop();
      }
      hasListeners() {
        return this._size > 0;
      }
    };
    jn = class {
      constructor() {
        this.i = -1;
        this.end = 0;
      }
      enqueue(t, e, i) {
        this.i = 0, this.end = i, this.current = t, this.value = e;
      }
      reset() {
        this.i = this.end, this.current = void 0, this.value = void 0;
      }
    };
    gr = class gr2 {
      constructor() {
        this.mapWindowIdToZoomLevel = /* @__PURE__ */ new Map();
        this._onDidChangeZoomLevel = new v();
        this.onDidChangeZoomLevel = this._onDidChangeZoomLevel.event;
        this.mapWindowIdToZoomFactor = /* @__PURE__ */ new Map();
        this._onDidChangeFullscreen = new v();
        this.onDidChangeFullscreen = this._onDidChangeFullscreen.event;
        this.mapWindowIdToFullScreen = /* @__PURE__ */ new Map();
      }
      getZoomLevel(t) {
        return this.mapWindowIdToZoomLevel.get(this.getWindowId(t)) ?? 0;
      }
      setZoomLevel(t, e) {
        if (this.getZoomLevel(e) === t) return;
        let i = this.getWindowId(e);
        this.mapWindowIdToZoomLevel.set(i, t), this._onDidChangeZoomLevel.fire(i);
      }
      getZoomFactor(t) {
        return this.mapWindowIdToZoomFactor.get(this.getWindowId(t)) ?? 1;
      }
      setZoomFactor(t, e) {
        this.mapWindowIdToZoomFactor.set(this.getWindowId(e), t);
      }
      setFullscreen(t, e) {
        if (this.isFullscreen(e) === t) return;
        let i = this.getWindowId(e);
        this.mapWindowIdToFullScreen.set(i, t), this._onDidChangeFullscreen.fire(i);
      }
      isFullscreen(t) {
        return !!this.mapWindowIdToFullScreen.get(this.getWindowId(t));
      }
      getWindowId(t) {
        return t.vscodeWindowId;
      }
    };
    gr.INSTANCE = new gr();
    Si = gr;
    Eu = Si.INSTANCE.onDidChangeZoomLevel;
    Tu = Si.INSTANCE.onDidChangeFullscreen, Ot = typeof navigator == "object" ? navigator.userAgent : "", Ei = Ot.indexOf("Firefox") >= 0, Bt = Ot.indexOf("AppleWebKit") >= 0, Ti = Ot.indexOf("Chrome") >= 0, Sr = !Ti && Ot.indexOf("Safari") >= 0;
    Iu = Ot.indexOf("Electron/") >= 0, yu = Ot.indexOf("Android") >= 0, vr = false;
    if (typeof fe.matchMedia == "function") {
      let s15 = fe.matchMedia("(display-mode: standalone) or (display-mode: window-controls-overlay)"), t = fe.matchMedia("(display-mode: fullscreen)");
      vr = s15.matches, Xl(fe, s15, ({ matches: e }) => {
        vr && t.matches || (vr = e);
      });
    }
    Nt = "en", yr = false, xr = false, Ii = false, Zl = false, vo = false, go = false, Jl = false, Ql = false, ea = false, ta = false, Ir = Nt, bo = Nt, Ve = globalThis;
    typeof Ve.vscode < "u" && typeof Ve.vscode.process < "u" ? xe = Ve.vscode.process : typeof process < "u" && typeof process?.versions?.node == "string" && (xe = process);
    So = typeof xe?.versions?.electron == "string", ra = So && xe?.type === "renderer";
    if (typeof xe == "object") {
      yr = xe.platform === "win32", xr = xe.platform === "darwin", Ii = xe.platform === "linux", Zl = Ii && !!xe.env.SNAP && !!xe.env.SNAP_REVISION, Jl = So, ea = !!xe.env.CI || !!xe.env.BUILD_ARTIFACTSTAGINGDIRECTORY, Tr = Nt, Ir = Nt;
      let s15 = xe.env.VSCODE_NLS_CONFIG;
      if (s15) try {
        let t = JSON.parse(s15);
        Tr = t.userLocale, bo = t.osLocale, Ir = t.resolvedLanguage || Nt, ia = t.languagePack?.translationsConfigFile;
      } catch {
      }
      vo = true;
    } else typeof navigator == "object" && !ra ? ($e = navigator.userAgent, yr = $e.indexOf("Windows") >= 0, xr = $e.indexOf("Macintosh") >= 0, Ql = ($e.indexOf("Macintosh") >= 0 || $e.indexOf("iPad") >= 0 || $e.indexOf("iPhone") >= 0) && !!navigator.maxTouchPoints && navigator.maxTouchPoints > 0, Ii = $e.indexOf("Linux") >= 0, ta = $e?.indexOf("Mobi") >= 0, go = true, Ir = globalThis._VSCODE_NLS_LANGUAGE || Nt, Tr = navigator.language.toLowerCase(), bo = Tr) : console.error("Unable to resolve platform.");
    Xn = 0;
    xr ? Xn = 1 : yr ? Xn = 3 : Ii && (Xn = 2);
    wr = yr, Te = xr, Zn = Ii;
    Dr = vo;
    na = go && typeof Ve.importScripts == "function", xu = na ? Ve.origin : void 0;
    Fe = $e, st = Ir;
    ((i) => {
      function s15() {
        return st;
      }
      i.value = s15;
      function t() {
        return st.length === 2 ? st === "en" : st.length >= 3 ? st[0] === "e" && st[1] === "n" && st[2] === "-" : false;
      }
      i.isDefaultVariant = t;
      function e() {
        return st === "en";
      }
      i.isDefault = e;
    })(sa ||= {});
    oa = typeof Ve.postMessage == "function" && !Ve.importScripts, Eo = (() => {
      if (oa) {
        let s15 = [];
        Ve.addEventListener("message", (e) => {
          if (e.data && e.data.vscodeScheduleAsyncWork) for (let i = 0, r = s15.length; i < r; i++) {
            let n = s15[i];
            if (n.id === e.data.vscodeScheduleAsyncWork) {
              s15.splice(i, 1), n.callback();
              return;
            }
          }
        });
        let t = 0;
        return (e) => {
          let i = ++t;
          s15.push({ id: i, callback: e }), Ve.postMessage({ vscodeScheduleAsyncWork: i }, "*");
        };
      }
      return (s15) => setTimeout(s15);
    })();
    la = !!(Fe && Fe.indexOf("Chrome") >= 0), wu = !!(Fe && Fe.indexOf("Firefox") >= 0), Du = !!(!la && Fe && Fe.indexOf("Safari") >= 0), Ru = !!(Fe && Fe.indexOf("Edg/") >= 0), Lu = !!(Fe && Fe.indexOf("Android") >= 0);
    ot = typeof navigator == "object" ? navigator : {}, aa = { clipboard: { writeText: Dr || document.queryCommandSupported && document.queryCommandSupported("copy") || !!(ot && ot.clipboard && ot.clipboard.writeText), readText: Dr || !!(ot && ot.clipboard && ot.clipboard.readText) }, keyboard: Dr || _o() ? 0 : ot.keyboard || Sr ? 1 : 2, touch: "ontouchstart" in fe || ot.maxTouchPoints > 0, pointerEvents: fe.PointerEvent && ("ontouchstart" in fe || navigator.maxTouchPoints > 0) };
    yi = class {
      constructor() {
        this._keyCodeToStr = [], this._strToKeyCode = /* @__PURE__ */ Object.create(null);
      }
      define(t, e) {
        this._keyCodeToStr[t] = e, this._strToKeyCode[e.toLowerCase()] = t;
      }
      keyCodeToStr(t) {
        return this._keyCodeToStr[t];
      }
      strToKeyCode(t) {
        return this._strToKeyCode[t.toLowerCase()] || 0;
      }
    }, Jn = new yi(), To = new yi(), Io = new yi(), yo = new Array(230);
    ((o) => {
      function s15(l) {
        return Jn.keyCodeToStr(l);
      }
      o.toString = s15;
      function t(l) {
        return Jn.strToKeyCode(l);
      }
      o.fromString = t;
      function e(l) {
        return To.keyCodeToStr(l);
      }
      o.toUserSettingsUS = e;
      function i(l) {
        return Io.keyCodeToStr(l);
      }
      o.toUserSettingsGeneral = i;
      function r(l) {
        return To.strToKeyCode(l) || Io.strToKeyCode(l);
      }
      o.fromUserSettings = r;
      function n(l) {
        if (l >= 98 && l <= 113) return null;
        switch (l) {
          case 16:
            return "Up";
          case 18:
            return "Down";
          case 15:
            return "Left";
          case 17:
            return "Right";
        }
        return Jn.keyCodeToStr(l);
      }
      o.toElectronAccelerator = n;
    })(Qn ||= {});
    Rr = class s8 {
      constructor(t, e, i, r, n) {
        this.ctrlKey = t;
        this.shiftKey = e;
        this.altKey = i;
        this.metaKey = r;
        this.keyCode = n;
      }
      equals(t) {
        return t instanceof s8 && this.ctrlKey === t.ctrlKey && this.shiftKey === t.shiftKey && this.altKey === t.altKey && this.metaKey === t.metaKey && this.keyCode === t.keyCode;
      }
      getHashCode() {
        let t = this.ctrlKey ? "1" : "0", e = this.shiftKey ? "1" : "0", i = this.altKey ? "1" : "0", r = this.metaKey ? "1" : "0";
        return `K${t}${e}${i}${r}${this.keyCode}`;
      }
      isModifierKey() {
        return this.keyCode === 0 || this.keyCode === 5 || this.keyCode === 57 || this.keyCode === 6 || this.keyCode === 4;
      }
      toKeybinding() {
        return new es([this]);
      }
      isDuplicateModifierCase() {
        return this.ctrlKey && this.keyCode === 5 || this.shiftKey && this.keyCode === 4 || this.altKey && this.keyCode === 6 || this.metaKey && this.keyCode === 57;
      }
    };
    es = class {
      constructor(t) {
        if (t.length === 0) throw eo("chords");
        this.chords = t;
      }
      getHashCode() {
        let t = "";
        for (let e = 0, i = this.chords.length; e < i; e++) e !== 0 && (t += ";"), t += this.chords[e].getHashCode();
        return t;
      }
      equals(t) {
        if (t === null || this.chords.length !== t.chords.length) return false;
        for (let e = 0; e < this.chords.length; e++) if (!this.chords[e].equals(t.chords[e])) return false;
        return true;
      }
    };
    ua = Te ? 256 : 2048, ha = 512, da = 1024, fa = Te ? 2048 : 256;
    ft = class {
      constructor(t) {
        this._standardKeyboardEventBrand = true;
        let e = t;
        this.browserEvent = e, this.target = e.target, this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, this.altGraphKey = e.getModifierState?.("AltGraph"), this.keyCode = ca(e), this.code = e.code, this.ctrlKey = this.ctrlKey || this.keyCode === 5, this.altKey = this.altKey || this.keyCode === 6, this.shiftKey = this.shiftKey || this.keyCode === 4, this.metaKey = this.metaKey || this.keyCode === 57, this._asKeybinding = this._computeKeybinding(), this._asKeyCodeChord = this._computeKeyCodeChord();
      }
      preventDefault() {
        this.browserEvent && this.browserEvent.preventDefault && this.browserEvent.preventDefault();
      }
      stopPropagation() {
        this.browserEvent && this.browserEvent.stopPropagation && this.browserEvent.stopPropagation();
      }
      toKeyCodeChord() {
        return this._asKeyCodeChord;
      }
      equals(t) {
        return this._asKeybinding === t;
      }
      _computeKeybinding() {
        let t = 0;
        this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t = this.keyCode);
        let e = 0;
        return this.ctrlKey && (e |= ua), this.altKey && (e |= ha), this.shiftKey && (e |= da), this.metaKey && (e |= fa), e |= t, e;
      }
      _computeKeyCodeChord() {
        let t = 0;
        return this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t = this.keyCode), new Rr(this.ctrlKey, this.shiftKey, this.altKey, this.metaKey, t);
      }
    };
    wo = /* @__PURE__ */ new WeakMap();
    Lr = class {
      static getSameOriginWindowChain(t) {
        let e = wo.get(t);
        if (!e) {
          e = [], wo.set(t, e);
          let i = t, r;
          do
            r = pa(i), r ? e.push({ window: new WeakRef(i), iframeElement: i.frameElement || null }) : e.push({ window: new WeakRef(i), iframeElement: null }), i = r;
          while (i);
        }
        return e.slice(0);
      }
      static getPositionOfChildWindowRelativeToAncestorWindow(t, e) {
        if (!e || t === e) return { top: 0, left: 0 };
        let i = 0, r = 0, n = this.getSameOriginWindowChain(t);
        for (let o of n) {
          let l = o.window.deref();
          if (i += l?.scrollY ?? 0, r += l?.scrollX ?? 0, l === e || !o.iframeElement) break;
          let a = o.iframeElement.getBoundingClientRect();
          i += a.top, r += a.left;
        }
        return { top: i, left: r };
      }
    };
    qe = class {
      constructor(t, e) {
        this.timestamp = Date.now(), this.browserEvent = e, this.leftButton = e.button === 0, this.middleButton = e.button === 1, this.rightButton = e.button === 2, this.buttons = e.buttons, this.target = e.target, this.detail = e.detail || 1, e.type === "dblclick" && (this.detail = 2), this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, typeof e.pageX == "number" ? (this.posx = e.pageX, this.posy = e.pageY) : (this.posx = e.clientX + this.target.ownerDocument.body.scrollLeft + this.target.ownerDocument.documentElement.scrollLeft, this.posy = e.clientY + this.target.ownerDocument.body.scrollTop + this.target.ownerDocument.documentElement.scrollTop);
        let i = Lr.getPositionOfChildWindowRelativeToAncestorWindow(t, e.view);
        this.posx -= i.left, this.posy -= i.top;
      }
      preventDefault() {
        this.browserEvent.preventDefault();
      }
      stopPropagation() {
        this.browserEvent.stopPropagation();
      }
    };
    xi = class {
      constructor(t, e = 0, i = 0) {
        this.browserEvent = t || null, this.target = t ? t.target || t.targetNode || t.srcElement : null, this.deltaY = i, this.deltaX = e;
        let r = false;
        if (Ti) {
          let n = navigator.userAgent.match(/Chrome\/(\d+)/);
          r = (n ? parseInt(n[1]) : 123) <= 122;
        }
        if (t) {
          let n = t, o = t, l = t.view?.devicePixelRatio || 1;
          if (typeof n.wheelDeltaY < "u") r ? this.deltaY = n.wheelDeltaY / (120 * l) : this.deltaY = n.wheelDeltaY / 120;
          else if (typeof o.VERTICAL_AXIS < "u" && o.axis === o.VERTICAL_AXIS) this.deltaY = -o.detail / 3;
          else if (t.type === "wheel") {
            let a = t;
            a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaY = -t.deltaY / 3 : this.deltaY = -t.deltaY : this.deltaY = -t.deltaY / 40;
          }
          if (typeof n.wheelDeltaX < "u") Sr && wr ? this.deltaX = -(n.wheelDeltaX / 120) : r ? this.deltaX = n.wheelDeltaX / (120 * l) : this.deltaX = n.wheelDeltaX / 120;
          else if (typeof o.HORIZONTAL_AXIS < "u" && o.axis === o.HORIZONTAL_AXIS) this.deltaX = -t.detail / 3;
          else if (t.type === "wheel") {
            let a = t;
            a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaX = -t.deltaX / 3 : this.deltaX = -t.deltaX : this.deltaX = -t.deltaX / 40;
          }
          this.deltaY === 0 && this.deltaX === 0 && t.wheelDelta && (r ? this.deltaY = t.wheelDelta / (120 * l) : this.deltaY = t.wheelDelta / 120);
        }
      }
      preventDefault() {
        this.browserEvent?.preventDefault();
      }
      stopPropagation() {
        this.browserEvent?.stopPropagation();
      }
    };
    Do = Object.freeze(function(s15, t) {
      let e = setTimeout(s15.bind(t), 0);
      return { dispose() {
        clearTimeout(e);
      } };
    });
    ((i) => {
      function s15(r) {
        return r === i.None || r === i.Cancelled || r instanceof ts ? true : !r || typeof r != "object" ? false : typeof r.isCancellationRequested == "boolean" && typeof r.onCancellationRequested == "function";
      }
      i.isCancellationToken = s15, i.None = Object.freeze({ isCancellationRequested: false, onCancellationRequested: $.None }), i.Cancelled = Object.freeze({ isCancellationRequested: true, onCancellationRequested: Do });
    })(ma ||= {});
    ts = class {
      constructor() {
        this._isCancelled = false;
        this._emitter = null;
      }
      cancel() {
        this._isCancelled || (this._isCancelled = true, this._emitter && (this._emitter.fire(void 0), this.dispose()));
      }
      get isCancellationRequested() {
        return this._isCancelled;
      }
      get onCancellationRequested() {
        return this._isCancelled ? Do : (this._emitter || (this._emitter = new v()), this._emitter.event);
      }
      dispose() {
        this._emitter && (this._emitter.dispose(), this._emitter = null);
      }
    };
    _a = /* @__PURE__ */ Symbol("MicrotaskDelay");
    Ye = class {
      constructor(t, e) {
        this._isDisposed = false;
        this._token = -1, typeof t == "function" && typeof e == "number" && this.setIfNotSet(t, e);
      }
      dispose() {
        this.cancel(), this._isDisposed = true;
      }
      cancel() {
        this._token !== -1 && (clearTimeout(this._token), this._token = -1);
      }
      cancelAndSet(t, e) {
        if (this._isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed TimeoutTimer");
        this.cancel(), this._token = setTimeout(() => {
          this._token = -1, t();
        }, e);
      }
      setIfNotSet(t, e) {
        if (this._isDisposed) throw new Rt("Calling 'setIfNotSet' on a disposed TimeoutTimer");
        this._token === -1 && (this._token = setTimeout(() => {
          this._token = -1, t();
        }, e));
      }
    }, kr = class {
      constructor() {
        this.disposable = void 0;
        this.isDisposed = false;
      }
      cancel() {
        this.disposable?.dispose(), this.disposable = void 0;
      }
      cancelAndSet(t, e, i = globalThis) {
        if (this.isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed IntervalTimer");
        this.cancel();
        let r = i.setInterval(() => {
          t();
        }, e);
        this.disposable = C(() => {
          i.clearInterval(r), this.disposable = void 0;
        });
      }
      dispose() {
        this.cancel(), this.isDisposed = true;
      }
    };
    (function() {
      typeof globalThis.requestIdleCallback != "function" || typeof globalThis.cancelIdleCallback != "function" ? Ar = (s15, t) => {
        Eo(() => {
          if (e) return;
          let i = Date.now() + 15;
          t(Object.freeze({ didTimeout: true, timeRemaining() {
            return Math.max(0, i - Date.now());
          } }));
        });
        let e = false;
        return { dispose() {
          e || (e = true);
        } };
      } : Ar = (s15, t, e) => {
        let i = s15.requestIdleCallback(t, typeof e == "number" ? { timeout: e } : void 0), r = false;
        return { dispose() {
          r || (r = true, s15.cancelIdleCallback(i));
        } };
      }, ba = (s15) => Ar(globalThis, s15);
    })();
    ((e) => {
      async function s15(i) {
        let r, n = await Promise.all(i.map((o) => o.then((l) => l, (l) => {
          r || (r = l);
        })));
        if (typeof r < "u") throw r;
        return n;
      }
      e.settled = s15;
      function t(i) {
        return new Promise(async (r, n) => {
          try {
            await i(r, n);
          } catch (o) {
            n(o);
          }
        });
      }
      e.withAsyncBody = t;
    })(va ||= {});
    _e = class _e2 {
      static fromArray(t) {
        return new _e2((e) => {
          e.emitMany(t);
        });
      }
      static fromPromise(t) {
        return new _e2(async (e) => {
          e.emitMany(await t);
        });
      }
      static fromPromises(t) {
        return new _e2(async (e) => {
          await Promise.all(t.map(async (i) => e.emitOne(await i)));
        });
      }
      static merge(t) {
        return new _e2(async (e) => {
          await Promise.all(t.map(async (i) => {
            for await (let r of i) e.emitOne(r);
          }));
        });
      }
      constructor(t, e) {
        this._state = 0, this._results = [], this._error = null, this._onReturn = e, this._onStateChanged = new v(), queueMicrotask(async () => {
          let i = { emitOne: (r) => this.emitOne(r), emitMany: (r) => this.emitMany(r), reject: (r) => this.reject(r) };
          try {
            await Promise.resolve(t(i)), this.resolve();
          } catch (r) {
            this.reject(r);
          } finally {
            i.emitOne = void 0, i.emitMany = void 0, i.reject = void 0;
          }
        });
      }
      [Symbol.asyncIterator]() {
        let t = 0;
        return { next: async () => {
          do {
            if (this._state === 2) throw this._error;
            if (t < this._results.length) return { done: false, value: this._results[t++] };
            if (this._state === 1) return { done: true, value: void 0 };
            await $.toPromise(this._onStateChanged.event);
          } while (true);
        }, return: async () => (this._onReturn?.(), { done: true, value: void 0 }) };
      }
      static map(t, e) {
        return new _e2(async (i) => {
          for await (let r of t) i.emitOne(e(r));
        });
      }
      map(t) {
        return _e2.map(this, t);
      }
      static filter(t, e) {
        return new _e2(async (i) => {
          for await (let r of t) e(r) && i.emitOne(r);
        });
      }
      filter(t) {
        return _e2.filter(this, t);
      }
      static coalesce(t) {
        return _e2.filter(t, (e) => !!e);
      }
      coalesce() {
        return _e2.coalesce(this);
      }
      static async toPromise(t) {
        let e = [];
        for await (let i of t) e.push(i);
        return e;
      }
      toPromise() {
        return _e2.toPromise(this);
      }
      emitOne(t) {
        this._state === 0 && (this._results.push(t), this._onStateChanged.fire());
      }
      emitMany(t) {
        this._state === 0 && (this._results = this._results.concat(t), this._onStateChanged.fire());
      }
      resolve() {
        this._state === 0 && (this._state = 1, this._onStateChanged.fire());
      }
      reject(t) {
        this._state === 0 && (this._state = 2, this._error = t, this._onStateChanged.fire());
      }
    };
    _e.EMPTY = _e.fromArray([]);
    Ro = _e;
    Cr = class Cr2 {
      constructor() {
        this._h0 = 1732584193;
        this._h1 = 4023233417;
        this._h2 = 2562383102;
        this._h3 = 271733878;
        this._h4 = 3285377520;
        this._buff = new Uint8Array(67), this._buffDV = new DataView(this._buff.buffer), this._buffLen = 0, this._totalLen = 0, this._leftoverHighSurrogate = 0, this._finished = false;
      }
      update(t) {
        let e = t.length;
        if (e === 0) return;
        let i = this._buff, r = this._buffLen, n = this._leftoverHighSurrogate, o, l;
        for (n !== 0 ? (o = n, l = -1, n = 0) : (o = t.charCodeAt(0), l = 0); ; ) {
          let a = o;
          if (Lo(o)) if (l + 1 < e) {
            let u = t.charCodeAt(l + 1);
            is(u) ? (l++, a = Ao(o, u)) : a = 65533;
          } else {
            n = o;
            break;
          }
          else is(o) && (a = 65533);
          if (r = this._push(i, r, a), l++, l < e) o = t.charCodeAt(l);
          else break;
        }
        this._buffLen = r, this._leftoverHighSurrogate = n;
      }
      _push(t, e, i) {
        return i < 128 ? t[e++] = i : i < 2048 ? (t[e++] = 192 | (i & 1984) >>> 6, t[e++] = 128 | (i & 63) >>> 0) : i < 65536 ? (t[e++] = 224 | (i & 61440) >>> 12, t[e++] = 128 | (i & 4032) >>> 6, t[e++] = 128 | (i & 63) >>> 0) : (t[e++] = 240 | (i & 1835008) >>> 18, t[e++] = 128 | (i & 258048) >>> 12, t[e++] = 128 | (i & 4032) >>> 6, t[e++] = 128 | (i & 63) >>> 0), e >= 64 && (this._step(), e -= 64, this._totalLen += 64, t[0] = t[64], t[1] = t[65], t[2] = t[66]), e;
      }
      digest() {
        return this._finished || (this._finished = true, this._leftoverHighSurrogate && (this._leftoverHighSurrogate = 0, this._buffLen = this._push(this._buff, this._buffLen, 65533)), this._totalLen += this._buffLen, this._wrapUp()), wi(this._h0) + wi(this._h1) + wi(this._h2) + wi(this._h3) + wi(this._h4);
      }
      _wrapUp() {
        this._buff[this._buffLen++] = 128, ko(this._buff, this._buffLen), this._buffLen > 56 && (this._step(), ko(this._buff));
        let t = 8 * this._totalLen;
        this._buffDV.setUint32(56, Math.floor(t / 4294967296), false), this._buffDV.setUint32(60, t % 4294967296, false), this._step();
      }
      _step() {
        let t = Cr2._bigBlock32, e = this._buffDV;
        for (let c = 0; c < 64; c += 4) t.setUint32(c, e.getUint32(c, false), false);
        for (let c = 64; c < 320; c += 4) t.setUint32(c, rs(t.getUint32(c - 12, false) ^ t.getUint32(c - 32, false) ^ t.getUint32(c - 56, false) ^ t.getUint32(c - 64, false), 1), false);
        let i = this._h0, r = this._h1, n = this._h2, o = this._h3, l = this._h4, a, u, h8;
        for (let c = 0; c < 80; c++) c < 20 ? (a = r & n | ~r & o, u = 1518500249) : c < 40 ? (a = r ^ n ^ o, u = 1859775393) : c < 60 ? (a = r & n | r & o | n & o, u = 2400959708) : (a = r ^ n ^ o, u = 3395469782), h8 = rs(i, 5) + a + l + u + t.getUint32(c * 4, false) & 4294967295, l = o, o = n, n = rs(r, 30), r = i, i = h8;
        this._h0 = this._h0 + i & 4294967295, this._h1 = this._h1 + r & 4294967295, this._h2 = this._h2 + n & 4294967295, this._h3 = this._h3 + o & 4294967295, this._h4 = this._h4 + l & 4294967295;
      }
    };
    Cr._bigBlock32 = new DataView(new ArrayBuffer(320));
    Co = Cr;
    ({ registerWindow: Bh, getWindow: be, getDocument: Nh, getWindows: Fh, getWindowsCount: Hh, getWindowId: Oo, getWindowById: Wh, hasWindow: Uh, onDidRegisterWindow: No, onWillUnregisterWindow: Kh, onDidUnregisterWindow: zh } = (function() {
      let s15 = /* @__PURE__ */ new Map();
      fe;
      let t = { window: fe, disposables: new Ee() };
      s15.set(fe.vscodeWindowId, t);
      let e = new v(), i = new v(), r = new v();
      function n(o, l) {
        return (typeof o == "number" ? s15.get(o) : void 0) ?? (l ? t : void 0);
      }
      return { onDidRegisterWindow: e.event, onWillUnregisterWindow: r.event, onDidUnregisterWindow: i.event, registerWindow(o) {
        if (s15.has(o.vscodeWindowId)) return D.None;
        let l = new Ee(), a = { window: o, disposables: l.add(new Ee()) };
        return s15.set(o.vscodeWindowId, a), l.add(C(() => {
          s15.delete(o.vscodeWindowId), i.fire(o);
        })), l.add(L(o, Y.BEFORE_UNLOAD, () => {
          r.fire(o);
        })), e.fire(a), l;
      }, getWindows() {
        return s15.values();
      }, getWindowsCount() {
        return s15.size;
      }, getWindowId(o) {
        return o.vscodeWindowId;
      }, hasWindow(o) {
        return s15.has(o);
      }, getWindowById: n, getWindow(o) {
        let l = o;
        if (l?.ownerDocument?.defaultView) return l.ownerDocument.defaultView.window;
        let a = o;
        return a?.view ? a.view.window : fe;
      }, getDocument(o) {
        return be(o).document;
      } };
    })());
    ss = class {
      constructor(t, e, i, r) {
        this._node = t, this._type = e, this._handler = i, this._options = r || false, this._node.addEventListener(this._type, this._handler, this._options);
      }
      dispose() {
        this._handler && (this._node.removeEventListener(this._type, this._handler, this._options), this._node = null, this._handler = null);
      }
    };
    os = function(t, e, i, r) {
      let n = i;
      return e === "click" || e === "mousedown" || e === "contextmenu" ? n = ya(be(t), i) : (e === "keydown" || e === "keypress" || e === "keyup") && (n = xa(i)), L(t, e, n, r);
    };
    Mr = class extends kr {
      constructor(t) {
        super(), this.defaultTarget = t && be(t);
      }
      cancelAndSet(t, e, i) {
        return super.cancelAndSet(t, e, i ?? this.defaultTarget);
      }
    }, Di = class {
      constructor(t, e = 0) {
        this._runner = t, this.priority = e, this._canceled = false;
      }
      dispose() {
        this._canceled = true;
      }
      execute() {
        if (!this._canceled) try {
          this._runner();
        } catch (t) {
          Lt(t);
        }
      }
      static sort(t, e) {
        return e.priority - t.priority;
      }
    };
    (function() {
      let s15 = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map(), e = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), r = (n) => {
        e.set(n, false);
        let o = s15.get(n) ?? [];
        for (t.set(n, o), s15.set(n, []), i.set(n, true); o.length > 0; ) o.sort(Di.sort), o.shift().execute();
        i.set(n, false);
      };
      mt = (n, o, l = 0) => {
        let a = Oo(n), u = new Di(o, l), h8 = s15.get(a);
        return h8 || (h8 = [], s15.set(a, h8)), h8.push(u), e.get(a) || (e.set(a, true), n.requestAnimationFrame(() => r(a))), u;
      }, wa = (n, o, l) => {
        let a = Oo(n);
        if (i.get(a)) {
          let u = new Di(o, l), h8 = t.get(a);
          return h8 || (h8 = [], t.set(a, h8)), h8.push(u), u;
        } else return mt(n, o, l);
      };
    })();
    pt = class pt2 {
      constructor(t, e) {
        this.width = t;
        this.height = e;
      }
      with(t = this.width, e = this.height) {
        return t !== this.width || e !== this.height ? new pt2(t, e) : this;
      }
      static is(t) {
        return typeof t == "object" && typeof t.height == "number" && typeof t.width == "number";
      }
      static lift(t) {
        return t instanceof pt2 ? t : new pt2(t.width, t.height);
      }
      static equals(t, e) {
        return t === e ? true : !t || !e ? false : t.width === e.width && t.height === e.height;
      }
    };
    pt.None = new pt(0, 0);
    Bo = pt;
    Gh = new class {
      constructor() {
        this.mutationObservers = /* @__PURE__ */ new Map();
      }
      observe(s15, t, e) {
        let i = this.mutationObservers.get(s15);
        i || (i = /* @__PURE__ */ new Map(), this.mutationObservers.set(s15, i));
        let r = Mo(e), n = i.get(r);
        if (n) n.users += 1;
        else {
          let o = new v(), l = new MutationObserver((u) => o.fire(u));
          l.observe(s15, e);
          let a = n = { users: 1, observer: l, onDidMutate: o.event };
          t.add(C(() => {
            a.users -= 1, a.users === 0 && (o.dispose(), l.disconnect(), i?.delete(r), i?.size === 0 && this.mutationObservers.delete(s15));
          })), i.set(r, n);
        }
        return n.onDidMutate;
      }
    }();
    Y = { CLICK: "click", AUXCLICK: "auxclick", DBLCLICK: "dblclick", MOUSE_UP: "mouseup", MOUSE_DOWN: "mousedown", MOUSE_OVER: "mouseover", MOUSE_MOVE: "mousemove", MOUSE_OUT: "mouseout", MOUSE_ENTER: "mouseenter", MOUSE_LEAVE: "mouseleave", MOUSE_WHEEL: "wheel", POINTER_UP: "pointerup", POINTER_DOWN: "pointerdown", POINTER_MOVE: "pointermove", POINTER_LEAVE: "pointerleave", CONTEXT_MENU: "contextmenu", WHEEL: "wheel", KEY_DOWN: "keydown", KEY_PRESS: "keypress", KEY_UP: "keyup", LOAD: "load", BEFORE_UNLOAD: "beforeunload", UNLOAD: "unload", PAGE_SHOW: "pageshow", PAGE_HIDE: "pagehide", PASTE: "paste", ABORT: "abort", ERROR: "error", RESIZE: "resize", SCROLL: "scroll", FULLSCREEN_CHANGE: "fullscreenchange", WK_FULLSCREEN_CHANGE: "webkitfullscreenchange", SELECT: "select", CHANGE: "change", SUBMIT: "submit", RESET: "reset", FOCUS: "focus", FOCUS_IN: "focusin", FOCUS_OUT: "focusout", BLUR: "blur", INPUT: "input", STORAGE: "storage", DRAG_START: "dragstart", DRAG: "drag", DRAG_ENTER: "dragenter", DRAG_LEAVE: "dragleave", DRAG_OVER: "dragover", DROP: "drop", DRAG_END: "dragend", ANIMATION_START: Bt ? "webkitAnimationStart" : "animationstart", ANIMATION_END: Bt ? "webkitAnimationEnd" : "animationend", ANIMATION_ITERATION: Bt ? "webkitAnimationIteration" : "animationiteration" };
    Da = /([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;
    Ra.SVG = function(s15, t, ...e) {
      return Ho("http://www.w3.org/2000/svg", s15, t, ...e);
    };
    ls = class {
      constructor(t) {
        this.domNode = t;
        this._maxWidth = "";
        this._width = "";
        this._height = "";
        this._top = "";
        this._left = "";
        this._bottom = "";
        this._right = "";
        this._paddingTop = "";
        this._paddingLeft = "";
        this._paddingBottom = "";
        this._paddingRight = "";
        this._fontFamily = "";
        this._fontWeight = "";
        this._fontSize = "";
        this._fontStyle = "";
        this._fontFeatureSettings = "";
        this._fontVariationSettings = "";
        this._textDecoration = "";
        this._lineHeight = "";
        this._letterSpacing = "";
        this._className = "";
        this._display = "";
        this._position = "";
        this._visibility = "";
        this._color = "";
        this._backgroundColor = "";
        this._layerHint = false;
        this._contain = "none";
        this._boxShadow = "";
      }
      setMaxWidth(t) {
        let e = Ie(t);
        this._maxWidth !== e && (this._maxWidth = e, this.domNode.style.maxWidth = this._maxWidth);
      }
      setWidth(t) {
        let e = Ie(t);
        this._width !== e && (this._width = e, this.domNode.style.width = this._width);
      }
      setHeight(t) {
        let e = Ie(t);
        this._height !== e && (this._height = e, this.domNode.style.height = this._height);
      }
      setTop(t) {
        let e = Ie(t);
        this._top !== e && (this._top = e, this.domNode.style.top = this._top);
      }
      setLeft(t) {
        let e = Ie(t);
        this._left !== e && (this._left = e, this.domNode.style.left = this._left);
      }
      setBottom(t) {
        let e = Ie(t);
        this._bottom !== e && (this._bottom = e, this.domNode.style.bottom = this._bottom);
      }
      setRight(t) {
        let e = Ie(t);
        this._right !== e && (this._right = e, this.domNode.style.right = this._right);
      }
      setPaddingTop(t) {
        let e = Ie(t);
        this._paddingTop !== e && (this._paddingTop = e, this.domNode.style.paddingTop = this._paddingTop);
      }
      setPaddingLeft(t) {
        let e = Ie(t);
        this._paddingLeft !== e && (this._paddingLeft = e, this.domNode.style.paddingLeft = this._paddingLeft);
      }
      setPaddingBottom(t) {
        let e = Ie(t);
        this._paddingBottom !== e && (this._paddingBottom = e, this.domNode.style.paddingBottom = this._paddingBottom);
      }
      setPaddingRight(t) {
        let e = Ie(t);
        this._paddingRight !== e && (this._paddingRight = e, this.domNode.style.paddingRight = this._paddingRight);
      }
      setFontFamily(t) {
        this._fontFamily !== t && (this._fontFamily = t, this.domNode.style.fontFamily = this._fontFamily);
      }
      setFontWeight(t) {
        this._fontWeight !== t && (this._fontWeight = t, this.domNode.style.fontWeight = this._fontWeight);
      }
      setFontSize(t) {
        let e = Ie(t);
        this._fontSize !== e && (this._fontSize = e, this.domNode.style.fontSize = this._fontSize);
      }
      setFontStyle(t) {
        this._fontStyle !== t && (this._fontStyle = t, this.domNode.style.fontStyle = this._fontStyle);
      }
      setFontFeatureSettings(t) {
        this._fontFeatureSettings !== t && (this._fontFeatureSettings = t, this.domNode.style.fontFeatureSettings = this._fontFeatureSettings);
      }
      setFontVariationSettings(t) {
        this._fontVariationSettings !== t && (this._fontVariationSettings = t, this.domNode.style.fontVariationSettings = this._fontVariationSettings);
      }
      setTextDecoration(t) {
        this._textDecoration !== t && (this._textDecoration = t, this.domNode.style.textDecoration = this._textDecoration);
      }
      setLineHeight(t) {
        let e = Ie(t);
        this._lineHeight !== e && (this._lineHeight = e, this.domNode.style.lineHeight = this._lineHeight);
      }
      setLetterSpacing(t) {
        let e = Ie(t);
        this._letterSpacing !== e && (this._letterSpacing = e, this.domNode.style.letterSpacing = this._letterSpacing);
      }
      setClassName(t) {
        this._className !== t && (this._className = t, this.domNode.className = this._className);
      }
      toggleClassName(t, e) {
        this.domNode.classList.toggle(t, e), this._className = this.domNode.className;
      }
      setDisplay(t) {
        this._display !== t && (this._display = t, this.domNode.style.display = this._display);
      }
      setPosition(t) {
        this._position !== t && (this._position = t, this.domNode.style.position = this._position);
      }
      setVisibility(t) {
        this._visibility !== t && (this._visibility = t, this.domNode.style.visibility = this._visibility);
      }
      setColor(t) {
        this._color !== t && (this._color = t, this.domNode.style.color = this._color);
      }
      setBackgroundColor(t) {
        this._backgroundColor !== t && (this._backgroundColor = t, this.domNode.style.backgroundColor = this._backgroundColor);
      }
      setLayerHinting(t) {
        this._layerHint !== t && (this._layerHint = t, this.domNode.style.transform = this._layerHint ? "translate3d(0px, 0px, 0px)" : "");
      }
      setBoxShadow(t) {
        this._boxShadow !== t && (this._boxShadow = t, this.domNode.style.boxShadow = t);
      }
      setContain(t) {
        this._contain !== t && (this._contain = t, this.domNode.style.contain = this._contain);
      }
      setAttribute(t, e) {
        this.domNode.setAttribute(t, e);
      }
      removeAttribute(t) {
        this.domNode.removeAttribute(t);
      }
      appendChild(t) {
        this.domNode.appendChild(t.domNode);
      }
      removeChild(t) {
        this.domNode.removeChild(t.domNode);
      }
    };
    Wt = class {
      constructor() {
        this._hooks = new Ee();
        this._pointerMoveCallback = null;
        this._onStopCallback = null;
      }
      dispose() {
        this.stopMonitoring(false), this._hooks.dispose();
      }
      stopMonitoring(t, e) {
        if (!this.isMonitoring()) return;
        this._hooks.clear(), this._pointerMoveCallback = null;
        let i = this._onStopCallback;
        this._onStopCallback = null, t && i && i(e);
      }
      isMonitoring() {
        return !!this._pointerMoveCallback;
      }
      startMonitoring(t, e, i, r, n) {
        this.isMonitoring() && this.stopMonitoring(false), this._pointerMoveCallback = r, this._onStopCallback = n;
        let o = t;
        try {
          t.setPointerCapture(e), this._hooks.add(C(() => {
            try {
              t.releasePointerCapture(e);
            } catch {
            }
          }));
        } catch {
          o = be(t);
        }
        this._hooks.add(L(o, Y.POINTER_MOVE, (l) => {
          if (l.buttons !== i) {
            this.stopMonitoring(true);
            return;
          }
          l.preventDefault(), this._pointerMoveCallback(l);
        })), this._hooks.add(L(o, Y.POINTER_UP, (l) => this.stopMonitoring(true)));
      }
    };
    ((n) => (n.Tap = "-xterm-gesturetap", n.Change = "-xterm-gesturechange", n.Start = "-xterm-gesturestart", n.End = "-xterm-gesturesend", n.Contextmenu = "-xterm-gesturecontextmenu"))(He ||= {});
    Q = class Q2 extends D {
      constructor() {
        super();
        this.dispatched = false;
        this.targets = new Ct();
        this.ignoreTargets = new Ct();
        this.activeTouches = {}, this.handle = null, this._lastSetTapCountTime = 0, this._register($.runAndSubscribe(No, ({ window: e, disposables: i }) => {
          i.add(L(e.document, "touchstart", (r) => this.onTouchStart(r), { passive: false })), i.add(L(e.document, "touchend", (r) => this.onTouchEnd(e, r))), i.add(L(e.document, "touchmove", (r) => this.onTouchMove(r), { passive: false }));
        }, { window: fe, disposables: this._store }));
      }
      static addTarget(e) {
        if (!Q2.isTouchDevice()) return D.None;
        Q2.INSTANCE || (Q2.INSTANCE = Gn(new Q2()));
        let i = Q2.INSTANCE.targets.push(e);
        return C(i);
      }
      static ignoreTarget(e) {
        if (!Q2.isTouchDevice()) return D.None;
        Q2.INSTANCE || (Q2.INSTANCE = Gn(new Q2()));
        let i = Q2.INSTANCE.ignoreTargets.push(e);
        return C(i);
      }
      static isTouchDevice() {
        return "ontouchstart" in fe || navigator.maxTouchPoints > 0;
      }
      dispose() {
        this.handle && (this.handle.dispose(), this.handle = null), super.dispose();
      }
      onTouchStart(e) {
        let i = Date.now();
        this.handle && (this.handle.dispose(), this.handle = null);
        for (let r = 0, n = e.targetTouches.length; r < n; r++) {
          let o = e.targetTouches.item(r);
          this.activeTouches[o.identifier] = { id: o.identifier, initialTarget: o.target, initialTimeStamp: i, initialPageX: o.pageX, initialPageY: o.pageY, rollingTimestamps: [i], rollingPageX: [o.pageX], rollingPageY: [o.pageY] };
          let l = this.newGestureEvent(He.Start, o.target);
          l.pageX = o.pageX, l.pageY = o.pageY, this.dispatchEvent(l);
        }
        this.dispatched && (e.preventDefault(), e.stopPropagation(), this.dispatched = false);
      }
      onTouchEnd(e, i) {
        let r = Date.now(), n = Object.keys(this.activeTouches).length;
        for (let o = 0, l = i.changedTouches.length; o < l; o++) {
          let a = i.changedTouches.item(o);
          if (!this.activeTouches.hasOwnProperty(String(a.identifier))) {
            console.warn("move of an UNKNOWN touch", a);
            continue;
          }
          let u = this.activeTouches[a.identifier], h8 = Date.now() - u.initialTimeStamp;
          if (h8 < Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
            let c = this.newGestureEvent(He.Tap, u.initialTarget);
            c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
          } else if (h8 >= Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
            let c = this.newGestureEvent(He.Contextmenu, u.initialTarget);
            c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
          } else if (n === 1) {
            let c = Se(u.rollingPageX), d = Se(u.rollingPageY), _ = Se(u.rollingTimestamps) - u.rollingTimestamps[0], p = c - u.rollingPageX[0], m = d - u.rollingPageY[0], f = [...this.targets].filter((A) => u.initialTarget instanceof Node && A.contains(u.initialTarget));
            this.inertia(e, f, r, Math.abs(p) / _, p > 0 ? 1 : -1, c, Math.abs(m) / _, m > 0 ? 1 : -1, d);
          }
          this.dispatchEvent(this.newGestureEvent(He.End, u.initialTarget)), delete this.activeTouches[a.identifier];
        }
        this.dispatched && (i.preventDefault(), i.stopPropagation(), this.dispatched = false);
      }
      newGestureEvent(e, i) {
        let r = document.createEvent("CustomEvent");
        return r.initEvent(e, false, true), r.initialTarget = i, r.tapCount = 0, r;
      }
      dispatchEvent(e) {
        if (e.type === He.Tap) {
          let i = (/* @__PURE__ */ new Date()).getTime(), r = 0;
          i - this._lastSetTapCountTime > Q2.CLEAR_TAP_COUNT_TIME ? r = 1 : r = 2, this._lastSetTapCountTime = i, e.tapCount = r;
        } else (e.type === He.Change || e.type === He.Contextmenu) && (this._lastSetTapCountTime = 0);
        if (e.initialTarget instanceof Node) {
          for (let r of this.ignoreTargets) if (r.contains(e.initialTarget)) return;
          let i = [];
          for (let r of this.targets) if (r.contains(e.initialTarget)) {
            let n = 0, o = e.initialTarget;
            for (; o && o !== r; ) n++, o = o.parentElement;
            i.push([n, r]);
          }
          i.sort((r, n) => r[0] - n[0]);
          for (let [r, n] of i) n.dispatchEvent(e), this.dispatched = true;
        }
      }
      inertia(e, i, r, n, o, l, a, u, h8) {
        this.handle = mt(e, () => {
          let c = Date.now(), d = c - r, _ = 0, p = 0, m = true;
          n += Q2.SCROLL_FRICTION * d, a += Q2.SCROLL_FRICTION * d, n > 0 && (m = false, _ = o * n * d), a > 0 && (m = false, p = u * a * d);
          let f = this.newGestureEvent(He.Change);
          f.translationX = _, f.translationY = p, i.forEach((A) => A.dispatchEvent(f)), m || this.inertia(e, i, c, n, o, l + _, a, u, h8 + p);
        });
      }
      onTouchMove(e) {
        let i = Date.now();
        for (let r = 0, n = e.changedTouches.length; r < n; r++) {
          let o = e.changedTouches.item(r);
          if (!this.activeTouches.hasOwnProperty(String(o.identifier))) {
            console.warn("end of an UNKNOWN touch", o);
            continue;
          }
          let l = this.activeTouches[o.identifier], a = this.newGestureEvent(He.Change, l.initialTarget);
          a.translationX = o.pageX - Se(l.rollingPageX), a.translationY = o.pageY - Se(l.rollingPageY), a.pageX = o.pageX, a.pageY = o.pageY, this.dispatchEvent(a), l.rollingPageX.length > 3 && (l.rollingPageX.shift(), l.rollingPageY.shift(), l.rollingTimestamps.shift()), l.rollingPageX.push(o.pageX), l.rollingPageY.push(o.pageY), l.rollingTimestamps.push(i);
        }
        this.dispatched && (e.preventDefault(), e.stopPropagation(), this.dispatched = false);
      }
    };
    Q.SCROLL_FRICTION = -5e-3, Q.HOLD_DELAY = 700, Q.CLEAR_TAP_COUNT_TIME = 400, M([Wo], Q, "isTouchDevice", 1);
    Pr = Q;
    lt = class extends D {
      onclick(t, e) {
        this._register(L(t, Y.CLICK, (i) => e(new qe(be(t), i))));
      }
      onmousedown(t, e) {
        this._register(L(t, Y.MOUSE_DOWN, (i) => e(new qe(be(t), i))));
      }
      onmouseover(t, e) {
        this._register(L(t, Y.MOUSE_OVER, (i) => e(new qe(be(t), i))));
      }
      onmouseleave(t, e) {
        this._register(L(t, Y.MOUSE_LEAVE, (i) => e(new qe(be(t), i))));
      }
      onkeydown(t, e) {
        this._register(L(t, Y.KEY_DOWN, (i) => e(new ft(i))));
      }
      onkeyup(t, e) {
        this._register(L(t, Y.KEY_UP, (i) => e(new ft(i))));
      }
      oninput(t, e) {
        this._register(L(t, Y.INPUT, e));
      }
      onblur(t, e) {
        this._register(L(t, Y.BLUR, e));
      }
      onfocus(t, e) {
        this._register(L(t, Y.FOCUS, e));
      }
      onchange(t, e) {
        this._register(L(t, Y.CHANGE, e));
      }
      ignoreGesture(t) {
        return Pr.ignoreTarget(t);
      }
    };
    Uo = 11, Or = class extends lt {
      constructor(t) {
        super(), this._onActivate = t.onActivate, this.bgDomNode = document.createElement("div"), this.bgDomNode.className = "arrow-background", this.bgDomNode.style.position = "absolute", this.bgDomNode.style.width = t.bgWidth + "px", this.bgDomNode.style.height = t.bgHeight + "px", typeof t.top < "u" && (this.bgDomNode.style.top = "0px"), typeof t.left < "u" && (this.bgDomNode.style.left = "0px"), typeof t.bottom < "u" && (this.bgDomNode.style.bottom = "0px"), typeof t.right < "u" && (this.bgDomNode.style.right = "0px"), this.domNode = document.createElement("div"), this.domNode.className = t.className, this.domNode.style.position = "absolute", this.domNode.style.width = Uo + "px", this.domNode.style.height = Uo + "px", typeof t.top < "u" && (this.domNode.style.top = t.top + "px"), typeof t.left < "u" && (this.domNode.style.left = t.left + "px"), typeof t.bottom < "u" && (this.domNode.style.bottom = t.bottom + "px"), typeof t.right < "u" && (this.domNode.style.right = t.right + "px"), this._pointerMoveMonitor = this._register(new Wt()), this._register(os(this.bgDomNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._register(os(this.domNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._pointerdownRepeatTimer = this._register(new Mr()), this._pointerdownScheduleRepeatTimer = this._register(new Ye());
      }
      _arrowPointerDown(t) {
        if (!t.target || !(t.target instanceof Element)) return;
        let e = () => {
          this._pointerdownRepeatTimer.cancelAndSet(() => this._onActivate(), 1e3 / 24, be(t));
        };
        this._onActivate(), this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancelAndSet(e, 200), this._pointerMoveMonitor.startMonitoring(t.target, t.pointerId, t.buttons, (i) => {
        }, () => {
          this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancel();
        }), t.preventDefault();
      }
    };
    cs = class s9 {
      constructor(t, e, i, r, n, o, l) {
        this._forceIntegerValues = t;
        this._scrollStateBrand = void 0;
        this._forceIntegerValues && (e = e | 0, i = i | 0, r = r | 0, n = n | 0, o = o | 0, l = l | 0), this.rawScrollLeft = r, this.rawScrollTop = l, e < 0 && (e = 0), r + e > i && (r = i - e), r < 0 && (r = 0), n < 0 && (n = 0), l + n > o && (l = o - n), l < 0 && (l = 0), this.width = e, this.scrollWidth = i, this.scrollLeft = r, this.height = n, this.scrollHeight = o, this.scrollTop = l;
      }
      equals(t) {
        return this.rawScrollLeft === t.rawScrollLeft && this.rawScrollTop === t.rawScrollTop && this.width === t.width && this.scrollWidth === t.scrollWidth && this.scrollLeft === t.scrollLeft && this.height === t.height && this.scrollHeight === t.scrollHeight && this.scrollTop === t.scrollTop;
      }
      withScrollDimensions(t, e) {
        return new s9(this._forceIntegerValues, typeof t.width < "u" ? t.width : this.width, typeof t.scrollWidth < "u" ? t.scrollWidth : this.scrollWidth, e ? this.rawScrollLeft : this.scrollLeft, typeof t.height < "u" ? t.height : this.height, typeof t.scrollHeight < "u" ? t.scrollHeight : this.scrollHeight, e ? this.rawScrollTop : this.scrollTop);
      }
      withScrollPosition(t) {
        return new s9(this._forceIntegerValues, this.width, this.scrollWidth, typeof t.scrollLeft < "u" ? t.scrollLeft : this.rawScrollLeft, this.height, this.scrollHeight, typeof t.scrollTop < "u" ? t.scrollTop : this.rawScrollTop);
      }
      createScrollEvent(t, e) {
        let i = this.width !== t.width, r = this.scrollWidth !== t.scrollWidth, n = this.scrollLeft !== t.scrollLeft, o = this.height !== t.height, l = this.scrollHeight !== t.scrollHeight, a = this.scrollTop !== t.scrollTop;
        return { inSmoothScrolling: e, oldWidth: t.width, oldScrollWidth: t.scrollWidth, oldScrollLeft: t.scrollLeft, width: this.width, scrollWidth: this.scrollWidth, scrollLeft: this.scrollLeft, oldHeight: t.height, oldScrollHeight: t.scrollHeight, oldScrollTop: t.scrollTop, height: this.height, scrollHeight: this.scrollHeight, scrollTop: this.scrollTop, widthChanged: i, scrollWidthChanged: r, scrollLeftChanged: n, heightChanged: o, scrollHeightChanged: l, scrollTopChanged: a };
      }
    }, Ri = class extends D {
      constructor(e) {
        super();
        this._scrollableBrand = void 0;
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this._smoothScrollDuration = e.smoothScrollDuration, this._scheduleAtNextAnimationFrame = e.scheduleAtNextAnimationFrame, this._state = new cs(e.forceIntegerValues, 0, 0, 0, 0, 0, 0), this._smoothScrolling = null;
      }
      dispose() {
        this._smoothScrolling && (this._smoothScrolling.dispose(), this._smoothScrolling = null), super.dispose();
      }
      setSmoothScrollDuration(e) {
        this._smoothScrollDuration = e;
      }
      validateScrollPosition(e) {
        return this._state.withScrollPosition(e);
      }
      getScrollDimensions() {
        return this._state;
      }
      setScrollDimensions(e, i) {
        let r = this._state.withScrollDimensions(e, i);
        this._setState(r, !!this._smoothScrolling), this._smoothScrolling?.acceptScrollDimensions(this._state);
      }
      getFutureScrollPosition() {
        return this._smoothScrolling ? this._smoothScrolling.to : this._state;
      }
      getCurrentScrollPosition() {
        return this._state;
      }
      setScrollPositionNow(e) {
        let i = this._state.withScrollPosition(e);
        this._smoothScrolling && (this._smoothScrolling.dispose(), this._smoothScrolling = null), this._setState(i, false);
      }
      setScrollPositionSmooth(e, i) {
        if (this._smoothScrollDuration === 0) return this.setScrollPositionNow(e);
        if (this._smoothScrolling) {
          e = { scrollLeft: typeof e.scrollLeft > "u" ? this._smoothScrolling.to.scrollLeft : e.scrollLeft, scrollTop: typeof e.scrollTop > "u" ? this._smoothScrolling.to.scrollTop : e.scrollTop };
          let r = this._state.withScrollPosition(e);
          if (this._smoothScrolling.to.scrollLeft === r.scrollLeft && this._smoothScrolling.to.scrollTop === r.scrollTop) return;
          let n;
          i ? n = new Nr(this._smoothScrolling.from, r, this._smoothScrolling.startTime, this._smoothScrolling.duration) : n = this._smoothScrolling.combine(this._state, r, this._smoothScrollDuration), this._smoothScrolling.dispose(), this._smoothScrolling = n;
        } else {
          let r = this._state.withScrollPosition(e);
          this._smoothScrolling = Nr.start(this._state, r, this._smoothScrollDuration);
        }
        this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
          this._smoothScrolling && (this._smoothScrolling.animationFrameDisposable = null, this._performSmoothScrolling());
        });
      }
      hasPendingScrollAnimation() {
        return !!this._smoothScrolling;
      }
      _performSmoothScrolling() {
        if (!this._smoothScrolling) return;
        let e = this._smoothScrolling.tick(), i = this._state.withScrollPosition(e);
        if (this._setState(i, true), !!this._smoothScrolling) {
          if (e.isDone) {
            this._smoothScrolling.dispose(), this._smoothScrolling = null;
            return;
          }
          this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
            this._smoothScrolling && (this._smoothScrolling.animationFrameDisposable = null, this._performSmoothScrolling());
          });
        }
      }
      _setState(e, i) {
        let r = this._state;
        r.equals(e) || (this._state = e, this._onScroll.fire(this._state.createScrollEvent(r, i)));
      }
    }, Br = class {
      constructor(t, e, i) {
        this.scrollLeft = t, this.scrollTop = e, this.isDone = i;
      }
    };
    Nr = class s10 {
      constructor(t, e, i, r) {
        this.from = t, this.to = e, this.duration = r, this.startTime = i, this.animationFrameDisposable = null, this._initAnimations();
      }
      _initAnimations() {
        this.scrollLeft = this._initAnimation(this.from.scrollLeft, this.to.scrollLeft, this.to.width), this.scrollTop = this._initAnimation(this.from.scrollTop, this.to.scrollTop, this.to.height);
      }
      _initAnimation(t, e, i) {
        if (Math.abs(t - e) > 2.5 * i) {
          let n, o;
          return t < e ? (n = t + 0.75 * i, o = e - 0.75 * i) : (n = t - 0.75 * i, o = e + 0.75 * i), La(as(t, n), as(o, e), 0.33);
        }
        return as(t, e);
      }
      dispose() {
        this.animationFrameDisposable !== null && (this.animationFrameDisposable.dispose(), this.animationFrameDisposable = null);
      }
      acceptScrollDimensions(t) {
        this.to = t.withScrollPosition(this.to), this._initAnimations();
      }
      tick() {
        return this._tick(Date.now());
      }
      _tick(t) {
        let e = (t - this.startTime) / this.duration;
        if (e < 1) {
          let i = this.scrollLeft(e), r = this.scrollTop(e);
          return new Br(i, r, false);
        }
        return new Br(this.to.scrollLeft, this.to.scrollTop, true);
      }
      combine(t, e, i) {
        return s10.start(t, e, i);
      }
      static start(t, e, i) {
        i = i + 10;
        let r = Date.now() - 10;
        return new s10(t, e, r, i);
      }
    };
    Fr = class extends D {
      constructor(t, e, i) {
        super(), this._visibility = t, this._visibleClassName = e, this._invisibleClassName = i, this._domNode = null, this._isVisible = false, this._isNeeded = false, this._rawShouldBeVisible = false, this._shouldBeVisible = false, this._revealTimer = this._register(new Ye());
      }
      setVisibility(t) {
        this._visibility !== t && (this._visibility = t, this._updateShouldBeVisible());
      }
      setShouldBeVisible(t) {
        this._rawShouldBeVisible = t, this._updateShouldBeVisible();
      }
      _applyVisibilitySetting() {
        return this._visibility === 2 ? false : this._visibility === 3 ? true : this._rawShouldBeVisible;
      }
      _updateShouldBeVisible() {
        let t = this._applyVisibilitySetting();
        this._shouldBeVisible !== t && (this._shouldBeVisible = t, this.ensureVisibility());
      }
      setIsNeeded(t) {
        this._isNeeded !== t && (this._isNeeded = t, this.ensureVisibility());
      }
      setDomNode(t) {
        this._domNode = t, this._domNode.setClassName(this._invisibleClassName), this.setShouldBeVisible(false);
      }
      ensureVisibility() {
        if (!this._isNeeded) {
          this._hide(false);
          return;
        }
        this._shouldBeVisible ? this._reveal() : this._hide(true);
      }
      _reveal() {
        this._isVisible || (this._isVisible = true, this._revealTimer.setIfNotSet(() => {
          this._domNode?.setClassName(this._visibleClassName);
        }, 0));
      }
      _hide(t) {
        this._revealTimer.cancel(), this._isVisible && (this._isVisible = false, this._domNode?.setClassName(this._invisibleClassName + (t ? " fade" : "")));
      }
    };
    Ca = 140, Ut = class extends lt {
      constructor(t) {
        super(), this._lazyRender = t.lazyRender, this._host = t.host, this._scrollable = t.scrollable, this._scrollByPage = t.scrollByPage, this._scrollbarState = t.scrollbarState, this._visibilityController = this._register(new Fr(t.visibility, "visible scrollbar " + t.extraScrollbarClassName, "invisible scrollbar " + t.extraScrollbarClassName)), this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._pointerMoveMonitor = this._register(new Wt()), this._shouldRender = true, this.domNode = _t(document.createElement("div")), this.domNode.setAttribute("role", "presentation"), this.domNode.setAttribute("aria-hidden", "true"), this._visibilityController.setDomNode(this.domNode), this.domNode.setPosition("absolute"), this._register(L(this.domNode.domNode, Y.POINTER_DOWN, (e) => this._domNodePointerDown(e)));
      }
      _createArrow(t) {
        let e = this._register(new Or(t));
        this.domNode.domNode.appendChild(e.bgDomNode), this.domNode.domNode.appendChild(e.domNode);
      }
      _createSlider(t, e, i, r) {
        this.slider = _t(document.createElement("div")), this.slider.setClassName("slider"), this.slider.setPosition("absolute"), this.slider.setTop(t), this.slider.setLeft(e), typeof i == "number" && this.slider.setWidth(i), typeof r == "number" && this.slider.setHeight(r), this.slider.setLayerHinting(true), this.slider.setContain("strict"), this.domNode.domNode.appendChild(this.slider.domNode), this._register(L(this.slider.domNode, Y.POINTER_DOWN, (n) => {
          n.button === 0 && (n.preventDefault(), this._sliderPointerDown(n));
        })), this.onclick(this.slider.domNode, (n) => {
          n.leftButton && n.stopPropagation();
        });
      }
      _onElementSize(t) {
        return this._scrollbarState.setVisibleSize(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      _onElementScrollSize(t) {
        return this._scrollbarState.setScrollSize(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      _onElementScrollPosition(t) {
        return this._scrollbarState.setScrollPosition(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
      }
      beginReveal() {
        this._visibilityController.setShouldBeVisible(true);
      }
      beginHide() {
        this._visibilityController.setShouldBeVisible(false);
      }
      render() {
        this._shouldRender && (this._shouldRender = false, this._renderDomNode(this._scrollbarState.getRectangleLargeSize(), this._scrollbarState.getRectangleSmallSize()), this._updateSlider(this._scrollbarState.getSliderSize(), this._scrollbarState.getArrowSize() + this._scrollbarState.getSliderPosition()));
      }
      _domNodePointerDown(t) {
        t.target === this.domNode.domNode && this._onPointerDown(t);
      }
      delegatePointerDown(t) {
        let e = this.domNode.domNode.getClientRects()[0].top, i = e + this._scrollbarState.getSliderPosition(), r = e + this._scrollbarState.getSliderPosition() + this._scrollbarState.getSliderSize(), n = this._sliderPointerPosition(t);
        i <= n && n <= r ? t.button === 0 && (t.preventDefault(), this._sliderPointerDown(t)) : this._onPointerDown(t);
      }
      _onPointerDown(t) {
        let e, i;
        if (t.target === this.domNode.domNode && typeof t.offsetX == "number" && typeof t.offsetY == "number") e = t.offsetX, i = t.offsetY;
        else {
          let n = Fo(this.domNode.domNode);
          e = t.pageX - n.left, i = t.pageY - n.top;
        }
        let r = this._pointerDownRelativePosition(e, i);
        this._setDesiredScrollPositionNow(this._scrollByPage ? this._scrollbarState.getDesiredScrollPositionFromOffsetPaged(r) : this._scrollbarState.getDesiredScrollPositionFromOffset(r)), t.button === 0 && (t.preventDefault(), this._sliderPointerDown(t));
      }
      _sliderPointerDown(t) {
        if (!t.target || !(t.target instanceof Element)) return;
        let e = this._sliderPointerPosition(t), i = this._sliderOrthogonalPointerPosition(t), r = this._scrollbarState.clone();
        this.slider.toggleClassName("active", true), this._pointerMoveMonitor.startMonitoring(t.target, t.pointerId, t.buttons, (n) => {
          let o = this._sliderOrthogonalPointerPosition(n), l = Math.abs(o - i);
          if (wr && l > Ca) {
            this._setDesiredScrollPositionNow(r.getScrollPosition());
            return;
          }
          let u = this._sliderPointerPosition(n) - e;
          this._setDesiredScrollPositionNow(r.getDesiredScrollPositionFromDelta(u));
        }, () => {
          this.slider.toggleClassName("active", false), this._host.onDragEnd();
        }), this._host.onDragStart();
      }
      _setDesiredScrollPositionNow(t) {
        let e = {};
        this.writeScrollPosition(e, t), this._scrollable.setScrollPositionNow(e);
      }
      updateScrollbarSize(t) {
        this._updateScrollbarSize(t), this._scrollbarState.setScrollbarSize(t), this._shouldRender = true, this._lazyRender || this.render();
      }
      isNeeded() {
        return this._scrollbarState.isNeeded();
      }
    };
    Kt = class s11 {
      constructor(t, e, i, r, n, o) {
        this._scrollbarSize = Math.round(e), this._oppositeScrollbarSize = Math.round(i), this._arrowSize = Math.round(t), this._visibleSize = r, this._scrollSize = n, this._scrollPosition = o, this._computedAvailableSize = 0, this._computedIsNeeded = false, this._computedSliderSize = 0, this._computedSliderRatio = 0, this._computedSliderPosition = 0, this._refreshComputedValues();
      }
      clone() {
        return new s11(this._arrowSize, this._scrollbarSize, this._oppositeScrollbarSize, this._visibleSize, this._scrollSize, this._scrollPosition);
      }
      setVisibleSize(t) {
        let e = Math.round(t);
        return this._visibleSize !== e ? (this._visibleSize = e, this._refreshComputedValues(), true) : false;
      }
      setScrollSize(t) {
        let e = Math.round(t);
        return this._scrollSize !== e ? (this._scrollSize = e, this._refreshComputedValues(), true) : false;
      }
      setScrollPosition(t) {
        let e = Math.round(t);
        return this._scrollPosition !== e ? (this._scrollPosition = e, this._refreshComputedValues(), true) : false;
      }
      setScrollbarSize(t) {
        this._scrollbarSize = Math.round(t);
      }
      setOppositeScrollbarSize(t) {
        this._oppositeScrollbarSize = Math.round(t);
      }
      static _computeValues(t, e, i, r, n) {
        let o = Math.max(0, i - t), l = Math.max(0, o - 2 * e), a = r > 0 && r > i;
        if (!a) return { computedAvailableSize: Math.round(o), computedIsNeeded: a, computedSliderSize: Math.round(l), computedSliderRatio: 0, computedSliderPosition: 0 };
        let u = Math.round(Math.max(20, Math.floor(i * l / r))), h8 = (l - u) / (r - i), c = n * h8;
        return { computedAvailableSize: Math.round(o), computedIsNeeded: a, computedSliderSize: Math.round(u), computedSliderRatio: h8, computedSliderPosition: Math.round(c) };
      }
      _refreshComputedValues() {
        let t = s11._computeValues(this._oppositeScrollbarSize, this._arrowSize, this._visibleSize, this._scrollSize, this._scrollPosition);
        this._computedAvailableSize = t.computedAvailableSize, this._computedIsNeeded = t.computedIsNeeded, this._computedSliderSize = t.computedSliderSize, this._computedSliderRatio = t.computedSliderRatio, this._computedSliderPosition = t.computedSliderPosition;
      }
      getArrowSize() {
        return this._arrowSize;
      }
      getScrollPosition() {
        return this._scrollPosition;
      }
      getRectangleLargeSize() {
        return this._computedAvailableSize;
      }
      getRectangleSmallSize() {
        return this._scrollbarSize;
      }
      isNeeded() {
        return this._computedIsNeeded;
      }
      getSliderSize() {
        return this._computedSliderSize;
      }
      getSliderPosition() {
        return this._computedSliderPosition;
      }
      getDesiredScrollPositionFromOffset(t) {
        if (!this._computedIsNeeded) return 0;
        let e = t - this._arrowSize - this._computedSliderSize / 2;
        return Math.round(e / this._computedSliderRatio);
      }
      getDesiredScrollPositionFromOffsetPaged(t) {
        if (!this._computedIsNeeded) return 0;
        let e = t - this._arrowSize, i = this._scrollPosition;
        return e < this._computedSliderPosition ? i -= this._visibleSize : i += this._visibleSize, i;
      }
      getDesiredScrollPositionFromDelta(t) {
        if (!this._computedIsNeeded) return 0;
        let e = this._computedSliderPosition + t;
        return Math.round(e / this._computedSliderRatio);
      }
    };
    Wr = class extends Ut {
      constructor(t, e, i) {
        let r = t.getScrollDimensions(), n = t.getCurrentScrollPosition();
        if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.horizontalHasArrows ? e.arrowSize : 0, e.horizontal === 2 ? 0 : e.horizontalScrollbarSize, e.vertical === 2 ? 0 : e.verticalScrollbarSize, r.width, r.scrollWidth, n.scrollLeft), visibility: e.horizontal, extraScrollbarClassName: "horizontal", scrollable: t, scrollByPage: e.scrollByPage }), e.horizontalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
        this._createSlider(Math.floor((e.horizontalScrollbarSize - e.horizontalSliderSize) / 2), 0, void 0, e.horizontalSliderSize);
      }
      _updateSlider(t, e) {
        this.slider.setWidth(t), this.slider.setLeft(e);
      }
      _renderDomNode(t, e) {
        this.domNode.setWidth(t), this.domNode.setHeight(e), this.domNode.setLeft(0), this.domNode.setBottom(0);
      }
      onDidScroll(t) {
        return this._shouldRender = this._onElementScrollSize(t.scrollWidth) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t.scrollLeft) || this._shouldRender, this._shouldRender = this._onElementSize(t.width) || this._shouldRender, this._shouldRender;
      }
      _pointerDownRelativePosition(t, e) {
        return t;
      }
      _sliderPointerPosition(t) {
        return t.pageX;
      }
      _sliderOrthogonalPointerPosition(t) {
        return t.pageY;
      }
      _updateScrollbarSize(t) {
        this.slider.setHeight(t);
      }
      writeScrollPosition(t, e) {
        t.scrollLeft = e;
      }
      updateOptions(t) {
        this.updateScrollbarSize(t.horizontal === 2 ? 0 : t.horizontalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(t.vertical === 2 ? 0 : t.verticalScrollbarSize), this._visibilityController.setVisibility(t.horizontal), this._scrollByPage = t.scrollByPage;
      }
    };
    Ur = class extends Ut {
      constructor(t, e, i) {
        let r = t.getScrollDimensions(), n = t.getCurrentScrollPosition();
        if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.verticalHasArrows ? e.arrowSize : 0, e.vertical === 2 ? 0 : e.verticalScrollbarSize, 0, r.height, r.scrollHeight, n.scrollTop), visibility: e.vertical, extraScrollbarClassName: "vertical", scrollable: t, scrollByPage: e.scrollByPage }), e.verticalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
        this._createSlider(0, Math.floor((e.verticalScrollbarSize - e.verticalSliderSize) / 2), e.verticalSliderSize, void 0);
      }
      _updateSlider(t, e) {
        this.slider.setHeight(t), this.slider.setTop(e);
      }
      _renderDomNode(t, e) {
        this.domNode.setWidth(e), this.domNode.setHeight(t), this.domNode.setRight(0), this.domNode.setTop(0);
      }
      onDidScroll(t) {
        return this._shouldRender = this._onElementScrollSize(t.scrollHeight) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t.scrollTop) || this._shouldRender, this._shouldRender = this._onElementSize(t.height) || this._shouldRender, this._shouldRender;
      }
      _pointerDownRelativePosition(t, e) {
        return e;
      }
      _sliderPointerPosition(t) {
        return t.pageY;
      }
      _sliderOrthogonalPointerPosition(t) {
        return t.pageX;
      }
      _updateScrollbarSize(t) {
        this.slider.setWidth(t);
      }
      writeScrollPosition(t, e) {
        t.scrollTop = e;
      }
      updateOptions(t) {
        this.updateScrollbarSize(t.vertical === 2 ? 0 : t.verticalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(0), this._visibilityController.setVisibility(t.vertical), this._scrollByPage = t.scrollByPage;
      }
    };
    Ma = 500, Ko = 50, zo = true, us = class {
      constructor(t, e, i) {
        this.timestamp = t, this.deltaX = e, this.deltaY = i, this.score = 0;
      }
    }, zr = class zr2 {
      constructor() {
        this._capacity = 5, this._memory = [], this._front = -1, this._rear = -1;
      }
      isPhysicalMouseWheel() {
        if (this._front === -1 && this._rear === -1) return false;
        let t = 1, e = 0, i = 1, r = this._rear;
        do {
          let n = r === this._front ? t : Math.pow(2, -i);
          if (t -= n, e += this._memory[r].score * n, r === this._front) break;
          r = (this._capacity + r - 1) % this._capacity, i++;
        } while (true);
        return e <= 0.5;
      }
      acceptStandardWheelEvent(t) {
        if (Ti) {
          let e = be(t.browserEvent), i = mo(e);
          this.accept(Date.now(), t.deltaX * i, t.deltaY * i);
        } else this.accept(Date.now(), t.deltaX, t.deltaY);
      }
      accept(t, e, i) {
        let r = null, n = new us(t, e, i);
        this._front === -1 && this._rear === -1 ? (this._memory[0] = n, this._front = 0, this._rear = 0) : (r = this._memory[this._rear], this._rear = (this._rear + 1) % this._capacity, this._rear === this._front && (this._front = (this._front + 1) % this._capacity), this._memory[this._rear] = n), n.score = this._computeScore(n, r);
      }
      _computeScore(t, e) {
        if (Math.abs(t.deltaX) > 0 && Math.abs(t.deltaY) > 0) return 1;
        let i = 0.5;
        if ((!this._isAlmostInt(t.deltaX) || !this._isAlmostInt(t.deltaY)) && (i += 0.25), e) {
          let r = Math.abs(t.deltaX), n = Math.abs(t.deltaY), o = Math.abs(e.deltaX), l = Math.abs(e.deltaY), a = Math.max(Math.min(r, o), 1), u = Math.max(Math.min(n, l), 1), h8 = Math.max(r, o), c = Math.max(n, l);
          h8 % a === 0 && c % u === 0 && (i -= 0.5);
        }
        return Math.min(Math.max(i, 0), 1);
      }
      _isAlmostInt(t) {
        return Math.abs(Math.round(t) - t) < 0.01;
      }
    };
    zr.INSTANCE = new zr();
    hs = zr, ds = class extends lt {
      constructor(e, i, r) {
        super();
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this._onWillScroll = this._register(new v());
        this.onWillScroll = this._onWillScroll.event;
        this._options = Pa(i), this._scrollable = r, this._register(this._scrollable.onScroll((o) => {
          this._onWillScroll.fire(o), this._onDidScroll(o), this._onScroll.fire(o);
        }));
        let n = { onMouseWheel: (o) => this._onMouseWheel(o), onDragStart: () => this._onDragStart(), onDragEnd: () => this._onDragEnd() };
        this._verticalScrollbar = this._register(new Ur(this._scrollable, this._options, n)), this._horizontalScrollbar = this._register(new Wr(this._scrollable, this._options, n)), this._domNode = document.createElement("div"), this._domNode.className = "xterm-scrollable-element " + this._options.className, this._domNode.setAttribute("role", "presentation"), this._domNode.style.position = "relative", this._domNode.appendChild(e), this._domNode.appendChild(this._horizontalScrollbar.domNode.domNode), this._domNode.appendChild(this._verticalScrollbar.domNode.domNode), this._options.useShadows ? (this._leftShadowDomNode = _t(document.createElement("div")), this._leftShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._leftShadowDomNode.domNode), this._topShadowDomNode = _t(document.createElement("div")), this._topShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._topShadowDomNode.domNode), this._topLeftShadowDomNode = _t(document.createElement("div")), this._topLeftShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._topLeftShadowDomNode.domNode)) : (this._leftShadowDomNode = null, this._topShadowDomNode = null, this._topLeftShadowDomNode = null), this._listenOnDomNode = this._options.listenOnDomNode || this._domNode, this._mouseWheelToDispose = [], this._setListeningToMouseWheel(this._options.handleMouseWheel), this.onmouseover(this._listenOnDomNode, (o) => this._onMouseOver(o)), this.onmouseleave(this._listenOnDomNode, (o) => this._onMouseLeave(o)), this._hideTimeout = this._register(new Ye()), this._isDragging = false, this._mouseIsOver = false, this._shouldRender = true, this._revealOnScroll = true;
      }
      get options() {
        return this._options;
      }
      dispose() {
        this._mouseWheelToDispose = Ne(this._mouseWheelToDispose), super.dispose();
      }
      getDomNode() {
        return this._domNode;
      }
      getOverviewRulerLayoutInfo() {
        return { parent: this._domNode, insertBefore: this._verticalScrollbar.domNode.domNode };
      }
      delegateVerticalScrollbarPointerDown(e) {
        this._verticalScrollbar.delegatePointerDown(e);
      }
      getScrollDimensions() {
        return this._scrollable.getScrollDimensions();
      }
      setScrollDimensions(e) {
        this._scrollable.setScrollDimensions(e, false);
      }
      updateClassName(e) {
        this._options.className = e, Te && (this._options.className += " mac"), this._domNode.className = "xterm-scrollable-element " + this._options.className;
      }
      updateOptions(e) {
        typeof e.handleMouseWheel < "u" && (this._options.handleMouseWheel = e.handleMouseWheel, this._setListeningToMouseWheel(this._options.handleMouseWheel)), typeof e.mouseWheelScrollSensitivity < "u" && (this._options.mouseWheelScrollSensitivity = e.mouseWheelScrollSensitivity), typeof e.fastScrollSensitivity < "u" && (this._options.fastScrollSensitivity = e.fastScrollSensitivity), typeof e.scrollPredominantAxis < "u" && (this._options.scrollPredominantAxis = e.scrollPredominantAxis), typeof e.horizontal < "u" && (this._options.horizontal = e.horizontal), typeof e.vertical < "u" && (this._options.vertical = e.vertical), typeof e.horizontalScrollbarSize < "u" && (this._options.horizontalScrollbarSize = e.horizontalScrollbarSize), typeof e.verticalScrollbarSize < "u" && (this._options.verticalScrollbarSize = e.verticalScrollbarSize), typeof e.scrollByPage < "u" && (this._options.scrollByPage = e.scrollByPage), this._horizontalScrollbar.updateOptions(this._options), this._verticalScrollbar.updateOptions(this._options), this._options.lazyRender || this._render();
      }
      setRevealOnScroll(e) {
        this._revealOnScroll = e;
      }
      delegateScrollFromMouseWheelEvent(e) {
        this._onMouseWheel(new xi(e));
      }
      _setListeningToMouseWheel(e) {
        if (this._mouseWheelToDispose.length > 0 !== e && (this._mouseWheelToDispose = Ne(this._mouseWheelToDispose), e)) {
          let r = (n) => {
            this._onMouseWheel(new xi(n));
          };
          this._mouseWheelToDispose.push(L(this._listenOnDomNode, Y.MOUSE_WHEEL, r, { passive: false }));
        }
      }
      _onMouseWheel(e) {
        if (e.browserEvent?.defaultPrevented) return;
        let i = hs.INSTANCE;
        zo && i.acceptStandardWheelEvent(e);
        let r = false;
        if (e.deltaY || e.deltaX) {
          let o = e.deltaY * this._options.mouseWheelScrollSensitivity, l = e.deltaX * this._options.mouseWheelScrollSensitivity;
          this._options.scrollPredominantAxis && (this._options.scrollYToX && l + o === 0 ? l = o = 0 : Math.abs(o) >= Math.abs(l) ? l = 0 : o = 0), this._options.flipAxes && ([o, l] = [l, o]);
          let a = !Te && e.browserEvent && e.browserEvent.shiftKey;
          (this._options.scrollYToX || a) && !l && (l = o, o = 0), e.browserEvent && e.browserEvent.altKey && (l = l * this._options.fastScrollSensitivity, o = o * this._options.fastScrollSensitivity);
          let u = this._scrollable.getFutureScrollPosition(), h8 = {};
          if (o) {
            let c = Ko * o, d = u.scrollTop - (c < 0 ? Math.floor(c) : Math.ceil(c));
            this._verticalScrollbar.writeScrollPosition(h8, d);
          }
          if (l) {
            let c = Ko * l, d = u.scrollLeft - (c < 0 ? Math.floor(c) : Math.ceil(c));
            this._horizontalScrollbar.writeScrollPosition(h8, d);
          }
          h8 = this._scrollable.validateScrollPosition(h8), (u.scrollLeft !== h8.scrollLeft || u.scrollTop !== h8.scrollTop) && (zo && this._options.mouseWheelSmoothScroll && i.isPhysicalMouseWheel() ? this._scrollable.setScrollPositionSmooth(h8) : this._scrollable.setScrollPositionNow(h8), r = true);
        }
        let n = r;
        !n && this._options.alwaysConsumeMouseWheel && (n = true), !n && this._options.consumeMouseWheelIfScrollbarIsNeeded && (this._verticalScrollbar.isNeeded() || this._horizontalScrollbar.isNeeded()) && (n = true), n && (e.preventDefault(), e.stopPropagation());
      }
      _onDidScroll(e) {
        this._shouldRender = this._horizontalScrollbar.onDidScroll(e) || this._shouldRender, this._shouldRender = this._verticalScrollbar.onDidScroll(e) || this._shouldRender, this._options.useShadows && (this._shouldRender = true), this._revealOnScroll && this._reveal(), this._options.lazyRender || this._render();
      }
      renderNow() {
        if (!this._options.lazyRender) throw new Error("Please use `lazyRender` together with `renderNow`!");
        this._render();
      }
      _render() {
        if (this._shouldRender && (this._shouldRender = false, this._horizontalScrollbar.render(), this._verticalScrollbar.render(), this._options.useShadows)) {
          let e = this._scrollable.getCurrentScrollPosition(), i = e.scrollTop > 0, r = e.scrollLeft > 0, n = r ? " left" : "", o = i ? " top" : "", l = r || i ? " top-left-corner" : "";
          this._leftShadowDomNode.setClassName(`shadow${n}`), this._topShadowDomNode.setClassName(`shadow${o}`), this._topLeftShadowDomNode.setClassName(`shadow${l}${o}${n}`);
        }
      }
      _onDragStart() {
        this._isDragging = true, this._reveal();
      }
      _onDragEnd() {
        this._isDragging = false, this._hide();
      }
      _onMouseLeave(e) {
        this._mouseIsOver = false, this._hide();
      }
      _onMouseOver(e) {
        this._mouseIsOver = true, this._reveal();
      }
      _reveal() {
        this._verticalScrollbar.beginReveal(), this._horizontalScrollbar.beginReveal(), this._scheduleHide();
      }
      _hide() {
        !this._mouseIsOver && !this._isDragging && (this._verticalScrollbar.beginHide(), this._horizontalScrollbar.beginHide());
      }
      _scheduleHide() {
        !this._mouseIsOver && !this._isDragging && this._hideTimeout.cancelAndSet(() => this._hide(), Ma);
      }
    };
    Kr = class extends ds {
      constructor(t, e, i) {
        super(t, e, i);
      }
      setScrollPosition(t) {
        t.reuseAnimation ? this._scrollable.setScrollPositionSmooth(t, t.reuseAnimation) : this._scrollable.setScrollPositionNow(t);
      }
      getScrollPosition() {
        return this._scrollable.getCurrentScrollPosition();
      }
    };
    zt = class extends D {
      constructor(e, i, r, n, o, l, a, u) {
        super();
        this._bufferService = r;
        this._optionsService = a;
        this._renderService = u;
        this._onRequestScrollLines = this._register(new v());
        this.onRequestScrollLines = this._onRequestScrollLines.event;
        this._isSyncing = false;
        this._isHandlingScroll = false;
        this._suppressOnScrollHandler = false;
        let h8 = this._register(new Ri({ forceIntegerValues: false, smoothScrollDuration: this._optionsService.rawOptions.smoothScrollDuration, scheduleAtNextAnimationFrame: (c) => mt(n.window, c) }));
        this._register(this._optionsService.onSpecificOptionChange("smoothScrollDuration", () => {
          h8.setSmoothScrollDuration(this._optionsService.rawOptions.smoothScrollDuration);
        })), this._scrollableElement = this._register(new Kr(i, { vertical: 1, horizontal: 2, useShadows: false, mouseWheelSmoothScroll: true, ...this._getChangeOptions() }, h8)), this._register(this._optionsService.onMultipleOptionChange(["scrollSensitivity", "fastScrollSensitivity", "overviewRuler"], () => this._scrollableElement.updateOptions(this._getChangeOptions()))), this._register(o.onProtocolChange((c) => {
          this._scrollableElement.updateOptions({ handleMouseWheel: !(c & 16) });
        })), this._scrollableElement.setScrollDimensions({ height: 0, scrollHeight: 0 }), this._register($.runAndSubscribe(l.onChangeColors, () => {
          this._scrollableElement.getDomNode().style.backgroundColor = l.colors.background.css;
        })), e.appendChild(this._scrollableElement.getDomNode()), this._register(C(() => this._scrollableElement.getDomNode().remove())), this._styleElement = n.mainDocument.createElement("style"), i.appendChild(this._styleElement), this._register(C(() => this._styleElement.remove())), this._register($.runAndSubscribe(l.onChangeColors, () => {
          this._styleElement.textContent = [".xterm .xterm-scrollable-element > .scrollbar > .slider {", `  background: ${l.colors.scrollbarSliderBackground.css};`, "}", ".xterm .xterm-scrollable-element > .scrollbar > .slider:hover {", `  background: ${l.colors.scrollbarSliderHoverBackground.css};`, "}", ".xterm .xterm-scrollable-element > .scrollbar > .slider.active {", `  background: ${l.colors.scrollbarSliderActiveBackground.css};`, "}"].join(`
`);
        })), this._register(this._bufferService.onResize(() => this.queueSync())), this._register(this._bufferService.buffers.onBufferActivate(() => {
          this._latestYDisp = void 0, this.queueSync();
        })), this._register(this._bufferService.onScroll(() => this._sync())), this._register(this._scrollableElement.onScroll((c) => this._handleScroll(c)));
      }
      scrollLines(e) {
        let i = this._scrollableElement.getScrollPosition();
        this._scrollableElement.setScrollPosition({ reuseAnimation: true, scrollTop: i.scrollTop + e * this._renderService.dimensions.css.cell.height });
      }
      scrollToLine(e, i) {
        i && (this._latestYDisp = e), this._scrollableElement.setScrollPosition({ reuseAnimation: !i, scrollTop: e * this._renderService.dimensions.css.cell.height });
      }
      _getChangeOptions() {
        return { mouseWheelScrollSensitivity: this._optionsService.rawOptions.scrollSensitivity, fastScrollSensitivity: this._optionsService.rawOptions.fastScrollSensitivity, verticalScrollbarSize: this._optionsService.rawOptions.overviewRuler?.width || 14 };
      }
      queueSync(e) {
        e !== void 0 && (this._latestYDisp = e), this._queuedAnimationFrame === void 0 && (this._queuedAnimationFrame = this._renderService.addRefreshCallback(() => {
          this._queuedAnimationFrame = void 0, this._sync(this._latestYDisp);
        }));
      }
      _sync(e = this._bufferService.buffer.ydisp) {
        !this._renderService || this._isSyncing || (this._isSyncing = true, this._suppressOnScrollHandler = true, this._scrollableElement.setScrollDimensions({ height: this._renderService.dimensions.css.canvas.height, scrollHeight: this._renderService.dimensions.css.cell.height * this._bufferService.buffer.lines.length }), this._suppressOnScrollHandler = false, e !== this._latestYDisp && this._scrollableElement.setScrollPosition({ scrollTop: e * this._renderService.dimensions.css.cell.height }), this._isSyncing = false);
      }
      _handleScroll(e) {
        if (!this._renderService || this._isHandlingScroll || this._suppressOnScrollHandler) return;
        this._isHandlingScroll = true;
        let i = Math.round(e.scrollTop / this._renderService.dimensions.css.cell.height), r = i - this._bufferService.buffer.ydisp;
        r !== 0 && (this._latestYDisp = i, this._onRequestScrollLines.fire(r)), this._isHandlingScroll = false;
      }
    };
    zt = M([S(2, F), S(3, ae), S(4, rr), S(5, Re), S(6, H), S(7, ce)], zt);
    Gt = class extends D {
      constructor(e, i, r, n, o) {
        super();
        this._screenElement = e;
        this._bufferService = i;
        this._coreBrowserService = r;
        this._decorationService = n;
        this._renderService = o;
        this._decorationElements = /* @__PURE__ */ new Map();
        this._altBufferIsActive = false;
        this._dimensionsChanged = false;
        this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this._register(this._renderService.onRenderedViewportChange(() => this._doRefreshDecorations())), this._register(this._renderService.onDimensionsChange(() => {
          this._dimensionsChanged = true, this._queueRefresh();
        })), this._register(this._coreBrowserService.onDprChange(() => this._queueRefresh())), this._register(this._bufferService.buffers.onBufferActivate(() => {
          this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
        })), this._register(this._decorationService.onDecorationRegistered(() => this._queueRefresh())), this._register(this._decorationService.onDecorationRemoved((l) => this._removeDecoration(l))), this._register(C(() => {
          this._container.remove(), this._decorationElements.clear();
        }));
      }
      _queueRefresh() {
        this._animationFrame === void 0 && (this._animationFrame = this._renderService.addRefreshCallback(() => {
          this._doRefreshDecorations(), this._animationFrame = void 0;
        }));
      }
      _doRefreshDecorations() {
        for (let e of this._decorationService.decorations) this._renderDecoration(e);
        this._dimensionsChanged = false;
      }
      _renderDecoration(e) {
        this._refreshStyle(e), this._dimensionsChanged && this._refreshXPosition(e);
      }
      _createElement(e) {
        let i = this._coreBrowserService.mainDocument.createElement("div");
        i.classList.add("xterm-decoration"), i.classList.toggle("xterm-decoration-top-layer", e?.options?.layer === "top"), i.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, i.style.height = `${(e.options.height || 1) * this._renderService.dimensions.css.cell.height}px`, i.style.top = `${(e.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height}px`, i.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
        let r = e.options.x ?? 0;
        return r && r > this._bufferService.cols && (i.style.display = "none"), this._refreshXPosition(e, i), i;
      }
      _refreshStyle(e) {
        let i = e.marker.line - this._bufferService.buffers.active.ydisp;
        if (i < 0 || i >= this._bufferService.rows) e.element && (e.element.style.display = "none", e.onRenderEmitter.fire(e.element));
        else {
          let r = this._decorationElements.get(e);
          r || (r = this._createElement(e), e.element = r, this._decorationElements.set(e, r), this._container.appendChild(r), e.onDispose(() => {
            this._decorationElements.delete(e), r.remove();
          })), r.style.display = this._altBufferIsActive ? "none" : "block", this._altBufferIsActive || (r.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, r.style.height = `${(e.options.height || 1) * this._renderService.dimensions.css.cell.height}px`, r.style.top = `${i * this._renderService.dimensions.css.cell.height}px`, r.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`), e.onRenderEmitter.fire(r);
        }
      }
      _refreshXPosition(e, i = e.element) {
        if (!i) return;
        let r = e.options.x ?? 0;
        (e.options.anchor || "left") === "right" ? i.style.right = r ? `${r * this._renderService.dimensions.css.cell.width}px` : "" : i.style.left = r ? `${r * this._renderService.dimensions.css.cell.width}px` : "";
      }
      _removeDecoration(e) {
        this._decorationElements.get(e)?.remove(), this._decorationElements.delete(e), e.dispose();
      }
    };
    Gt = M([S(1, F), S(2, ae), S(3, Be), S(4, ce)], Gt);
    Gr = class {
      constructor() {
        this._zones = [];
        this._zonePool = [];
        this._zonePoolIndex = 0;
        this._linePadding = { full: 0, left: 0, center: 0, right: 0 };
      }
      get zones() {
        return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
      }
      clear() {
        this._zones.length = 0, this._zonePoolIndex = 0;
      }
      addDecoration(t) {
        if (t.options.overviewRulerOptions) {
          for (let e of this._zones) if (e.color === t.options.overviewRulerOptions.color && e.position === t.options.overviewRulerOptions.position) {
            if (this._lineIntersectsZone(e, t.marker.line)) return;
            if (this._lineAdjacentToZone(e, t.marker.line, t.options.overviewRulerOptions.position)) {
              this._addLineToZone(e, t.marker.line);
              return;
            }
          }
          if (this._zonePoolIndex < this._zonePool.length) {
            this._zonePool[this._zonePoolIndex].color = t.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = t.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = t.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = t.marker.line, this._zones.push(this._zonePool[this._zonePoolIndex++]);
            return;
          }
          this._zones.push({ color: t.options.overviewRulerOptions.color, position: t.options.overviewRulerOptions.position, startBufferLine: t.marker.line, endBufferLine: t.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
        }
      }
      setPadding(t) {
        this._linePadding = t;
      }
      _lineIntersectsZone(t, e) {
        return e >= t.startBufferLine && e <= t.endBufferLine;
      }
      _lineAdjacentToZone(t, e, i) {
        return e >= t.startBufferLine - this._linePadding[i || "full"] && e <= t.endBufferLine + this._linePadding[i || "full"];
      }
      _addLineToZone(t, e) {
        t.startBufferLine = Math.min(t.startBufferLine, e), t.endBufferLine = Math.max(t.endBufferLine, e);
      }
    };
    We = { full: 0, left: 0, center: 0, right: 0 }, at = { full: 0, left: 0, center: 0, right: 0 }, Li = { full: 0, left: 0, center: 0, right: 0 }, bt = class extends D {
      constructor(e, i, r, n, o, l, a, u) {
        super();
        this._viewportElement = e;
        this._screenElement = i;
        this._bufferService = r;
        this._decorationService = n;
        this._renderService = o;
        this._optionsService = l;
        this._themeService = a;
        this._coreBrowserService = u;
        this._colorZoneStore = new Gr();
        this._shouldUpdateDimensions = true;
        this._shouldUpdateAnchor = true;
        this._lastKnownBufferLength = 0;
        this._canvas = this._coreBrowserService.mainDocument.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), this._viewportElement.parentElement?.insertBefore(this._canvas, this._viewportElement), this._register(C(() => this._canvas?.remove()));
        let h8 = this._canvas.getContext("2d");
        if (h8) this._ctx = h8;
        else throw new Error("Ctx cannot be null");
        this._register(this._decorationService.onDecorationRegistered(() => this._queueRefresh(void 0, true))), this._register(this._decorationService.onDecorationRemoved(() => this._queueRefresh(void 0, true))), this._register(this._renderService.onRenderedViewportChange(() => this._queueRefresh())), this._register(this._bufferService.buffers.onBufferActivate(() => {
          this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
        })), this._register(this._bufferService.onScroll(() => {
          this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
        })), this._register(this._renderService.onRender(() => {
          (!this._containerHeight || this._containerHeight !== this._screenElement.clientHeight) && (this._queueRefresh(true), this._containerHeight = this._screenElement.clientHeight);
        })), this._register(this._coreBrowserService.onDprChange(() => this._queueRefresh(true))), this._register(this._optionsService.onSpecificOptionChange("overviewRuler", () => this._queueRefresh(true))), this._register(this._themeService.onChangeColors(() => this._queueRefresh())), this._queueRefresh(true);
      }
      get _width() {
        return this._optionsService.options.overviewRuler?.width || 0;
      }
      _refreshDrawConstants() {
        let e = Math.floor((this._canvas.width - 1) / 3), i = Math.ceil((this._canvas.width - 1) / 3);
        at.full = this._canvas.width, at.left = e, at.center = i, at.right = e, this._refreshDrawHeightConstants(), Li.full = 1, Li.left = 1, Li.center = 1 + at.left, Li.right = 1 + at.left + at.center;
      }
      _refreshDrawHeightConstants() {
        We.full = Math.round(2 * this._coreBrowserService.dpr);
        let e = this._canvas.height / this._bufferService.buffer.lines.length, i = Math.round(Math.max(Math.min(e, 12), 6) * this._coreBrowserService.dpr);
        We.left = i, We.center = i, We.right = i;
      }
      _refreshColorZonePadding() {
        this._colorZoneStore.setPadding({ full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.full), left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.left), center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.center), right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.right) }), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
      }
      _refreshCanvasDimensions() {
        this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowserService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowserService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
      }
      _refreshDecorations() {
        this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
        for (let i of this._decorationService.decorations) this._colorZoneStore.addDecoration(i);
        this._ctx.lineWidth = 1, this._renderRulerOutline();
        let e = this._colorZoneStore.zones;
        for (let i of e) i.position !== "full" && this._renderColorZone(i);
        for (let i of e) i.position === "full" && this._renderColorZone(i);
        this._shouldUpdateDimensions = false, this._shouldUpdateAnchor = false;
      }
      _renderRulerOutline() {
        this._ctx.fillStyle = this._themeService.colors.overviewRulerBorder.css, this._ctx.fillRect(0, 0, 1, this._canvas.height), this._optionsService.rawOptions.overviewRuler.showTopBorder && this._ctx.fillRect(1, 0, this._canvas.width - 1, 1), this._optionsService.rawOptions.overviewRuler.showBottomBorder && this._ctx.fillRect(1, this._canvas.height - 1, this._canvas.width - 1, this._canvas.height);
      }
      _renderColorZone(e) {
        this._ctx.fillStyle = e.color, this._ctx.fillRect(Li[e.position || "full"], Math.round((this._canvas.height - 1) * (e.startBufferLine / this._bufferService.buffers.active.lines.length) - We[e.position || "full"] / 2), at[e.position || "full"], Math.round((this._canvas.height - 1) * ((e.endBufferLine - e.startBufferLine) / this._bufferService.buffers.active.lines.length) + We[e.position || "full"]));
      }
      _queueRefresh(e, i) {
        this._shouldUpdateDimensions = e || this._shouldUpdateDimensions, this._shouldUpdateAnchor = i || this._shouldUpdateAnchor, this._animationFrame === void 0 && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => {
          this._refreshDecorations(), this._animationFrame = void 0;
        }));
      }
    };
    bt = M([S(2, F), S(3, Be), S(4, ce), S(5, H), S(6, Re), S(7, ae)], bt);
    ((E) => (E.NUL = "\0", E.SOH = "", E.STX = "", E.ETX = "", E.EOT = "", E.ENQ = "", E.ACK = "", E.BEL = "\x07", E.BS = "\b", E.HT = "	", E.LF = `
`, E.VT = "\v", E.FF = "\f", E.CR = "\r", E.SO = "", E.SI = "", E.DLE = "", E.DC1 = "", E.DC2 = "", E.DC3 = "", E.DC4 = "", E.NAK = "", E.SYN = "", E.ETB = "", E.CAN = "", E.EM = "", E.SUB = "", E.ESC = "\x1B", E.FS = "", E.GS = "", E.RS = "", E.US = "", E.SP = " ", E.DEL = ""))(b ||= {});
    ((g) => (g.PAD = "", g.HOP = "", g.BPH = "", g.NBH = "", g.IND = "", g.NEL = "", g.SSA = "", g.ESA = "", g.HTS = "", g.HTJ = "", g.VTS = "", g.PLD = "", g.PLU = "", g.RI = "", g.SS2 = "", g.SS3 = "", g.DCS = "", g.PU1 = "", g.PU2 = "", g.STS = "", g.CCH = "", g.MW = "", g.SPA = "", g.EPA = "", g.SOS = "", g.SGCI = "", g.SCI = "", g.CSI = "", g.ST = "", g.OSC = "", g.PM = "", g.APC = ""))(Ai ||= {});
    ((t) => t.ST = `${b.ESC}\\`)(fs ||= {});
    $t = class {
      constructor(t, e, i, r, n, o) {
        this._textarea = t;
        this._compositionView = e;
        this._bufferService = i;
        this._optionsService = r;
        this._coreService = n;
        this._renderService = o;
        this._isComposing = false, this._isSendingComposition = false, this._compositionPosition = { start: 0, end: 0 }, this._dataAlreadySent = "";
      }
      get isComposing() {
        return this._isComposing;
      }
      compositionstart() {
        this._isComposing = true, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
      }
      compositionupdate(t) {
        this._compositionView.textContent = t.data, this.updateCompositionElements(), setTimeout(() => {
          this._compositionPosition.end = this._textarea.value.length;
        }, 0);
      }
      compositionend() {
        this._finalizeComposition(true);
      }
      keydown(t) {
        if (this._isComposing || this._isSendingComposition) {
          if (t.keyCode === 20 || t.keyCode === 229 || t.keyCode === 16 || t.keyCode === 17 || t.keyCode === 18) return false;
          this._finalizeComposition(false);
        }
        return t.keyCode === 229 ? (this._handleAnyTextareaChanges(), false) : true;
      }
      _finalizeComposition(t) {
        if (this._compositionView.classList.remove("active"), this._isComposing = false, t) {
          let e = { start: this._compositionPosition.start, end: this._compositionPosition.end };
          this._isSendingComposition = true, setTimeout(() => {
            if (this._isSendingComposition) {
              this._isSendingComposition = false;
              let i;
              e.start += this._dataAlreadySent.length, this._isComposing ? i = this._textarea.value.substring(e.start, this._compositionPosition.start) : i = this._textarea.value.substring(e.start), i.length > 0 && this._coreService.triggerDataEvent(i, true);
            }
          }, 0);
        } else {
          this._isSendingComposition = false;
          let e = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
          this._coreService.triggerDataEvent(e, true);
        }
      }
      _handleAnyTextareaChanges() {
        let t = this._textarea.value;
        setTimeout(() => {
          if (!this._isComposing) {
            let e = this._textarea.value, i = e.replace(t, "");
            this._dataAlreadySent = i, e.length > t.length ? this._coreService.triggerDataEvent(i, true) : e.length < t.length ? this._coreService.triggerDataEvent(`${b.DEL}`, true) : e.length === t.length && e !== t && this._coreService.triggerDataEvent(e, true);
          }
        }, 0);
      }
      updateCompositionElements(t) {
        if (this._isComposing) {
          if (this._bufferService.buffer.isCursorInViewport) {
            let e = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), i = this._renderService.dimensions.css.cell.height, r = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, n = e * this._renderService.dimensions.css.cell.width;
            this._compositionView.style.left = n + "px", this._compositionView.style.top = r + "px", this._compositionView.style.height = i + "px", this._compositionView.style.lineHeight = i + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
            let o = this._compositionView.getBoundingClientRect();
            this._textarea.style.left = n + "px", this._textarea.style.top = r + "px", this._textarea.style.width = Math.max(o.width, 1) + "px", this._textarea.style.height = Math.max(o.height, 1) + "px", this._textarea.style.lineHeight = o.height + "px";
          }
          t || setTimeout(() => this.updateCompositionElements(true), 0);
        }
      }
    };
    $t = M([S(2, F), S(3, H), S(4, ge), S(5, ce)], $t);
    ue = 0, he = 0, de = 0, J = 0, ps = { css: "#00000000", rgba: 0 };
    ((i) => {
      function s15(r, n, o, l) {
        return l !== void 0 ? `#${vt(r)}${vt(n)}${vt(o)}${vt(l)}` : `#${vt(r)}${vt(n)}${vt(o)}`;
      }
      i.toCss = s15;
      function t(r, n, o, l = 255) {
        return (r << 24 | n << 16 | o << 8 | l) >>> 0;
      }
      i.toRgba = t;
      function e(r, n, o, l) {
        return { css: i.toCss(r, n, o, l), rgba: i.toRgba(r, n, o, l) };
      }
      i.toColor = e;
    })(j ||= {});
    ((l) => {
      function s15(a, u) {
        if (J = (u.rgba & 255) / 255, J === 1) return { css: u.css, rgba: u.rgba };
        let h8 = u.rgba >> 24 & 255, c = u.rgba >> 16 & 255, d = u.rgba >> 8 & 255, _ = a.rgba >> 24 & 255, p = a.rgba >> 16 & 255, m = a.rgba >> 8 & 255;
        ue = _ + Math.round((h8 - _) * J), he = p + Math.round((c - p) * J), de = m + Math.round((d - m) * J);
        let f = j.toCss(ue, he, de), A = j.toRgba(ue, he, de);
        return { css: f, rgba: A };
      }
      l.blend = s15;
      function t(a) {
        return (a.rgba & 255) === 255;
      }
      l.isOpaque = t;
      function e(a, u, h8) {
        let c = $r.ensureContrastRatio(a.rgba, u.rgba, h8);
        if (c) return j.toColor(c >> 24 & 255, c >> 16 & 255, c >> 8 & 255);
      }
      l.ensureContrastRatio = e;
      function i(a) {
        let u = (a.rgba | 255) >>> 0;
        return [ue, he, de] = $r.toChannels(u), { css: j.toCss(ue, he, de), rgba: u };
      }
      l.opaque = i;
      function r(a, u) {
        return J = Math.round(u * 255), [ue, he, de] = $r.toChannels(a.rgba), { css: j.toCss(ue, he, de, J), rgba: j.toRgba(ue, he, de, J) };
      }
      l.opacity = r;
      function n(a, u) {
        return J = a.rgba & 255, r(a, J * u / 255);
      }
      l.multiplyOpacity = n;
      function o(a) {
        return [a.rgba >> 24 & 255, a.rgba >> 16 & 255, a.rgba >> 8 & 255];
      }
      l.toColorRGB = o;
    })(U ||= {});
    ((i) => {
      let s15, t;
      try {
        let r = document.createElement("canvas");
        r.width = 1, r.height = 1;
        let n = r.getContext("2d", { willReadFrequently: true });
        n && (s15 = n, s15.globalCompositeOperation = "copy", t = s15.createLinearGradient(0, 0, 1, 1));
      } catch {
      }
      function e(r) {
        if (r.match(/#[\da-f]{3,8}/i)) switch (r.length) {
          case 4:
            return ue = parseInt(r.slice(1, 2).repeat(2), 16), he = parseInt(r.slice(2, 3).repeat(2), 16), de = parseInt(r.slice(3, 4).repeat(2), 16), j.toColor(ue, he, de);
          case 5:
            return ue = parseInt(r.slice(1, 2).repeat(2), 16), he = parseInt(r.slice(2, 3).repeat(2), 16), de = parseInt(r.slice(3, 4).repeat(2), 16), J = parseInt(r.slice(4, 5).repeat(2), 16), j.toColor(ue, he, de, J);
          case 7:
            return { css: r, rgba: (parseInt(r.slice(1), 16) << 8 | 255) >>> 0 };
          case 9:
            return { css: r, rgba: parseInt(r.slice(1), 16) >>> 0 };
        }
        let n = r.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
        if (n) return ue = parseInt(n[1]), he = parseInt(n[2]), de = parseInt(n[3]), J = Math.round((n[5] === void 0 ? 1 : parseFloat(n[5])) * 255), j.toColor(ue, he, de, J);
        if (!s15 || !t) throw new Error("css.toColor: Unsupported css format");
        if (s15.fillStyle = t, s15.fillStyle = r, typeof s15.fillStyle != "string") throw new Error("css.toColor: Unsupported css format");
        if (s15.fillRect(0, 0, 1, 1), [ue, he, de, J] = s15.getImageData(0, 0, 1, 1).data, J !== 255) throw new Error("css.toColor: Unsupported css format");
        return { rgba: j.toRgba(ue, he, de, J), css: r };
      }
      i.toColor = e;
    })(z ||= {});
    ((e) => {
      function s15(i) {
        return t(i >> 16 & 255, i >> 8 & 255, i & 255);
      }
      e.relativeLuminance = s15;
      function t(i, r, n) {
        let o = i / 255, l = r / 255, a = n / 255, u = o <= 0.03928 ? o / 12.92 : Math.pow((o + 0.055) / 1.055, 2.4), h8 = l <= 0.03928 ? l / 12.92 : Math.pow((l + 0.055) / 1.055, 2.4), c = a <= 0.03928 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
        return u * 0.2126 + h8 * 0.7152 + c * 0.0722;
      }
      e.relativeLuminance2 = t;
    })(ve ||= {});
    ((n) => {
      function s15(o, l) {
        if (J = (l & 255) / 255, J === 1) return l;
        let a = l >> 24 & 255, u = l >> 16 & 255, h8 = l >> 8 & 255, c = o >> 24 & 255, d = o >> 16 & 255, _ = o >> 8 & 255;
        return ue = c + Math.round((a - c) * J), he = d + Math.round((u - d) * J), de = _ + Math.round((h8 - _) * J), j.toRgba(ue, he, de);
      }
      n.blend = s15;
      function t(o, l, a) {
        let u = ve.relativeLuminance(o >> 8), h8 = ve.relativeLuminance(l >> 8);
        if (Xe(u, h8) < a) {
          if (h8 < u) {
            let p = e(o, l, a), m = Xe(u, ve.relativeLuminance(p >> 8));
            if (m < a) {
              let f = i(o, l, a), A = Xe(u, ve.relativeLuminance(f >> 8));
              return m > A ? p : f;
            }
            return p;
          }
          let d = i(o, l, a), _ = Xe(u, ve.relativeLuminance(d >> 8));
          if (_ < a) {
            let p = e(o, l, a), m = Xe(u, ve.relativeLuminance(p >> 8));
            return _ > m ? d : p;
          }
          return d;
        }
      }
      n.ensureContrastRatio = t;
      function e(o, l, a) {
        let u = o >> 24 & 255, h8 = o >> 16 & 255, c = o >> 8 & 255, d = l >> 24 & 255, _ = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        for (; m < a && (d > 0 || _ > 0 || p > 0); ) d -= Math.max(0, Math.ceil(d * 0.1)), _ -= Math.max(0, Math.ceil(_ * 0.1)), p -= Math.max(0, Math.ceil(p * 0.1)), m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        return (d << 24 | _ << 16 | p << 8 | 255) >>> 0;
      }
      n.reduceLuminance = e;
      function i(o, l, a) {
        let u = o >> 24 & 255, h8 = o >> 16 & 255, c = o >> 8 & 255, d = l >> 24 & 255, _ = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        for (; m < a && (d < 255 || _ < 255 || p < 255); ) d = Math.min(255, d + Math.ceil((255 - d) * 0.1)), _ = Math.min(255, _ + Math.ceil((255 - _) * 0.1)), p = Math.min(255, p + Math.ceil((255 - p) * 0.1)), m = Xe(ve.relativeLuminance2(d, _, p), ve.relativeLuminance2(u, h8, c));
        return (d << 24 | _ << 16 | p << 8 | 255) >>> 0;
      }
      n.increaseLuminance = i;
      function r(o) {
        return [o >> 24 & 255, o >> 16 & 255, o >> 8 & 255, o & 255];
      }
      n.toChannels = r;
    })($r ||= {});
    Vr = class extends De {
      constructor(e, i, r) {
        super();
        this.content = 0;
        this.combinedData = "";
        this.fg = e.fg, this.bg = e.bg, this.combinedData = i, this._width = r;
      }
      isCombined() {
        return 2097152;
      }
      getWidth() {
        return this._width;
      }
      getChars() {
        return this.combinedData;
      }
      getCode() {
        return 2097151;
      }
      setFromCharData(e) {
        throw new Error("not implemented");
      }
      getAsCharData() {
        return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
      }
    }, ct = class {
      constructor(t) {
        this._bufferService = t;
        this._characterJoiners = [];
        this._nextCharacterJoinerId = 0;
        this._workCell = new q();
      }
      register(t) {
        let e = { id: this._nextCharacterJoinerId++, handler: t };
        return this._characterJoiners.push(e), e.id;
      }
      deregister(t) {
        for (let e = 0; e < this._characterJoiners.length; e++) if (this._characterJoiners[e].id === t) return this._characterJoiners.splice(e, 1), true;
        return false;
      }
      getJoinedCharacters(t) {
        if (this._characterJoiners.length === 0) return [];
        let e = this._bufferService.buffer.lines.get(t);
        if (!e || e.length === 0) return [];
        let i = [], r = e.translateToString(true), n = 0, o = 0, l = 0, a = e.getFg(0), u = e.getBg(0);
        for (let h8 = 0; h8 < e.getTrimmedLength(); h8++) if (e.loadCell(h8, this._workCell), this._workCell.getWidth() !== 0) {
          if (this._workCell.fg !== a || this._workCell.bg !== u) {
            if (h8 - n > 1) {
              let c = this._getJoinedRanges(r, l, o, e, n);
              for (let d = 0; d < c.length; d++) i.push(c[d]);
            }
            n = h8, l = o, a = this._workCell.fg, u = this._workCell.bg;
          }
          o += this._workCell.getChars().length || we.length;
        }
        if (this._bufferService.cols - n > 1) {
          let h8 = this._getJoinedRanges(r, l, o, e, n);
          for (let c = 0; c < h8.length; c++) i.push(h8[c]);
        }
        return i;
      }
      _getJoinedRanges(t, e, i, r, n) {
        let o = t.substring(e, i), l = [];
        try {
          l = this._characterJoiners[0].handler(o);
        } catch (a) {
          console.error(a);
        }
        for (let a = 1; a < this._characterJoiners.length; a++) try {
          let u = this._characterJoiners[a].handler(o);
          for (let h8 = 0; h8 < u.length; h8++) ct._mergeRanges(l, u[h8]);
        } catch (u) {
          console.error(u);
        }
        return this._stringRangesToCellRanges(l, r, n), l;
      }
      _stringRangesToCellRanges(t, e, i) {
        let r = 0, n = false, o = 0, l = t[r];
        if (l) {
          for (let a = i; a < this._bufferService.cols; a++) {
            let u = e.getWidth(a), h8 = e.getString(a).length || we.length;
            if (u !== 0) {
              if (!n && l[0] <= o && (l[0] = a, n = true), l[1] <= o) {
                if (l[1] = a, l = t[++r], !l) break;
                l[0] <= o ? (l[0] = a, n = true) : n = false;
              }
              o += h8;
            }
          }
          l && (l[1] = this._bufferService.cols);
        }
      }
      static _mergeRanges(t, e) {
        let i = false;
        for (let r = 0; r < t.length; r++) {
          let n = t[r];
          if (i) {
            if (e[1] <= n[0]) return t[r - 1][1] = e[1], t;
            if (e[1] <= n[1]) return t[r - 1][1] = Math.max(e[1], n[1]), t.splice(r, 1), t;
            t.splice(r, 1), r--;
          } else {
            if (e[1] <= n[0]) return t.splice(r, 0, e), t;
            if (e[1] <= n[1]) return n[0] = Math.min(e[0], n[0]), t;
            e[0] < n[1] && (n[0] = Math.min(e[0], n[0]), i = true);
            continue;
          }
        }
        return i ? t[t.length - 1][1] = e[1] : t.push(e), t;
      }
    };
    ct = M([S(0, F)], ct);
    Vt = class {
      constructor(t, e, i, r, n, o, l) {
        this._document = t;
        this._characterJoinerService = e;
        this._optionsService = i;
        this._coreBrowserService = r;
        this._coreService = n;
        this._decorationService = o;
        this._themeService = l;
        this._workCell = new q();
        this._columnSelectMode = false;
        this.defaultSpacing = 0;
      }
      handleSelectionChanged(t, e, i) {
        this._selectionStart = t, this._selectionEnd = e, this._columnSelectMode = i;
      }
      createRow(t, e, i, r, n, o, l, a, u, h8, c) {
        let d = [], _ = this._characterJoinerService.getJoinedCharacters(e), p = this._themeService.colors, m = t.getNoBgTrimmedLength();
        i && m < o + 1 && (m = o + 1);
        let f, A = 0, R = "", O = 0, I = 0, k = 0, P = 0, oe = false, Me = 0, Pe = false, Ke = 0, di = 0, V = [], Qe = h8 !== -1 && c !== -1;
        for (let y = 0; y < m; y++) {
          t.loadCell(y, this._workCell);
          let T = this._workCell.getWidth();
          if (T === 0) continue;
          let g = false, w = y >= di, E = y, x = this._workCell;
          if (_.length > 0 && y === _[0][0] && w) {
            let W = _.shift(), An = this._isCellInSelection(W[0], e);
            for (O = W[0] + 1; O < W[1]; O++) w &&= An === this._isCellInSelection(O, e);
            w &&= !i || o < W[0] || o >= W[1], w ? (g = true, x = new Vr(this._workCell, t.translateToString(true, W[0], W[1]), W[1] - W[0]), E = W[1] - 1, T = x.getWidth()) : di = W[1];
          }
          let N = this._isCellInSelection(y, e), Z = i && y === o, te = Qe && y >= h8 && y <= c, Oe = false;
          this._decorationService.forEachDecorationAtCell(y, e, void 0, (W) => {
            Oe = true;
          });
          let ze = x.getChars() || we;
          if (ze === " " && (x.isUnderline() || x.isOverline()) && (ze = " "), Ke = T * a - u.get(ze, x.isBold(), x.isItalic()), !f) f = this._document.createElement("span");
          else if (A && (N && Pe || !N && !Pe && x.bg === I) && (N && Pe && p.selectionForeground || x.fg === k) && x.extended.ext === P && te === oe && Ke === Me && !Z && !g && !Oe && w) {
            x.isInvisible() ? R += we : R += ze, A++;
            continue;
          } else A && (f.textContent = R), f = this._document.createElement("span"), A = 0, R = "";
          if (I = x.bg, k = x.fg, P = x.extended.ext, oe = te, Me = Ke, Pe = N, g && o >= y && o <= E && (o = y), !this._coreService.isCursorHidden && Z && this._coreService.isCursorInitialized) {
            if (V.push("xterm-cursor"), this._coreBrowserService.isFocused) l && V.push("xterm-cursor-blink"), V.push(r === "bar" ? "xterm-cursor-bar" : r === "underline" ? "xterm-cursor-underline" : "xterm-cursor-block");
            else if (n) switch (n) {
              case "outline":
                V.push("xterm-cursor-outline");
                break;
              case "block":
                V.push("xterm-cursor-block");
                break;
              case "bar":
                V.push("xterm-cursor-bar");
                break;
              case "underline":
                V.push("xterm-cursor-underline");
                break;
              default:
                break;
            }
          }
          if (x.isBold() && V.push("xterm-bold"), x.isItalic() && V.push("xterm-italic"), x.isDim() && V.push("xterm-dim"), x.isInvisible() ? R = we : R = x.getChars() || we, x.isUnderline() && (V.push(`xterm-underline-${x.extended.underlineStyle}`), R === " " && (R = " "), !x.isUnderlineColorDefault())) if (x.isUnderlineColorRGB()) f.style.textDecorationColor = `rgb(${De.toColorRGB(x.getUnderlineColor()).join(",")})`;
          else {
            let W = x.getUnderlineColor();
            this._optionsService.rawOptions.drawBoldTextInBrightColors && x.isBold() && W < 8 && (W += 8), f.style.textDecorationColor = p.ansi[W].css;
          }
          x.isOverline() && (V.push("xterm-overline"), R === " " && (R = " ")), x.isStrikethrough() && V.push("xterm-strikethrough"), te && (f.style.textDecoration = "underline");
          let le = x.getFgColor(), et = x.getFgColorMode(), me = x.getBgColor(), ht = x.getBgColorMode(), fi = !!x.isInverse();
          if (fi) {
            let W = le;
            le = me, me = W;
            let An = et;
            et = ht, ht = An;
          }
          let tt, Qi, pi = false;
          this._decorationService.forEachDecorationAtCell(y, e, void 0, (W) => {
            W.options.layer !== "top" && pi || (W.backgroundColorRGB && (ht = 50331648, me = W.backgroundColorRGB.rgba >> 8 & 16777215, tt = W.backgroundColorRGB), W.foregroundColorRGB && (et = 50331648, le = W.foregroundColorRGB.rgba >> 8 & 16777215, Qi = W.foregroundColorRGB), pi = W.options.layer === "top");
          }), !pi && N && (tt = this._coreBrowserService.isFocused ? p.selectionBackgroundOpaque : p.selectionInactiveBackgroundOpaque, me = tt.rgba >> 8 & 16777215, ht = 50331648, pi = true, p.selectionForeground && (et = 50331648, le = p.selectionForeground.rgba >> 8 & 16777215, Qi = p.selectionForeground)), pi && V.push("xterm-decoration-top");
          let it;
          switch (ht) {
            case 16777216:
            case 33554432:
              it = p.ansi[me], V.push(`xterm-bg-${me}`);
              break;
            case 50331648:
              it = j.toColor(me >> 16, me >> 8 & 255, me & 255), this._addStyle(f, `background-color:#${qo((me >>> 0).toString(16), "0", 6)}`);
              break;
            case 0:
            default:
              fi ? (it = p.foreground, V.push(`xterm-bg-${257}`)) : it = p.background;
          }
          switch (tt || x.isDim() && (tt = U.multiplyOpacity(it, 0.5)), et) {
            case 16777216:
            case 33554432:
              x.isBold() && le < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && (le += 8), this._applyMinimumContrast(f, it, p.ansi[le], x, tt, void 0) || V.push(`xterm-fg-${le}`);
              break;
            case 50331648:
              let W = j.toColor(le >> 16 & 255, le >> 8 & 255, le & 255);
              this._applyMinimumContrast(f, it, W, x, tt, Qi) || this._addStyle(f, `color:#${qo(le.toString(16), "0", 6)}`);
              break;
            case 0:
            default:
              this._applyMinimumContrast(f, it, p.foreground, x, tt, Qi) || fi && V.push(`xterm-fg-${257}`);
          }
          V.length && (f.className = V.join(" "), V.length = 0), !Z && !g && !Oe && w ? A++ : f.textContent = R, Ke !== this.defaultSpacing && (f.style.letterSpacing = `${Ke}px`), d.push(f), y = E;
        }
        return f && A && (f.textContent = R), d;
      }
      _applyMinimumContrast(t, e, i, r, n, o) {
        if (this._optionsService.rawOptions.minimumContrastRatio === 1 || $o(r.getCode())) return false;
        let l = this._getContrastCache(r), a;
        if (!n && !o && (a = l.getColor(e.rgba, i.rgba)), a === void 0) {
          let u = this._optionsService.rawOptions.minimumContrastRatio / (r.isDim() ? 2 : 1);
          a = U.ensureContrastRatio(n || e, o || i, u), l.setColor((n || e).rgba, (o || i).rgba, a ?? null);
        }
        return a ? (this._addStyle(t, `color:${a.css}`), true) : false;
      }
      _getContrastCache(t) {
        return t.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
      }
      _addStyle(t, e) {
        t.setAttribute("style", `${t.getAttribute("style") || ""}${e};`);
      }
      _isCellInSelection(t, e) {
        let i = this._selectionStart, r = this._selectionEnd;
        return !i || !r ? false : this._columnSelectMode ? i[0] <= r[0] ? t >= i[0] && e >= i[1] && t < r[0] && e <= r[1] : t < i[0] && e >= i[1] && t >= r[0] && e <= r[1] : e > i[1] && e < r[1] || i[1] === r[1] && e === i[1] && t >= i[0] && t < r[0] || i[1] < r[1] && e === r[1] && t < r[0] || i[1] < r[1] && e === i[1] && t >= i[0];
      }
    };
    Vt = M([S(1, or), S(2, H), S(3, ae), S(4, ge), S(5, Be), S(6, Re)], Vt);
    Yr = class {
      constructor(t, e) {
        this._flat = new Float32Array(256);
        this._font = "";
        this._fontSize = 0;
        this._weight = "normal";
        this._weightBold = "bold";
        this._measureElements = [];
        this._container = t.createElement("div"), this._container.classList.add("xterm-width-cache-measure-container"), this._container.setAttribute("aria-hidden", "true"), this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
        let i = t.createElement("span");
        i.classList.add("xterm-char-measure-element");
        let r = t.createElement("span");
        r.classList.add("xterm-char-measure-element"), r.style.fontWeight = "bold";
        let n = t.createElement("span");
        n.classList.add("xterm-char-measure-element"), n.style.fontStyle = "italic";
        let o = t.createElement("span");
        o.classList.add("xterm-char-measure-element"), o.style.fontWeight = "bold", o.style.fontStyle = "italic", this._measureElements = [i, r, n, o], this._container.appendChild(i), this._container.appendChild(r), this._container.appendChild(n), this._container.appendChild(o), e.appendChild(this._container), this.clear();
      }
      dispose() {
        this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
      }
      clear() {
        this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
      }
      setFont(t, e, i, r) {
        t === this._font && e === this._fontSize && i === this._weight && r === this._weightBold || (this._font = t, this._fontSize = e, this._weight = i, this._weightBold = r, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i}`, this._measureElements[1].style.fontWeight = `${r}`, this._measureElements[2].style.fontWeight = `${i}`, this._measureElements[3].style.fontWeight = `${r}`, this.clear());
      }
      get(t, e, i) {
        let r = 0;
        if (!e && !i && t.length === 1 && (r = t.charCodeAt(0)) < 256) {
          if (this._flat[r] !== -9999) return this._flat[r];
          let l = this._measure(t, 0);
          return l > 0 && (this._flat[r] = l), l;
        }
        let n = t;
        e && (n += "B"), i && (n += "I");
        let o = this._holey.get(n);
        if (o === void 0) {
          let l = 0;
          e && (l |= 1), i && (l |= 2), o = this._measure(t, l), o > 0 && this._holey.set(n, o);
        }
        return o;
      }
      _measure(t, e) {
        let i = this._measureElements[e];
        return i.textContent = t.repeat(32), i.offsetWidth / 32;
      }
    };
    ms = class {
      constructor() {
        this.clear();
      }
      clear() {
        this.hasSelection = false, this.columnSelectMode = false, this.viewportStartRow = 0, this.viewportEndRow = 0, this.viewportCappedStartRow = 0, this.viewportCappedEndRow = 0, this.startCol = 0, this.endCol = 0, this.selectionStart = void 0, this.selectionEnd = void 0;
      }
      update(t, e, i, r = false) {
        if (this.selectionStart = e, this.selectionEnd = i, !e || !i || e[0] === i[0] && e[1] === i[1]) {
          this.clear();
          return;
        }
        let n = t.buffers.active.ydisp, o = e[1] - n, l = i[1] - n, a = Math.max(o, 0), u = Math.min(l, t.rows - 1);
        if (a >= t.rows || u < 0) {
          this.clear();
          return;
        }
        this.hasSelection = true, this.columnSelectMode = r, this.viewportStartRow = o, this.viewportEndRow = l, this.viewportCappedStartRow = a, this.viewportCappedEndRow = u, this.startCol = e[0], this.endCol = i[0];
      }
      isCellSelected(t, e, i) {
        return this.hasSelection ? (i -= t.buffer.active.viewportY, this.columnSelectMode ? this.startCol <= this.endCol ? e >= this.startCol && i >= this.viewportCappedStartRow && e < this.endCol && i <= this.viewportCappedEndRow : e < this.startCol && i >= this.viewportCappedStartRow && e >= this.endCol && i <= this.viewportCappedEndRow : i > this.viewportStartRow && i < this.viewportEndRow || this.viewportStartRow === this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportEndRow && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol) : false;
      }
    };
    _s = "xterm-dom-renderer-owner-", Le = "xterm-rows", jr = "xterm-fg-", jo = "xterm-bg-", ki = "xterm-focus", Xr = "xterm-selection", Na = 1, Yt = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8, c, d, _, p, m) {
        super();
        this._terminal = e;
        this._document = i;
        this._element = r;
        this._screenElement = n;
        this._viewportElement = o;
        this._helperContainer = l;
        this._linkifier2 = a;
        this._charSizeService = h8;
        this._optionsService = c;
        this._bufferService = d;
        this._coreService = _;
        this._coreBrowserService = p;
        this._themeService = m;
        this._terminalClass = Na++;
        this._rowElements = [];
        this._selectionRenderModel = Yo();
        this.onRequestRedraw = this._register(new v()).event;
        this._rowContainer = this._document.createElement("div"), this._rowContainer.classList.add(Le), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = this._document.createElement("div"), this._selectionContainer.classList.add(Xr), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = Vo(), this._updateDimensions(), this._register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this._register(this._themeService.onChangeColors((f) => this._injectCss(f))), this._injectCss(this._themeService.colors), this._rowFactory = u.createInstance(Vt, document), this._element.classList.add(_s + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this._register(this._linkifier2.onShowLinkUnderline((f) => this._handleLinkHover(f))), this._register(this._linkifier2.onHideLinkUnderline((f) => this._handleLinkLeave(f))), this._register(C(() => {
          this._element.classList.remove(_s + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
        })), this._widthCache = new Yr(this._document, this._helperContainer), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
      }
      _updateDimensions() {
        let e = this._coreBrowserService.dpr;
        this.dimensions.device.char.width = this._charSizeService.width * e, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
        for (let r of this._rowElements) r.style.width = `${this.dimensions.css.canvas.width}px`, r.style.height = `${this.dimensions.css.cell.height}px`, r.style.lineHeight = `${this.dimensions.css.cell.height}px`, r.style.overflow = "hidden";
        this._dimensionsStyleElement || (this._dimensionsStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
        let i = `${this._terminalSelector} .${Le} span { display: inline-block; height: 100%; vertical-align: top;}`;
        this._dimensionsStyleElement.textContent = i, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
      }
      _injectCss(e) {
        this._themeStyleElement || (this._themeStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
        let i = `${this._terminalSelector} .${Le} { pointer-events: none; color: ${e.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
        i += `${this._terminalSelector} .${Le} .xterm-dim { color: ${U.multiplyOpacity(e.foreground, 0.5).css};}`, i += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`;
        let r = `blink_underline_${this._terminalClass}`, n = `blink_bar_${this._terminalClass}`, o = `blink_block_${this._terminalClass}`;
        i += `@keyframes ${r} { 50% {  border-bottom-style: hidden; }}`, i += `@keyframes ${n} { 50% {  box-shadow: none; }}`, i += `@keyframes ${o} { 0% {  background-color: ${e.cursor.css};  color: ${e.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e.cursor.css}; }}`, i += `${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-underline { animation: ${r} 1s step-end infinite;}${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-bar { animation: ${n} 1s step-end infinite;}${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: ${o} 1s step-end infinite;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-block { background-color: ${e.cursor.css}; color: ${e.cursorAccent.css};}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: ${e.cursor.css} !important; color: ${e.cursorAccent.css} !important;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e.cursor.css} inset;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, i += `${this._terminalSelector} .${Xr} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${Xr} div { position: absolute; background-color: ${e.selectionBackgroundOpaque.css};}${this._terminalSelector} .${Xr} div { position: absolute; background-color: ${e.selectionInactiveBackgroundOpaque.css};}`;
        for (let [l, a] of e.ansi.entries()) i += `${this._terminalSelector} .${jr}${l} { color: ${a.css}; }${this._terminalSelector} .${jr}${l}.xterm-dim { color: ${U.multiplyOpacity(a, 0.5).css}; }${this._terminalSelector} .${jo}${l} { background-color: ${a.css}; }`;
        i += `${this._terminalSelector} .${jr}${257} { color: ${U.opaque(e.background).css}; }${this._terminalSelector} .${jr}${257}.xterm-dim { color: ${U.multiplyOpacity(U.opaque(e.background), 0.5).css}; }${this._terminalSelector} .${jo}${257} { background-color: ${e.foreground.css}; }`, this._themeStyleElement.textContent = i;
      }
      _setDefaultSpacing() {
        let e = this.dimensions.css.cell.width - this._widthCache.get("W", false, false);
        this._rowContainer.style.letterSpacing = `${e}px`, this._rowFactory.defaultSpacing = e;
      }
      handleDevicePixelRatioChange() {
        this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
      }
      _refreshRowElements(e, i) {
        for (let r = this._rowElements.length; r <= i; r++) {
          let n = this._document.createElement("div");
          this._rowContainer.appendChild(n), this._rowElements.push(n);
        }
        for (; this._rowElements.length > i; ) this._rowContainer.removeChild(this._rowElements.pop());
      }
      handleResize(e, i) {
        this._refreshRowElements(e, i), this._updateDimensions(), this.handleSelectionChanged(this._selectionRenderModel.selectionStart, this._selectionRenderModel.selectionEnd, this._selectionRenderModel.columnSelectMode);
      }
      handleCharSizeChanged() {
        this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
      }
      handleBlur() {
        this._rowContainer.classList.remove(ki), this.renderRows(0, this._bufferService.rows - 1);
      }
      handleFocus() {
        this._rowContainer.classList.add(ki), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
      }
      handleSelectionChanged(e, i, r) {
        if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e, i, r), this.renderRows(0, this._bufferService.rows - 1), !e || !i || (this._selectionRenderModel.update(this._terminal, e, i, r), !this._selectionRenderModel.hasSelection)) return;
        let n = this._selectionRenderModel.viewportStartRow, o = this._selectionRenderModel.viewportEndRow, l = this._selectionRenderModel.viewportCappedStartRow, a = this._selectionRenderModel.viewportCappedEndRow, u = this._document.createDocumentFragment();
        if (r) {
          let h8 = e[0] > i[0];
          u.appendChild(this._createSelectionElement(l, h8 ? i[0] : e[0], h8 ? e[0] : i[0], a - l + 1));
        } else {
          let h8 = n === l ? e[0] : 0, c = l === o ? i[0] : this._bufferService.cols;
          u.appendChild(this._createSelectionElement(l, h8, c));
          let d = a - l - 1;
          if (u.appendChild(this._createSelectionElement(l + 1, 0, this._bufferService.cols, d)), l !== a) {
            let _ = o === a ? i[0] : this._bufferService.cols;
            u.appendChild(this._createSelectionElement(a, 0, _));
          }
        }
        this._selectionContainer.appendChild(u);
      }
      _createSelectionElement(e, i, r, n = 1) {
        let o = this._document.createElement("div"), l = i * this.dimensions.css.cell.width, a = this.dimensions.css.cell.width * (r - i);
        return l + a > this.dimensions.css.canvas.width && (a = this.dimensions.css.canvas.width - l), o.style.height = `${n * this.dimensions.css.cell.height}px`, o.style.top = `${e * this.dimensions.css.cell.height}px`, o.style.left = `${l}px`, o.style.width = `${a}px`, o;
      }
      handleCursorMove() {
      }
      _handleOptionsChanged() {
        this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
      }
      clear() {
        for (let e of this._rowElements) e.replaceChildren();
      }
      renderRows(e, i) {
        let r = this._bufferService.buffer, n = r.ybase + r.y, o = Math.min(r.x, this._bufferService.cols - 1), l = this._coreService.decPrivateModes.cursorBlink ?? this._optionsService.rawOptions.cursorBlink, a = this._coreService.decPrivateModes.cursorStyle ?? this._optionsService.rawOptions.cursorStyle, u = this._optionsService.rawOptions.cursorInactiveStyle;
        for (let h8 = e; h8 <= i; h8++) {
          let c = h8 + r.ydisp, d = this._rowElements[h8], _ = r.lines.get(c);
          if (!d || !_) break;
          d.replaceChildren(...this._rowFactory.createRow(_, c, c === n, a, u, o, l, this.dimensions.css.cell.width, this._widthCache, -1, -1));
        }
      }
      get _terminalSelector() {
        return `.${_s}${this._terminalClass}`;
      }
      _handleLinkHover(e) {
        this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, true);
      }
      _handleLinkLeave(e) {
        this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, false);
      }
      _setCellUnderline(e, i, r, n, o, l) {
        r < 0 && (e = 0), n < 0 && (i = 0);
        let a = this._bufferService.rows - 1;
        r = Math.max(Math.min(r, a), 0), n = Math.max(Math.min(n, a), 0), o = Math.min(o, this._bufferService.cols);
        let u = this._bufferService.buffer, h8 = u.ybase + u.y, c = Math.min(u.x, o - 1), d = this._optionsService.rawOptions.cursorBlink, _ = this._optionsService.rawOptions.cursorStyle, p = this._optionsService.rawOptions.cursorInactiveStyle;
        for (let m = r; m <= n; ++m) {
          let f = m + u.ydisp, A = this._rowElements[m], R = u.lines.get(f);
          if (!A || !R) break;
          A.replaceChildren(...this._rowFactory.createRow(R, f, f === h8, _, p, c, d, this.dimensions.css.cell.width, this._widthCache, l ? m === r ? e : 0 : -1, l ? (m === n ? i : o) - 1 : -1));
        }
      }
    };
    Yt = M([S(7, xt), S(8, nt), S(9, H), S(10, F), S(11, ge), S(12, ae), S(13, Re)], Yt);
    jt = class extends D {
      constructor(e, i, r) {
        super();
        this._optionsService = r;
        this.width = 0;
        this.height = 0;
        this._onCharSizeChange = this._register(new v());
        this.onCharSizeChange = this._onCharSizeChange.event;
        try {
          this._measureStrategy = this._register(new vs(this._optionsService));
        } catch {
          this._measureStrategy = this._register(new bs(e, i, this._optionsService));
        }
        this._register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], () => this.measure()));
      }
      get hasValidSize() {
        return this.width > 0 && this.height > 0;
      }
      measure() {
        let e = this._measureStrategy.measure();
        (e.width !== this.width || e.height !== this.height) && (this.width = e.width, this.height = e.height, this._onCharSizeChange.fire());
      }
    };
    jt = M([S(2, H)], jt);
    Zr = class extends D {
      constructor() {
        super(...arguments);
        this._result = { width: 0, height: 0 };
      }
      _validateAndSet(e, i) {
        e !== void 0 && e > 0 && i !== void 0 && i > 0 && (this._result.width = e, this._result.height = i);
      }
    }, bs = class extends Zr {
      constructor(e, i, r) {
        super();
        this._document = e;
        this._parentElement = i;
        this._optionsService = r;
        this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
      }
      measure() {
        return this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`, this._validateAndSet(Number(this._measureElement.offsetWidth) / 32, Number(this._measureElement.offsetHeight)), this._result;
      }
    }, vs = class extends Zr {
      constructor(e) {
        super();
        this._optionsService = e;
        this._canvas = new OffscreenCanvas(100, 100), this._ctx = this._canvas.getContext("2d");
        let i = this._ctx.measureText("W");
        if (!("width" in i && "fontBoundingBoxAscent" in i && "fontBoundingBoxDescent" in i)) throw new Error("Required font metrics not supported");
      }
      measure() {
        this._ctx.font = `${this._optionsService.rawOptions.fontSize}px ${this._optionsService.rawOptions.fontFamily}`;
        let e = this._ctx.measureText("W");
        return this._validateAndSet(e.width, e.fontBoundingBoxAscent + e.fontBoundingBoxDescent), this._result;
      }
    };
    Jr = class extends D {
      constructor(e, i, r) {
        super();
        this._textarea = e;
        this._window = i;
        this.mainDocument = r;
        this._isFocused = false;
        this._cachedIsFocused = void 0;
        this._screenDprMonitor = this._register(new gs(this._window));
        this._onDprChange = this._register(new v());
        this.onDprChange = this._onDprChange.event;
        this._onWindowChange = this._register(new v());
        this.onWindowChange = this._onWindowChange.event;
        this._register(this.onWindowChange((n) => this._screenDprMonitor.setWindow(n))), this._register($.forward(this._screenDprMonitor.onDprChange, this._onDprChange)), this._register(L(this._textarea, "focus", () => this._isFocused = true)), this._register(L(this._textarea, "blur", () => this._isFocused = false));
      }
      get window() {
        return this._window;
      }
      set window(e) {
        this._window !== e && (this._window = e, this._onWindowChange.fire(this._window));
      }
      get dpr() {
        return this.window.devicePixelRatio;
      }
      get isFocused() {
        return this._cachedIsFocused === void 0 && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask(() => this._cachedIsFocused = void 0)), this._cachedIsFocused;
      }
    }, gs = class extends D {
      constructor(e) {
        super();
        this._parentWindow = e;
        this._windowResizeListener = this._register(new ye());
        this._onDprChange = this._register(new v());
        this.onDprChange = this._onDprChange.event;
        this._outerListener = () => this._setDprAndFireIfDiffers(), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._updateDpr(), this._setWindowResizeListener(), this._register(C(() => this.clearListener()));
      }
      setWindow(e) {
        this._parentWindow = e, this._setWindowResizeListener(), this._setDprAndFireIfDiffers();
      }
      _setWindowResizeListener() {
        this._windowResizeListener.value = L(this._parentWindow, "resize", () => this._setDprAndFireIfDiffers());
      }
      _setDprAndFireIfDiffers() {
        this._parentWindow.devicePixelRatio !== this._currentDevicePixelRatio && this._onDprChange.fire(this._parentWindow.devicePixelRatio), this._updateDpr();
      }
      _updateDpr() {
        this._outerListener && (this._resolutionMediaMatchList?.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
      }
      clearListener() {
        !this._resolutionMediaMatchList || !this._outerListener || (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._outerListener = void 0);
      }
    };
    Qr = class extends D {
      constructor() {
        super();
        this.linkProviders = [];
        this._register(C(() => this.linkProviders.length = 0));
      }
      registerLinkProvider(e) {
        return this.linkProviders.push(e), { dispose: () => {
          let i = this.linkProviders.indexOf(e);
          i !== -1 && this.linkProviders.splice(i, 1);
        } };
      }
    };
    Xt = class {
      constructor(t, e) {
        this._renderService = t;
        this._charSizeService = e;
      }
      getCoords(t, e, i, r, n) {
        return Xo(window, t, e, i, r, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, n);
      }
      getMouseReportCoords(t, e) {
        let i = Ci(window, t, e);
        if (this._charSizeService.hasValidSize) return i[0] = Math.min(Math.max(i[0], 0), this._renderService.dimensions.css.canvas.width - 1), i[1] = Math.min(Math.max(i[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i[0]), y: Math.floor(i[1]) };
      }
    };
    Xt = M([S(0, ce), S(1, nt)], Xt);
    en = class {
      constructor(t, e) {
        this._renderCallback = t;
        this._coreBrowserService = e;
        this._refreshCallbacks = [];
      }
      dispose() {
        this._animationFrame && (this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
      }
      addRefreshCallback(t) {
        return this._refreshCallbacks.push(t), this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh())), this._animationFrame;
      }
      refresh(t, e, i) {
        this._rowCount = i, t = t !== void 0 ? t : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t) : t, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e, !this._animationFrame && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
      }
      _innerRefresh() {
        if (this._animationFrame = void 0, this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) {
          this._runRefreshCallbacks();
          return;
        }
        let t = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
        this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t, e), this._runRefreshCallbacks();
      }
      _runRefreshCallbacks() {
        for (let t of this._refreshCallbacks) t(0);
        this._refreshCallbacks = [];
      }
    };
    tn = {};
    Ll(tn, { getSafariVersion: () => Ha, isChromeOS: () => Ts, isFirefox: () => Ss, isIpad: () => Wa, isIphone: () => Ua, isLegacyEdge: () => Fa, isLinux: () => Bi, isMac: () => Zt, isNode: () => Mi, isSafari: () => Zo, isWindows: () => Es });
    Mi = typeof process < "u" && "title" in process, Pi = Mi ? "node" : navigator.userAgent, Oi = Mi ? "node" : navigator.platform, Ss = Pi.includes("Firefox"), Fa = Pi.includes("Edge"), Zo = /^((?!chrome|android).)*safari/i.test(Pi);
    Zt = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(Oi), Wa = Oi === "iPad", Ua = Oi === "iPhone", Es = ["Windows", "Win16", "Win32", "WinCE"].includes(Oi), Bi = Oi.indexOf("Linux") >= 0, Ts = /\bCrOS\b/.test(Pi);
    rn = class {
      constructor() {
        this._tasks = [];
        this._i = 0;
      }
      enqueue(t) {
        this._tasks.push(t), this._start();
      }
      flush() {
        for (; this._i < this._tasks.length; ) this._tasks[this._i]() || this._i++;
        this.clear();
      }
      clear() {
        this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
      }
      _start() {
        this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
      }
      _process(t) {
        this._idleCallback = void 0;
        let e = 0, i = 0, r = t.timeRemaining(), n = 0;
        for (; this._i < this._tasks.length; ) {
          if (e = performance.now(), this._tasks[this._i]() || this._i++, e = Math.max(1, performance.now() - e), i = Math.max(e, i), n = t.timeRemaining(), i * 1.5 > n) {
            r - e < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(r - e))}ms`), this._start();
            return;
          }
          r = n;
        }
        this.clear();
      }
    }, Is = class extends rn {
      _requestCallback(t) {
        return setTimeout(() => t(this._createDeadline(16)));
      }
      _cancelCallback(t) {
        clearTimeout(t);
      }
      _createDeadline(t) {
        let e = performance.now() + t;
        return { timeRemaining: () => Math.max(0, e - performance.now()) };
      }
    }, ys = class extends rn {
      _requestCallback(t) {
        return requestIdleCallback(t);
      }
      _cancelCallback(t) {
        cancelIdleCallback(t);
      }
    }, Jt = !Mi && "requestIdleCallback" in window ? ys : Is, nn = class {
      constructor() {
        this._queue = new Jt();
      }
      set(t) {
        this._queue.clear(), this._queue.enqueue(t);
      }
      flush() {
        this._queue.flush();
      }
    };
    Qt = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8) {
        super();
        this._rowCount = e;
        this._optionsService = r;
        this._charSizeService = n;
        this._coreService = o;
        this._coreBrowserService = u;
        this._renderer = this._register(new ye());
        this._pausedResizeTask = new nn();
        this._observerDisposable = this._register(new ye());
        this._isPaused = false;
        this._needsFullRefresh = false;
        this._isNextRenderRedrawOnly = true;
        this._needsSelectionRefresh = false;
        this._canvasWidth = 0;
        this._canvasHeight = 0;
        this._selectionState = { start: void 0, end: void 0, columnSelectMode: false };
        this._onDimensionsChange = this._register(new v());
        this.onDimensionsChange = this._onDimensionsChange.event;
        this._onRenderedViewportChange = this._register(new v());
        this.onRenderedViewportChange = this._onRenderedViewportChange.event;
        this._onRender = this._register(new v());
        this.onRender = this._onRender.event;
        this._onRefreshRequest = this._register(new v());
        this.onRefreshRequest = this._onRefreshRequest.event;
        this._renderDebouncer = new en((c, d) => this._renderRows(c, d), this._coreBrowserService), this._register(this._renderDebouncer), this._syncOutputHandler = new xs(this._coreBrowserService, this._coreService, () => this._fullRefresh()), this._register(C(() => this._syncOutputHandler.dispose())), this._register(this._coreBrowserService.onDprChange(() => this.handleDevicePixelRatioChange())), this._register(a.onResize(() => this._fullRefresh())), this._register(a.buffers.onBufferActivate(() => this._renderer.value?.clear())), this._register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this._register(this._charSizeService.onCharSizeChange(() => this.handleCharSizeChanged())), this._register(l.onDecorationRegistered(() => this._fullRefresh())), this._register(l.onDecorationRemoved(() => this._fullRefresh())), this._register(this._optionsService.onMultipleOptionChange(["customGlyphs", "drawBoldTextInBrightColors", "letterSpacing", "lineHeight", "fontFamily", "fontSize", "fontWeight", "fontWeightBold", "minimumContrastRatio", "rescaleOverlappingGlyphs"], () => {
          this.clear(), this.handleResize(a.cols, a.rows), this._fullRefresh();
        })), this._register(this._optionsService.onMultipleOptionChange(["cursorBlink", "cursorStyle"], () => this.refreshRows(a.buffer.y, a.buffer.y, true))), this._register(h8.onChangeColors(() => this._fullRefresh())), this._registerIntersectionObserver(this._coreBrowserService.window, i), this._register(this._coreBrowserService.onWindowChange((c) => this._registerIntersectionObserver(c, i)));
      }
      get dimensions() {
        return this._renderer.value.dimensions;
      }
      _registerIntersectionObserver(e, i) {
        if ("IntersectionObserver" in e) {
          let r = new e.IntersectionObserver((n) => this._handleIntersectionChange(n[n.length - 1]), { threshold: 0 });
          r.observe(i), this._observerDisposable.value = C(() => r.disconnect());
        }
      }
      _handleIntersectionChange(e) {
        this._isPaused = e.isIntersecting === void 0 ? e.intersectionRatio === 0 : !e.isIntersecting, !this._isPaused && !this._charSizeService.hasValidSize && this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = false);
      }
      refreshRows(e, i, r = false) {
        if (this._isPaused) {
          this._needsFullRefresh = true;
          return;
        }
        if (this._coreService.decPrivateModes.synchronizedOutput) {
          this._syncOutputHandler.bufferRows(e, i);
          return;
        }
        let n = this._syncOutputHandler.flush();
        n && (e = Math.min(e, n.start), i = Math.max(i, n.end)), r || (this._isNextRenderRedrawOnly = false), this._renderDebouncer.refresh(e, i, this._rowCount);
      }
      _renderRows(e, i) {
        if (this._renderer.value) {
          if (this._coreService.decPrivateModes.synchronizedOutput) {
            this._syncOutputHandler.bufferRows(e, i);
            return;
          }
          e = Math.min(e, this._rowCount - 1), i = Math.min(i, this._rowCount - 1), this._renderer.value.renderRows(e, i), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = false), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({ start: e, end: i }), this._onRender.fire({ start: e, end: i }), this._isNextRenderRedrawOnly = true;
        }
      }
      resize(e, i) {
        this._rowCount = i, this._fireOnCanvasResize();
      }
      _handleOptionsChanged() {
        this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
      }
      _fireOnCanvasResize() {
        this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
      }
      hasRenderer() {
        return !!this._renderer.value;
      }
      setRenderer(e) {
        this._renderer.value = e, this._renderer.value && (this._renderer.value.onRequestRedraw((i) => this.refreshRows(i.start, i.end, true)), this._needsSelectionRefresh = true, this._fullRefresh());
      }
      addRefreshCallback(e) {
        return this._renderDebouncer.addRefreshCallback(e);
      }
      _fullRefresh() {
        this._isPaused ? this._needsFullRefresh = true : this.refreshRows(0, this._rowCount - 1);
      }
      clearTextureAtlas() {
        this._renderer.value && (this._renderer.value.clearTextureAtlas?.(), this._fullRefresh());
      }
      handleDevicePixelRatioChange() {
        this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
      }
      handleResize(e, i) {
        this._renderer.value && (this._isPaused ? this._pausedResizeTask.set(() => this._renderer.value?.handleResize(e, i)) : this._renderer.value.handleResize(e, i), this._fullRefresh());
      }
      handleCharSizeChanged() {
        this._renderer.value?.handleCharSizeChanged();
      }
      handleBlur() {
        this._renderer.value?.handleBlur();
      }
      handleFocus() {
        this._renderer.value?.handleFocus();
      }
      handleSelectionChanged(e, i, r) {
        this._selectionState.start = e, this._selectionState.end = i, this._selectionState.columnSelectMode = r, this._renderer.value?.handleSelectionChanged(e, i, r);
      }
      handleCursorMove() {
        this._renderer.value?.handleCursorMove();
      }
      clear() {
        this._renderer.value?.clear();
      }
    };
    Qt = M([S(2, H), S(3, nt), S(4, ge), S(5, Be), S(6, F), S(7, ae), S(8, Re)], Qt);
    xs = class {
      constructor(t, e, i) {
        this._coreBrowserService = t;
        this._coreService = e;
        this._onTimeout = i;
        this._start = 0;
        this._end = 0;
        this._isBuffering = false;
      }
      bufferRows(t, e) {
        this._isBuffering ? (this._start = Math.min(this._start, t), this._end = Math.max(this._end, e)) : (this._start = t, this._end = e, this._isBuffering = true), this._timeout === void 0 && (this._timeout = this._coreBrowserService.window.setTimeout(() => {
          this._timeout = void 0, this._coreService.decPrivateModes.synchronizedOutput = false, this._onTimeout();
        }, 1e3));
      }
      flush() {
        if (this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0), !this._isBuffering) return;
        let t = { start: this._start, end: this._end };
        return this._isBuffering = false, t;
      }
      dispose() {
        this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0);
      }
    };
    on = class {
      constructor(t) {
        this._bufferService = t;
        this.isSelectAllActive = false;
        this.selectionStartLength = 0;
      }
      clearSelection() {
        this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = false, this.selectionStartLength = 0;
      }
      get finalSelectionStart() {
        return this.isSelectAllActive ? [0, 0] : !this.selectionEnd || !this.selectionStart ? this.selectionStart : this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
      }
      get finalSelectionEnd() {
        if (this.isSelectAllActive) return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
        if (this.selectionStart) {
          if (!this.selectionEnd || this.areSelectionValuesReversed()) {
            let t = this.selectionStart[0] + this.selectionStartLength;
            return t > this._bufferService.cols ? t % this._bufferService.cols === 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols) - 1] : [t % this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols)] : [t, this.selectionStart[1]];
          }
          if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
            let t = this.selectionStart[0] + this.selectionStartLength;
            return t > this._bufferService.cols ? [t % this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols)] : [Math.max(t, this.selectionEnd[0]), this.selectionEnd[1]];
          }
          return this.selectionEnd;
        }
      }
      areSelectionValuesReversed() {
        let t = this.selectionStart, e = this.selectionEnd;
        return !t || !e ? false : t[1] > e[1] || t[1] === e[1] && t[0] > e[0];
      }
      handleTrim(t) {
        return this.selectionStart && (this.selectionStart[1] -= t), this.selectionEnd && (this.selectionEnd[1] -= t), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
      }
    };
    Ds = 50, Ya = 15, ja = 50, Xa = 500, Za = " ", Ja = new RegExp(Za, "g");
    ei = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8) {
        super();
        this._element = e;
        this._screenElement = i;
        this._linkifier = r;
        this._bufferService = n;
        this._coreService = o;
        this._mouseService = l;
        this._optionsService = a;
        this._renderService = u;
        this._coreBrowserService = h8;
        this._dragScrollAmount = 0;
        this._enabled = true;
        this._workCell = new q();
        this._mouseDownTimeStamp = 0;
        this._oldHasSelection = false;
        this._oldSelectionStart = void 0;
        this._oldSelectionEnd = void 0;
        this._onLinuxMouseSelection = this._register(new v());
        this.onLinuxMouseSelection = this._onLinuxMouseSelection.event;
        this._onRedrawRequest = this._register(new v());
        this.onRequestRedraw = this._onRedrawRequest.event;
        this._onSelectionChange = this._register(new v());
        this.onSelectionChange = this._onSelectionChange.event;
        this._onRequestScrollLines = this._register(new v());
        this.onRequestScrollLines = this._onRequestScrollLines.event;
        this._mouseMoveListener = (c) => this._handleMouseMove(c), this._mouseUpListener = (c) => this._handleMouseUp(c), this._coreService.onUserInput(() => {
          this.hasSelection && this.clearSelection();
        }), this._trimListener = this._bufferService.buffer.lines.onTrim((c) => this._handleTrim(c)), this._register(this._bufferService.buffers.onBufferActivate((c) => this._handleBufferActivate(c))), this.enable(), this._model = new on(this._bufferService), this._activeSelectionMode = 0, this._register(C(() => {
          this._removeMouseDownListeners();
        })), this._register(this._bufferService.onResize((c) => {
          c.rowsChanged && this.clearSelection();
        }));
      }
      reset() {
        this.clearSelection();
      }
      disable() {
        this.clearSelection(), this._enabled = false;
      }
      enable() {
        this._enabled = true;
      }
      get selectionStart() {
        return this._model.finalSelectionStart;
      }
      get selectionEnd() {
        return this._model.finalSelectionEnd;
      }
      get hasSelection() {
        let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd;
        return !e || !i ? false : e[0] !== i[0] || e[1] !== i[1];
      }
      get selectionText() {
        let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd;
        if (!e || !i) return "";
        let r = this._bufferService.buffer, n = [];
        if (this._activeSelectionMode === 3) {
          if (e[0] === i[0]) return "";
          let l = e[0] < i[0] ? e[0] : i[0], a = e[0] < i[0] ? i[0] : e[0];
          for (let u = e[1]; u <= i[1]; u++) {
            let h8 = r.translateBufferLineToString(u, true, l, a);
            n.push(h8);
          }
        } else {
          let l = e[1] === i[1] ? i[0] : void 0;
          n.push(r.translateBufferLineToString(e[1], true, e[0], l));
          for (let a = e[1] + 1; a <= i[1] - 1; a++) {
            let u = r.lines.get(a), h8 = r.translateBufferLineToString(a, true);
            u?.isWrapped ? n[n.length - 1] += h8 : n.push(h8);
          }
          if (e[1] !== i[1]) {
            let a = r.lines.get(i[1]), u = r.translateBufferLineToString(i[1], true, 0, i[0]);
            a && a.isWrapped ? n[n.length - 1] += u : n.push(u);
          }
        }
        return n.map((l) => l.replace(Ja, " ")).join(Es ? `\r
` : `
`);
      }
      clearSelection() {
        this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
      }
      refresh(e) {
        this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._refresh())), Bi && e && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
      }
      _refresh() {
        this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({ start: this._model.finalSelectionStart, end: this._model.finalSelectionEnd, columnSelectMode: this._activeSelectionMode === 3 });
      }
      _isClickInSelection(e) {
        let i = this._getMouseBufferCoords(e), r = this._model.finalSelectionStart, n = this._model.finalSelectionEnd;
        return !r || !n || !i ? false : this._areCoordsInSelection(i, r, n);
      }
      isCellInSelection(e, i) {
        let r = this._model.finalSelectionStart, n = this._model.finalSelectionEnd;
        return !r || !n ? false : this._areCoordsInSelection([e, i], r, n);
      }
      _areCoordsInSelection(e, i, r) {
        return e[1] > i[1] && e[1] < r[1] || i[1] === r[1] && e[1] === i[1] && e[0] >= i[0] && e[0] < r[0] || i[1] < r[1] && e[1] === r[1] && e[0] < r[0] || i[1] < r[1] && e[1] === i[1] && e[0] >= i[0];
      }
      _selectWordAtCursor(e, i) {
        let r = this._linkifier.currentLink?.link?.range;
        if (r) return this._model.selectionStart = [r.start.x - 1, r.start.y - 1], this._model.selectionStartLength = ws(r, this._bufferService.cols), this._model.selectionEnd = void 0, true;
        let n = this._getMouseBufferCoords(e);
        return n ? (this._selectWordAt(n, i), this._model.selectionEnd = void 0, true) : false;
      }
      selectAll() {
        this._model.isSelectAllActive = true, this.refresh(), this._onSelectionChange.fire();
      }
      selectLines(e, i) {
        this._model.clearSelection(), e = Math.max(e, 0), i = Math.min(i, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e], this._model.selectionEnd = [this._bufferService.cols, i], this.refresh(), this._onSelectionChange.fire();
      }
      _handleTrim(e) {
        this._model.handleTrim(e) && this.refresh();
      }
      _getMouseBufferCoords(e) {
        let i = this._mouseService.getCoords(e, this._screenElement, this._bufferService.cols, this._bufferService.rows, true);
        if (i) return i[0]--, i[1]--, i[1] += this._bufferService.buffer.ydisp, i;
      }
      _getMouseEventScrollAmount(e) {
        let i = Ci(this._coreBrowserService.window, e, this._screenElement)[1], r = this._renderService.dimensions.css.canvas.height;
        return i >= 0 && i <= r ? 0 : (i > r && (i -= r), i = Math.min(Math.max(i, -Ds), Ds), i /= Ds, i / Math.abs(i) + Math.round(i * (Ya - 1)));
      }
      shouldForceSelection(e) {
        return Zt ? e.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e.shiftKey;
      }
      handleMouseDown(e) {
        if (this._mouseDownTimeStamp = e.timeStamp, !(e.button === 2 && this.hasSelection) && e.button === 0) {
          if (!this._enabled) {
            if (!this.shouldForceSelection(e)) return;
            e.stopPropagation();
          }
          e.preventDefault(), this._dragScrollAmount = 0, this._enabled && e.shiftKey ? this._handleIncrementalClick(e) : e.detail === 1 ? this._handleSingleClick(e) : e.detail === 2 ? this._handleDoubleClick(e) : e.detail === 3 && this._handleTripleClick(e), this._addMouseDownListeners(), this.refresh(true);
        }
      }
      _addMouseDownListeners() {
        this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval(() => this._dragScroll(), ja);
      }
      _removeMouseDownListeners() {
        this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
      }
      _handleIncrementalClick(e) {
        this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e));
      }
      _handleSingleClick(e) {
        if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = false, this._activeSelectionMode = this.shouldColumnSelect(e) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e), !this._model.selectionStart) return;
        this._model.selectionEnd = void 0;
        let i = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
        i && i.length !== this._model.selectionStart[0] && i.hasWidth(this._model.selectionStart[0]) === 0 && this._model.selectionStart[0]++;
      }
      _handleDoubleClick(e) {
        this._selectWordAtCursor(e, true) && (this._activeSelectionMode = 1);
      }
      _handleTripleClick(e) {
        let i = this._getMouseBufferCoords(e);
        i && (this._activeSelectionMode = 2, this._selectLineAt(i[1]));
      }
      shouldColumnSelect(e) {
        return e.altKey && !(Zt && this._optionsService.rawOptions.macOptionClickForcesSelection);
      }
      _handleMouseMove(e) {
        if (e.stopImmediatePropagation(), !this._model.selectionStart) return;
        let i = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
        if (this._model.selectionEnd = this._getMouseBufferCoords(e), !this._model.selectionEnd) {
          this.refresh(true);
          return;
        }
        this._activeSelectionMode === 2 ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : this._activeSelectionMode === 1 && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e), this._activeSelectionMode !== 3 && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
        let r = this._bufferService.buffer;
        if (this._model.selectionEnd[1] < r.lines.length) {
          let n = r.lines.get(this._model.selectionEnd[1]);
          n && n.hasWidth(this._model.selectionEnd[0]) === 0 && this._model.selectionEnd[0] < this._bufferService.cols && this._model.selectionEnd[0]++;
        }
        (!i || i[0] !== this._model.selectionEnd[0] || i[1] !== this._model.selectionEnd[1]) && this.refresh(true);
      }
      _dragScroll() {
        if (!(!this._model.selectionEnd || !this._model.selectionStart) && this._dragScrollAmount) {
          this._onRequestScrollLines.fire({ amount: this._dragScrollAmount, suppressScrollEvent: false });
          let e = this._bufferService.buffer;
          this._dragScrollAmount > 0 ? (this._activeSelectionMode !== 3 && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e.ydisp + this._bufferService.rows, e.lines.length - 1)) : (this._activeSelectionMode !== 3 && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e.ydisp), this.refresh();
        }
      }
      _handleMouseUp(e) {
        let i = e.timeStamp - this._mouseDownTimeStamp;
        if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && i < Xa && e.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
          if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
            let r = this._mouseService.getCoords(e, this._element, this._bufferService.cols, this._bufferService.rows, false);
            if (r && r[0] !== void 0 && r[1] !== void 0) {
              let n = Jo(r[0] - 1, r[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
              this._coreService.triggerDataEvent(n, true);
            }
          }
        } else this._fireEventIfSelectionChanged();
      }
      _fireEventIfSelectionChanged() {
        let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd, r = !!e && !!i && (e[0] !== i[0] || e[1] !== i[1]);
        if (!r) {
          this._oldHasSelection && this._fireOnSelectionChange(e, i, r);
          return;
        }
        !e || !i || (!this._oldSelectionStart || !this._oldSelectionEnd || e[0] !== this._oldSelectionStart[0] || e[1] !== this._oldSelectionStart[1] || i[0] !== this._oldSelectionEnd[0] || i[1] !== this._oldSelectionEnd[1]) && this._fireOnSelectionChange(e, i, r);
      }
      _fireOnSelectionChange(e, i, r) {
        this._oldSelectionStart = e, this._oldSelectionEnd = i, this._oldHasSelection = r, this._onSelectionChange.fire();
      }
      _handleBufferActivate(e) {
        this.clearSelection(), this._trimListener.dispose(), this._trimListener = e.activeBuffer.lines.onTrim((i) => this._handleTrim(i));
      }
      _convertViewportColToCharacterIndex(e, i) {
        let r = i;
        for (let n = 0; i >= n; n++) {
          let o = e.loadCell(n, this._workCell).getChars().length;
          this._workCell.getWidth() === 0 ? r-- : o > 1 && i !== n && (r += o - 1);
        }
        return r;
      }
      setSelection(e, i, r) {
        this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e, i], this._model.selectionStartLength = r, this.refresh(), this._fireEventIfSelectionChanged();
      }
      rightClickSelect(e) {
        this._isClickInSelection(e) || (this._selectWordAtCursor(e, false) && this.refresh(true), this._fireEventIfSelectionChanged());
      }
      _getWordAt(e, i, r = true, n = true) {
        if (e[0] >= this._bufferService.cols) return;
        let o = this._bufferService.buffer, l = o.lines.get(e[1]);
        if (!l) return;
        let a = o.translateBufferLineToString(e[1], false), u = this._convertViewportColToCharacterIndex(l, e[0]), h8 = u, c = e[0] - u, d = 0, _ = 0, p = 0, m = 0;
        if (a.charAt(u) === " ") {
          for (; u > 0 && a.charAt(u - 1) === " "; ) u--;
          for (; h8 < a.length && a.charAt(h8 + 1) === " "; ) h8++;
        } else {
          let R = e[0], O = e[0];
          l.getWidth(R) === 0 && (d++, R--), l.getWidth(O) === 2 && (_++, O++);
          let I = l.getString(O).length;
          for (I > 1 && (m += I - 1, h8 += I - 1); R > 0 && u > 0 && !this._isCharWordSeparator(l.loadCell(R - 1, this._workCell)); ) {
            l.loadCell(R - 1, this._workCell);
            let k = this._workCell.getChars().length;
            this._workCell.getWidth() === 0 ? (d++, R--) : k > 1 && (p += k - 1, u -= k - 1), u--, R--;
          }
          for (; O < l.length && h8 + 1 < a.length && !this._isCharWordSeparator(l.loadCell(O + 1, this._workCell)); ) {
            l.loadCell(O + 1, this._workCell);
            let k = this._workCell.getChars().length;
            this._workCell.getWidth() === 2 ? (_++, O++) : k > 1 && (m += k - 1, h8 += k - 1), h8++, O++;
          }
        }
        h8++;
        let f = u + c - d + p, A = Math.min(this._bufferService.cols, h8 - u + d + _ - p - m);
        if (!(!i && a.slice(u, h8).trim() === "")) {
          if (r && f === 0 && l.getCodePoint(0) !== 32) {
            let R = o.lines.get(e[1] - 1);
            if (R && l.isWrapped && R.getCodePoint(this._bufferService.cols - 1) !== 32) {
              let O = this._getWordAt([this._bufferService.cols - 1, e[1] - 1], false, true, false);
              if (O) {
                let I = this._bufferService.cols - O.start;
                f -= I, A += I;
              }
            }
          }
          if (n && f + A === this._bufferService.cols && l.getCodePoint(this._bufferService.cols - 1) !== 32) {
            let R = o.lines.get(e[1] + 1);
            if (R?.isWrapped && R.getCodePoint(0) !== 32) {
              let O = this._getWordAt([0, e[1] + 1], false, false, true);
              O && (A += O.length);
            }
          }
          return { start: f, length: A };
        }
      }
      _selectWordAt(e, i) {
        let r = this._getWordAt(e, i);
        if (r) {
          for (; r.start < 0; ) r.start += this._bufferService.cols, e[1]--;
          this._model.selectionStart = [r.start, e[1]], this._model.selectionStartLength = r.length;
        }
      }
      _selectToWordAt(e) {
        let i = this._getWordAt(e, true);
        if (i) {
          let r = e[1];
          for (; i.start < 0; ) i.start += this._bufferService.cols, r--;
          if (!this._model.areSelectionValuesReversed()) for (; i.start + i.length > this._bufferService.cols; ) i.length -= this._bufferService.cols, r++;
          this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? i.start : i.start + i.length, r];
        }
      }
      _isCharWordSeparator(e) {
        return e.getWidth() === 0 ? false : this._optionsService.rawOptions.wordSeparator.indexOf(e.getChars()) >= 0;
      }
      _selectLineAt(e) {
        let i = this._bufferService.buffer.getWrappedRangeForLine(e), r = { start: { x: 0, y: i.first }, end: { x: this._bufferService.cols - 1, y: i.last } };
        this._model.selectionStart = [0, i.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = ws(r, this._bufferService.cols);
      }
    };
    ei = M([S(3, F), S(4, ge), S(5, Dt), S(6, H), S(7, ce), S(8, ae)], ei);
    Hi = class {
      constructor() {
        this._data = {};
      }
      set(t, e, i) {
        this._data[t] || (this._data[t] = {}), this._data[t][e] = i;
      }
      get(t, e) {
        return this._data[t] ? this._data[t][e] : void 0;
      }
      clear() {
        this._data = {};
      }
    };
    Wi = class {
      constructor() {
        this._color = new Hi();
        this._css = new Hi();
      }
      setCss(t, e, i) {
        this._css.set(t, e, i);
      }
      getCss(t, e) {
        return this._css.get(t, e);
      }
      setColor(t, e, i) {
        this._color.set(t, e, i);
      }
      getColor(t, e) {
        return this._color.get(t, e);
      }
      clear() {
        this._color.clear(), this._css.clear();
      }
    };
    re = Object.freeze((() => {
      let s15 = [z.toColor("#2e3436"), z.toColor("#cc0000"), z.toColor("#4e9a06"), z.toColor("#c4a000"), z.toColor("#3465a4"), z.toColor("#75507b"), z.toColor("#06989a"), z.toColor("#d3d7cf"), z.toColor("#555753"), z.toColor("#ef2929"), z.toColor("#8ae234"), z.toColor("#fce94f"), z.toColor("#729fcf"), z.toColor("#ad7fa8"), z.toColor("#34e2e2"), z.toColor("#eeeeec")], t = [0, 95, 135, 175, 215, 255];
      for (let e = 0; e < 216; e++) {
        let i = t[e / 36 % 6 | 0], r = t[e / 6 % 6 | 0], n = t[e % 6];
        s15.push({ css: j.toCss(i, r, n), rgba: j.toRgba(i, r, n) });
      }
      for (let e = 0; e < 24; e++) {
        let i = 8 + e * 10;
        s15.push({ css: j.toCss(i, i, i), rgba: j.toRgba(i, i, i) });
      }
      return s15;
    })());
    St = z.toColor("#ffffff"), Ki = z.toColor("#000000"), tl = z.toColor("#ffffff"), il = Ki, Ui = { css: "rgba(255, 255, 255, 0.3)", rgba: 4294967117 }, Qa = St, ti = class extends D {
      constructor(e) {
        super();
        this._optionsService = e;
        this._contrastCache = new Wi();
        this._halfContrastCache = new Wi();
        this._onChangeColors = this._register(new v());
        this.onChangeColors = this._onChangeColors.event;
        this._colors = { foreground: St, background: Ki, cursor: tl, cursorAccent: il, selectionForeground: void 0, selectionBackgroundTransparent: Ui, selectionBackgroundOpaque: U.blend(Ki, Ui), selectionInactiveBackgroundTransparent: Ui, selectionInactiveBackgroundOpaque: U.blend(Ki, Ui), scrollbarSliderBackground: U.opacity(St, 0.2), scrollbarSliderHoverBackground: U.opacity(St, 0.4), scrollbarSliderActiveBackground: U.opacity(St, 0.5), overviewRulerBorder: St, ansi: re.slice(), contrastCache: this._contrastCache, halfContrastCache: this._halfContrastCache }, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this._register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", () => this._contrastCache.clear())), this._register(this._optionsService.onSpecificOptionChange("theme", () => this._setTheme(this._optionsService.rawOptions.theme)));
      }
      get colors() {
        return this._colors;
      }
      _setTheme(e = {}) {
        let i = this._colors;
        if (i.foreground = K(e.foreground, St), i.background = K(e.background, Ki), i.cursor = U.blend(i.background, K(e.cursor, tl)), i.cursorAccent = U.blend(i.background, K(e.cursorAccent, il)), i.selectionBackgroundTransparent = K(e.selectionBackground, Ui), i.selectionBackgroundOpaque = U.blend(i.background, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundTransparent = K(e.selectionInactiveBackground, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundOpaque = U.blend(i.background, i.selectionInactiveBackgroundTransparent), i.selectionForeground = e.selectionForeground ? K(e.selectionForeground, ps) : void 0, i.selectionForeground === ps && (i.selectionForeground = void 0), U.isOpaque(i.selectionBackgroundTransparent) && (i.selectionBackgroundTransparent = U.opacity(i.selectionBackgroundTransparent, 0.3)), U.isOpaque(i.selectionInactiveBackgroundTransparent) && (i.selectionInactiveBackgroundTransparent = U.opacity(i.selectionInactiveBackgroundTransparent, 0.3)), i.scrollbarSliderBackground = K(e.scrollbarSliderBackground, U.opacity(i.foreground, 0.2)), i.scrollbarSliderHoverBackground = K(e.scrollbarSliderHoverBackground, U.opacity(i.foreground, 0.4)), i.scrollbarSliderActiveBackground = K(e.scrollbarSliderActiveBackground, U.opacity(i.foreground, 0.5)), i.overviewRulerBorder = K(e.overviewRulerBorder, Qa), i.ansi = re.slice(), i.ansi[0] = K(e.black, re[0]), i.ansi[1] = K(e.red, re[1]), i.ansi[2] = K(e.green, re[2]), i.ansi[3] = K(e.yellow, re[3]), i.ansi[4] = K(e.blue, re[4]), i.ansi[5] = K(e.magenta, re[5]), i.ansi[6] = K(e.cyan, re[6]), i.ansi[7] = K(e.white, re[7]), i.ansi[8] = K(e.brightBlack, re[8]), i.ansi[9] = K(e.brightRed, re[9]), i.ansi[10] = K(e.brightGreen, re[10]), i.ansi[11] = K(e.brightYellow, re[11]), i.ansi[12] = K(e.brightBlue, re[12]), i.ansi[13] = K(e.brightMagenta, re[13]), i.ansi[14] = K(e.brightCyan, re[14]), i.ansi[15] = K(e.brightWhite, re[15]), e.extendedAnsi) {
          let r = Math.min(i.ansi.length - 16, e.extendedAnsi.length);
          for (let n = 0; n < r; n++) i.ansi[n + 16] = K(e.extendedAnsi[n], re[n + 16]);
        }
        this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
      }
      restoreColor(e) {
        this._restoreColor(e), this._onChangeColors.fire(this.colors);
      }
      _restoreColor(e) {
        if (e === void 0) {
          for (let i = 0; i < this._restoreColors.ansi.length; ++i) this._colors.ansi[i] = this._restoreColors.ansi[i];
          return;
        }
        switch (e) {
          case 256:
            this._colors.foreground = this._restoreColors.foreground;
            break;
          case 257:
            this._colors.background = this._restoreColors.background;
            break;
          case 258:
            this._colors.cursor = this._restoreColors.cursor;
            break;
          default:
            this._colors.ansi[e] = this._restoreColors.ansi[e];
        }
      }
      modifyColors(e) {
        e(this._colors), this._onChangeColors.fire(this.colors);
      }
      _updateRestoreColors() {
        this._restoreColors = { foreground: this._colors.foreground, background: this._colors.background, cursor: this._colors.cursor, ansi: this._colors.ansi.slice() };
      }
    };
    ti = M([S(0, H)], ti);
    Rs = class {
      constructor(...t) {
        this._entries = /* @__PURE__ */ new Map();
        for (let [e, i] of t) this.set(e, i);
      }
      set(t, e) {
        let i = this._entries.get(t);
        return this._entries.set(t, e), i;
      }
      forEach(t) {
        for (let [e, i] of this._entries.entries()) t(e, i);
      }
      has(t) {
        return this._entries.has(t);
      }
      get(t) {
        return this._entries.get(t);
      }
    }, ln = class {
      constructor() {
        this._services = new Rs();
        this._services.set(xt, this);
      }
      setService(t, e) {
        this._services.set(t, e);
      }
      getService(t) {
        return this._services.get(t);
      }
      createInstance(t, ...e) {
        let i = Xs(t).sort((o, l) => o.index - l.index), r = [];
        for (let o of i) {
          let l = this._services.get(o.id);
          if (!l) throw new Error(`[createInstance] ${t.name} depends on UNKNOWN service ${o.id._id}.`);
          r.push(l);
        }
        let n = i.length > 0 ? i[0].index : e.length;
        if (e.length !== n) throw new Error(`[createInstance] First service dependency of ${t.name} at position ${n + 1} conflicts with ${e.length} static arguments`);
        return new t(...e, ...r);
      }
    };
    ec = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, off: 5 }, tc = "xterm.js: ", ii = class extends D {
      constructor(e) {
        super();
        this._optionsService = e;
        this._logLevel = 5;
        this._updateLogLevel(), this._register(this._optionsService.onSpecificOptionChange("logLevel", () => this._updateLogLevel())), ic = this;
      }
      get logLevel() {
        return this._logLevel;
      }
      _updateLogLevel() {
        this._logLevel = ec[this._optionsService.rawOptions.logLevel];
      }
      _evalLazyOptionalParams(e) {
        for (let i = 0; i < e.length; i++) typeof e[i] == "function" && (e[i] = e[i]());
      }
      _log(e, i, r) {
        this._evalLazyOptionalParams(r), e.call(console, (this._optionsService.options.logger ? "" : tc) + i, ...r);
      }
      trace(e, ...i) {
        this._logLevel <= 0 && this._log(this._optionsService.options.logger?.trace.bind(this._optionsService.options.logger) ?? console.log, e, i);
      }
      debug(e, ...i) {
        this._logLevel <= 1 && this._log(this._optionsService.options.logger?.debug.bind(this._optionsService.options.logger) ?? console.log, e, i);
      }
      info(e, ...i) {
        this._logLevel <= 2 && this._log(this._optionsService.options.logger?.info.bind(this._optionsService.options.logger) ?? console.info, e, i);
      }
      warn(e, ...i) {
        this._logLevel <= 3 && this._log(this._optionsService.options.logger?.warn.bind(this._optionsService.options.logger) ?? console.warn, e, i);
      }
      error(e, ...i) {
        this._logLevel <= 4 && this._log(this._optionsService.options.logger?.error.bind(this._optionsService.options.logger) ?? console.error, e, i);
      }
    };
    ii = M([S(0, H)], ii);
    zi = class extends D {
      constructor(e) {
        super();
        this._maxLength = e;
        this.onDeleteEmitter = this._register(new v());
        this.onDelete = this.onDeleteEmitter.event;
        this.onInsertEmitter = this._register(new v());
        this.onInsert = this.onInsertEmitter.event;
        this.onTrimEmitter = this._register(new v());
        this.onTrim = this.onTrimEmitter.event;
        this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
      }
      get maxLength() {
        return this._maxLength;
      }
      set maxLength(e) {
        if (this._maxLength === e) return;
        let i = new Array(e);
        for (let r = 0; r < Math.min(e, this.length); r++) i[r] = this._array[this._getCyclicIndex(r)];
        this._array = i, this._maxLength = e, this._startIndex = 0;
      }
      get length() {
        return this._length;
      }
      set length(e) {
        if (e > this._length) for (let i = this._length; i < e; i++) this._array[i] = void 0;
        this._length = e;
      }
      get(e) {
        return this._array[this._getCyclicIndex(e)];
      }
      set(e, i) {
        this._array[this._getCyclicIndex(e)] = i;
      }
      push(e) {
        this._array[this._getCyclicIndex(this._length)] = e, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
      }
      recycle() {
        if (this._length !== this._maxLength) throw new Error("Can only recycle when the buffer is full");
        return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
      }
      get isFull() {
        return this._length === this._maxLength;
      }
      pop() {
        return this._array[this._getCyclicIndex(this._length-- - 1)];
      }
      splice(e, i, ...r) {
        if (i) {
          for (let n = e; n < this._length - i; n++) this._array[this._getCyclicIndex(n)] = this._array[this._getCyclicIndex(n + i)];
          this._length -= i, this.onDeleteEmitter.fire({ index: e, amount: i });
        }
        for (let n = this._length - 1; n >= e; n--) this._array[this._getCyclicIndex(n + r.length)] = this._array[this._getCyclicIndex(n)];
        for (let n = 0; n < r.length; n++) this._array[this._getCyclicIndex(e + n)] = r[n];
        if (r.length && this.onInsertEmitter.fire({ index: e, amount: r.length }), this._length + r.length > this._maxLength) {
          let n = this._length + r.length - this._maxLength;
          this._startIndex += n, this._length = this._maxLength, this.onTrimEmitter.fire(n);
        } else this._length += r.length;
      }
      trimStart(e) {
        e > this._length && (e = this._length), this._startIndex += e, this._length -= e, this.onTrimEmitter.fire(e);
      }
      shiftElements(e, i, r) {
        if (!(i <= 0)) {
          if (e < 0 || e >= this._length) throw new Error("start argument out of range");
          if (e + r < 0) throw new Error("Cannot shift elements in list beyond index 0");
          if (r > 0) {
            for (let o = i - 1; o >= 0; o--) this.set(e + o + r, this.get(e + o));
            let n = e + i + r - this._length;
            if (n > 0) for (this._length += n; this._length > this._maxLength; ) this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
          } else for (let n = 0; n < i; n++) this.set(e + n + r, this.get(e + n));
        }
      }
      _getCyclicIndex(e) {
        return (this._startIndex + e) % this._maxLength;
      }
    };
    B = 3;
    X = Object.freeze(new De()), an = 0, Ls = 2, Ze = class s12 {
      constructor(t, e, i = false) {
        this.isWrapped = i;
        this._combined = {};
        this._extendedAttrs = {};
        this._data = new Uint32Array(t * B);
        let r = e || q.fromCharData([0, ir, 1, 0]);
        for (let n = 0; n < t; ++n) this.setCell(n, r);
        this.length = t;
      }
      get(t) {
        let e = this._data[t * B + 0], i = e & 2097151;
        return [this._data[t * B + 1], e & 2097152 ? this._combined[t] : i ? Ce(i) : "", e >> 22, e & 2097152 ? this._combined[t].charCodeAt(this._combined[t].length - 1) : i];
      }
      set(t, e) {
        this._data[t * B + 1] = e[0], e[1].length > 1 ? (this._combined[t] = e[1], this._data[t * B + 0] = t | 2097152 | e[2] << 22) : this._data[t * B + 0] = e[1].charCodeAt(0) | e[2] << 22;
      }
      getWidth(t) {
        return this._data[t * B + 0] >> 22;
      }
      hasWidth(t) {
        return this._data[t * B + 0] & 12582912;
      }
      getFg(t) {
        return this._data[t * B + 1];
      }
      getBg(t) {
        return this._data[t * B + 2];
      }
      hasContent(t) {
        return this._data[t * B + 0] & 4194303;
      }
      getCodePoint(t) {
        let e = this._data[t * B + 0];
        return e & 2097152 ? this._combined[t].charCodeAt(this._combined[t].length - 1) : e & 2097151;
      }
      isCombined(t) {
        return this._data[t * B + 0] & 2097152;
      }
      getString(t) {
        let e = this._data[t * B + 0];
        return e & 2097152 ? this._combined[t] : e & 2097151 ? Ce(e & 2097151) : "";
      }
      isProtected(t) {
        return this._data[t * B + 2] & 536870912;
      }
      loadCell(t, e) {
        return an = t * B, e.content = this._data[an + 0], e.fg = this._data[an + 1], e.bg = this._data[an + 2], e.content & 2097152 && (e.combinedData = this._combined[t]), e.bg & 268435456 && (e.extended = this._extendedAttrs[t]), e;
      }
      setCell(t, e) {
        e.content & 2097152 && (this._combined[t] = e.combinedData), e.bg & 268435456 && (this._extendedAttrs[t] = e.extended), this._data[t * B + 0] = e.content, this._data[t * B + 1] = e.fg, this._data[t * B + 2] = e.bg;
      }
      setCellFromCodepoint(t, e, i, r) {
        r.bg & 268435456 && (this._extendedAttrs[t] = r.extended), this._data[t * B + 0] = e | i << 22, this._data[t * B + 1] = r.fg, this._data[t * B + 2] = r.bg;
      }
      addCodepointToCell(t, e, i) {
        let r = this._data[t * B + 0];
        r & 2097152 ? this._combined[t] += Ce(e) : r & 2097151 ? (this._combined[t] = Ce(r & 2097151) + Ce(e), r &= -2097152, r |= 2097152) : r = e | 1 << 22, i && (r &= -12582913, r |= i << 22), this._data[t * B + 0] = r;
      }
      insertCells(t, e, i) {
        if (t %= this.length, t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length - t) {
          let r = new q();
          for (let n = this.length - t - e - 1; n >= 0; --n) this.setCell(t + e + n, this.loadCell(t + n, r));
          for (let n = 0; n < e; ++n) this.setCell(t + n, i);
        } else for (let r = t; r < this.length; ++r) this.setCell(r, i);
        this.getWidth(this.length - 1) === 2 && this.setCellFromCodepoint(this.length - 1, 0, 1, i);
      }
      deleteCells(t, e, i) {
        if (t %= this.length, e < this.length - t) {
          let r = new q();
          for (let n = 0; n < this.length - t - e; ++n) this.setCell(t + n, this.loadCell(t + e + n, r));
          for (let n = this.length - e; n < this.length; ++n) this.setCell(n, i);
        } else for (let r = t; r < this.length; ++r) this.setCell(r, i);
        t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), this.getWidth(t) === 0 && !this.hasContent(t) && this.setCellFromCodepoint(t, 0, 1, i);
      }
      replaceCells(t, e, i, r = false) {
        if (r) {
          for (t && this.getWidth(t - 1) === 2 && !this.isProtected(t - 1) && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && !this.isProtected(e) && this.setCellFromCodepoint(e, 0, 1, i); t < e && t < this.length; ) this.isProtected(t) || this.setCell(t, i), t++;
          return;
        }
        for (t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && this.setCellFromCodepoint(e, 0, 1, i); t < e && t < this.length; ) this.setCell(t++, i);
      }
      resize(t, e) {
        if (t === this.length) return this._data.length * 4 * Ls < this._data.buffer.byteLength;
        let i = t * B;
        if (t > this.length) {
          if (this._data.buffer.byteLength >= i * 4) this._data = new Uint32Array(this._data.buffer, 0, i);
          else {
            let r = new Uint32Array(i);
            r.set(this._data), this._data = r;
          }
          for (let r = this.length; r < t; ++r) this.setCell(r, e);
        } else {
          this._data = this._data.subarray(0, i);
          let r = Object.keys(this._combined);
          for (let o = 0; o < r.length; o++) {
            let l = parseInt(r[o], 10);
            l >= t && delete this._combined[l];
          }
          let n = Object.keys(this._extendedAttrs);
          for (let o = 0; o < n.length; o++) {
            let l = parseInt(n[o], 10);
            l >= t && delete this._extendedAttrs[l];
          }
        }
        return this.length = t, i * 4 * Ls < this._data.buffer.byteLength;
      }
      cleanupMemory() {
        if (this._data.length * 4 * Ls < this._data.buffer.byteLength) {
          let t = new Uint32Array(this._data.length);
          return t.set(this._data), this._data = t, 1;
        }
        return 0;
      }
      fill(t, e = false) {
        if (e) {
          for (let i = 0; i < this.length; ++i) this.isProtected(i) || this.setCell(i, t);
          return;
        }
        this._combined = {}, this._extendedAttrs = {};
        for (let i = 0; i < this.length; ++i) this.setCell(i, t);
      }
      copyFrom(t) {
        this.length !== t.length ? this._data = new Uint32Array(t._data) : this._data.set(t._data), this.length = t.length, this._combined = {};
        for (let e in t._combined) this._combined[e] = t._combined[e];
        this._extendedAttrs = {};
        for (let e in t._extendedAttrs) this._extendedAttrs[e] = t._extendedAttrs[e];
        this.isWrapped = t.isWrapped;
      }
      clone() {
        let t = new s12(0);
        t._data = new Uint32Array(this._data), t.length = this.length;
        for (let e in this._combined) t._combined[e] = this._combined[e];
        for (let e in this._extendedAttrs) t._extendedAttrs[e] = this._extendedAttrs[e];
        return t.isWrapped = this.isWrapped, t;
      }
      getTrimmedLength() {
        for (let t = this.length - 1; t >= 0; --t) if (this._data[t * B + 0] & 4194303) return t + (this._data[t * B + 0] >> 22);
        return 0;
      }
      getNoBgTrimmedLength() {
        for (let t = this.length - 1; t >= 0; --t) if (this._data[t * B + 0] & 4194303 || this._data[t * B + 2] & 50331648) return t + (this._data[t * B + 0] >> 22);
        return 0;
      }
      copyCellsFrom(t, e, i, r, n) {
        let o = t._data;
        if (n) for (let a = r - 1; a >= 0; a--) {
          for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o[(e + a) * B + u];
          o[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t._extendedAttrs[e + a]);
        }
        else for (let a = 0; a < r; a++) {
          for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o[(e + a) * B + u];
          o[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t._extendedAttrs[e + a]);
        }
        let l = Object.keys(t._combined);
        for (let a = 0; a < l.length; a++) {
          let u = parseInt(l[a], 10);
          u >= e && (this._combined[u - e + i] = t._combined[u]);
        }
      }
      translateToString(t, e, i, r) {
        e = e ?? 0, i = i ?? this.length, t && (i = Math.min(i, this.getTrimmedLength())), r && (r.length = 0);
        let n = "";
        for (; e < i; ) {
          let o = this._data[e * B + 0], l = o & 2097151, a = o & 2097152 ? this._combined[e] : l ? Ce(l) : we;
          if (n += a, r) for (let u = 0; u < a.length; ++u) r.push(e);
          e += o >> 22 || 1;
        }
        return r && r.push(e), n;
      }
    };
    un = class un2 {
      constructor(t) {
        this.line = t;
        this.isDisposed = false;
        this._disposables = [];
        this._id = un2._nextId++;
        this._onDispose = this.register(new v());
        this.onDispose = this._onDispose.event;
      }
      get id() {
        return this._id;
      }
      dispose() {
        this.isDisposed || (this.isDisposed = true, this.line = -1, this._onDispose.fire(), Ne(this._disposables), this._disposables.length = 0);
      }
      register(t) {
        return this._disposables.push(t), t;
      }
    };
    un._nextId = 1;
    cn = un;
    ne = {}, Je = ne.B;
    ne[0] = { "`": "◆", a: "▒", b: "␉", c: "␌", d: "␍", e: "␊", f: "°", g: "±", h: "␤", i: "␋", j: "┘", k: "┐", l: "┌", m: "└", n: "┼", o: "⎺", p: "⎻", q: "─", r: "⎼", s: "⎽", t: "├", u: "┤", v: "┴", w: "┬", x: "│", y: "≤", z: "≥", "{": "π", "|": "≠", "}": "£", "~": "·" };
    ne.A = { "#": "£" };
    ne.B = void 0;
    ne[4] = { "#": "£", "@": "¾", "[": "ij", "\\": "½", "]": "|", "{": "¨", "|": "f", "}": "¼", "~": "´" };
    ne.C = ne[5] = { "[": "Ä", "\\": "Ö", "]": "Å", "^": "Ü", "`": "é", "{": "ä", "|": "ö", "}": "å", "~": "ü" };
    ne.R = { "#": "£", "@": "à", "[": "°", "\\": "ç", "]": "§", "{": "é", "|": "ù", "}": "è", "~": "¨" };
    ne.Q = { "@": "à", "[": "â", "\\": "ç", "]": "ê", "^": "î", "`": "ô", "{": "é", "|": "ù", "}": "è", "~": "û" };
    ne.K = { "@": "§", "[": "Ä", "\\": "Ö", "]": "Ü", "{": "ä", "|": "ö", "}": "ü", "~": "ß" };
    ne.Y = { "#": "£", "@": "§", "[": "°", "\\": "ç", "]": "é", "`": "ù", "{": "à", "|": "ò", "}": "è", "~": "ì" };
    ne.E = ne[6] = { "@": "Ä", "[": "Æ", "\\": "Ø", "]": "Å", "^": "Ü", "`": "ä", "{": "æ", "|": "ø", "}": "å", "~": "ü" };
    ne.Z = { "#": "£", "@": "§", "[": "¡", "\\": "Ñ", "]": "¿", "{": "°", "|": "ñ", "}": "ç" };
    ne.H = ne[7] = { "@": "É", "[": "Ä", "\\": "Ö", "]": "Å", "^": "Ü", "`": "é", "{": "ä", "|": "ö", "}": "å", "~": "ü" };
    ne["="] = { "#": "ù", "@": "à", "[": "é", "\\": "ç", "]": "ê", "^": "î", _: "è", "`": "ô", "{": "ä", "|": "ö", "}": "ü", "~": "û" };
    cl = 4294967295, $i = class {
      constructor(t, e, i) {
        this._hasScrollback = t;
        this._optionsService = e;
        this._bufferService = i;
        this.ydisp = 0;
        this.ybase = 0;
        this.y = 0;
        this.x = 0;
        this.tabs = {};
        this.savedY = 0;
        this.savedX = 0;
        this.savedCurAttrData = X.clone();
        this.savedCharset = Je;
        this.markers = [];
        this._nullCell = q.fromCharData([0, ir, 1, 0]);
        this._whitespaceCell = q.fromCharData([0, we, 1, 32]);
        this._isClearing = false;
        this._memoryCleanupQueue = new Jt();
        this._memoryCleanupPosition = 0;
        this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
      }
      getNullCell(t) {
        return t ? (this._nullCell.fg = t.fg, this._nullCell.bg = t.bg, this._nullCell.extended = t.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new rt()), this._nullCell;
      }
      getWhitespaceCell(t) {
        return t ? (this._whitespaceCell.fg = t.fg, this._whitespaceCell.bg = t.bg, this._whitespaceCell.extended = t.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new rt()), this._whitespaceCell;
      }
      getBlankLine(t, e) {
        return new Ze(this._bufferService.cols, this.getNullCell(t), e);
      }
      get hasScrollback() {
        return this._hasScrollback && this.lines.maxLength > this._rows;
      }
      get isCursorInViewport() {
        let e = this.ybase + this.y - this.ydisp;
        return e >= 0 && e < this._rows;
      }
      _getCorrectBufferLength(t) {
        if (!this._hasScrollback) return t;
        let e = t + this._optionsService.rawOptions.scrollback;
        return e > cl ? cl : e;
      }
      fillViewportRows(t) {
        if (this.lines.length === 0) {
          t === void 0 && (t = X);
          let e = this._rows;
          for (; e--; ) this.lines.push(this.getBlankLine(t));
        }
      }
      clear() {
        this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
      }
      resize(t, e) {
        let i = this.getNullCell(X), r = 0, n = this._getCorrectBufferLength(e);
        if (n > this.lines.maxLength && (this.lines.maxLength = n), this.lines.length > 0) {
          if (this._cols < t) for (let l = 0; l < this.lines.length; l++) r += +this.lines.get(l).resize(t, i);
          let o = 0;
          if (this._rows < e) for (let l = this._rows; l < e; l++) this.lines.length < e + this.ybase && (this._optionsService.rawOptions.windowsMode || this._optionsService.rawOptions.windowsPty.backend !== void 0 || this._optionsService.rawOptions.windowsPty.buildNumber !== void 0 ? this.lines.push(new Ze(t, i)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + o + 1 ? (this.ybase--, o++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new Ze(t, i)));
          else for (let l = this._rows; l > e; l--) this.lines.length > e + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
          if (n < this.lines.maxLength) {
            let l = this.lines.length - n;
            l > 0 && (this.lines.trimStart(l), this.ybase = Math.max(this.ybase - l, 0), this.ydisp = Math.max(this.ydisp - l, 0), this.savedY = Math.max(this.savedY - l, 0)), this.lines.maxLength = n;
          }
          this.x = Math.min(this.x, t - 1), this.y = Math.min(this.y, e - 1), o && (this.y += o), this.savedX = Math.min(this.savedX, t - 1), this.scrollTop = 0;
        }
        if (this.scrollBottom = e - 1, this._isReflowEnabled && (this._reflow(t, e), this._cols > t)) for (let o = 0; o < this.lines.length; o++) r += +this.lines.get(o).resize(t, i);
        this._cols = t, this._rows = e, this._memoryCleanupQueue.clear(), r > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue(() => this._batchedMemoryCleanup()));
      }
      _batchedMemoryCleanup() {
        let t = true;
        this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, t = false);
        let e = 0;
        for (; this._memoryCleanupPosition < this.lines.length; ) if (e += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), e > 100) return true;
        return t;
      }
      get _isReflowEnabled() {
        let t = this._optionsService.rawOptions.windowsPty;
        return t && t.buildNumber ? this._hasScrollback && t.backend === "conpty" && t.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
      }
      _reflow(t, e) {
        this._cols !== t && (t > this._cols ? this._reflowLarger(t, e) : this._reflowSmaller(t, e));
      }
      _reflowLarger(t, e) {
        let i = this._optionsService.rawOptions.reflowCursorLine, r = sl(this.lines, this._cols, t, this.ybase + this.y, this.getNullCell(X), i);
        if (r.length > 0) {
          let n = ol(this.lines, r);
          ll(this.lines, n.layout), this._reflowLargerAdjustViewport(t, e, n.countRemoved);
        }
      }
      _reflowLargerAdjustViewport(t, e, i) {
        let r = this.getNullCell(X), n = i;
        for (; n-- > 0; ) this.ybase === 0 ? (this.y > 0 && this.y--, this.lines.length < e && this.lines.push(new Ze(t, r))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
        this.savedY = Math.max(this.savedY - i, 0);
      }
      _reflowSmaller(t, e) {
        let i = this._optionsService.rawOptions.reflowCursorLine, r = this.getNullCell(X), n = [], o = 0;
        for (let l = this.lines.length - 1; l >= 0; l--) {
          let a = this.lines.get(l);
          if (!a || !a.isWrapped && a.getTrimmedLength() <= t) continue;
          let u = [a];
          for (; a.isWrapped && l > 0; ) a = this.lines.get(--l), u.unshift(a);
          if (!i) {
            let I = this.ybase + this.y;
            if (I >= l && I < l + u.length) continue;
          }
          let h8 = u[u.length - 1].getTrimmedLength(), c = al(u, this._cols, t), d = c.length - u.length, _;
          this.ybase === 0 && this.y !== this.lines.length - 1 ? _ = Math.max(0, this.y - this.lines.maxLength + d) : _ = Math.max(0, this.lines.length - this.lines.maxLength + d);
          let p = [];
          for (let I = 0; I < d; I++) {
            let k = this.getBlankLine(X, true);
            p.push(k);
          }
          p.length > 0 && (n.push({ start: l + u.length + o, newLines: p }), o += p.length), u.push(...p);
          let m = c.length - 1, f = c[m];
          f === 0 && (m--, f = c[m]);
          let A = u.length - d - 1, R = h8;
          for (; A >= 0; ) {
            let I = Math.min(R, f);
            if (u[m] === void 0) break;
            if (u[m].copyCellsFrom(u[A], R - I, f - I, I, true), f -= I, f === 0 && (m--, f = c[m]), R -= I, R === 0) {
              A--;
              let k = Math.max(A, 0);
              R = ri(u, k, this._cols);
            }
          }
          for (let I = 0; I < u.length; I++) c[I] < t && u[I].setCell(c[I], r);
          let O = d - _;
          for (; O-- > 0; ) this.ybase === 0 ? this.y < e - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + o) - e && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
          this.savedY = Math.min(this.savedY + d, this.ybase + e - 1);
        }
        if (n.length > 0) {
          let l = [], a = [];
          for (let f = 0; f < this.lines.length; f++) a.push(this.lines.get(f));
          let u = this.lines.length, h8 = u - 1, c = 0, d = n[c];
          this.lines.length = Math.min(this.lines.maxLength, this.lines.length + o);
          let _ = 0;
          for (let f = Math.min(this.lines.maxLength - 1, u + o - 1); f >= 0; f--) if (d && d.start > h8 + _) {
            for (let A = d.newLines.length - 1; A >= 0; A--) this.lines.set(f--, d.newLines[A]);
            f++, l.push({ index: h8 + 1, amount: d.newLines.length }), _ += d.newLines.length, d = n[++c];
          } else this.lines.set(f, a[h8--]);
          let p = 0;
          for (let f = l.length - 1; f >= 0; f--) l[f].index += p, this.lines.onInsertEmitter.fire(l[f]), p += l[f].amount;
          let m = Math.max(0, u + o - this.lines.maxLength);
          m > 0 && this.lines.onTrimEmitter.fire(m);
        }
      }
      translateBufferLineToString(t, e, i = 0, r) {
        let n = this.lines.get(t);
        return n ? n.translateToString(e, i, r) : "";
      }
      getWrappedRangeForLine(t) {
        let e = t, i = t;
        for (; e > 0 && this.lines.get(e).isWrapped; ) e--;
        for (; i + 1 < this.lines.length && this.lines.get(i + 1).isWrapped; ) i++;
        return { first: e, last: i };
      }
      setupTabStops(t) {
        for (t != null ? this.tabs[t] || (t = this.prevStop(t)) : (this.tabs = {}, t = 0); t < this._cols; t += this._optionsService.rawOptions.tabStopWidth) this.tabs[t] = true;
      }
      prevStop(t) {
        for (t == null && (t = this.x); !this.tabs[--t] && t > 0; ) ;
        return t >= this._cols ? this._cols - 1 : t < 0 ? 0 : t;
      }
      nextStop(t) {
        for (t == null && (t = this.x); !this.tabs[++t] && t < this._cols; ) ;
        return t >= this._cols ? this._cols - 1 : t < 0 ? 0 : t;
      }
      clearMarkers(t) {
        this._isClearing = true;
        for (let e = 0; e < this.markers.length; e++) this.markers[e].line === t && (this.markers[e].dispose(), this.markers.splice(e--, 1));
        this._isClearing = false;
      }
      clearAllMarkers() {
        this._isClearing = true;
        for (let t = 0; t < this.markers.length; t++) this.markers[t].dispose();
        this.markers.length = 0, this._isClearing = false;
      }
      addMarker(t) {
        let e = new cn(t);
        return this.markers.push(e), e.register(this.lines.onTrim((i) => {
          e.line -= i, e.line < 0 && e.dispose();
        })), e.register(this.lines.onInsert((i) => {
          e.line >= i.index && (e.line += i.amount);
        })), e.register(this.lines.onDelete((i) => {
          e.line >= i.index && e.line < i.index + i.amount && e.dispose(), e.line > i.index && (e.line -= i.amount);
        })), e.register(e.onDispose(() => this._removeMarker(e))), e;
      }
      _removeMarker(t) {
        this._isClearing || this.markers.splice(this.markers.indexOf(t), 1);
      }
    };
    hn = class extends D {
      constructor(e, i) {
        super();
        this._optionsService = e;
        this._bufferService = i;
        this._onBufferActivate = this._register(new v());
        this.onBufferActivate = this._onBufferActivate.event;
        this.reset(), this._register(this._optionsService.onSpecificOptionChange("scrollback", () => this.resize(this._bufferService.cols, this._bufferService.rows))), this._register(this._optionsService.onSpecificOptionChange("tabStopWidth", () => this.setupTabStops()));
      }
      reset() {
        this._normal = new $i(true, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new $i(false, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }), this.setupTabStops();
      }
      get alt() {
        return this._alt;
      }
      get active() {
        return this._activeBuffer;
      }
      get normal() {
        return this._normal;
      }
      activateNormalBuffer() {
        this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }));
      }
      activateAltBuffer(e) {
        this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({ activeBuffer: this._alt, inactiveBuffer: this._normal }));
      }
      resize(e, i) {
        this._normal.resize(e, i), this._alt.resize(e, i), this.setupTabStops(e);
      }
      setupTabStops(e) {
        this._normal.setupTabStops(e), this._alt.setupTabStops(e);
      }
    };
    ks = 2, Cs = 1, ni = class extends D {
      constructor(e) {
        super();
        this.isUserScrolling = false;
        this._onResize = this._register(new v());
        this.onResize = this._onResize.event;
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this.cols = Math.max(e.rawOptions.cols || 0, ks), this.rows = Math.max(e.rawOptions.rows || 0, Cs), this.buffers = this._register(new hn(e, this)), this._register(this.buffers.onBufferActivate((i) => {
          this._onScroll.fire(i.activeBuffer.ydisp);
        }));
      }
      get buffer() {
        return this.buffers.active;
      }
      resize(e, i) {
        let r = this.cols !== e, n = this.rows !== i;
        this.cols = e, this.rows = i, this.buffers.resize(e, i), this._onResize.fire({ cols: e, rows: i, colsChanged: r, rowsChanged: n });
      }
      reset() {
        this.buffers.reset(), this.isUserScrolling = false;
      }
      scroll(e, i = false) {
        let r = this.buffer, n;
        n = this._cachedBlankLine, (!n || n.length !== this.cols || n.getFg(0) !== e.fg || n.getBg(0) !== e.bg) && (n = r.getBlankLine(e, i), this._cachedBlankLine = n), n.isWrapped = i;
        let o = r.ybase + r.scrollTop, l = r.ybase + r.scrollBottom;
        if (r.scrollTop === 0) {
          let a = r.lines.isFull;
          l === r.lines.length - 1 ? a ? r.lines.recycle().copyFrom(n) : r.lines.push(n.clone()) : r.lines.splice(l + 1, 0, n.clone()), a ? this.isUserScrolling && (r.ydisp = Math.max(r.ydisp - 1, 0)) : (r.ybase++, this.isUserScrolling || r.ydisp++);
        } else {
          let a = l - o + 1;
          r.lines.shiftElements(o + 1, a - 1, -1), r.lines.set(l, n.clone());
        }
        this.isUserScrolling || (r.ydisp = r.ybase), this._onScroll.fire(r.ydisp);
      }
      scrollLines(e, i) {
        let r = this.buffer;
        if (e < 0) {
          if (r.ydisp === 0) return;
          this.isUserScrolling = true;
        } else e + r.ydisp >= r.ybase && (this.isUserScrolling = false);
        let n = r.ydisp;
        r.ydisp = Math.max(Math.min(r.ydisp + e, r.ybase), 0), n !== r.ydisp && (i || this._onScroll.fire(r.ydisp));
      }
    };
    ni = M([S(0, H)], ni);
    si = { cols: 80, rows: 24, cursorBlink: false, cursorStyle: "block", cursorWidth: 1, cursorInactiveStyle: "outline", customGlyphs: true, drawBoldTextInBrightColors: true, documentOverride: null, fastScrollModifier: "alt", fastScrollSensitivity: 5, fontFamily: "monospace", fontSize: 15, fontWeight: "normal", fontWeightBold: "bold", ignoreBracketedPasteMode: false, lineHeight: 1, letterSpacing: 0, linkHandler: null, logLevel: "info", logger: null, scrollback: 1e3, scrollOnEraseInDisplay: false, scrollOnUserInput: true, scrollSensitivity: 1, screenReaderMode: false, smoothScrollDuration: 0, macOptionIsMeta: false, macOptionClickForcesSelection: false, minimumContrastRatio: 1, disableStdin: false, allowProposedApi: false, allowTransparency: false, tabStopWidth: 8, theme: {}, reflowCursorLine: false, rescaleOverlappingGlyphs: false, rightClickSelectsWord: Zt, windowOptions: {}, windowsMode: false, windowsPty: {}, wordSeparator: " ()[]{}',\"`", altClickMovesCursor: true, convertEol: false, termName: "xterm", cancelEvents: false, overviewRuler: {} }, nc = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"], dn = class extends D {
      constructor(e) {
        super();
        this._onOptionChange = this._register(new v());
        this.onOptionChange = this._onOptionChange.event;
        let i = { ...si };
        for (let r in e) if (r in i) try {
          let n = e[r];
          i[r] = this._sanitizeAndValidateOption(r, n);
        } catch (n) {
          console.error(n);
        }
        this.rawOptions = i, this.options = { ...i }, this._setupOptions(), this._register(C(() => {
          this.rawOptions.linkHandler = null, this.rawOptions.documentOverride = null;
        }));
      }
      onSpecificOptionChange(e, i) {
        return this.onOptionChange((r) => {
          r === e && i(this.rawOptions[e]);
        });
      }
      onMultipleOptionChange(e, i) {
        return this.onOptionChange((r) => {
          e.indexOf(r) !== -1 && i();
        });
      }
      _setupOptions() {
        let e = (r) => {
          if (!(r in si)) throw new Error(`No option with key "${r}"`);
          return this.rawOptions[r];
        }, i = (r, n) => {
          if (!(r in si)) throw new Error(`No option with key "${r}"`);
          n = this._sanitizeAndValidateOption(r, n), this.rawOptions[r] !== n && (this.rawOptions[r] = n, this._onOptionChange.fire(r));
        };
        for (let r in this.rawOptions) {
          let n = { get: e.bind(this, r), set: i.bind(this, r) };
          Object.defineProperty(this.options, r, n);
        }
      }
      _sanitizeAndValidateOption(e, i) {
        switch (e) {
          case "cursorStyle":
            if (i || (i = si[e]), !sc(i)) throw new Error(`"${i}" is not a valid value for ${e}`);
            break;
          case "wordSeparator":
            i || (i = si[e]);
            break;
          case "fontWeight":
          case "fontWeightBold":
            if (typeof i == "number" && 1 <= i && i <= 1e3) break;
            i = nc.includes(i) ? i : si[e];
            break;
          case "cursorWidth":
            i = Math.floor(i);
          case "lineHeight":
          case "tabStopWidth":
            if (i < 1) throw new Error(`${e} cannot be less than 1, value: ${i}`);
            break;
          case "minimumContrastRatio":
            i = Math.max(1, Math.min(21, Math.round(i * 10) / 10));
            break;
          case "scrollback":
            if (i = Math.min(i, 4294967295), i < 0) throw new Error(`${e} cannot be less than 0, value: ${i}`);
            break;
          case "fastScrollSensitivity":
          case "scrollSensitivity":
            if (i <= 0) throw new Error(`${e} cannot be less than or equal to 0, value: ${i}`);
            break;
          case "rows":
          case "cols":
            if (!i && i !== 0) throw new Error(`${e} must be numeric, value: ${i}`);
            break;
          case "windowsPty":
            i = i ?? {};
            break;
        }
        return i;
      }
    };
    ul = Object.freeze({ insertMode: false }), hl = Object.freeze({ applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false, cursorBlink: void 0, cursorStyle: void 0, origin: false, reverseWraparound: false, sendFocus: false, synchronizedOutput: false, wraparound: true }), li = class extends D {
      constructor(e, i, r) {
        super();
        this._bufferService = e;
        this._logService = i;
        this._optionsService = r;
        this.isCursorInitialized = false;
        this.isCursorHidden = false;
        this._onData = this._register(new v());
        this.onData = this._onData.event;
        this._onUserInput = this._register(new v());
        this.onUserInput = this._onUserInput.event;
        this._onBinary = this._register(new v());
        this.onBinary = this._onBinary.event;
        this._onRequestScrollToBottom = this._register(new v());
        this.onRequestScrollToBottom = this._onRequestScrollToBottom.event;
        this.modes = oi(ul), this.decPrivateModes = oi(hl);
      }
      reset() {
        this.modes = oi(ul), this.decPrivateModes = oi(hl);
      }
      triggerDataEvent(e, i = false) {
        if (this._optionsService.rawOptions.disableStdin) return;
        let r = this._bufferService.buffer;
        i && this._optionsService.rawOptions.scrollOnUserInput && r.ybase !== r.ydisp && this._onRequestScrollToBottom.fire(), i && this._onUserInput.fire(), this._logService.debug(`sending data "${e}"`), this._logService.trace("sending data (codes)", () => e.split("").map((n) => n.charCodeAt(0))), this._onData.fire(e);
      }
      triggerBinaryEvent(e) {
        this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e}"`), this._logService.trace("sending binary (codes)", () => e.split("").map((i) => i.charCodeAt(0))), this._onBinary.fire(e));
      }
    };
    li = M([S(0, F), S(1, nr), S(2, H)], li);
    dl = { NONE: { events: 0, restrict: () => false }, X10: { events: 1, restrict: (s15) => s15.button === 4 || s15.action !== 1 ? false : (s15.ctrl = false, s15.alt = false, s15.shift = false, true) }, VT200: { events: 19, restrict: (s15) => s15.action !== 32 }, DRAG: { events: 23, restrict: (s15) => !(s15.action === 32 && s15.button === 3) }, ANY: { events: 31, restrict: (s15) => true } };
    Ps = String.fromCharCode, fl = { DEFAULT: (s15) => {
      let t = [Ms(s15, false) + 32, s15.col + 32, s15.row + 32];
      return t[0] > 255 || t[1] > 255 || t[2] > 255 ? "" : `\x1B[M${Ps(t[0])}${Ps(t[1])}${Ps(t[2])}`;
    }, SGR: (s15) => {
      let t = s15.action === 0 && s15.button !== 4 ? "m" : "M";
      return `\x1B[<${Ms(s15, true)};${s15.col};${s15.row}${t}`;
    }, SGR_PIXELS: (s15) => {
      let t = s15.action === 0 && s15.button !== 4 ? "m" : "M";
      return `\x1B[<${Ms(s15, true)};${s15.x};${s15.y}${t}`;
    } }, ai = class extends D {
      constructor(e, i, r) {
        super();
        this._bufferService = e;
        this._coreService = i;
        this._optionsService = r;
        this._protocols = {};
        this._encodings = {};
        this._activeProtocol = "";
        this._activeEncoding = "";
        this._lastEvent = null;
        this._wheelPartialScroll = 0;
        this._onProtocolChange = this._register(new v());
        this.onProtocolChange = this._onProtocolChange.event;
        for (let n of Object.keys(dl)) this.addProtocol(n, dl[n]);
        for (let n of Object.keys(fl)) this.addEncoding(n, fl[n]);
        this.reset();
      }
      addProtocol(e, i) {
        this._protocols[e] = i;
      }
      addEncoding(e, i) {
        this._encodings[e] = i;
      }
      get activeProtocol() {
        return this._activeProtocol;
      }
      get areMouseEventsActive() {
        return this._protocols[this._activeProtocol].events !== 0;
      }
      set activeProtocol(e) {
        if (!this._protocols[e]) throw new Error(`unknown protocol "${e}"`);
        this._activeProtocol = e, this._onProtocolChange.fire(this._protocols[e].events);
      }
      get activeEncoding() {
        return this._activeEncoding;
      }
      set activeEncoding(e) {
        if (!this._encodings[e]) throw new Error(`unknown encoding "${e}"`);
        this._activeEncoding = e;
      }
      reset() {
        this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null, this._wheelPartialScroll = 0;
      }
      consumeWheelEvent(e, i, r) {
        if (e.deltaY === 0 || e.shiftKey || i === void 0 || r === void 0) return 0;
        let n = i / r, o = this._applyScrollModifier(e.deltaY, e);
        return e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (o /= n + 0, Math.abs(e.deltaY) < 50 && (o *= 0.3), this._wheelPartialScroll += o, o = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e.deltaMode === WheelEvent.DOM_DELTA_PAGE && (o *= this._bufferService.rows), o;
      }
      _applyScrollModifier(e, i) {
        return i.altKey || i.ctrlKey || i.shiftKey ? e * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e * this._optionsService.rawOptions.scrollSensitivity;
      }
      triggerMouseEvent(e) {
        if (e.col < 0 || e.col >= this._bufferService.cols || e.row < 0 || e.row >= this._bufferService.rows || e.button === 4 && e.action === 32 || e.button === 3 && e.action !== 32 || e.button !== 4 && (e.action === 2 || e.action === 3) || (e.col++, e.row++, e.action === 32 && this._lastEvent && this._equalEvents(this._lastEvent, e, this._activeEncoding === "SGR_PIXELS")) || !this._protocols[this._activeProtocol].restrict(e)) return false;
        let i = this._encodings[this._activeEncoding](e);
        return i && (this._activeEncoding === "DEFAULT" ? this._coreService.triggerBinaryEvent(i) : this._coreService.triggerDataEvent(i, true)), this._lastEvent = e, true;
      }
      explainEvents(e) {
        return { down: !!(e & 1), up: !!(e & 2), drag: !!(e & 4), move: !!(e & 8), wheel: !!(e & 16) };
      }
      _equalEvents(e, i, r) {
        if (r) {
          if (e.x !== i.x || e.y !== i.y) return false;
        } else if (e.col !== i.col || e.row !== i.row) return false;
        return !(e.button !== i.button || e.action !== i.action || e.ctrl !== i.ctrl || e.alt !== i.alt || e.shift !== i.shift);
      }
    };
    ai = M([S(0, F), S(1, ge), S(2, H)], ai);
    Os = [[768, 879], [1155, 1158], [1160, 1161], [1425, 1469], [1471, 1471], [1473, 1474], [1476, 1477], [1479, 1479], [1536, 1539], [1552, 1557], [1611, 1630], [1648, 1648], [1750, 1764], [1767, 1768], [1770, 1773], [1807, 1807], [1809, 1809], [1840, 1866], [1958, 1968], [2027, 2035], [2305, 2306], [2364, 2364], [2369, 2376], [2381, 2381], [2385, 2388], [2402, 2403], [2433, 2433], [2492, 2492], [2497, 2500], [2509, 2509], [2530, 2531], [2561, 2562], [2620, 2620], [2625, 2626], [2631, 2632], [2635, 2637], [2672, 2673], [2689, 2690], [2748, 2748], [2753, 2757], [2759, 2760], [2765, 2765], [2786, 2787], [2817, 2817], [2876, 2876], [2879, 2879], [2881, 2883], [2893, 2893], [2902, 2902], [2946, 2946], [3008, 3008], [3021, 3021], [3134, 3136], [3142, 3144], [3146, 3149], [3157, 3158], [3260, 3260], [3263, 3263], [3270, 3270], [3276, 3277], [3298, 3299], [3393, 3395], [3405, 3405], [3530, 3530], [3538, 3540], [3542, 3542], [3633, 3633], [3636, 3642], [3655, 3662], [3761, 3761], [3764, 3769], [3771, 3772], [3784, 3789], [3864, 3865], [3893, 3893], [3895, 3895], [3897, 3897], [3953, 3966], [3968, 3972], [3974, 3975], [3984, 3991], [3993, 4028], [4038, 4038], [4141, 4144], [4146, 4146], [4150, 4151], [4153, 4153], [4184, 4185], [4448, 4607], [4959, 4959], [5906, 5908], [5938, 5940], [5970, 5971], [6002, 6003], [6068, 6069], [6071, 6077], [6086, 6086], [6089, 6099], [6109, 6109], [6155, 6157], [6313, 6313], [6432, 6434], [6439, 6440], [6450, 6450], [6457, 6459], [6679, 6680], [6912, 6915], [6964, 6964], [6966, 6970], [6972, 6972], [6978, 6978], [7019, 7027], [7616, 7626], [7678, 7679], [8203, 8207], [8234, 8238], [8288, 8291], [8298, 8303], [8400, 8431], [12330, 12335], [12441, 12442], [43014, 43014], [43019, 43019], [43045, 43046], [64286, 64286], [65024, 65039], [65056, 65059], [65279, 65279], [65529, 65531]], ac = [[68097, 68099], [68101, 68102], [68108, 68111], [68152, 68154], [68159, 68159], [119143, 119145], [119155, 119170], [119173, 119179], [119210, 119213], [119362, 119364], [917505, 917505], [917536, 917631], [917760, 917999]];
    fn = class {
      constructor() {
        this.version = "6";
        if (!se) {
          se = new Uint8Array(65536), se.fill(1), se[0] = 0, se.fill(0, 1, 32), se.fill(0, 127, 160), se.fill(2, 4352, 4448), se[9001] = 2, se[9002] = 2, se.fill(2, 11904, 42192), se[12351] = 1, se.fill(2, 44032, 55204), se.fill(2, 63744, 64256), se.fill(2, 65040, 65050), se.fill(2, 65072, 65136), se.fill(2, 65280, 65377), se.fill(2, 65504, 65511);
          for (let t = 0; t < Os.length; ++t) se.fill(0, Os[t][0], Os[t][1] + 1);
        }
      }
      wcwidth(t) {
        return t < 32 ? 0 : t < 127 ? 1 : t < 65536 ? se[t] : cc(t, ac) ? 0 : t >= 131072 && t <= 196605 || t >= 196608 && t <= 262141 ? 2 : 1;
      }
      charProperties(t, e) {
        let i = this.wcwidth(t), r = i === 0 && e !== 0;
        if (r) {
          let n = Ae.extractWidth(e);
          n === 0 ? r = false : n > i && (i = n);
        }
        return Ae.createPropertyValue(0, i, r);
      }
    };
    Ae = class s13 {
      constructor() {
        this._providers = /* @__PURE__ */ Object.create(null);
        this._active = "";
        this._onChange = new v();
        this.onChange = this._onChange.event;
        let t = new fn();
        this.register(t), this._active = t.version, this._activeProvider = t;
      }
      static extractShouldJoin(t) {
        return (t & 1) !== 0;
      }
      static extractWidth(t) {
        return t >> 1 & 3;
      }
      static extractCharKind(t) {
        return t >> 3;
      }
      static createPropertyValue(t, e, i = false) {
        return (t & 16777215) << 3 | (e & 3) << 1 | (i ? 1 : 0);
      }
      dispose() {
        this._onChange.dispose();
      }
      get versions() {
        return Object.keys(this._providers);
      }
      get activeVersion() {
        return this._active;
      }
      set activeVersion(t) {
        if (!this._providers[t]) throw new Error(`unknown Unicode version "${t}"`);
        this._active = t, this._activeProvider = this._providers[t], this._onChange.fire(t);
      }
      register(t) {
        this._providers[t.version] = t;
      }
      wcwidth(t) {
        return this._activeProvider.wcwidth(t);
      }
      getStringCellWidth(t) {
        let e = 0, i = 0, r = t.length;
        for (let n = 0; n < r; ++n) {
          let o = t.charCodeAt(n);
          if (55296 <= o && o <= 56319) {
            if (++n >= r) return e + this.wcwidth(o);
            let u = t.charCodeAt(n);
            56320 <= u && u <= 57343 ? o = (o - 55296) * 1024 + u - 56320 + 65536 : e += this.wcwidth(u);
          }
          let l = this.charProperties(o, i), a = s13.extractWidth(l);
          s13.extractShouldJoin(l) && (a -= s13.extractWidth(i)), e += a, i = l;
        }
        return e;
      }
      charProperties(t, e) {
        return this._activeProvider.charProperties(t, e);
      }
    };
    pn = class {
      constructor() {
        this.glevel = 0;
        this._charsets = [];
      }
      reset() {
        this.charset = void 0, this._charsets = [], this.glevel = 0;
      }
      setgLevel(t) {
        this.glevel = t, this.charset = this._charsets[t];
      }
      setgCharset(t, e) {
        this._charsets[t] = e, this.glevel === t && (this.charset = e);
      }
    };
    Vi = 2147483647, uc = 256, ci = class s14 {
      constructor(t = 32, e = 32) {
        this.maxLength = t;
        this.maxSubParamsLength = e;
        if (e > uc) throw new Error("maxSubParamsLength must not be greater than 256");
        this.params = new Int32Array(t), this.length = 0, this._subParams = new Int32Array(e), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(t), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
      }
      static fromArray(t) {
        let e = new s14();
        if (!t.length) return e;
        for (let i = Array.isArray(t[0]) ? 1 : 0; i < t.length; ++i) {
          let r = t[i];
          if (Array.isArray(r)) for (let n = 0; n < r.length; ++n) e.addSubParam(r[n]);
          else e.addParam(r);
        }
        return e;
      }
      clone() {
        let t = new s14(this.maxLength, this.maxSubParamsLength);
        return t.params.set(this.params), t.length = this.length, t._subParams.set(this._subParams), t._subParamsLength = this._subParamsLength, t._subParamsIdx.set(this._subParamsIdx), t._rejectDigits = this._rejectDigits, t._rejectSubDigits = this._rejectSubDigits, t._digitIsSub = this._digitIsSub, t;
      }
      toArray() {
        let t = [];
        for (let e = 0; e < this.length; ++e) {
          t.push(this.params[e]);
          let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
          r - i > 0 && t.push(Array.prototype.slice.call(this._subParams, i, r));
        }
        return t;
      }
      reset() {
        this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
      }
      addParam(t) {
        if (this._digitIsSub = false, this.length >= this.maxLength) {
          this._rejectDigits = true;
          return;
        }
        if (t < -1) throw new Error("values lesser than -1 are not allowed");
        this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = t > Vi ? Vi : t;
      }
      addSubParam(t) {
        if (this._digitIsSub = true, !!this.length) {
          if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) {
            this._rejectSubDigits = true;
            return;
          }
          if (t < -1) throw new Error("values lesser than -1 are not allowed");
          this._subParams[this._subParamsLength++] = t > Vi ? Vi : t, this._subParamsIdx[this.length - 1]++;
        }
      }
      hasSubParams(t) {
        return (this._subParamsIdx[t] & 255) - (this._subParamsIdx[t] >> 8) > 0;
      }
      getSubParams(t) {
        let e = this._subParamsIdx[t] >> 8, i = this._subParamsIdx[t] & 255;
        return i - e > 0 ? this._subParams.subarray(e, i) : null;
      }
      getSubParamsAll() {
        let t = {};
        for (let e = 0; e < this.length; ++e) {
          let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
          r - i > 0 && (t[e] = this._subParams.slice(i, r));
        }
        return t;
      }
      addDigit(t) {
        let e;
        if (this._rejectDigits || !(e = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
        let i = this._digitIsSub ? this._subParams : this.params, r = i[e - 1];
        i[e - 1] = ~r ? Math.min(r * 10 + t, Vi) : t;
      }
    };
    qi = [], mn = class {
      constructor() {
        this._state = 0;
        this._active = qi;
        this._id = -1;
        this._handlers = /* @__PURE__ */ Object.create(null);
        this._handlerFb = () => {
        };
        this._stack = { paused: false, loopPosition: 0, fallThrough: false };
      }
      registerHandler(t, e) {
        this._handlers[t] === void 0 && (this._handlers[t] = []);
        let i = this._handlers[t];
        return i.push(e), { dispose: () => {
          let r = i.indexOf(e);
          r !== -1 && i.splice(r, 1);
        } };
      }
      clearHandler(t) {
        this._handlers[t] && delete this._handlers[t];
      }
      setHandlerFallback(t) {
        this._handlerFb = t;
      }
      dispose() {
        this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
        }, this._active = qi;
      }
      reset() {
        if (this._state === 2) for (let t = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t >= 0; --t) this._active[t].end(false);
        this._stack.paused = false, this._active = qi, this._id = -1, this._state = 0;
      }
      _start() {
        if (this._active = this._handlers[this._id] || qi, !this._active.length) this._handlerFb(this._id, "START");
        else for (let t = this._active.length - 1; t >= 0; t--) this._active[t].start();
      }
      _put(t, e, i) {
        if (!this._active.length) this._handlerFb(this._id, "PUT", It(t, e, i));
        else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t, e, i);
      }
      start() {
        this.reset(), this._state = 1;
      }
      put(t, e, i) {
        if (this._state !== 3) {
          if (this._state === 1) for (; e < i; ) {
            let r = t[e++];
            if (r === 59) {
              this._state = 2, this._start();
              break;
            }
            if (r < 48 || 57 < r) {
              this._state = 3;
              return;
            }
            this._id === -1 && (this._id = 0), this._id = this._id * 10 + r - 48;
          }
          this._state === 2 && i - e > 0 && this._put(t, e, i);
        }
      }
      end(t, e = true) {
        if (this._state !== 0) {
          if (this._state !== 3) if (this._state === 1 && this._start(), !this._active.length) this._handlerFb(this._id, "END", t);
          else {
            let i = false, r = this._active.length - 1, n = false;
            if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
              for (; r >= 0 && (i = this._active[r].end(t), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
              r--;
            }
            for (; r >= 0; r--) if (i = this._active[r].end(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
          }
          this._active = qi, this._id = -1, this._state = 0;
        }
      }
    }, pe = class {
      constructor(t) {
        this._handler = t;
        this._data = "";
        this._hitLimit = false;
      }
      start() {
        this._data = "", this._hitLimit = false;
      }
      put(t, e, i) {
        this._hitLimit || (this._data += It(t, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
      }
      end(t) {
        let e = false;
        if (this._hitLimit) e = false;
        else if (t && (e = this._handler(this._data), e instanceof Promise)) return e.then((i) => (this._data = "", this._hitLimit = false, i));
        return this._data = "", this._hitLimit = false, e;
      }
    };
    Yi = [], _n = class {
      constructor() {
        this._handlers = /* @__PURE__ */ Object.create(null);
        this._active = Yi;
        this._ident = 0;
        this._handlerFb = () => {
        };
        this._stack = { paused: false, loopPosition: 0, fallThrough: false };
      }
      dispose() {
        this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
        }, this._active = Yi;
      }
      registerHandler(t, e) {
        this._handlers[t] === void 0 && (this._handlers[t] = []);
        let i = this._handlers[t];
        return i.push(e), { dispose: () => {
          let r = i.indexOf(e);
          r !== -1 && i.splice(r, 1);
        } };
      }
      clearHandler(t) {
        this._handlers[t] && delete this._handlers[t];
      }
      setHandlerFallback(t) {
        this._handlerFb = t;
      }
      reset() {
        if (this._active.length) for (let t = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t >= 0; --t) this._active[t].unhook(false);
        this._stack.paused = false, this._active = Yi, this._ident = 0;
      }
      hook(t, e) {
        if (this.reset(), this._ident = t, this._active = this._handlers[t] || Yi, !this._active.length) this._handlerFb(this._ident, "HOOK", e);
        else for (let i = this._active.length - 1; i >= 0; i--) this._active[i].hook(e);
      }
      put(t, e, i) {
        if (!this._active.length) this._handlerFb(this._ident, "PUT", It(t, e, i));
        else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t, e, i);
      }
      unhook(t, e = true) {
        if (!this._active.length) this._handlerFb(this._ident, "UNHOOK", t);
        else {
          let i = false, r = this._active.length - 1, n = false;
          if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
            for (; r >= 0 && (i = this._active[r].unhook(t), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
            r--;
          }
          for (; r >= 0; r--) if (i = this._active[r].unhook(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
        }
        this._active = Yi, this._ident = 0;
      }
    }, ji = new ci();
    ji.addParam(0);
    Xi = class {
      constructor(t) {
        this._handler = t;
        this._data = "";
        this._params = ji;
        this._hitLimit = false;
      }
      hook(t) {
        this._params = t.length > 1 || t.params[0] ? t.clone() : ji, this._data = "", this._hitLimit = false;
      }
      put(t, e, i) {
        this._hitLimit || (this._data += It(t, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
      }
      unhook(t) {
        let e = false;
        if (this._hitLimit) e = false;
        else if (t && (e = this._handler(this._data, this._params), e instanceof Promise)) return e.then((i) => (this._params = ji, this._data = "", this._hitLimit = false, i));
        return this._params = ji, this._data = "", this._hitLimit = false, e;
      }
    };
    Fs = class {
      constructor(t) {
        this.table = new Uint8Array(t);
      }
      setDefault(t, e) {
        this.table.fill(t << 4 | e);
      }
      add(t, e, i, r) {
        this.table[e << 8 | t] = i << 4 | r;
      }
      addMany(t, e, i, r) {
        for (let n = 0; n < t.length; n++) this.table[e << 8 | t[n]] = i << 4 | r;
      }
    }, ke = 160, hc = (function() {
      let s15 = new Fs(4095), e = Array.apply(null, Array(256)).map((a, u) => u), i = (a, u) => e.slice(a, u), r = i(32, 127), n = i(0, 24);
      n.push(25), n.push.apply(n, i(28, 32));
      let o = i(0, 14), l;
      s15.setDefault(1, 0), s15.addMany(r, 0, 2, 0);
      for (l in o) s15.addMany([24, 26, 153, 154], l, 3, 0), s15.addMany(i(128, 144), l, 3, 0), s15.addMany(i(144, 152), l, 3, 0), s15.add(156, l, 0, 0), s15.add(27, l, 11, 1), s15.add(157, l, 4, 8), s15.addMany([152, 158, 159], l, 0, 7), s15.add(155, l, 11, 3), s15.add(144, l, 11, 9);
      return s15.addMany(n, 0, 3, 0), s15.addMany(n, 1, 3, 1), s15.add(127, 1, 0, 1), s15.addMany(n, 8, 0, 8), s15.addMany(n, 3, 3, 3), s15.add(127, 3, 0, 3), s15.addMany(n, 4, 3, 4), s15.add(127, 4, 0, 4), s15.addMany(n, 6, 3, 6), s15.addMany(n, 5, 3, 5), s15.add(127, 5, 0, 5), s15.addMany(n, 2, 3, 2), s15.add(127, 2, 0, 2), s15.add(93, 1, 4, 8), s15.addMany(r, 8, 5, 8), s15.add(127, 8, 5, 8), s15.addMany([156, 27, 24, 26, 7], 8, 6, 0), s15.addMany(i(28, 32), 8, 0, 8), s15.addMany([88, 94, 95], 1, 0, 7), s15.addMany(r, 7, 0, 7), s15.addMany(n, 7, 0, 7), s15.add(156, 7, 0, 0), s15.add(127, 7, 0, 7), s15.add(91, 1, 11, 3), s15.addMany(i(64, 127), 3, 7, 0), s15.addMany(i(48, 60), 3, 8, 4), s15.addMany([60, 61, 62, 63], 3, 9, 4), s15.addMany(i(48, 60), 4, 8, 4), s15.addMany(i(64, 127), 4, 7, 0), s15.addMany([60, 61, 62, 63], 4, 0, 6), s15.addMany(i(32, 64), 6, 0, 6), s15.add(127, 6, 0, 6), s15.addMany(i(64, 127), 6, 0, 0), s15.addMany(i(32, 48), 3, 9, 5), s15.addMany(i(32, 48), 5, 9, 5), s15.addMany(i(48, 64), 5, 0, 6), s15.addMany(i(64, 127), 5, 7, 0), s15.addMany(i(32, 48), 4, 9, 5), s15.addMany(i(32, 48), 1, 9, 2), s15.addMany(i(32, 48), 2, 9, 2), s15.addMany(i(48, 127), 2, 10, 0), s15.addMany(i(48, 80), 1, 10, 0), s15.addMany(i(81, 88), 1, 10, 0), s15.addMany([89, 90, 92], 1, 10, 0), s15.addMany(i(96, 127), 1, 10, 0), s15.add(80, 1, 11, 9), s15.addMany(n, 9, 0, 9), s15.add(127, 9, 0, 9), s15.addMany(i(28, 32), 9, 0, 9), s15.addMany(i(32, 48), 9, 9, 12), s15.addMany(i(48, 60), 9, 8, 10), s15.addMany([60, 61, 62, 63], 9, 9, 10), s15.addMany(n, 11, 0, 11), s15.addMany(i(32, 128), 11, 0, 11), s15.addMany(i(28, 32), 11, 0, 11), s15.addMany(n, 10, 0, 10), s15.add(127, 10, 0, 10), s15.addMany(i(28, 32), 10, 0, 10), s15.addMany(i(48, 60), 10, 8, 10), s15.addMany([60, 61, 62, 63], 10, 0, 11), s15.addMany(i(32, 48), 10, 9, 12), s15.addMany(n, 12, 0, 12), s15.add(127, 12, 0, 12), s15.addMany(i(28, 32), 12, 0, 12), s15.addMany(i(32, 48), 12, 9, 12), s15.addMany(i(48, 64), 12, 0, 11), s15.addMany(i(64, 127), 12, 12, 13), s15.addMany(i(64, 127), 10, 12, 13), s15.addMany(i(64, 127), 9, 12, 13), s15.addMany(n, 13, 13, 13), s15.addMany(r, 13, 13, 13), s15.add(127, 13, 0, 13), s15.addMany([27, 156, 24, 26], 13, 14, 0), s15.add(ke, 0, 2, 0), s15.add(ke, 8, 5, 8), s15.add(ke, 6, 0, 6), s15.add(ke, 11, 0, 11), s15.add(ke, 13, 13, 13), s15;
    })(), bn = class extends D {
      constructor(e = hc) {
        super();
        this._transitions = e;
        this._parseStack = { state: 0, handlers: [], handlerPos: 0, transition: 0, chunkPos: 0 };
        this.initialState = 0, this.currentState = this.initialState, this._params = new ci(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._printHandlerFb = (i, r, n) => {
        }, this._executeHandlerFb = (i) => {
        }, this._csiHandlerFb = (i, r) => {
        }, this._escHandlerFb = (i) => {
        }, this._errorHandlerFb = (i) => i, this._printHandler = this._printHandlerFb, this._executeHandlers = /* @__PURE__ */ Object.create(null), this._csiHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null), this._register(C(() => {
          this._csiHandlers = /* @__PURE__ */ Object.create(null), this._executeHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null);
        })), this._oscParser = this._register(new mn()), this._dcsParser = this._register(new _n()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, () => true);
      }
      _identifier(e, i = [64, 126]) {
        let r = 0;
        if (e.prefix) {
          if (e.prefix.length > 1) throw new Error("only one byte as prefix supported");
          if (r = e.prefix.charCodeAt(0), r && 60 > r || r > 63) throw new Error("prefix must be in range 0x3c .. 0x3f");
        }
        if (e.intermediates) {
          if (e.intermediates.length > 2) throw new Error("only two bytes as intermediates are supported");
          for (let o = 0; o < e.intermediates.length; ++o) {
            let l = e.intermediates.charCodeAt(o);
            if (32 > l || l > 47) throw new Error("intermediate must be in range 0x20 .. 0x2f");
            r <<= 8, r |= l;
          }
        }
        if (e.final.length !== 1) throw new Error("final must be a single byte");
        let n = e.final.charCodeAt(0);
        if (i[0] > n || n > i[1]) throw new Error(`final must be in range ${i[0]} .. ${i[1]}`);
        return r <<= 8, r |= n, r;
      }
      identToString(e) {
        let i = [];
        for (; e; ) i.push(String.fromCharCode(e & 255)), e >>= 8;
        return i.reverse().join("");
      }
      setPrintHandler(e) {
        this._printHandler = e;
      }
      clearPrintHandler() {
        this._printHandler = this._printHandlerFb;
      }
      registerEscHandler(e, i) {
        let r = this._identifier(e, [48, 126]);
        this._escHandlers[r] === void 0 && (this._escHandlers[r] = []);
        let n = this._escHandlers[r];
        return n.push(i), { dispose: () => {
          let o = n.indexOf(i);
          o !== -1 && n.splice(o, 1);
        } };
      }
      clearEscHandler(e) {
        this._escHandlers[this._identifier(e, [48, 126])] && delete this._escHandlers[this._identifier(e, [48, 126])];
      }
      setEscHandlerFallback(e) {
        this._escHandlerFb = e;
      }
      setExecuteHandler(e, i) {
        this._executeHandlers[e.charCodeAt(0)] = i;
      }
      clearExecuteHandler(e) {
        this._executeHandlers[e.charCodeAt(0)] && delete this._executeHandlers[e.charCodeAt(0)];
      }
      setExecuteHandlerFallback(e) {
        this._executeHandlerFb = e;
      }
      registerCsiHandler(e, i) {
        let r = this._identifier(e);
        this._csiHandlers[r] === void 0 && (this._csiHandlers[r] = []);
        let n = this._csiHandlers[r];
        return n.push(i), { dispose: () => {
          let o = n.indexOf(i);
          o !== -1 && n.splice(o, 1);
        } };
      }
      clearCsiHandler(e) {
        this._csiHandlers[this._identifier(e)] && delete this._csiHandlers[this._identifier(e)];
      }
      setCsiHandlerFallback(e) {
        this._csiHandlerFb = e;
      }
      registerDcsHandler(e, i) {
        return this._dcsParser.registerHandler(this._identifier(e), i);
      }
      clearDcsHandler(e) {
        this._dcsParser.clearHandler(this._identifier(e));
      }
      setDcsHandlerFallback(e) {
        this._dcsParser.setHandlerFallback(e);
      }
      registerOscHandler(e, i) {
        return this._oscParser.registerHandler(e, i);
      }
      clearOscHandler(e) {
        this._oscParser.clearHandler(e);
      }
      setOscHandlerFallback(e) {
        this._oscParser.setHandlerFallback(e);
      }
      setErrorHandler(e) {
        this._errorHandler = e;
      }
      clearErrorHandler() {
        this._errorHandler = this._errorHandlerFb;
      }
      reset() {
        this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._parseStack.state !== 0 && (this._parseStack.state = 2, this._parseStack.handlers = []);
      }
      _preserveStack(e, i, r, n, o) {
        this._parseStack.state = e, this._parseStack.handlers = i, this._parseStack.handlerPos = r, this._parseStack.transition = n, this._parseStack.chunkPos = o;
      }
      parse(e, i, r) {
        let n = 0, o = 0, l = 0, a;
        if (this._parseStack.state) if (this._parseStack.state === 2) this._parseStack.state = 0, l = this._parseStack.chunkPos + 1;
        else {
          if (r === void 0 || this._parseStack.state === 1) throw this._parseStack.state = 1, new Error("improper continuation due to previous async handler, giving up parsing");
          let u = this._parseStack.handlers, h8 = this._parseStack.handlerPos - 1;
          switch (this._parseStack.state) {
            case 3:
              if (r === false && h8 > -1) {
                for (; h8 >= 0 && (a = u[h8](this._params), a !== true); h8--) if (a instanceof Promise) return this._parseStack.handlerPos = h8, a;
              }
              this._parseStack.handlers = [];
              break;
            case 4:
              if (r === false && h8 > -1) {
                for (; h8 >= 0 && (a = u[h8](), a !== true); h8--) if (a instanceof Promise) return this._parseStack.handlerPos = h8, a;
              }
              this._parseStack.handlers = [];
              break;
            case 6:
              if (n = e[this._parseStack.chunkPos], a = this._dcsParser.unhook(n !== 24 && n !== 26, r), a) return a;
              n === 27 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
              break;
            case 5:
              if (n = e[this._parseStack.chunkPos], a = this._oscParser.end(n !== 24 && n !== 26, r), a) return a;
              n === 27 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
              break;
          }
          this._parseStack.state = 0, l = this._parseStack.chunkPos + 1, this.precedingJoinState = 0, this.currentState = this._parseStack.transition & 15;
        }
        for (let u = l; u < i; ++u) {
          switch (n = e[u], o = this._transitions.table[this.currentState << 8 | (n < 160 ? n : ke)], o >> 4) {
            case 2:
              for (let m = u + 1; ; ++m) {
                if (m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
                if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
                if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
                if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
                  this._printHandler(e, u, m), u = m - 1;
                  break;
                }
              }
              break;
            case 3:
              this._executeHandlers[n] ? this._executeHandlers[n]() : this._executeHandlerFb(n), this.precedingJoinState = 0;
              break;
            case 0:
              break;
            case 1:
              if (this._errorHandler({ position: u, code: n, currentState: this.currentState, collect: this._collect, params: this._params, abort: false }).abort) return;
              break;
            case 7:
              let c = this._csiHandlers[this._collect << 8 | n], d = c ? c.length - 1 : -1;
              for (; d >= 0 && (a = c[d](this._params), a !== true); d--) if (a instanceof Promise) return this._preserveStack(3, c, d, o, u), a;
              d < 0 && this._csiHandlerFb(this._collect << 8 | n, this._params), this.precedingJoinState = 0;
              break;
            case 8:
              do
                switch (n) {
                  case 59:
                    this._params.addParam(0);
                    break;
                  case 58:
                    this._params.addSubParam(-1);
                    break;
                  default:
                    this._params.addDigit(n - 48);
                }
              while (++u < i && (n = e[u]) > 47 && n < 60);
              u--;
              break;
            case 9:
              this._collect <<= 8, this._collect |= n;
              break;
            case 10:
              let _ = this._escHandlers[this._collect << 8 | n], p = _ ? _.length - 1 : -1;
              for (; p >= 0 && (a = _[p](), a !== true); p--) if (a instanceof Promise) return this._preserveStack(4, _, p, o, u), a;
              p < 0 && this._escHandlerFb(this._collect << 8 | n), this.precedingJoinState = 0;
              break;
            case 11:
              this._params.reset(), this._params.addParam(0), this._collect = 0;
              break;
            case 12:
              this._dcsParser.hook(this._collect << 8 | n, this._params);
              break;
            case 13:
              for (let m = u + 1; ; ++m) if (m >= i || (n = e[m]) === 24 || n === 26 || n === 27 || n > 127 && n < ke) {
                this._dcsParser.put(e, u, m), u = m - 1;
                break;
              }
              break;
            case 14:
              if (a = this._dcsParser.unhook(n !== 24 && n !== 26), a) return this._preserveStack(6, [], 0, o, u), a;
              n === 27 && (o |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
              break;
            case 4:
              this._oscParser.start();
              break;
            case 5:
              for (let m = u + 1; ; m++) if (m >= i || (n = e[m]) < 32 || n > 127 && n < ke) {
                this._oscParser.put(e, u, m), u = m - 1;
                break;
              }
              break;
            case 6:
              if (a = this._oscParser.end(n !== 24 && n !== 26), a) return this._preserveStack(5, [], 0, o, u), a;
              n === 27 && (o |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
              break;
          }
          this.currentState = o & 15;
        }
      }
    };
    dc = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/, fc = /^[\da-f]+$/;
    mc = { "(": 0, ")": 1, "*": 2, "+": 3, "-": 1, ".": 2 }, ut = 131072, _l = 10;
    vl = 5e3, gl = 0, vn = class extends D {
      constructor(e, i, r, n, o, l, a, u, h8 = new bn()) {
        super();
        this._bufferService = e;
        this._charsetService = i;
        this._coreService = r;
        this._logService = n;
        this._optionsService = o;
        this._oscLinkService = l;
        this._coreMouseService = a;
        this._unicodeService = u;
        this._parser = h8;
        this._parseBuffer = new Uint32Array(4096);
        this._stringDecoder = new er();
        this._utf8Decoder = new tr();
        this._windowTitle = "";
        this._iconName = "";
        this._windowTitleStack = [];
        this._iconNameStack = [];
        this._curAttrData = X.clone();
        this._eraseAttrDataInternal = X.clone();
        this._onRequestBell = this._register(new v());
        this.onRequestBell = this._onRequestBell.event;
        this._onRequestRefreshRows = this._register(new v());
        this.onRequestRefreshRows = this._onRequestRefreshRows.event;
        this._onRequestReset = this._register(new v());
        this.onRequestReset = this._onRequestReset.event;
        this._onRequestSendFocus = this._register(new v());
        this.onRequestSendFocus = this._onRequestSendFocus.event;
        this._onRequestSyncScrollBar = this._register(new v());
        this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event;
        this._onRequestWindowsOptionsReport = this._register(new v());
        this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event;
        this._onA11yChar = this._register(new v());
        this.onA11yChar = this._onA11yChar.event;
        this._onA11yTab = this._register(new v());
        this.onA11yTab = this._onA11yTab.event;
        this._onCursorMove = this._register(new v());
        this.onCursorMove = this._onCursorMove.event;
        this._onLineFeed = this._register(new v());
        this.onLineFeed = this._onLineFeed.event;
        this._onScroll = this._register(new v());
        this.onScroll = this._onScroll.event;
        this._onTitleChange = this._register(new v());
        this.onTitleChange = this._onTitleChange.event;
        this._onColor = this._register(new v());
        this.onColor = this._onColor.event;
        this._parseStack = { paused: false, cursorStartX: 0, cursorStartY: 0, decodedLength: 0, position: 0 };
        this._specialColors = [256, 257, 258];
        this._register(this._parser), this._dirtyRowTracker = new Zi(this._bufferService), this._activeBuffer = this._bufferService.buffer, this._register(this._bufferService.buffers.onBufferActivate((c) => this._activeBuffer = c.activeBuffer)), this._parser.setCsiHandlerFallback((c, d) => {
          this._logService.debug("Unknown CSI code: ", { identifier: this._parser.identToString(c), params: d.toArray() });
        }), this._parser.setEscHandlerFallback((c) => {
          this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(c) });
        }), this._parser.setExecuteHandlerFallback((c) => {
          this._logService.debug("Unknown EXECUTE code: ", { code: c });
        }), this._parser.setOscHandlerFallback((c, d, _) => {
          this._logService.debug("Unknown OSC code: ", { identifier: c, action: d, data: _ });
        }), this._parser.setDcsHandlerFallback((c, d, _) => {
          d === "HOOK" && (_ = _.toArray()), this._logService.debug("Unknown DCS code: ", { identifier: this._parser.identToString(c), action: d, payload: _ });
        }), this._parser.setPrintHandler((c, d, _) => this.print(c, d, _)), this._parser.registerCsiHandler({ final: "@" }, (c) => this.insertChars(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "@" }, (c) => this.scrollLeft(c)), this._parser.registerCsiHandler({ final: "A" }, (c) => this.cursorUp(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "A" }, (c) => this.scrollRight(c)), this._parser.registerCsiHandler({ final: "B" }, (c) => this.cursorDown(c)), this._parser.registerCsiHandler({ final: "C" }, (c) => this.cursorForward(c)), this._parser.registerCsiHandler({ final: "D" }, (c) => this.cursorBackward(c)), this._parser.registerCsiHandler({ final: "E" }, (c) => this.cursorNextLine(c)), this._parser.registerCsiHandler({ final: "F" }, (c) => this.cursorPrecedingLine(c)), this._parser.registerCsiHandler({ final: "G" }, (c) => this.cursorCharAbsolute(c)), this._parser.registerCsiHandler({ final: "H" }, (c) => this.cursorPosition(c)), this._parser.registerCsiHandler({ final: "I" }, (c) => this.cursorForwardTab(c)), this._parser.registerCsiHandler({ final: "J" }, (c) => this.eraseInDisplay(c, false)), this._parser.registerCsiHandler({ prefix: "?", final: "J" }, (c) => this.eraseInDisplay(c, true)), this._parser.registerCsiHandler({ final: "K" }, (c) => this.eraseInLine(c, false)), this._parser.registerCsiHandler({ prefix: "?", final: "K" }, (c) => this.eraseInLine(c, true)), this._parser.registerCsiHandler({ final: "L" }, (c) => this.insertLines(c)), this._parser.registerCsiHandler({ final: "M" }, (c) => this.deleteLines(c)), this._parser.registerCsiHandler({ final: "P" }, (c) => this.deleteChars(c)), this._parser.registerCsiHandler({ final: "S" }, (c) => this.scrollUp(c)), this._parser.registerCsiHandler({ final: "T" }, (c) => this.scrollDown(c)), this._parser.registerCsiHandler({ final: "X" }, (c) => this.eraseChars(c)), this._parser.registerCsiHandler({ final: "Z" }, (c) => this.cursorBackwardTab(c)), this._parser.registerCsiHandler({ final: "`" }, (c) => this.charPosAbsolute(c)), this._parser.registerCsiHandler({ final: "a" }, (c) => this.hPositionRelative(c)), this._parser.registerCsiHandler({ final: "b" }, (c) => this.repeatPrecedingCharacter(c)), this._parser.registerCsiHandler({ final: "c" }, (c) => this.sendDeviceAttributesPrimary(c)), this._parser.registerCsiHandler({ prefix: ">", final: "c" }, (c) => this.sendDeviceAttributesSecondary(c)), this._parser.registerCsiHandler({ final: "d" }, (c) => this.linePosAbsolute(c)), this._parser.registerCsiHandler({ final: "e" }, (c) => this.vPositionRelative(c)), this._parser.registerCsiHandler({ final: "f" }, (c) => this.hVPosition(c)), this._parser.registerCsiHandler({ final: "g" }, (c) => this.tabClear(c)), this._parser.registerCsiHandler({ final: "h" }, (c) => this.setMode(c)), this._parser.registerCsiHandler({ prefix: "?", final: "h" }, (c) => this.setModePrivate(c)), this._parser.registerCsiHandler({ final: "l" }, (c) => this.resetMode(c)), this._parser.registerCsiHandler({ prefix: "?", final: "l" }, (c) => this.resetModePrivate(c)), this._parser.registerCsiHandler({ final: "m" }, (c) => this.charAttributes(c)), this._parser.registerCsiHandler({ final: "n" }, (c) => this.deviceStatus(c)), this._parser.registerCsiHandler({ prefix: "?", final: "n" }, (c) => this.deviceStatusPrivate(c)), this._parser.registerCsiHandler({ intermediates: "!", final: "p" }, (c) => this.softReset(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "q" }, (c) => this.setCursorStyle(c)), this._parser.registerCsiHandler({ final: "r" }, (c) => this.setScrollRegion(c)), this._parser.registerCsiHandler({ final: "s" }, (c) => this.saveCursor(c)), this._parser.registerCsiHandler({ final: "t" }, (c) => this.windowOptions(c)), this._parser.registerCsiHandler({ final: "u" }, (c) => this.restoreCursor(c)), this._parser.registerCsiHandler({ intermediates: "'", final: "}" }, (c) => this.insertColumns(c)), this._parser.registerCsiHandler({ intermediates: "'", final: "~" }, (c) => this.deleteColumns(c)), this._parser.registerCsiHandler({ intermediates: '"', final: "q" }, (c) => this.selectProtected(c)), this._parser.registerCsiHandler({ intermediates: "$", final: "p" }, (c) => this.requestMode(c, true)), this._parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, (c) => this.requestMode(c, false)), this._parser.setExecuteHandler(b.BEL, () => this.bell()), this._parser.setExecuteHandler(b.LF, () => this.lineFeed()), this._parser.setExecuteHandler(b.VT, () => this.lineFeed()), this._parser.setExecuteHandler(b.FF, () => this.lineFeed()), this._parser.setExecuteHandler(b.CR, () => this.carriageReturn()), this._parser.setExecuteHandler(b.BS, () => this.backspace()), this._parser.setExecuteHandler(b.HT, () => this.tab()), this._parser.setExecuteHandler(b.SO, () => this.shiftOut()), this._parser.setExecuteHandler(b.SI, () => this.shiftIn()), this._parser.setExecuteHandler(Ai.IND, () => this.index()), this._parser.setExecuteHandler(Ai.NEL, () => this.nextLine()), this._parser.setExecuteHandler(Ai.HTS, () => this.tabSet()), this._parser.registerOscHandler(0, new pe((c) => (this.setTitle(c), this.setIconName(c), true))), this._parser.registerOscHandler(1, new pe((c) => this.setIconName(c))), this._parser.registerOscHandler(2, new pe((c) => this.setTitle(c))), this._parser.registerOscHandler(4, new pe((c) => this.setOrReportIndexedColor(c))), this._parser.registerOscHandler(8, new pe((c) => this.setHyperlink(c))), this._parser.registerOscHandler(10, new pe((c) => this.setOrReportFgColor(c))), this._parser.registerOscHandler(11, new pe((c) => this.setOrReportBgColor(c))), this._parser.registerOscHandler(12, new pe((c) => this.setOrReportCursorColor(c))), this._parser.registerOscHandler(104, new pe((c) => this.restoreIndexedColor(c))), this._parser.registerOscHandler(110, new pe((c) => this.restoreFgColor(c))), this._parser.registerOscHandler(111, new pe((c) => this.restoreBgColor(c))), this._parser.registerOscHandler(112, new pe((c) => this.restoreCursorColor(c))), this._parser.registerEscHandler({ final: "7" }, () => this.saveCursor()), this._parser.registerEscHandler({ final: "8" }, () => this.restoreCursor()), this._parser.registerEscHandler({ final: "D" }, () => this.index()), this._parser.registerEscHandler({ final: "E" }, () => this.nextLine()), this._parser.registerEscHandler({ final: "H" }, () => this.tabSet()), this._parser.registerEscHandler({ final: "M" }, () => this.reverseIndex()), this._parser.registerEscHandler({ final: "=" }, () => this.keypadApplicationMode()), this._parser.registerEscHandler({ final: ">" }, () => this.keypadNumericMode()), this._parser.registerEscHandler({ final: "c" }, () => this.fullReset()), this._parser.registerEscHandler({ final: "n" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "o" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "|" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "}" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "~" }, () => this.setgLevel(1)), this._parser.registerEscHandler({ intermediates: "%", final: "@" }, () => this.selectDefaultCharset()), this._parser.registerEscHandler({ intermediates: "%", final: "G" }, () => this.selectDefaultCharset());
        for (let c in ne) this._parser.registerEscHandler({ intermediates: "(", final: c }, () => this.selectCharset("(" + c)), this._parser.registerEscHandler({ intermediates: ")", final: c }, () => this.selectCharset(")" + c)), this._parser.registerEscHandler({ intermediates: "*", final: c }, () => this.selectCharset("*" + c)), this._parser.registerEscHandler({ intermediates: "+", final: c }, () => this.selectCharset("+" + c)), this._parser.registerEscHandler({ intermediates: "-", final: c }, () => this.selectCharset("-" + c)), this._parser.registerEscHandler({ intermediates: ".", final: c }, () => this.selectCharset("." + c)), this._parser.registerEscHandler({ intermediates: "/", final: c }, () => this.selectCharset("/" + c));
        this._parser.registerEscHandler({ intermediates: "#", final: "8" }, () => this.screenAlignmentPattern()), this._parser.setErrorHandler((c) => (this._logService.error("Parsing error: ", c), c)), this._parser.registerDcsHandler({ intermediates: "$", final: "q" }, new Xi((c, d) => this.requestStatusString(c, d)));
      }
      getAttrData() {
        return this._curAttrData;
      }
      _preserveStack(e, i, r, n) {
        this._parseStack.paused = true, this._parseStack.cursorStartX = e, this._parseStack.cursorStartY = i, this._parseStack.decodedLength = r, this._parseStack.position = n;
      }
      _logSlowResolvingAsync(e) {
        this._logService.logLevel <= 3 && Promise.race([e, new Promise((i, r) => setTimeout(() => r("#SLOW_TIMEOUT"), vl))]).catch((i) => {
          if (i !== "#SLOW_TIMEOUT") throw i;
          console.warn(`async parser handler taking longer than ${vl} ms`);
        });
      }
      _getCurrentLinkId() {
        return this._curAttrData.extended.urlId;
      }
      parse(e, i) {
        let r, n = this._activeBuffer.x, o = this._activeBuffer.y, l = 0, a = this._parseStack.paused;
        if (a) {
          if (r = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, i)) return this._logSlowResolvingAsync(r), r;
          n = this._parseStack.cursorStartX, o = this._parseStack.cursorStartY, this._parseStack.paused = false, e.length > ut && (l = this._parseStack.position + ut);
        }
        if (this._logService.logLevel <= 1 && this._logService.debug(`parsing data ${typeof e == "string" ? ` "${e}"` : ` "${Array.prototype.map.call(e, (c) => String.fromCharCode(c)).join("")}"`}`), this._logService.logLevel === 0 && this._logService.trace("parsing data (codes)", typeof e == "string" ? e.split("").map((c) => c.charCodeAt(0)) : e), this._parseBuffer.length < e.length && this._parseBuffer.length < ut && (this._parseBuffer = new Uint32Array(Math.min(e.length, ut))), a || this._dirtyRowTracker.clearRange(), e.length > ut) for (let c = l; c < e.length; c += ut) {
          let d = c + ut < e.length ? c + ut : e.length, _ = typeof e == "string" ? this._stringDecoder.decode(e.substring(c, d), this._parseBuffer) : this._utf8Decoder.decode(e.subarray(c, d), this._parseBuffer);
          if (r = this._parser.parse(this._parseBuffer, _)) return this._preserveStack(n, o, _, c), this._logSlowResolvingAsync(r), r;
        }
        else if (!a) {
          let c = typeof e == "string" ? this._stringDecoder.decode(e, this._parseBuffer) : this._utf8Decoder.decode(e, this._parseBuffer);
          if (r = this._parser.parse(this._parseBuffer, c)) return this._preserveStack(n, o, c, 0), this._logSlowResolvingAsync(r), r;
        }
        (this._activeBuffer.x !== n || this._activeBuffer.y !== o) && this._onCursorMove.fire();
        let u = this._dirtyRowTracker.end + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp), h8 = this._dirtyRowTracker.start + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
        h8 < this._bufferService.rows && this._onRequestRefreshRows.fire({ start: Math.min(h8, this._bufferService.rows - 1), end: Math.min(u, this._bufferService.rows - 1) });
      }
      print(e, i, r) {
        let n, o, l = this._charsetService.charset, a = this._optionsService.rawOptions.screenReaderMode, u = this._bufferService.cols, h8 = this._coreService.decPrivateModes.wraparound, c = this._coreService.modes.insertMode, d = this._curAttrData, _ = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && r - i > 0 && _.getWidth(this._activeBuffer.x - 1) === 2 && _.setCellFromCodepoint(this._activeBuffer.x - 1, 0, 1, d);
        let p = this._parser.precedingJoinState;
        for (let m = i; m < r; ++m) {
          if (n = e[m], n < 127 && l) {
            let O = l[String.fromCharCode(n)];
            O && (n = O.charCodeAt(0));
          }
          let f = this._unicodeService.charProperties(n, p);
          o = Ae.extractWidth(f);
          let A = Ae.extractShouldJoin(f), R = A ? Ae.extractWidth(p) : 0;
          if (p = f, a && this._onA11yChar.fire(Ce(n)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), this._activeBuffer.x + o - R > u) {
            if (h8) {
              let O = _, I = this._activeBuffer.x - R;
              for (this._activeBuffer.x = R, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), true)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = true), _ = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y), R > 0 && _ instanceof Ze && _.copyCellsFrom(O, I, 0, R, false); I < u; ) O.setCellFromCodepoint(I++, 0, 1, d);
            } else if (this._activeBuffer.x = u - 1, o === 2) continue;
          }
          if (A && this._activeBuffer.x) {
            let O = _.getWidth(this._activeBuffer.x - 1) ? 1 : 2;
            _.addCodepointToCell(this._activeBuffer.x - O, n, o);
            for (let I = o - R; --I >= 0; ) _.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, d);
            continue;
          }
          if (c && (_.insertCells(this._activeBuffer.x, o - R, this._activeBuffer.getNullCell(d)), _.getWidth(u - 1) === 2 && _.setCellFromCodepoint(u - 1, 0, 1, d)), _.setCellFromCodepoint(this._activeBuffer.x++, n, o, d), o > 0) for (; --o; ) _.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, d);
        }
        this._parser.precedingJoinState = p, this._activeBuffer.x < u && r - i > 0 && _.getWidth(this._activeBuffer.x) === 0 && !_.hasContent(this._activeBuffer.x) && _.setCellFromCodepoint(this._activeBuffer.x, 0, 1, d), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
      }
      registerCsiHandler(e, i) {
        return e.final === "t" && !e.prefix && !e.intermediates ? this._parser.registerCsiHandler(e, (r) => bl(r.params[0], this._optionsService.rawOptions.windowOptions) ? i(r) : true) : this._parser.registerCsiHandler(e, i);
      }
      registerDcsHandler(e, i) {
        return this._parser.registerDcsHandler(e, new Xi(i));
      }
      registerEscHandler(e, i) {
        return this._parser.registerEscHandler(e, i);
      }
      registerOscHandler(e, i) {
        return this._parser.registerOscHandler(e, new pe(i));
      }
      bell() {
        return this._onRequestBell.fire(), true;
      }
      lineFeed() {
        return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), true;
      }
      carriageReturn() {
        return this._activeBuffer.x = 0, true;
      }
      backspace() {
        if (!this._coreService.decPrivateModes.reverseWraparound) return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, true;
        if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0) this._activeBuffer.x--;
        else if (this._activeBuffer.x === 0 && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)?.isWrapped) {
          this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
          let e = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
          e.hasWidth(this._activeBuffer.x) && !e.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
        }
        return this._restrictCursor(), true;
      }
      tab() {
        if (this._activeBuffer.x >= this._bufferService.cols) return true;
        let e = this._activeBuffer.x;
        return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e), true;
      }
      shiftOut() {
        return this._charsetService.setgLevel(1), true;
      }
      shiftIn() {
        return this._charsetService.setgLevel(0), true;
      }
      _restrictCursor(e = this._bufferService.cols - 1) {
        this._activeBuffer.x = Math.min(e, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
      }
      _setCursor(e, i) {
        this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e, this._activeBuffer.y = this._activeBuffer.scrollTop + i) : (this._activeBuffer.x = e, this._activeBuffer.y = i), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
      }
      _moveCursor(e, i) {
        this._restrictCursor(), this._setCursor(this._activeBuffer.x + e, this._activeBuffer.y + i);
      }
      cursorUp(e) {
        let i = this._activeBuffer.y - this._activeBuffer.scrollTop;
        return i >= 0 ? this._moveCursor(0, -Math.min(i, e.params[0] || 1)) : this._moveCursor(0, -(e.params[0] || 1)), true;
      }
      cursorDown(e) {
        let i = this._activeBuffer.scrollBottom - this._activeBuffer.y;
        return i >= 0 ? this._moveCursor(0, Math.min(i, e.params[0] || 1)) : this._moveCursor(0, e.params[0] || 1), true;
      }
      cursorForward(e) {
        return this._moveCursor(e.params[0] || 1, 0), true;
      }
      cursorBackward(e) {
        return this._moveCursor(-(e.params[0] || 1), 0), true;
      }
      cursorNextLine(e) {
        return this.cursorDown(e), this._activeBuffer.x = 0, true;
      }
      cursorPrecedingLine(e) {
        return this.cursorUp(e), this._activeBuffer.x = 0, true;
      }
      cursorCharAbsolute(e) {
        return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), true;
      }
      cursorPosition(e) {
        return this._setCursor(e.length >= 2 ? (e.params[1] || 1) - 1 : 0, (e.params[0] || 1) - 1), true;
      }
      charPosAbsolute(e) {
        return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), true;
      }
      hPositionRelative(e) {
        return this._moveCursor(e.params[0] || 1, 0), true;
      }
      linePosAbsolute(e) {
        return this._setCursor(this._activeBuffer.x, (e.params[0] || 1) - 1), true;
      }
      vPositionRelative(e) {
        return this._moveCursor(0, e.params[0] || 1), true;
      }
      hVPosition(e) {
        return this.cursorPosition(e), true;
      }
      tabClear(e) {
        let i = e.params[0];
        return i === 0 ? delete this._activeBuffer.tabs[this._activeBuffer.x] : i === 3 && (this._activeBuffer.tabs = {}), true;
      }
      cursorForwardTab(e) {
        if (this._activeBuffer.x >= this._bufferService.cols) return true;
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.x = this._activeBuffer.nextStop();
        return true;
      }
      cursorBackwardTab(e) {
        if (this._activeBuffer.x >= this._bufferService.cols) return true;
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.x = this._activeBuffer.prevStop();
        return true;
      }
      selectProtected(e) {
        let i = e.params[0];
        return i === 1 && (this._curAttrData.bg |= 536870912), (i === 2 || i === 0) && (this._curAttrData.bg &= -536870913), true;
      }
      _eraseInBufferLine(e, i, r, n = false, o = false) {
        let l = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
        l.replaceCells(i, r, this._activeBuffer.getNullCell(this._eraseAttrData()), o), n && (l.isWrapped = false);
      }
      _resetBufferLine(e, i = false) {
        let r = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
        r && (r.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), i), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e), r.isWrapped = false);
      }
      eraseInDisplay(e, i = false) {
        this._restrictCursor(this._bufferService.cols);
        let r;
        switch (e.params[0]) {
          case 0:
            for (r = this._activeBuffer.y, this._dirtyRowTracker.markDirty(r), this._eraseInBufferLine(r++, this._activeBuffer.x, this._bufferService.cols, this._activeBuffer.x === 0, i); r < this._bufferService.rows; r++) this._resetBufferLine(r, i);
            this._dirtyRowTracker.markDirty(r);
            break;
          case 1:
            for (r = this._activeBuffer.y, this._dirtyRowTracker.markDirty(r), this._eraseInBufferLine(r, 0, this._activeBuffer.x + 1, true, i), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(r + 1).isWrapped = false); r--; ) this._resetBufferLine(r, i);
            this._dirtyRowTracker.markDirty(0);
            break;
          case 2:
            if (this._optionsService.rawOptions.scrollOnEraseInDisplay) {
              for (r = this._bufferService.rows, this._dirtyRowTracker.markRangeDirty(0, r - 1); r-- && !this._activeBuffer.lines.get(this._activeBuffer.ybase + r)?.getTrimmedLength(); ) ;
              for (; r >= 0; r--) this._bufferService.scroll(this._eraseAttrData());
            } else {
              for (r = this._bufferService.rows, this._dirtyRowTracker.markDirty(r - 1); r--; ) this._resetBufferLine(r, i);
              this._dirtyRowTracker.markDirty(0);
            }
            break;
          case 3:
            let n = this._activeBuffer.lines.length - this._bufferService.rows;
            n > 0 && (this._activeBuffer.lines.trimStart(n), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - n, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - n, 0), this._onScroll.fire(0));
            break;
        }
        return true;
      }
      eraseInLine(e, i = false) {
        switch (this._restrictCursor(this._bufferService.cols), e.params[0]) {
          case 0:
            this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, this._activeBuffer.x === 0, i);
            break;
          case 1:
            this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, false, i);
            break;
          case 2:
            this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, true, i);
            break;
        }
        return this._dirtyRowTracker.markDirty(this._activeBuffer.y), true;
      }
      insertLines(e) {
        this._restrictCursor();
        let i = e.params[0] || 1;
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let r = this._activeBuffer.ybase + this._activeBuffer.y, n = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, o = this._bufferService.rows - 1 + this._activeBuffer.ybase - n + 1;
        for (; i--; ) this._activeBuffer.lines.splice(o - 1, 1), this._activeBuffer.lines.splice(r, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
      }
      deleteLines(e) {
        this._restrictCursor();
        let i = e.params[0] || 1;
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let r = this._activeBuffer.ybase + this._activeBuffer.y, n;
        for (n = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, n = this._bufferService.rows - 1 + this._activeBuffer.ybase - n; i--; ) this._activeBuffer.lines.splice(r, 1), this._activeBuffer.lines.splice(n, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
      }
      insertChars(e) {
        this._restrictCursor();
        let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        return i && (i.insertCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
      }
      deleteChars(e) {
        this._restrictCursor();
        let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        return i && (i.deleteCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
      }
      scrollUp(e) {
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      scrollDown(e) {
        let i = e.params[0] || 1;
        for (; i--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(X));
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      scrollLeft(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.deleteCells(0, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      scrollRight(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.insertCells(0, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      insertColumns(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.insertCells(this._activeBuffer.x, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      deleteColumns(e) {
        if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
        let i = e.params[0] || 1;
        for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
          let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
          n.deleteCells(this._activeBuffer.x, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
        }
        return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
      }
      eraseChars(e) {
        this._restrictCursor();
        let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
        return i && (i.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
      }
      repeatPrecedingCharacter(e) {
        let i = this._parser.precedingJoinState;
        if (!i) return true;
        let r = e.params[0] || 1, n = Ae.extractWidth(i), o = this._activeBuffer.x - n, a = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).getString(o), u = new Uint32Array(a.length * r), h8 = 0;
        for (let d = 0; d < a.length; ) {
          let _ = a.codePointAt(d) || 0;
          u[h8++] = _, d += _ > 65535 ? 2 : 1;
        }
        let c = h8;
        for (let d = 1; d < r; ++d) u.copyWithin(c, 0, h8), c += h8;
        return this.print(u, 0, c), true;
      }
      sendDeviceAttributesPrimary(e) {
        return e.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(b.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(b.ESC + "[?6c")), true;
      }
      sendDeviceAttributesSecondary(e) {
        return e.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(b.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(b.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(b.ESC + "[>83;40003;0c")), true;
      }
      _is(e) {
        return (this._optionsService.rawOptions.termName + "").indexOf(e) === 0;
      }
      setMode(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 4:
            this._coreService.modes.insertMode = true;
            break;
          case 20:
            this._optionsService.options.convertEol = true;
            break;
        }
        return true;
      }
      setModePrivate(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 1:
            this._coreService.decPrivateModes.applicationCursorKeys = true;
            break;
          case 2:
            this._charsetService.setgCharset(0, Je), this._charsetService.setgCharset(1, Je), this._charsetService.setgCharset(2, Je), this._charsetService.setgCharset(3, Je);
            break;
          case 3:
            this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
            break;
          case 6:
            this._coreService.decPrivateModes.origin = true, this._setCursor(0, 0);
            break;
          case 7:
            this._coreService.decPrivateModes.wraparound = true;
            break;
          case 12:
            this._optionsService.options.cursorBlink = true;
            break;
          case 45:
            this._coreService.decPrivateModes.reverseWraparound = true;
            break;
          case 66:
            this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire();
            break;
          case 9:
            this._coreMouseService.activeProtocol = "X10";
            break;
          case 1e3:
            this._coreMouseService.activeProtocol = "VT200";
            break;
          case 1002:
            this._coreMouseService.activeProtocol = "DRAG";
            break;
          case 1003:
            this._coreMouseService.activeProtocol = "ANY";
            break;
          case 1004:
            this._coreService.decPrivateModes.sendFocus = true, this._onRequestSendFocus.fire();
            break;
          case 1005:
            this._logService.debug("DECSET 1005 not supported (see #2507)");
            break;
          case 1006:
            this._coreMouseService.activeEncoding = "SGR";
            break;
          case 1015:
            this._logService.debug("DECSET 1015 not supported (see #2507)");
            break;
          case 1016:
            this._coreMouseService.activeEncoding = "SGR_PIXELS";
            break;
          case 25:
            this._coreService.isCursorHidden = false;
            break;
          case 1048:
            this.saveCursor();
            break;
          case 1049:
            this.saveCursor();
          case 47:
          case 1047:
            this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(void 0), this._onRequestSyncScrollBar.fire();
            break;
          case 2004:
            this._coreService.decPrivateModes.bracketedPasteMode = true;
            break;
          case 2026:
            this._coreService.decPrivateModes.synchronizedOutput = true;
            break;
        }
        return true;
      }
      resetMode(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 4:
            this._coreService.modes.insertMode = false;
            break;
          case 20:
            this._optionsService.options.convertEol = false;
            break;
        }
        return true;
      }
      resetModePrivate(e) {
        for (let i = 0; i < e.length; i++) switch (e.params[i]) {
          case 1:
            this._coreService.decPrivateModes.applicationCursorKeys = false;
            break;
          case 3:
            this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
            break;
          case 6:
            this._coreService.decPrivateModes.origin = false, this._setCursor(0, 0);
            break;
          case 7:
            this._coreService.decPrivateModes.wraparound = false;
            break;
          case 12:
            this._optionsService.options.cursorBlink = false;
            break;
          case 45:
            this._coreService.decPrivateModes.reverseWraparound = false;
            break;
          case 66:
            this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire();
            break;
          case 9:
          case 1e3:
          case 1002:
          case 1003:
            this._coreMouseService.activeProtocol = "NONE";
            break;
          case 1004:
            this._coreService.decPrivateModes.sendFocus = false;
            break;
          case 1005:
            this._logService.debug("DECRST 1005 not supported (see #2507)");
            break;
          case 1006:
            this._coreMouseService.activeEncoding = "DEFAULT";
            break;
          case 1015:
            this._logService.debug("DECRST 1015 not supported (see #2507)");
            break;
          case 1016:
            this._coreMouseService.activeEncoding = "DEFAULT";
            break;
          case 25:
            this._coreService.isCursorHidden = true;
            break;
          case 1048:
            this.restoreCursor();
            break;
          case 1049:
          case 47:
          case 1047:
            this._bufferService.buffers.activateNormalBuffer(), e.params[i] === 1049 && this.restoreCursor(), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(void 0), this._onRequestSyncScrollBar.fire();
            break;
          case 2004:
            this._coreService.decPrivateModes.bracketedPasteMode = false;
            break;
          case 2026:
            this._coreService.decPrivateModes.synchronizedOutput = false, this._onRequestRefreshRows.fire(void 0);
            break;
        }
        return true;
      }
      requestMode(e, i) {
        let r;
        ((P) => (P[P.NOT_RECOGNIZED = 0] = "NOT_RECOGNIZED", P[P.SET = 1] = "SET", P[P.RESET = 2] = "RESET", P[P.PERMANENTLY_SET = 3] = "PERMANENTLY_SET", P[P.PERMANENTLY_RESET = 4] = "PERMANENTLY_RESET"))(r ||= {});
        let n = this._coreService.decPrivateModes, { activeProtocol: o, activeEncoding: l } = this._coreMouseService, a = this._coreService, { buffers: u, cols: h8 } = this._bufferService, { active: c, alt: d } = u, _ = this._optionsService.rawOptions, p = (A, R) => (a.triggerDataEvent(`${b.ESC}[${i ? "" : "?"}${A};${R}$y`), true), m = (A) => A ? 1 : 2, f = e.params[0];
        return i ? f === 2 ? p(f, 4) : f === 4 ? p(f, m(a.modes.insertMode)) : f === 12 ? p(f, 3) : f === 20 ? p(f, m(_.convertEol)) : p(f, 0) : f === 1 ? p(f, m(n.applicationCursorKeys)) : f === 3 ? p(f, _.windowOptions.setWinLines ? h8 === 80 ? 2 : h8 === 132 ? 1 : 0 : 0) : f === 6 ? p(f, m(n.origin)) : f === 7 ? p(f, m(n.wraparound)) : f === 8 ? p(f, 3) : f === 9 ? p(f, m(o === "X10")) : f === 12 ? p(f, m(_.cursorBlink)) : f === 25 ? p(f, m(!a.isCursorHidden)) : f === 45 ? p(f, m(n.reverseWraparound)) : f === 66 ? p(f, m(n.applicationKeypad)) : f === 67 ? p(f, 4) : f === 1e3 ? p(f, m(o === "VT200")) : f === 1002 ? p(f, m(o === "DRAG")) : f === 1003 ? p(f, m(o === "ANY")) : f === 1004 ? p(f, m(n.sendFocus)) : f === 1005 ? p(f, 4) : f === 1006 ? p(f, m(l === "SGR")) : f === 1015 ? p(f, 4) : f === 1016 ? p(f, m(l === "SGR_PIXELS")) : f === 1048 ? p(f, 1) : f === 47 || f === 1047 || f === 1049 ? p(f, m(c === d)) : f === 2004 ? p(f, m(n.bracketedPasteMode)) : f === 2026 ? p(f, m(n.synchronizedOutput)) : p(f, 0);
      }
      _updateAttrColor(e, i, r, n, o) {
        return i === 2 ? (e |= 50331648, e &= -16777216, e |= De.fromColorRGB([r, n, o])) : i === 5 && (e &= -50331904, e |= 33554432 | r & 255), e;
      }
      _extractColor(e, i, r) {
        let n = [0, 0, -1, 0, 0, 0], o = 0, l = 0;
        do {
          if (n[l + o] = e.params[i + l], e.hasSubParams(i + l)) {
            let a = e.getSubParams(i + l), u = 0;
            do
              n[1] === 5 && (o = 1), n[l + u + 1 + o] = a[u];
            while (++u < a.length && u + l + 1 + o < n.length);
            break;
          }
          if (n[1] === 5 && l + o >= 2 || n[1] === 2 && l + o >= 5) break;
          n[1] && (o = 1);
        } while (++l + i < e.length && l + o < n.length);
        for (let a = 2; a < n.length; ++a) n[a] === -1 && (n[a] = 0);
        switch (n[0]) {
          case 38:
            r.fg = this._updateAttrColor(r.fg, n[1], n[3], n[4], n[5]);
            break;
          case 48:
            r.bg = this._updateAttrColor(r.bg, n[1], n[3], n[4], n[5]);
            break;
          case 58:
            r.extended = r.extended.clone(), r.extended.underlineColor = this._updateAttrColor(r.extended.underlineColor, n[1], n[3], n[4], n[5]);
        }
        return l;
      }
      _processUnderline(e, i) {
        i.extended = i.extended.clone(), (!~e || e > 5) && (e = 1), i.extended.underlineStyle = e, i.fg |= 268435456, e === 0 && (i.fg &= -268435457), i.updateExtended();
      }
      _processSGR0(e) {
        e.fg = X.fg, e.bg = X.bg, e.extended = e.extended.clone(), e.extended.underlineStyle = 0, e.extended.underlineColor &= -67108864, e.updateExtended();
      }
      charAttributes(e) {
        if (e.length === 1 && e.params[0] === 0) return this._processSGR0(this._curAttrData), true;
        let i = e.length, r, n = this._curAttrData;
        for (let o = 0; o < i; o++) r = e.params[o], r >= 30 && r <= 37 ? (n.fg &= -50331904, n.fg |= 16777216 | r - 30) : r >= 40 && r <= 47 ? (n.bg &= -50331904, n.bg |= 16777216 | r - 40) : r >= 90 && r <= 97 ? (n.fg &= -50331904, n.fg |= 16777216 | r - 90 | 8) : r >= 100 && r <= 107 ? (n.bg &= -50331904, n.bg |= 16777216 | r - 100 | 8) : r === 0 ? this._processSGR0(n) : r === 1 ? n.fg |= 134217728 : r === 3 ? n.bg |= 67108864 : r === 4 ? (n.fg |= 268435456, this._processUnderline(e.hasSubParams(o) ? e.getSubParams(o)[0] : 1, n)) : r === 5 ? n.fg |= 536870912 : r === 7 ? n.fg |= 67108864 : r === 8 ? n.fg |= 1073741824 : r === 9 ? n.fg |= 2147483648 : r === 2 ? n.bg |= 134217728 : r === 21 ? this._processUnderline(2, n) : r === 22 ? (n.fg &= -134217729, n.bg &= -134217729) : r === 23 ? n.bg &= -67108865 : r === 24 ? (n.fg &= -268435457, this._processUnderline(0, n)) : r === 25 ? n.fg &= -536870913 : r === 27 ? n.fg &= -67108865 : r === 28 ? n.fg &= -1073741825 : r === 29 ? n.fg &= 2147483647 : r === 39 ? (n.fg &= -67108864, n.fg |= X.fg & 16777215) : r === 49 ? (n.bg &= -67108864, n.bg |= X.bg & 16777215) : r === 38 || r === 48 || r === 58 ? o += this._extractColor(e, o, n) : r === 53 ? n.bg |= 1073741824 : r === 55 ? n.bg &= -1073741825 : r === 59 ? (n.extended = n.extended.clone(), n.extended.underlineColor = -1, n.updateExtended()) : r === 100 ? (n.fg &= -67108864, n.fg |= X.fg & 16777215, n.bg &= -67108864, n.bg |= X.bg & 16777215) : this._logService.debug("Unknown SGR attribute: %d.", r);
        return true;
      }
      deviceStatus(e) {
        switch (e.params[0]) {
          case 5:
            this._coreService.triggerDataEvent(`${b.ESC}[0n`);
            break;
          case 6:
            let i = this._activeBuffer.y + 1, r = this._activeBuffer.x + 1;
            this._coreService.triggerDataEvent(`${b.ESC}[${i};${r}R`);
            break;
        }
        return true;
      }
      deviceStatusPrivate(e) {
        switch (e.params[0]) {
          case 6:
            let i = this._activeBuffer.y + 1, r = this._activeBuffer.x + 1;
            this._coreService.triggerDataEvent(`${b.ESC}[?${i};${r}R`);
            break;
          case 15:
            break;
          case 25:
            break;
          case 26:
            break;
          case 53:
            break;
        }
        return true;
      }
      softReset(e) {
        return this._coreService.isCursorHidden = false, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = X.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = false, true;
      }
      setCursorStyle(e) {
        let i = e.length === 0 ? 1 : e.params[0];
        if (i === 0) this._coreService.decPrivateModes.cursorStyle = void 0, this._coreService.decPrivateModes.cursorBlink = void 0;
        else {
          switch (i) {
            case 1:
            case 2:
              this._coreService.decPrivateModes.cursorStyle = "block";
              break;
            case 3:
            case 4:
              this._coreService.decPrivateModes.cursorStyle = "underline";
              break;
            case 5:
            case 6:
              this._coreService.decPrivateModes.cursorStyle = "bar";
              break;
          }
          let r = i % 2 === 1;
          this._coreService.decPrivateModes.cursorBlink = r;
        }
        return true;
      }
      setScrollRegion(e) {
        let i = e.params[0] || 1, r;
        return (e.length < 2 || (r = e.params[1]) > this._bufferService.rows || r === 0) && (r = this._bufferService.rows), r > i && (this._activeBuffer.scrollTop = i - 1, this._activeBuffer.scrollBottom = r - 1, this._setCursor(0, 0)), true;
      }
      windowOptions(e) {
        if (!bl(e.params[0], this._optionsService.rawOptions.windowOptions)) return true;
        let i = e.length > 1 ? e.params[1] : 0;
        switch (e.params[0]) {
          case 14:
            i !== 2 && this._onRequestWindowsOptionsReport.fire(0);
            break;
          case 16:
            this._onRequestWindowsOptionsReport.fire(1);
            break;
          case 18:
            this._bufferService && this._coreService.triggerDataEvent(`${b.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
            break;
          case 22:
            (i === 0 || i === 2) && (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > _l && this._windowTitleStack.shift()), (i === 0 || i === 1) && (this._iconNameStack.push(this._iconName), this._iconNameStack.length > _l && this._iconNameStack.shift());
            break;
          case 23:
            (i === 0 || i === 2) && this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), (i === 0 || i === 1) && this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
            break;
        }
        return true;
      }
      saveCursor(e) {
        return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, true;
      }
      restoreCursor(e) {
        return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), true;
      }
      setTitle(e) {
        return this._windowTitle = e, this._onTitleChange.fire(e), true;
      }
      setIconName(e) {
        return this._iconName = e, true;
      }
      setOrReportIndexedColor(e) {
        let i = [], r = e.split(";");
        for (; r.length > 1; ) {
          let n = r.shift(), o = r.shift();
          if (/^\d+$/.exec(n)) {
            let l = parseInt(n);
            if (Sl(l)) if (o === "?") i.push({ type: 0, index: l });
            else {
              let a = Ws(o);
              a && i.push({ type: 1, index: l, color: a });
            }
          }
        }
        return i.length && this._onColor.fire(i), true;
      }
      setHyperlink(e) {
        let i = e.indexOf(";");
        if (i === -1) return true;
        let r = e.slice(0, i).trim(), n = e.slice(i + 1);
        return n ? this._createHyperlink(r, n) : r.trim() ? false : this._finishHyperlink();
      }
      _createHyperlink(e, i) {
        this._getCurrentLinkId() && this._finishHyperlink();
        let r = e.split(":"), n, o = r.findIndex((l) => l.startsWith("id="));
        return o !== -1 && (n = r[o].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({ id: n, uri: i }), this._curAttrData.updateExtended(), true;
      }
      _finishHyperlink() {
        return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), true;
      }
      _setOrReportSpecialColor(e, i) {
        let r = e.split(";");
        for (let n = 0; n < r.length && !(i >= this._specialColors.length); ++n, ++i) if (r[n] === "?") this._onColor.fire([{ type: 0, index: this._specialColors[i] }]);
        else {
          let o = Ws(r[n]);
          o && this._onColor.fire([{ type: 1, index: this._specialColors[i], color: o }]);
        }
        return true;
      }
      setOrReportFgColor(e) {
        return this._setOrReportSpecialColor(e, 0);
      }
      setOrReportBgColor(e) {
        return this._setOrReportSpecialColor(e, 1);
      }
      setOrReportCursorColor(e) {
        return this._setOrReportSpecialColor(e, 2);
      }
      restoreIndexedColor(e) {
        if (!e) return this._onColor.fire([{ type: 2 }]), true;
        let i = [], r = e.split(";");
        for (let n = 0; n < r.length; ++n) if (/^\d+$/.exec(r[n])) {
          let o = parseInt(r[n]);
          Sl(o) && i.push({ type: 2, index: o });
        }
        return i.length && this._onColor.fire(i), true;
      }
      restoreFgColor(e) {
        return this._onColor.fire([{ type: 2, index: 256 }]), true;
      }
      restoreBgColor(e) {
        return this._onColor.fire([{ type: 2, index: 257 }]), true;
      }
      restoreCursorColor(e) {
        return this._onColor.fire([{ type: 2, index: 258 }]), true;
      }
      nextLine() {
        return this._activeBuffer.x = 0, this.index(), true;
      }
      keypadApplicationMode() {
        return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire(), true;
      }
      keypadNumericMode() {
        return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire(), true;
      }
      selectDefaultCharset() {
        return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, Je), true;
      }
      selectCharset(e) {
        return e.length !== 2 ? (this.selectDefaultCharset(), true) : (e[0] === "/" || this._charsetService.setgCharset(mc[e[0]], ne[e[1]] || Je), true);
      }
      index() {
        return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), true;
      }
      tabSet() {
        return this._activeBuffer.tabs[this._activeBuffer.x] = true, true;
      }
      reverseIndex() {
        if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
          let e = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
          this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
        } else this._activeBuffer.y--, this._restrictCursor();
        return true;
      }
      fullReset() {
        return this._parser.reset(), this._onRequestReset.fire(), true;
      }
      reset() {
        this._curAttrData = X.clone(), this._eraseAttrDataInternal = X.clone();
      }
      _eraseAttrData() {
        return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= this._curAttrData.bg & 67108863, this._eraseAttrDataInternal;
      }
      setgLevel(e) {
        return this._charsetService.setgLevel(e), true;
      }
      screenAlignmentPattern() {
        let e = new q();
        e.content = 1 << 22 | 69, e.fg = this._curAttrData.fg, e.bg = this._curAttrData.bg, this._setCursor(0, 0);
        for (let i = 0; i < this._bufferService.rows; ++i) {
          let r = this._activeBuffer.ybase + this._activeBuffer.y + i, n = this._activeBuffer.lines.get(r);
          n && (n.fill(e), n.isWrapped = false);
        }
        return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), true;
      }
      requestStatusString(e, i) {
        let r = (a) => (this._coreService.triggerDataEvent(`${b.ESC}${a}${b.ESC}\\`), true), n = this._bufferService.buffer, o = this._optionsService.rawOptions, l = { block: 2, underline: 4, bar: 6 };
        return r(e === '"q' ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : e === '"p' ? 'P1$r61;1"p' : e === "r" ? `P1$r${n.scrollTop + 1};${n.scrollBottom + 1}r` : e === "m" ? "P1$r0m" : e === " q" ? `P1$r${l[o.cursorStyle] - (o.cursorBlink ? 1 : 0)} q` : "P0$r");
      }
      markRangeDirty(e, i) {
        this._dirtyRowTracker.markRangeDirty(e, i);
      }
    }, Zi = class {
      constructor(t) {
        this._bufferService = t;
        this.clearRange();
      }
      clearRange() {
        this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
      }
      markDirty(t) {
        t < this.start ? this.start = t : t > this.end && (this.end = t);
      }
      markRangeDirty(t, e) {
        t > e && (gl = t, t = e, e = gl), t < this.start && (this.start = t), e > this.end && (this.end = e);
      }
      markAllDirty() {
        this.markRangeDirty(0, this._bufferService.rows - 1);
      }
    };
    Zi = M([S(0, F)], Zi);
    _c = 5e7, El = 12, bc = 50, gn = class extends D {
      constructor(e) {
        super();
        this._action = e;
        this._writeBuffer = [];
        this._callbacks = [];
        this._pendingData = 0;
        this._bufferOffset = 0;
        this._isSyncWriting = false;
        this._syncCalls = 0;
        this._didUserInput = false;
        this._onWriteParsed = this._register(new v());
        this.onWriteParsed = this._onWriteParsed.event;
      }
      handleUserInput() {
        this._didUserInput = true;
      }
      writeSync(e, i) {
        if (i !== void 0 && this._syncCalls > i) {
          this._syncCalls = 0;
          return;
        }
        if (this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting) return;
        this._isSyncWriting = true;
        let r;
        for (; r = this._writeBuffer.shift(); ) {
          this._action(r);
          let n = this._callbacks.shift();
          n && n();
        }
        this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = false, this._syncCalls = 0;
      }
      write(e, i) {
        if (this._pendingData > _c) throw new Error("write data discarded, use flow control to avoid losing data");
        if (!this._writeBuffer.length) {
          if (this._bufferOffset = 0, this._didUserInput) {
            this._didUserInput = false, this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(i), this._innerWrite();
            return;
          }
          setTimeout(() => this._innerWrite());
        }
        this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(i);
      }
      _innerWrite(e = 0, i = true) {
        let r = e || performance.now();
        for (; this._writeBuffer.length > this._bufferOffset; ) {
          let n = this._writeBuffer[this._bufferOffset], o = this._action(n, i);
          if (o) {
            let a = (u) => performance.now() - r >= El ? setTimeout(() => this._innerWrite(0, u)) : this._innerWrite(r, u);
            o.catch((u) => (queueMicrotask(() => {
              throw u;
            }), Promise.resolve(false))).then(a);
            return;
          }
          let l = this._callbacks[this._bufferOffset];
          if (l && l(), this._bufferOffset++, this._pendingData -= n.length, performance.now() - r >= El) break;
        }
        this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > bc && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout(() => this._innerWrite())) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
      }
    };
    ui = class {
      constructor(t) {
        this._bufferService = t;
        this._nextId = 1;
        this._entriesWithId = /* @__PURE__ */ new Map();
        this._dataByLinkId = /* @__PURE__ */ new Map();
      }
      registerLink(t) {
        let e = this._bufferService.buffer;
        if (t.id === void 0) {
          let a = e.addMarker(e.ybase + e.y), u = { data: t, id: this._nextId++, lines: [a] };
          return a.onDispose(() => this._removeMarkerFromLink(u, a)), this._dataByLinkId.set(u.id, u), u.id;
        }
        let i = t, r = this._getEntryIdKey(i), n = this._entriesWithId.get(r);
        if (n) return this.addLineToLink(n.id, e.ybase + e.y), n.id;
        let o = e.addMarker(e.ybase + e.y), l = { id: this._nextId++, key: this._getEntryIdKey(i), data: i, lines: [o] };
        return o.onDispose(() => this._removeMarkerFromLink(l, o)), this._entriesWithId.set(l.key, l), this._dataByLinkId.set(l.id, l), l.id;
      }
      addLineToLink(t, e) {
        let i = this._dataByLinkId.get(t);
        if (i && i.lines.every((r) => r.line !== e)) {
          let r = this._bufferService.buffer.addMarker(e);
          i.lines.push(r), r.onDispose(() => this._removeMarkerFromLink(i, r));
        }
      }
      getLinkData(t) {
        return this._dataByLinkId.get(t)?.data;
      }
      _getEntryIdKey(t) {
        return `${t.id};;${t.uri}`;
      }
      _removeMarkerFromLink(t, e) {
        let i = t.lines.indexOf(e);
        i !== -1 && (t.lines.splice(i, 1), t.lines.length === 0 && (t.data.id !== void 0 && this._entriesWithId.delete(t.key), this._dataByLinkId.delete(t.id)));
      }
    };
    ui = M([S(0, F)], ui);
    Tl = false, Sn = class extends D {
      constructor(e) {
        super();
        this._windowsWrappingHeuristics = this._register(new ye());
        this._onBinary = this._register(new v());
        this.onBinary = this._onBinary.event;
        this._onData = this._register(new v());
        this.onData = this._onData.event;
        this._onLineFeed = this._register(new v());
        this.onLineFeed = this._onLineFeed.event;
        this._onResize = this._register(new v());
        this.onResize = this._onResize.event;
        this._onWriteParsed = this._register(new v());
        this.onWriteParsed = this._onWriteParsed.event;
        this._onScroll = this._register(new v());
        this._instantiationService = new ln(), this.optionsService = this._register(new dn(e)), this._instantiationService.setService(H, this.optionsService), this._bufferService = this._register(this._instantiationService.createInstance(ni)), this._instantiationService.setService(F, this._bufferService), this._logService = this._register(this._instantiationService.createInstance(ii)), this._instantiationService.setService(nr, this._logService), this.coreService = this._register(this._instantiationService.createInstance(li)), this._instantiationService.setService(ge, this.coreService), this.coreMouseService = this._register(this._instantiationService.createInstance(ai)), this._instantiationService.setService(rr, this.coreMouseService), this.unicodeService = this._register(this._instantiationService.createInstance(Ae)), this._instantiationService.setService(Js, this.unicodeService), this._charsetService = this._instantiationService.createInstance(pn), this._instantiationService.setService(Zs, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(ui), this._instantiationService.setService(sr, this._oscLinkService), this._inputHandler = this._register(new vn(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this._register($.forward(this._inputHandler.onLineFeed, this._onLineFeed)), this._register(this._inputHandler), this._register($.forward(this._bufferService.onResize, this._onResize)), this._register($.forward(this.coreService.onData, this._onData)), this._register($.forward(this.coreService.onBinary, this._onBinary)), this._register(this.coreService.onRequestScrollToBottom(() => this.scrollToBottom(true))), this._register(this.coreService.onUserInput(() => this._writeBuffer.handleUserInput())), this._register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], () => this._handleWindowsPtyOptionChange())), this._register(this._bufferService.onScroll(() => {
          this._onScroll.fire({ position: this._bufferService.buffer.ydisp }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
        })), this._writeBuffer = this._register(new gn((i, r) => this._inputHandler.parse(i, r))), this._register($.forward(this._writeBuffer.onWriteParsed, this._onWriteParsed));
      }
      get onScroll() {
        return this._onScrollApi || (this._onScrollApi = this._register(new v()), this._onScroll.event((e) => {
          this._onScrollApi?.fire(e.position);
        })), this._onScrollApi.event;
      }
      get cols() {
        return this._bufferService.cols;
      }
      get rows() {
        return this._bufferService.rows;
      }
      get buffers() {
        return this._bufferService.buffers;
      }
      get options() {
        return this.optionsService.options;
      }
      set options(e) {
        for (let i in e) this.optionsService.options[i] = e[i];
      }
      write(e, i) {
        this._writeBuffer.write(e, i);
      }
      writeSync(e, i) {
        this._logService.logLevel <= 3 && !Tl && (this._logService.warn("writeSync is unreliable and will be removed soon."), Tl = true), this._writeBuffer.writeSync(e, i);
      }
      input(e, i = true) {
        this.coreService.triggerDataEvent(e, i);
      }
      resize(e, i) {
        isNaN(e) || isNaN(i) || (e = Math.max(e, ks), i = Math.max(i, Cs), this._bufferService.resize(e, i));
      }
      scroll(e, i = false) {
        this._bufferService.scroll(e, i);
      }
      scrollLines(e, i) {
        this._bufferService.scrollLines(e, i);
      }
      scrollPages(e) {
        this.scrollLines(e * (this.rows - 1));
      }
      scrollToTop() {
        this.scrollLines(-this._bufferService.buffer.ydisp);
      }
      scrollToBottom(e) {
        this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
      }
      scrollToLine(e) {
        let i = e - this._bufferService.buffer.ydisp;
        i !== 0 && this.scrollLines(i);
      }
      registerEscHandler(e, i) {
        return this._inputHandler.registerEscHandler(e, i);
      }
      registerDcsHandler(e, i) {
        return this._inputHandler.registerDcsHandler(e, i);
      }
      registerCsiHandler(e, i) {
        return this._inputHandler.registerCsiHandler(e, i);
      }
      registerOscHandler(e, i) {
        return this._inputHandler.registerOscHandler(e, i);
      }
      _setup() {
        this._handleWindowsPtyOptionChange();
      }
      reset() {
        this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
      }
      _handleWindowsPtyOptionChange() {
        let e = false, i = this.optionsService.rawOptions.windowsPty;
        i && i.buildNumber !== void 0 && i.buildNumber !== void 0 ? e = i.backend === "conpty" && i.buildNumber < 21376 : this.optionsService.rawOptions.windowsMode && (e = true), e ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
      }
      _enableWindowsWrappingHeuristics() {
        if (!this._windowsWrappingHeuristics.value) {
          let e = [];
          e.push(this.onLineFeed(Bs.bind(null, this._bufferService))), e.push(this.registerCsiHandler({ final: "H" }, () => (Bs(this._bufferService), false))), this._windowsWrappingHeuristics.value = C(() => {
            for (let i of e) i.dispose();
          });
        }
      }
    };
    gc = { 48: ["0", ")"], 49: ["1", "!"], 50: ["2", "@"], 51: ["3", "#"], 52: ["4", "$"], 53: ["5", "%"], 54: ["6", "^"], 55: ["7", "&"], 56: ["8", "*"], 57: ["9", "("], 186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"], 191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", '"'] };
    ee = 0, En = class {
      constructor(t) {
        this._getKey = t;
        this._array = [];
        this._insertedValues = [];
        this._flushInsertedTask = new Jt();
        this._isFlushingInserted = false;
        this._deletedIndices = [];
        this._flushDeletedTask = new Jt();
        this._isFlushingDeleted = false;
      }
      clear() {
        this._array.length = 0, this._insertedValues.length = 0, this._flushInsertedTask.clear(), this._isFlushingInserted = false, this._deletedIndices.length = 0, this._flushDeletedTask.clear(), this._isFlushingDeleted = false;
      }
      insert(t) {
        this._flushCleanupDeleted(), this._insertedValues.length === 0 && this._flushInsertedTask.enqueue(() => this._flushInserted()), this._insertedValues.push(t);
      }
      _flushInserted() {
        let t = this._insertedValues.sort((n, o) => this._getKey(n) - this._getKey(o)), e = 0, i = 0, r = new Array(this._array.length + this._insertedValues.length);
        for (let n = 0; n < r.length; n++) i >= this._array.length || this._getKey(t[e]) <= this._getKey(this._array[i]) ? (r[n] = t[e], e++) : r[n] = this._array[i++];
        this._array = r, this._insertedValues.length = 0;
      }
      _flushCleanupInserted() {
        !this._isFlushingInserted && this._insertedValues.length > 0 && this._flushInsertedTask.flush();
      }
      delete(t) {
        if (this._flushCleanupInserted(), this._array.length === 0) return false;
        let e = this._getKey(t);
        if (e === void 0 || (ee = this._search(e), ee === -1) || this._getKey(this._array[ee]) !== e) return false;
        do
          if (this._array[ee] === t) return this._deletedIndices.length === 0 && this._flushDeletedTask.enqueue(() => this._flushDeleted()), this._deletedIndices.push(ee), true;
        while (++ee < this._array.length && this._getKey(this._array[ee]) === e);
        return false;
      }
      _flushDeleted() {
        this._isFlushingDeleted = true;
        let t = this._deletedIndices.sort((n, o) => n - o), e = 0, i = new Array(this._array.length - t.length), r = 0;
        for (let n = 0; n < this._array.length; n++) t[e] === n ? e++ : i[r++] = this._array[n];
        this._array = i, this._deletedIndices.length = 0, this._isFlushingDeleted = false;
      }
      _flushCleanupDeleted() {
        !this._isFlushingDeleted && this._deletedIndices.length > 0 && this._flushDeletedTask.flush();
      }
      *getKeyIterator(t) {
        if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t)) do
          yield this._array[ee];
        while (++ee < this._array.length && this._getKey(this._array[ee]) === t);
      }
      forEachByKey(t, e) {
        if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t)) do
          e(this._array[ee]);
        while (++ee < this._array.length && this._getKey(this._array[ee]) === t);
      }
      values() {
        return this._flushCleanupInserted(), this._flushCleanupDeleted(), [...this._array].values();
      }
      _search(t) {
        let e = 0, i = this._array.length - 1;
        for (; i >= e; ) {
          let r = e + i >> 1, n = this._getKey(this._array[r]);
          if (n > t) i = r - 1;
          else if (n < t) e = r + 1;
          else {
            for (; r > 0 && this._getKey(this._array[r - 1]) === t; ) r--;
            return r;
          }
        }
        return e;
      }
    };
    Us = 0, yl = 0, Tn = class extends D {
      constructor() {
        super();
        this._decorations = new En((e) => e?.marker.line);
        this._onDecorationRegistered = this._register(new v());
        this.onDecorationRegistered = this._onDecorationRegistered.event;
        this._onDecorationRemoved = this._register(new v());
        this.onDecorationRemoved = this._onDecorationRemoved.event;
        this._register(C(() => this.reset()));
      }
      get decorations() {
        return this._decorations.values();
      }
      registerDecoration(e) {
        if (e.marker.isDisposed) return;
        let i = new Ks(e);
        if (i) {
          let r = i.marker.onDispose(() => i.dispose()), n = i.onDispose(() => {
            n.dispose(), i && (this._decorations.delete(i) && this._onDecorationRemoved.fire(i), r.dispose());
          });
          this._decorations.insert(i), this._onDecorationRegistered.fire(i);
        }
        return i;
      }
      reset() {
        for (let e of this._decorations.values()) e.dispose();
        this._decorations.clear();
      }
      *getDecorationsAtCell(e, i, r) {
        let n = 0, o = 0;
        for (let l of this._decorations.getKeyIterator(i)) n = l.options.x ?? 0, o = n + (l.options.width ?? 1), e >= n && e < o && (!r || (l.options.layer ?? "bottom") === r) && (yield l);
      }
      forEachDecorationAtCell(e, i, r, n) {
        this._decorations.forEachByKey(i, (o) => {
          Us = o.options.x ?? 0, yl = Us + (o.options.width ?? 1), e >= Us && e < yl && (!r || (o.options.layer ?? "bottom") === r) && n(o);
        });
      }
    }, Ks = class extends Ee {
      constructor(e) {
        super();
        this.options = e;
        this.onRenderEmitter = this.add(new v());
        this.onRender = this.onRenderEmitter.event;
        this._onDispose = this.add(new v());
        this.onDispose = this._onDispose.event;
        this._cachedBg = null;
        this._cachedFg = null;
        this.marker = e.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
      }
      get backgroundColorRGB() {
        return this._cachedBg === null && (this.options.backgroundColor ? this._cachedBg = z.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
      }
      get foregroundColorRGB() {
        return this._cachedFg === null && (this.options.foregroundColor ? this._cachedFg = z.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
      }
      dispose() {
        this._onDispose.fire(), super.dispose();
      }
    };
    Sc = 1e3, In = class {
      constructor(t, e = Sc) {
        this._renderCallback = t;
        this._debounceThresholdMS = e;
        this._lastRefreshMs = 0;
        this._additionalRefreshRequested = false;
      }
      dispose() {
        this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
      }
      refresh(t, e, i) {
        this._rowCount = i, t = t !== void 0 ? t : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t) : t, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e;
        let r = performance.now();
        if (r - this._lastRefreshMs >= this._debounceThresholdMS) this._lastRefreshMs = r, this._innerRefresh();
        else if (!this._additionalRefreshRequested) {
          let n = r - this._lastRefreshMs, o = this._debounceThresholdMS - n;
          this._additionalRefreshRequested = true, this._refreshTimeoutID = window.setTimeout(() => {
            this._lastRefreshMs = performance.now(), this._innerRefresh(), this._additionalRefreshRequested = false, this._refreshTimeoutID = void 0;
          }, o);
        }
      }
      _innerRefresh() {
        if (this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) return;
        let t = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
        this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t, e);
      }
    };
    xl = 20;
    wl = false, Tt = class extends D {
      constructor(e, i, r, n) {
        super();
        this._terminal = e;
        this._coreBrowserService = r;
        this._renderService = n;
        this._rowColumns = /* @__PURE__ */ new WeakMap();
        this._liveRegionLineCount = 0;
        this._charsToConsume = [];
        this._charsToAnnounce = "";
        let o = this._coreBrowserService.mainDocument;
        this._accessibilityContainer = o.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = o.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
        for (let l = 0; l < this._terminal.rows; l++) this._rowElements[l] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[l]);
        if (this._topBoundaryFocusListener = (l) => this._handleBoundaryFocus(l, 0), this._bottomBoundaryFocusListener = (l) => this._handleBoundaryFocus(l, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = o.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this._register(new In(this._renderRows.bind(this))), !this._terminal.element) throw new Error("Cannot enable accessibility before Terminal.open");
        wl ? (this._accessibilityContainer.classList.add("debug"), this._rowContainer.classList.add("debug"), this._debugRootContainer = o.createElement("div"), this._debugRootContainer.classList.add("xterm"), this._debugRootContainer.appendChild(o.createTextNode("------start a11y------")), this._debugRootContainer.appendChild(this._accessibilityContainer), this._debugRootContainer.appendChild(o.createTextNode("------end a11y------")), this._terminal.element.insertAdjacentElement("afterend", this._debugRootContainer)) : this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this._register(this._terminal.onResize((l) => this._handleResize(l.rows))), this._register(this._terminal.onRender((l) => this._refreshRows(l.start, l.end))), this._register(this._terminal.onScroll(() => this._refreshRows())), this._register(this._terminal.onA11yChar((l) => this._handleChar(l))), this._register(this._terminal.onLineFeed(() => this._handleChar(`
`))), this._register(this._terminal.onA11yTab((l) => this._handleTab(l))), this._register(this._terminal.onKey((l) => this._handleKey(l.key))), this._register(this._terminal.onBlur(() => this._clearLiveRegion())), this._register(this._renderService.onDimensionsChange(() => this._refreshRowsDimensions())), this._register(L(o, "selectionchange", () => this._handleSelectionChange())), this._register(this._coreBrowserService.onDprChange(() => this._refreshRowsDimensions())), this._refreshRowsDimensions(), this._refreshRows(), this._register(C(() => {
          wl ? this._debugRootContainer.remove() : this._accessibilityContainer.remove(), this._rowElements.length = 0;
        }));
      }
      _handleTab(e) {
        for (let i = 0; i < e; i++) this._handleChar(" ");
      }
      _handleChar(e) {
        this._liveRegionLineCount < xl + 1 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e && (this._charsToAnnounce += e) : this._charsToAnnounce += e, e === `
` && (this._liveRegionLineCount++, this._liveRegionLineCount === xl + 1 && (this._liveRegion.textContent += _i.get())));
      }
      _clearLiveRegion() {
        this._liveRegion.textContent = "", this._liveRegionLineCount = 0;
      }
      _handleKey(e) {
        this._clearLiveRegion(), /\p{Control}/u.test(e) || this._charsToConsume.push(e);
      }
      _refreshRows(e, i) {
        this._liveRegionDebouncer.refresh(e, i, this._terminal.rows);
      }
      _renderRows(e, i) {
        let r = this._terminal.buffer, n = r.lines.length.toString();
        for (let o = e; o <= i; o++) {
          let l = r.lines.get(r.ydisp + o), a = [], u = l?.translateToString(true, void 0, void 0, a) || "", h8 = (r.ydisp + o + 1).toString(), c = this._rowElements[o];
          c && (u.length === 0 ? (c.textContent = " ", this._rowColumns.set(c, [0, 1])) : (c.textContent = u, this._rowColumns.set(c, a)), c.setAttribute("aria-posinset", h8), c.setAttribute("aria-setsize", n), this._alignRowWidth(c));
        }
        this._announceCharacters();
      }
      _announceCharacters() {
        this._charsToAnnounce.length !== 0 && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
      }
      _handleBoundaryFocus(e, i) {
        let r = e.target, n = this._rowElements[i === 0 ? 1 : this._rowElements.length - 2], o = r.getAttribute("aria-posinset"), l = i === 0 ? "1" : `${this._terminal.buffer.lines.length}`;
        if (o === l || e.relatedTarget !== n) return;
        let a, u;
        if (i === 0 ? (a = r, u = this._rowElements.pop(), this._rowContainer.removeChild(u)) : (a = this._rowElements.shift(), u = r, this._rowContainer.removeChild(a)), a.removeEventListener("focus", this._topBoundaryFocusListener), u.removeEventListener("focus", this._bottomBoundaryFocusListener), i === 0) {
          let h8 = this._createAccessibilityTreeNode();
          this._rowElements.unshift(h8), this._rowContainer.insertAdjacentElement("afterbegin", h8);
        } else {
          let h8 = this._createAccessibilityTreeNode();
          this._rowElements.push(h8), this._rowContainer.appendChild(h8);
        }
        this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(i === 0 ? -1 : 1), this._rowElements[i === 0 ? 1 : this._rowElements.length - 2].focus(), e.preventDefault(), e.stopImmediatePropagation();
      }
      _handleSelectionChange() {
        if (this._rowElements.length === 0) return;
        let e = this._coreBrowserService.mainDocument.getSelection();
        if (!e) return;
        if (e.isCollapsed) {
          this._rowContainer.contains(e.anchorNode) && this._terminal.clearSelection();
          return;
        }
        if (!e.anchorNode || !e.focusNode) {
          console.error("anchorNode and/or focusNode are null");
          return;
        }
        let i = { node: e.anchorNode, offset: e.anchorOffset }, r = { node: e.focusNode, offset: e.focusOffset };
        if ((i.node.compareDocumentPosition(r.node) & Node.DOCUMENT_POSITION_PRECEDING || i.node === r.node && i.offset > r.offset) && ([i, r] = [r, i]), i.node.compareDocumentPosition(this._rowElements[0]) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING) && (i = { node: this._rowElements[0].childNodes[0], offset: 0 }), !this._rowContainer.contains(i.node)) return;
        let n = this._rowElements.slice(-1)[0];
        if (r.node.compareDocumentPosition(n) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_PRECEDING) && (r = { node: n, offset: n.textContent?.length ?? 0 }), !this._rowContainer.contains(r.node)) return;
        let o = ({ node: u, offset: h8 }) => {
          let c = u instanceof Text ? u.parentNode : u, d = parseInt(c?.getAttribute("aria-posinset"), 10) - 1;
          if (isNaN(d)) return console.warn("row is invalid. Race condition?"), null;
          let _ = this._rowColumns.get(c);
          if (!_) return console.warn("columns is null. Race condition?"), null;
          let p = h8 < _.length ? _[h8] : _.slice(-1)[0] + 1;
          return p >= this._terminal.cols && (++d, p = 0), { row: d, column: p };
        }, l = o(i), a = o(r);
        if (!(!l || !a)) {
          if (l.row > a.row || l.row === a.row && l.column >= a.column) throw new Error("invalid range");
          this._terminal.select(l.column, l.row, (a.row - l.row) * this._terminal.cols - l.column + a.column);
        }
      }
      _handleResize(e) {
        this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
        for (let i = this._rowContainer.children.length; i < this._terminal.rows; i++) this._rowElements[i] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[i]);
        for (; this._rowElements.length > e; ) this._rowContainer.removeChild(this._rowElements.pop());
        this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
      }
      _createAccessibilityTreeNode() {
        let e = this._coreBrowserService.mainDocument.createElement("div");
        return e.setAttribute("role", "listitem"), e.tabIndex = -1, this._refreshRowDimensions(e), e;
      }
      _refreshRowsDimensions() {
        if (this._renderService.dimensions.css.cell.height) {
          Object.assign(this._accessibilityContainer.style, { width: `${this._renderService.dimensions.css.canvas.width}px`, fontSize: `${this._terminal.options.fontSize}px` }), this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
          for (let e = 0; e < this._terminal.rows; e++) this._refreshRowDimensions(this._rowElements[e]), this._alignRowWidth(this._rowElements[e]);
        }
      }
      _refreshRowDimensions(e) {
        e.style.height = `${this._renderService.dimensions.css.cell.height}px`;
      }
      _alignRowWidth(e) {
        e.style.transform = "";
        let i = e.getBoundingClientRect().width, r = this._rowColumns.get(e)?.slice(-1)?.[0];
        if (!r) return;
        let n = r * this._renderService.dimensions.css.cell.width;
        e.style.transform = `scaleX(${n / i})`;
      }
    };
    Tt = M([S(1, xt), S(2, ae), S(3, ce)], Tt);
    hi = class extends D {
      constructor(e, i, r, n, o) {
        super();
        this._element = e;
        this._mouseService = i;
        this._renderService = r;
        this._bufferService = n;
        this._linkProviderService = o;
        this._linkCacheDisposables = [];
        this._isMouseOut = true;
        this._wasResized = false;
        this._activeLine = -1;
        this._onShowLinkUnderline = this._register(new v());
        this.onShowLinkUnderline = this._onShowLinkUnderline.event;
        this._onHideLinkUnderline = this._register(new v());
        this.onHideLinkUnderline = this._onHideLinkUnderline.event;
        this._register(C(() => {
          Ne(this._linkCacheDisposables), this._linkCacheDisposables.length = 0, this._lastMouseEvent = void 0, this._activeProviderReplies?.clear();
        })), this._register(this._bufferService.onResize(() => {
          this._clearCurrentLink(), this._wasResized = true;
        })), this._register(L(this._element, "mouseleave", () => {
          this._isMouseOut = true, this._clearCurrentLink();
        })), this._register(L(this._element, "mousemove", this._handleMouseMove.bind(this))), this._register(L(this._element, "mousedown", this._handleMouseDown.bind(this))), this._register(L(this._element, "mouseup", this._handleMouseUp.bind(this)));
      }
      get currentLink() {
        return this._currentLink;
      }
      _handleMouseMove(e) {
        this._lastMouseEvent = e;
        let i = this._positionFromMouseEvent(e, this._element, this._mouseService);
        if (!i) return;
        this._isMouseOut = false;
        let r = e.composedPath();
        for (let n = 0; n < r.length; n++) {
          let o = r[n];
          if (o.classList.contains("xterm")) break;
          if (o.classList.contains("xterm-hover")) return;
        }
        (!this._lastBufferCell || i.x !== this._lastBufferCell.x || i.y !== this._lastBufferCell.y) && (this._handleHover(i), this._lastBufferCell = i);
      }
      _handleHover(e) {
        if (this._activeLine !== e.y || this._wasResized) {
          this._clearCurrentLink(), this._askForLink(e, false), this._wasResized = false;
          return;
        }
        this._currentLink && this._linkAtPosition(this._currentLink.link, e) || (this._clearCurrentLink(), this._askForLink(e, true));
      }
      _askForLink(e, i) {
        (!this._activeProviderReplies || !i) && (this._activeProviderReplies?.forEach((n) => {
          n?.forEach((o) => {
            o.link.dispose && o.link.dispose();
          });
        }), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e.y);
        let r = false;
        for (let [n, o] of this._linkProviderService.linkProviders.entries()) i ? this._activeProviderReplies?.get(n) && (r = this._checkLinkProviderResult(n, e, r)) : o.provideLinks(e.y, (l) => {
          if (this._isMouseOut) return;
          let a = l?.map((u) => ({ link: u }));
          this._activeProviderReplies?.set(n, a), r = this._checkLinkProviderResult(n, e, r), this._activeProviderReplies?.size === this._linkProviderService.linkProviders.length && this._removeIntersectingLinks(e.y, this._activeProviderReplies);
        });
      }
      _removeIntersectingLinks(e, i) {
        let r = /* @__PURE__ */ new Set();
        for (let n = 0; n < i.size; n++) {
          let o = i.get(n);
          if (o) for (let l = 0; l < o.length; l++) {
            let a = o[l], u = a.link.range.start.y < e ? 0 : a.link.range.start.x, h8 = a.link.range.end.y > e ? this._bufferService.cols : a.link.range.end.x;
            for (let c = u; c <= h8; c++) {
              if (r.has(c)) {
                o.splice(l--, 1);
                break;
              }
              r.add(c);
            }
          }
        }
      }
      _checkLinkProviderResult(e, i, r) {
        if (!this._activeProviderReplies) return r;
        let n = this._activeProviderReplies.get(e), o = false;
        for (let l = 0; l < e; l++) (!this._activeProviderReplies.has(l) || this._activeProviderReplies.get(l)) && (o = true);
        if (!o && n) {
          let l = n.find((a) => this._linkAtPosition(a.link, i));
          l && (r = true, this._handleNewLink(l));
        }
        if (this._activeProviderReplies.size === this._linkProviderService.linkProviders.length && !r) for (let l = 0; l < this._activeProviderReplies.size; l++) {
          let a = this._activeProviderReplies.get(l)?.find((u) => this._linkAtPosition(u.link, i));
          if (a) {
            r = true, this._handleNewLink(a);
            break;
          }
        }
        return r;
      }
      _handleMouseDown() {
        this._mouseDownLink = this._currentLink;
      }
      _handleMouseUp(e) {
        if (!this._currentLink) return;
        let i = this._positionFromMouseEvent(e, this._element, this._mouseService);
        i && this._mouseDownLink && Ec(this._mouseDownLink.link, this._currentLink.link) && this._linkAtPosition(this._currentLink.link, i) && this._currentLink.link.activate(e, this._currentLink.link.text);
      }
      _clearCurrentLink(e, i) {
        !this._currentLink || !this._lastMouseEvent || (!e || !i || this._currentLink.link.range.start.y >= e && this._currentLink.link.range.end.y <= i) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, Ne(this._linkCacheDisposables), this._linkCacheDisposables.length = 0);
      }
      _handleNewLink(e) {
        if (!this._lastMouseEvent) return;
        let i = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
        i && this._linkAtPosition(e.link, i) && (this._currentLink = e, this._currentLink.state = { decorations: { underline: e.link.decorations === void 0 ? true : e.link.decorations.underline, pointerCursor: e.link.decorations === void 0 ? true : e.link.decorations.pointerCursor }, isHovered: true }, this._linkHover(this._element, e.link, this._lastMouseEvent), e.link.decorations = {}, Object.defineProperties(e.link.decorations, { pointerCursor: { get: () => this._currentLink?.state?.decorations.pointerCursor, set: (r) => {
          this._currentLink?.state && this._currentLink.state.decorations.pointerCursor !== r && (this._currentLink.state.decorations.pointerCursor = r, this._currentLink.state.isHovered && this._element.classList.toggle("xterm-cursor-pointer", r));
        } }, underline: { get: () => this._currentLink?.state?.decorations.underline, set: (r) => {
          this._currentLink?.state && this._currentLink?.state?.decorations.underline !== r && (this._currentLink.state.decorations.underline = r, this._currentLink.state.isHovered && this._fireUnderlineEvent(e.link, r));
        } } }), this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((r) => {
          if (!this._currentLink) return;
          let n = r.start === 0 ? 0 : r.start + 1 + this._bufferService.buffer.ydisp, o = this._bufferService.buffer.ydisp + 1 + r.end;
          if (this._currentLink.link.range.start.y >= n && this._currentLink.link.range.end.y <= o && (this._clearCurrentLink(n, o), this._lastMouseEvent)) {
            let l = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
            l && this._askForLink(l, false);
          }
        })));
      }
      _linkHover(e, i, r) {
        this._currentLink?.state && (this._currentLink.state.isHovered = true, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(i, true), this._currentLink.state.decorations.pointerCursor && e.classList.add("xterm-cursor-pointer")), i.hover && i.hover(r, i.text);
      }
      _fireUnderlineEvent(e, i) {
        let r = e.range, n = this._bufferService.buffer.ydisp, o = this._createLinkUnderlineEvent(r.start.x - 1, r.start.y - n - 1, r.end.x, r.end.y - n - 1, void 0);
        (i ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(o);
      }
      _linkLeave(e, i, r) {
        this._currentLink?.state && (this._currentLink.state.isHovered = false, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(i, false), this._currentLink.state.decorations.pointerCursor && e.classList.remove("xterm-cursor-pointer")), i.leave && i.leave(r, i.text);
      }
      _linkAtPosition(e, i) {
        let r = e.range.start.y * this._bufferService.cols + e.range.start.x, n = e.range.end.y * this._bufferService.cols + e.range.end.x, o = i.y * this._bufferService.cols + i.x;
        return r <= o && o <= n;
      }
      _positionFromMouseEvent(e, i, r) {
        let n = r.getCoords(e, i, this._bufferService.cols, this._bufferService.rows);
        if (n) return { x: n[0], y: n[1] + this._bufferService.buffer.ydisp };
      }
      _createLinkUnderlineEvent(e, i, r, n, o) {
        return { x1: e, y1: i, x2: r, y2: n, cols: this._bufferService.cols, fg: o };
      }
    };
    hi = M([S(1, Dt), S(2, ce), S(3, F), S(4, lr)], hi);
    yn = class extends Sn {
      constructor(e = {}) {
        super(e);
        this._linkifier = this._register(new ye());
        this.browser = tn;
        this._keyDownHandled = false;
        this._keyDownSeen = false;
        this._keyPressHandled = false;
        this._unprocessedDeadKey = false;
        this._accessibilityManager = this._register(new ye());
        this._onCursorMove = this._register(new v());
        this.onCursorMove = this._onCursorMove.event;
        this._onKey = this._register(new v());
        this.onKey = this._onKey.event;
        this._onRender = this._register(new v());
        this.onRender = this._onRender.event;
        this._onSelectionChange = this._register(new v());
        this.onSelectionChange = this._onSelectionChange.event;
        this._onTitleChange = this._register(new v());
        this.onTitleChange = this._onTitleChange.event;
        this._onBell = this._register(new v());
        this.onBell = this._onBell.event;
        this._onFocus = this._register(new v());
        this._onBlur = this._register(new v());
        this._onA11yCharEmitter = this._register(new v());
        this._onA11yTabEmitter = this._register(new v());
        this._onWillOpen = this._register(new v());
        this._setup(), this._decorationService = this._instantiationService.createInstance(Tn), this._instantiationService.setService(Be, this._decorationService), this._linkProviderService = this._instantiationService.createInstance(Qr), this._instantiationService.setService(lr, this._linkProviderService), this._linkProviderService.registerLinkProvider(this._instantiationService.createInstance(wt)), this._register(this._inputHandler.onRequestBell(() => this._onBell.fire())), this._register(this._inputHandler.onRequestRefreshRows((i) => this.refresh(i?.start ?? 0, i?.end ?? this.rows - 1))), this._register(this._inputHandler.onRequestSendFocus(() => this._reportFocus())), this._register(this._inputHandler.onRequestReset(() => this.reset())), this._register(this._inputHandler.onRequestWindowsOptionsReport((i) => this._reportWindowsOptions(i))), this._register(this._inputHandler.onColor((i) => this._handleColorEvent(i))), this._register($.forward(this._inputHandler.onCursorMove, this._onCursorMove)), this._register($.forward(this._inputHandler.onTitleChange, this._onTitleChange)), this._register($.forward(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this._register($.forward(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this._register(this._bufferService.onResize((i) => this._afterResize(i.cols, i.rows))), this._register(C(() => {
          this._customKeyEventHandler = void 0, this.element?.parentNode?.removeChild(this.element);
        }));
      }
      get linkifier() {
        return this._linkifier.value;
      }
      get onFocus() {
        return this._onFocus.event;
      }
      get onBlur() {
        return this._onBlur.event;
      }
      get onA11yChar() {
        return this._onA11yCharEmitter.event;
      }
      get onA11yTab() {
        return this._onA11yTabEmitter.event;
      }
      get onWillOpen() {
        return this._onWillOpen.event;
      }
      _handleColorEvent(e) {
        if (this._themeService) for (let i of e) {
          let r, n = "";
          switch (i.index) {
            case 256:
              r = "foreground", n = "10";
              break;
            case 257:
              r = "background", n = "11";
              break;
            case 258:
              r = "cursor", n = "12";
              break;
            default:
              r = "ansi", n = "4;" + i.index;
          }
          switch (i.type) {
            case 0:
              let o = U.toColorRGB(r === "ansi" ? this._themeService.colors.ansi[i.index] : this._themeService.colors[r]);
              this.coreService.triggerDataEvent(`${b.ESC}]${n};${ml(o)}${fs.ST}`);
              break;
            case 1:
              if (r === "ansi") this._themeService.modifyColors((l) => l.ansi[i.index] = j.toColor(...i.color));
              else {
                let l = r;
                this._themeService.modifyColors((a) => a[l] = j.toColor(...i.color));
              }
              break;
            case 2:
              this._themeService.restoreColor(i.index);
              break;
          }
        }
      }
      _setup() {
        super._setup(), this._customKeyEventHandler = void 0;
      }
      get buffer() {
        return this.buffers.active;
      }
      focus() {
        this.textarea && this.textarea.focus({ preventScroll: true });
      }
      _handleScreenReaderModeOptionChange(e) {
        e ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(Tt, this)) : this._accessibilityManager.clear();
      }
      _handleTextAreaFocus(e) {
        this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(b.ESC + "[I"), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
      }
      blur() {
        return this.textarea?.blur();
      }
      _handleTextAreaBlur() {
        this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(b.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
      }
      _syncTextArea() {
        if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService) return;
        let e = this.buffer.ybase + this.buffer.y, i = this.buffer.lines.get(e);
        if (!i) return;
        let r = Math.min(this.buffer.x, this.cols - 1), n = this._renderService.dimensions.css.cell.height, o = i.getWidth(r), l = this._renderService.dimensions.css.cell.width * o, a = this.buffer.y * this._renderService.dimensions.css.cell.height, u = r * this._renderService.dimensions.css.cell.width;
        this.textarea.style.left = u + "px", this.textarea.style.top = a + "px", this.textarea.style.width = l + "px", this.textarea.style.height = n + "px", this.textarea.style.lineHeight = n + "px", this.textarea.style.zIndex = "-5";
      }
      _initGlobal() {
        this._bindKeys(), this._register(L(this.element, "copy", (i) => {
          this.hasSelection() && Vs(i, this._selectionService);
        }));
        let e = (i) => qs(i, this.textarea, this.coreService, this.optionsService);
        this._register(L(this.textarea, "paste", e)), this._register(L(this.element, "paste", e)), Ss ? this._register(L(this.element, "mousedown", (i) => {
          i.button === 2 && Pn(i, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
        })) : this._register(L(this.element, "contextmenu", (i) => {
          Pn(i, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
        })), Bi && this._register(L(this.element, "auxclick", (i) => {
          i.button === 1 && Mn(i, this.textarea, this.screenElement);
        }));
      }
      _bindKeys() {
        this._register(L(this.textarea, "keyup", (e) => this._keyUp(e), true)), this._register(L(this.textarea, "keydown", (e) => this._keyDown(e), true)), this._register(L(this.textarea, "keypress", (e) => this._keyPress(e), true)), this._register(L(this.textarea, "compositionstart", () => this._compositionHelper.compositionstart())), this._register(L(this.textarea, "compositionupdate", (e) => this._compositionHelper.compositionupdate(e))), this._register(L(this.textarea, "compositionend", () => this._compositionHelper.compositionend())), this._register(L(this.textarea, "input", (e) => this._inputEvent(e), true)), this._register(this.onRender(() => this._compositionHelper.updateCompositionElements()));
      }
      open(e) {
        if (!e) throw new Error("Terminal requires a parent element.");
        if (e.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this.element?.ownerDocument.defaultView && this._coreBrowserService) {
          this.element.ownerDocument.defaultView !== this._coreBrowserService.window && (this._coreBrowserService.window = this.element.ownerDocument.defaultView);
          return;
        }
        this._document = e.ownerDocument, this.options.documentOverride && this.options.documentOverride instanceof Document && (this._document = this.optionsService.rawOptions.documentOverride), this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e.appendChild(this.element);
        let i = this._document.createDocumentFragment();
        this._viewportElement = this._document.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), i.appendChild(this._viewportElement), this.screenElement = this._document.createElement("div"), this.screenElement.classList.add("xterm-screen"), this._register(L(this.screenElement, "mousemove", (o) => this.updateCursorStyle(o))), this._helperContainer = this._document.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), i.appendChild(this.screenElement);
        let r = this.textarea = this._document.createElement("textarea");
        this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", mi.get()), Ts || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._register(this.optionsService.onSpecificOptionChange("disableStdin", () => r.readOnly = this.optionsService.rawOptions.disableStdin)), this.textarea.readOnly = this.optionsService.rawOptions.disableStdin, this._coreBrowserService = this._register(this._instantiationService.createInstance(Jr, this.textarea, e.ownerDocument.defaultView ?? window, this._document ?? typeof window < "u" ? window.document : null)), this._instantiationService.setService(ae, this._coreBrowserService), this._register(L(this.textarea, "focus", (o) => this._handleTextAreaFocus(o))), this._register(L(this.textarea, "blur", () => this._handleTextAreaBlur())), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(jt, this._document, this._helperContainer), this._instantiationService.setService(nt, this._charSizeService), this._themeService = this._instantiationService.createInstance(ti), this._instantiationService.setService(Re, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(ct), this._instantiationService.setService(or, this._characterJoinerService), this._renderService = this._register(this._instantiationService.createInstance(Qt, this.rows, this.screenElement)), this._instantiationService.setService(ce, this._renderService), this._register(this._renderService.onRenderedViewportChange((o) => this._onRender.fire(o))), this.onResize((o) => this._renderService.resize(o.cols, o.rows)), this._compositionView = this._document.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance($t, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this._mouseService = this._instantiationService.createInstance(Xt), this._instantiationService.setService(Dt, this._mouseService);
        let n = this._linkifier.value = this._register(this._instantiationService.createInstance(hi, this.screenElement));
        this.element.appendChild(i);
        try {
          this._onWillOpen.fire(this.element);
        } catch {
        }
        this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this._register(this.onCursorMove(() => {
          this._renderService.handleCursorMove(), this._syncTextArea();
        })), this._register(this.onResize(() => this._renderService.handleResize(this.cols, this.rows))), this._register(this.onBlur(() => this._renderService.handleBlur())), this._register(this.onFocus(() => this._renderService.handleFocus())), this._viewport = this._register(this._instantiationService.createInstance(zt, this.element, this.screenElement)), this._register(this._viewport.onRequestScrollLines((o) => {
          super.scrollLines(o, false), this.refresh(0, this.rows - 1);
        })), this._selectionService = this._register(this._instantiationService.createInstance(ei, this.element, this.screenElement, n)), this._instantiationService.setService(Qs, this._selectionService), this._register(this._selectionService.onRequestScrollLines((o) => this.scrollLines(o.amount, o.suppressScrollEvent))), this._register(this._selectionService.onSelectionChange(() => this._onSelectionChange.fire())), this._register(this._selectionService.onRequestRedraw((o) => this._renderService.handleSelectionChanged(o.start, o.end, o.columnSelectMode))), this._register(this._selectionService.onLinuxMouseSelection((o) => {
          this.textarea.value = o, this.textarea.focus(), this.textarea.select();
        })), this._register($.any(this._onScroll.event, this._inputHandler.onScroll)(() => {
          this._selectionService.refresh(), this._viewport?.queueSync();
        })), this._register(this._instantiationService.createInstance(Gt, this.screenElement)), this._register(L(this.element, "mousedown", (o) => this._selectionService.handleMouseDown(o))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(Tt, this)), this._register(this.optionsService.onSpecificOptionChange("screenReaderMode", (o) => this._handleScreenReaderModeOptionChange(o))), this.options.overviewRuler.width && (this._overviewRulerRenderer = this._register(this._instantiationService.createInstance(bt, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRuler", (o) => {
          !this._overviewRulerRenderer && o && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this._register(this._instantiationService.createInstance(bt, this._viewportElement, this.screenElement)));
        }), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
      }
      _createRenderer() {
        return this._instantiationService.createInstance(Yt, this, this._document, this.element, this.screenElement, this._viewportElement, this._helperContainer, this.linkifier);
      }
      bindMouse() {
        let e = this, i = this.element;
        function r(l) {
          let a = e._mouseService.getMouseReportCoords(l, e.screenElement);
          if (!a) return false;
          let u, h8;
          switch (l.overrideType || l.type) {
            case "mousemove":
              h8 = 32, l.buttons === void 0 ? (u = 3, l.button !== void 0 && (u = l.button < 3 ? l.button : 3)) : u = l.buttons & 1 ? 0 : l.buttons & 4 ? 1 : l.buttons & 2 ? 2 : 3;
              break;
            case "mouseup":
              h8 = 0, u = l.button < 3 ? l.button : 3;
              break;
            case "mousedown":
              h8 = 1, u = l.button < 3 ? l.button : 3;
              break;
            case "wheel":
              if (e._customWheelEventHandler && e._customWheelEventHandler(l) === false) return false;
              let c = l.deltaY;
              if (c === 0 || e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return false;
              h8 = c < 0 ? 0 : 1, u = 4;
              break;
            default:
              return false;
          }
          return h8 === void 0 || u === void 0 || u > 4 ? false : e.coreMouseService.triggerMouseEvent({ col: a.col, row: a.row, x: a.x, y: a.y, button: u, action: h8, ctrl: l.ctrlKey, alt: l.altKey, shift: l.shiftKey });
        }
        let n = { mouseup: null, wheel: null, mousedrag: null, mousemove: null }, o = { mouseup: (l) => (r(l), l.buttons || (this._document.removeEventListener("mouseup", n.mouseup), n.mousedrag && this._document.removeEventListener("mousemove", n.mousedrag)), this.cancel(l)), wheel: (l) => (r(l), this.cancel(l, true)), mousedrag: (l) => {
          l.buttons && r(l);
        }, mousemove: (l) => {
          l.buttons || r(l);
        } };
        this._register(this.coreMouseService.onProtocolChange((l) => {
          l ? (this.optionsService.rawOptions.logLevel === "debug" && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(l)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), l & 8 ? n.mousemove || (i.addEventListener("mousemove", o.mousemove), n.mousemove = o.mousemove) : (i.removeEventListener("mousemove", n.mousemove), n.mousemove = null), l & 16 ? n.wheel || (i.addEventListener("wheel", o.wheel, { passive: false }), n.wheel = o.wheel) : (i.removeEventListener("wheel", n.wheel), n.wheel = null), l & 2 ? n.mouseup || (n.mouseup = o.mouseup) : (this._document.removeEventListener("mouseup", n.mouseup), n.mouseup = null), l & 4 ? n.mousedrag || (n.mousedrag = o.mousedrag) : (this._document.removeEventListener("mousemove", n.mousedrag), n.mousedrag = null);
        })), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this._register(L(i, "mousedown", (l) => {
          if (l.preventDefault(), this.focus(), !(!this.coreMouseService.areMouseEventsActive || this._selectionService.shouldForceSelection(l))) return r(l), n.mouseup && this._document.addEventListener("mouseup", n.mouseup), n.mousedrag && this._document.addEventListener("mousemove", n.mousedrag), this.cancel(l);
        })), this._register(L(i, "wheel", (l) => {
          if (!n.wheel) {
            if (this._customWheelEventHandler && this._customWheelEventHandler(l) === false) return false;
            if (!this.buffer.hasScrollback) {
              if (l.deltaY === 0) return false;
              if (e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return this.cancel(l, true);
              let h8 = b.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (l.deltaY < 0 ? "A" : "B");
              return this.coreService.triggerDataEvent(h8, true), this.cancel(l, true);
            }
          }
        }, { passive: false }));
      }
      refresh(e, i) {
        this._renderService?.refreshRows(e, i);
      }
      updateCursorStyle(e) {
        this._selectionService?.shouldColumnSelect(e) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
      }
      _showCursor() {
        this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = true, this.refresh(this.buffer.y, this.buffer.y));
      }
      scrollLines(e, i) {
        this._viewport ? this._viewport.scrollLines(e) : super.scrollLines(e, i), this.refresh(0, this.rows - 1);
      }
      scrollPages(e) {
        this.scrollLines(e * (this.rows - 1));
      }
      scrollToTop() {
        this.scrollLines(-this._bufferService.buffer.ydisp);
      }
      scrollToBottom(e) {
        e && this._viewport ? this._viewport.scrollToLine(this.buffer.ybase, true) : this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
      }
      scrollToLine(e) {
        let i = e - this._bufferService.buffer.ydisp;
        i !== 0 && this.scrollLines(i);
      }
      paste(e) {
        Cn(e, this.textarea, this.coreService, this.optionsService);
      }
      attachCustomKeyEventHandler(e) {
        this._customKeyEventHandler = e;
      }
      attachCustomWheelEventHandler(e) {
        this._customWheelEventHandler = e;
      }
      registerLinkProvider(e) {
        return this._linkProviderService.registerLinkProvider(e);
      }
      registerCharacterJoiner(e) {
        if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
        let i = this._characterJoinerService.register(e);
        return this.refresh(0, this.rows - 1), i;
      }
      deregisterCharacterJoiner(e) {
        if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
        this._characterJoinerService.deregister(e) && this.refresh(0, this.rows - 1);
      }
      get markers() {
        return this.buffer.markers;
      }
      registerMarker(e) {
        return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e);
      }
      registerDecoration(e) {
        return this._decorationService.registerDecoration(e);
      }
      hasSelection() {
        return this._selectionService ? this._selectionService.hasSelection : false;
      }
      select(e, i, r) {
        this._selectionService.setSelection(e, i, r);
      }
      getSelection() {
        return this._selectionService ? this._selectionService.selectionText : "";
      }
      getSelectionPosition() {
        if (!(!this._selectionService || !this._selectionService.hasSelection)) return { start: { x: this._selectionService.selectionStart[0], y: this._selectionService.selectionStart[1] }, end: { x: this._selectionService.selectionEnd[0], y: this._selectionService.selectionEnd[1] } };
      }
      clearSelection() {
        this._selectionService?.clearSelection();
      }
      selectAll() {
        this._selectionService?.selectAll();
      }
      selectLines(e, i) {
        this._selectionService?.selectLines(e, i);
      }
      _keyDown(e) {
        if (this._keyDownHandled = false, this._keyDownSeen = true, this._customKeyEventHandler && this._customKeyEventHandler(e) === false) return false;
        let i = this.browser.isMac && this.options.macOptionIsMeta && e.altKey;
        if (!i && !this._compositionHelper.keydown(e)) return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(true), false;
        !i && (e.key === "Dead" || e.key === "AltGraph") && (this._unprocessedDeadKey = true);
        let r = Il(e, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
        if (this.updateCursorStyle(e), r.type === 3 || r.type === 2) {
          let n = this.rows - 1;
          return this.scrollLines(r.type === 2 ? -n : n), this.cancel(e, true);
        }
        if (r.type === 1 && this.selectAll(), this._isThirdLevelShift(this.browser, e) || (r.cancel && this.cancel(e, true), !r.key) || e.key && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key.charCodeAt(0) >= 65 && e.key.charCodeAt(0) <= 90) return true;
        if (this._unprocessedDeadKey) return this._unprocessedDeadKey = false, true;
        if ((r.key === b.ETX || r.key === b.CR) && (this.textarea.value = ""), this._onKey.fire({ key: r.key, domEvent: e }), this._showCursor(), this.coreService.triggerDataEvent(r.key, true), !this.optionsService.rawOptions.screenReaderMode || e.altKey || e.ctrlKey) return this.cancel(e, true);
        this._keyDownHandled = true;
      }
      _isThirdLevelShift(e, i) {
        let r = e.isMac && !this.options.macOptionIsMeta && i.altKey && !i.ctrlKey && !i.metaKey || e.isWindows && i.altKey && i.ctrlKey && !i.metaKey || e.isWindows && i.getModifierState("AltGraph");
        return i.type === "keypress" ? r : r && (!i.keyCode || i.keyCode > 47);
      }
      _keyUp(e) {
        this._keyDownSeen = false, !(this._customKeyEventHandler && this._customKeyEventHandler(e) === false) && (Tc(e) || this.focus(), this.updateCursorStyle(e), this._keyPressHandled = false);
      }
      _keyPress(e) {
        let i;
        if (this._keyPressHandled = false, this._keyDownHandled || this._customKeyEventHandler && this._customKeyEventHandler(e) === false) return false;
        if (this.cancel(e), e.charCode) i = e.charCode;
        else if (e.which === null || e.which === void 0) i = e.keyCode;
        else if (e.which !== 0 && e.charCode !== 0) i = e.which;
        else return false;
        return !i || (e.altKey || e.ctrlKey || e.metaKey) && !this._isThirdLevelShift(this.browser, e) ? false : (i = String.fromCharCode(i), this._onKey.fire({ key: i, domEvent: e }), this._showCursor(), this.coreService.triggerDataEvent(i, true), this._keyPressHandled = true, this._unprocessedDeadKey = false, true);
      }
      _inputEvent(e) {
        if (e.data && e.inputType === "insertText" && (!e.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
          if (this._keyPressHandled) return false;
          this._unprocessedDeadKey = false;
          let i = e.data;
          return this.coreService.triggerDataEvent(i, true), this.cancel(e), true;
        }
        return false;
      }
      resize(e, i) {
        if (e === this.cols && i === this.rows) {
          this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
          return;
        }
        super.resize(e, i);
      }
      _afterResize(e, i) {
        this._charSizeService?.measure();
      }
      clear() {
        if (!(this.buffer.ybase === 0 && this.buffer.y === 0)) {
          this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
          for (let e = 1; e < this.rows; e++) this.buffer.lines.push(this.buffer.getBlankLine(X));
          this._onScroll.fire({ position: this.buffer.ydisp }), this.refresh(0, this.rows - 1);
        }
      }
      reset() {
        this.options.rows = this.rows, this.options.cols = this.cols;
        let e = this._customKeyEventHandler;
        this._setup(), super.reset(), this._selectionService?.reset(), this._decorationService.reset(), this._customKeyEventHandler = e, this.refresh(0, this.rows - 1);
      }
      clearTextureAtlas() {
        this._renderService?.clearTextureAtlas();
      }
      _reportFocus() {
        this.element?.classList.contains("focus") ? this.coreService.triggerDataEvent(b.ESC + "[I") : this.coreService.triggerDataEvent(b.ESC + "[O");
      }
      _reportWindowsOptions(e) {
        if (this._renderService) switch (e) {
          case 0:
            let i = this._renderService.dimensions.css.canvas.width.toFixed(0), r = this._renderService.dimensions.css.canvas.height.toFixed(0);
            this.coreService.triggerDataEvent(`${b.ESC}[4;${r};${i}t`);
            break;
          case 1:
            let n = this._renderService.dimensions.css.cell.width.toFixed(0), o = this._renderService.dimensions.css.cell.height.toFixed(0);
            this.coreService.triggerDataEvent(`${b.ESC}[6;${o};${n}t`);
            break;
        }
      }
      cancel(e, i) {
        if (!(!this.options.cancelEvents && !i)) return e.preventDefault(), e.stopPropagation(), false;
      }
    };
    xn = class {
      constructor() {
        this._addons = [];
      }
      dispose() {
        for (let t = this._addons.length - 1; t >= 0; t--) this._addons[t].instance.dispose();
      }
      loadAddon(t, e) {
        let i = { instance: e, dispose: e.dispose, isDisposed: false };
        this._addons.push(i), e.dispose = () => this._wrappedAddonDispose(i), e.activate(t);
      }
      _wrappedAddonDispose(t) {
        if (t.isDisposed) return;
        let e = -1;
        for (let i = 0; i < this._addons.length; i++) if (this._addons[i] === t) {
          e = i;
          break;
        }
        if (e === -1) throw new Error("Could not dispose an addon that has not been loaded");
        t.isDisposed = true, t.dispose.apply(t.instance), this._addons.splice(e, 1);
      }
    };
    wn = class {
      constructor(t) {
        this._line = t;
      }
      get isWrapped() {
        return this._line.isWrapped;
      }
      get length() {
        return this._line.length;
      }
      getCell(t, e) {
        if (!(t < 0 || t >= this._line.length)) return e ? (this._line.loadCell(t, e), e) : this._line.loadCell(t, new q());
      }
      translateToString(t, e, i) {
        return this._line.translateToString(t, e, i);
      }
    };
    Ji = class {
      constructor(t, e) {
        this._buffer = t;
        this.type = e;
      }
      init(t) {
        return this._buffer = t, this;
      }
      get cursorY() {
        return this._buffer.y;
      }
      get cursorX() {
        return this._buffer.x;
      }
      get viewportY() {
        return this._buffer.ydisp;
      }
      get baseY() {
        return this._buffer.ybase;
      }
      get length() {
        return this._buffer.lines.length;
      }
      getLine(t) {
        let e = this._buffer.lines.get(t);
        if (e) return new wn(e);
      }
      getNullCell() {
        return new q();
      }
    };
    Dn = class extends D {
      constructor(e) {
        super();
        this._core = e;
        this._onBufferChange = this._register(new v());
        this.onBufferChange = this._onBufferChange.event;
        this._normal = new Ji(this._core.buffers.normal, "normal"), this._alternate = new Ji(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate(() => this._onBufferChange.fire(this.active));
      }
      get active() {
        if (this._core.buffers.active === this._core.buffers.normal) return this.normal;
        if (this._core.buffers.active === this._core.buffers.alt) return this.alternate;
        throw new Error("Active buffer is neither normal nor alternate");
      }
      get normal() {
        return this._normal.init(this._core.buffers.normal);
      }
      get alternate() {
        return this._alternate.init(this._core.buffers.alt);
      }
    };
    Rn = class {
      constructor(t) {
        this._core = t;
      }
      registerCsiHandler(t, e) {
        return this._core.registerCsiHandler(t, (i) => e(i.toArray()));
      }
      addCsiHandler(t, e) {
        return this.registerCsiHandler(t, e);
      }
      registerDcsHandler(t, e) {
        return this._core.registerDcsHandler(t, (i, r) => e(i, r.toArray()));
      }
      addDcsHandler(t, e) {
        return this.registerDcsHandler(t, e);
      }
      registerEscHandler(t, e) {
        return this._core.registerEscHandler(t, e);
      }
      addEscHandler(t, e) {
        return this.registerEscHandler(t, e);
      }
      registerOscHandler(t, e) {
        return this._core.registerOscHandler(t, e);
      }
      addOscHandler(t, e) {
        return this.registerOscHandler(t, e);
      }
    };
    Ln = class {
      constructor(t) {
        this._core = t;
      }
      register(t) {
        this._core.unicodeService.register(t);
      }
      get versions() {
        return this._core.unicodeService.versions;
      }
      get activeVersion() {
        return this._core.unicodeService.activeVersion;
      }
      set activeVersion(t) {
        this._core.unicodeService.activeVersion = t;
      }
    };
    Ic = ["cols", "rows"], Ue = 0, Dl = class extends D {
      constructor(t) {
        super(), this._core = this._register(new yn(t)), this._addonManager = this._register(new xn()), this._publicOptions = { ...this._core.options };
        let e = (r) => this._core.options[r], i = (r, n) => {
          this._checkReadonlyOptions(r), this._core.options[r] = n;
        };
        for (let r in this._core.options) {
          let n = { get: e.bind(this, r), set: i.bind(this, r) };
          Object.defineProperty(this._publicOptions, r, n);
        }
      }
      _checkReadonlyOptions(t) {
        if (Ic.includes(t)) throw new Error(`Option "${t}" can only be set in the constructor`);
      }
      _checkProposedApi() {
        if (!this._core.optionsService.rawOptions.allowProposedApi) throw new Error("You must set the allowProposedApi option to true to use proposed API");
      }
      get onBell() {
        return this._core.onBell;
      }
      get onBinary() {
        return this._core.onBinary;
      }
      get onCursorMove() {
        return this._core.onCursorMove;
      }
      get onData() {
        return this._core.onData;
      }
      get onKey() {
        return this._core.onKey;
      }
      get onLineFeed() {
        return this._core.onLineFeed;
      }
      get onRender() {
        return this._core.onRender;
      }
      get onResize() {
        return this._core.onResize;
      }
      get onScroll() {
        return this._core.onScroll;
      }
      get onSelectionChange() {
        return this._core.onSelectionChange;
      }
      get onTitleChange() {
        return this._core.onTitleChange;
      }
      get onWriteParsed() {
        return this._core.onWriteParsed;
      }
      get element() {
        return this._core.element;
      }
      get parser() {
        return this._parser || (this._parser = new Rn(this._core)), this._parser;
      }
      get unicode() {
        return this._checkProposedApi(), new Ln(this._core);
      }
      get textarea() {
        return this._core.textarea;
      }
      get rows() {
        return this._core.rows;
      }
      get cols() {
        return this._core.cols;
      }
      get buffer() {
        return this._buffer || (this._buffer = this._register(new Dn(this._core))), this._buffer;
      }
      get markers() {
        return this._checkProposedApi(), this._core.markers;
      }
      get modes() {
        let t = this._core.coreService.decPrivateModes, e = "none";
        switch (this._core.coreMouseService.activeProtocol) {
          case "X10":
            e = "x10";
            break;
          case "VT200":
            e = "vt200";
            break;
          case "DRAG":
            e = "drag";
            break;
          case "ANY":
            e = "any";
            break;
        }
        return { applicationCursorKeysMode: t.applicationCursorKeys, applicationKeypadMode: t.applicationKeypad, bracketedPasteMode: t.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: e, originMode: t.origin, reverseWraparoundMode: t.reverseWraparound, sendFocusMode: t.sendFocus, synchronizedOutputMode: t.synchronizedOutput, wraparoundMode: t.wraparound };
      }
      get options() {
        return this._publicOptions;
      }
      set options(t) {
        for (let e in t) this._publicOptions[e] = t[e];
      }
      blur() {
        this._core.blur();
      }
      focus() {
        this._core.focus();
      }
      input(t, e = true) {
        this._core.input(t, e);
      }
      resize(t, e) {
        this._verifyIntegers(t, e), this._core.resize(t, e);
      }
      open(t) {
        this._core.open(t);
      }
      attachCustomKeyEventHandler(t) {
        this._core.attachCustomKeyEventHandler(t);
      }
      attachCustomWheelEventHandler(t) {
        this._core.attachCustomWheelEventHandler(t);
      }
      registerLinkProvider(t) {
        return this._core.registerLinkProvider(t);
      }
      registerCharacterJoiner(t) {
        return this._checkProposedApi(), this._core.registerCharacterJoiner(t);
      }
      deregisterCharacterJoiner(t) {
        this._checkProposedApi(), this._core.deregisterCharacterJoiner(t);
      }
      registerMarker(t = 0) {
        return this._verifyIntegers(t), this._core.registerMarker(t);
      }
      registerDecoration(t) {
        return this._checkProposedApi(), this._verifyPositiveIntegers(t.x ?? 0, t.width ?? 0, t.height ?? 0), this._core.registerDecoration(t);
      }
      hasSelection() {
        return this._core.hasSelection();
      }
      select(t, e, i) {
        this._verifyIntegers(t, e, i), this._core.select(t, e, i);
      }
      getSelection() {
        return this._core.getSelection();
      }
      getSelectionPosition() {
        return this._core.getSelectionPosition();
      }
      clearSelection() {
        this._core.clearSelection();
      }
      selectAll() {
        this._core.selectAll();
      }
      selectLines(t, e) {
        this._verifyIntegers(t, e), this._core.selectLines(t, e);
      }
      dispose() {
        super.dispose();
      }
      scrollLines(t) {
        this._verifyIntegers(t), this._core.scrollLines(t);
      }
      scrollPages(t) {
        this._verifyIntegers(t), this._core.scrollPages(t);
      }
      scrollToTop() {
        this._core.scrollToTop();
      }
      scrollToBottom() {
        this._core.scrollToBottom();
      }
      scrollToLine(t) {
        this._verifyIntegers(t), this._core.scrollToLine(t);
      }
      clear() {
        this._core.clear();
      }
      write(t, e) {
        this._core.write(t, e);
      }
      writeln(t, e) {
        this._core.write(t), this._core.write(`\r
`, e);
      }
      paste(t) {
        this._core.paste(t);
      }
      refresh(t, e) {
        this._verifyIntegers(t, e), this._core.refresh(t, e);
      }
      reset() {
        this._core.reset();
      }
      clearTextureAtlas() {
        this._core.clearTextureAtlas();
      }
      loadAddon(t) {
        this._addonManager.loadAddon(this, t);
      }
      static get strings() {
        return { get promptLabel() {
          return mi.get();
        }, set promptLabel(t) {
          mi.set(t);
        }, get tooMuchOutput() {
          return _i.get();
        }, set tooMuchOutput(t) {
          _i.set(t);
        } };
      }
      _verifyIntegers(...t) {
        for (Ue of t) if (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0) throw new Error("This API only accepts integers");
      }
      _verifyPositiveIntegers(...t) {
        for (Ue of t) if (Ue && (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0 || Ue < 0)) throw new Error("This API only accepts positive integers");
      }
    };
  }
});

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/api.js
var ROUTE = "api/omni-ai";
var OMNI_UI = "api/omni-ui";
var call = (endpoint, payload) => callRoute(ROUTE, endpoint, payload);
var callOmniUi = (endpoint, payload) => callRoute(OMNI_UI, endpoint, payload);
async function callRoute(route, endpoint, payload) {
  let response;
  try {
    response = await fetch(route, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, payload: payload ?? null })
    });
  } catch {
    throw Object.assign(new Error("Could not reach DSH. Check that it is still running."), { code: "NETWORK" });
  }
  if (!response.ok) throw Object.assign(new Error(`DSH answered HTTP ${response.status}`), { code: `HTTP_${response.status}` });
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(result.error?.message ?? "Request failed"), { code: result.error?.code ?? "omni-ai/error" });
  return result.value;
}

// src/client/vendor/inks.js
var INKS = {
  deepseek: ["#0891B2", "#22D3EE"],
  charcoal: ["#141416", "#F1F2F4"],
  graphite: ["#2D2D2D", "#D6D6DA"],
  rose: ["#EC2F6B", "#FF5A7A"],
  sky: ["#0AA8D6", "#2EE6E0"],
  tangerine: ["#FF6900", "#FF8A2E"],
  cobalt: ["#082DFF", "#5C78FF"],
  black: ["#000000", "#FFFFFF"],
  brown: ["#A27952", "#855C36"],
  red: ["#FF3E51", "#E02135"],
  orange: ["#FF781C", "#FF6700"],
  yellow: ["#FFAF38", "#FF9800"],
  green: ["#00C972", "#009957"],
  cyan: ["#1CC3B0", "#00A592"],
  blue: ["#2A92FE", "#0E74E0"],
  violet: ["#A97EFE", "#804EE0"],
  magenta: ["#FF5EB1", "#E02A88"],
  gray: ["#959595", "#777777"],
  aurora: ["#00B8D4", "#2EE6E0"]
};
var GRADIENTS = { aurora: [[0, "#A4FFB0"], [0.42, "#00F0E4"], [1, "#2E9EF7"]] };
var ACCENT_INKS = ["deepseek", "charcoal", "graphite", "rose", "sky", "tangerine", "cobalt"];
var LEGACY_INKS = { kimi: "charcoal", zai: "graphite", minimax: "rose", stepfun: "sky", mimo: "tangerine", qwen: "cobalt" };
var isHex = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
var luminance = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
var inkName = (color) => INKS[color] ? color : INKS[LEGACY_INKS[color]] ? LEGACY_INKS[color] : "gray";
var inkFill = (color) => isHex(color) ? color : `var(--bt-ink-${inkName(color)})`;
var inkText = (color) => color === "black" ? "var(--bt-ink-gray)" : inkFill(color);
var paintCss = (color) => GRADIENTS[color] ? `linear-gradient(135deg,${GRADIENTS[color].map(([offset, value]) => `${value} ${offset * 100}%`).join(",")})` : inkFill(color);

// src/client/vendor/characters.js
var CHARACTERS = {
  whale: { label: "Whale", body: "M65.3 20.9l5.1 .1 4.8 .9 4.8 1.7 4.3 2.3 3.8 3.1 3 3.4 2.3 3.8 1.6 4.3 .9 4.3 0 4.8-.8 4.8-1.4 4.3-2.3 4.3-3.2 4.3-3.4 3.3-4.3 3.1-7.2 3.5-7.6 1.7-7.2 .1-9.6-1.6-3.3-1-2.9-1.7-8.8-8.9-6-4.7-3.3-.5-7.7 1.1-4.8-.1-4.7-1.2-1.9-1.2-1-1-.5-1.5 .4-1.4 1.1-1.3 1.9-1.3 4.7-1.5 7.7-.6 1.1-.5 .7-1 0-1.4-2.8-7.2-1.2-5.3-.1-4.3 .4-1.4 .9-1.2 1.9-.2 2 1 2.2 2.3 2.2 3.4 3.2 7.6 1.9 9.7 .5-.1 1.1-7.2 1.8-4.8 3.2-5.2 3.9-4.3 4.9-3.9 5.6-2.9 5.8-1.9z", paints: [["M93.3 55.8l1-.3 .1 1.2-2.4 5.3-3.4 4.8-3.8 3.8-4.8 3.4-5.7 2.8-4.8 1.5-4.8 .4 20.1-17.4 5.2-3.7z", "#fff", 1]], shade: "M88.6 29.5l2.4 2.9 1.9 2.8 2.4 6.3 .5 3.3 .1 5.3-1.5 6.6-1.9 4.3-2 3.3-4.8 5.4-5.7 4.3-7.2 3.3-6.2 1.5-6.7 .1-3.3-.2-9.6-1.8-3.3-1.5-2.4-1.9-8.6-8.9-5.3-3.9-3.3-.1-2.9 .2-3.3 .8-5.8 0-4.3-1-2.9-1.9 .6-.6 3.8-1.3 10.5-2.5 4.3 .9 1.4-.1 2.2-1.7 .5-1.4-.3-1.5-1.2-1.4-2.2-1.4-1.2-1.9-.6-12 .4-3.3 .5-.5 2.9 3.8 2.4 4.8 1.9 5.7 .7 5.8 .7 2.8 2.1 2.4 2.7 5.5 3.8 4.3 2.9 2.2 3.3 1 3.4-.4 6.2-3 7.1-4.5 7.3-5.6 6.6-5.9 5.9-6.5 3.7-5.3 1.7-4.2 .1-2.9z", light: "M55.6 22.8l1.9-.3 1.5 .3 .6 1 .1 .9-2 4.3-3.8 5.3-5.8 6.2-5.4 4.4-4.8 2.3-1.4 0-1.2-.5-.8-1.9 .5-3.3 2.5-4.8 3.3-4.3 2.4-2.4 5.3-3.9zM19.3 28.1l-1.4 2 .3-1.1zM21.7 49.1l.6 .5-.3 .5-.8 0zM35.8 52l1.2-.4 .9 .7 .7 1.6-.4 .9-1.2 .1-2.6-.5zM7.2 52.9l-2.9 2.9 1.2-1.6z", eyes: [[72.5, 48.4, 9.3, 23, -15.8], [85.6, 43.4, 7, 22.9, -21.2]] },
  octopus: { label: "Octopus", body: "M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z", shade: "M87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C62 76 70 66 75 56C80 48 80 36 75 26C82 32 87 38 87 46Z", light: "M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z", eyes: [[40, 36, 6.5, 11, 0], [60, 36, 6.5, 11, 0]] },
  star: { label: "Star", body: "M40.1 4.4l1.5-.4 1.9 .1 5.2 1.1 1.9 .9 13.2 14.9 17.1-.8 5.2 1.1 1.8 .9 1.7 1.6 .7 2.4-.4 1.9-9.7 23.6 5.6 23.7 .1 1.9-.6 1.4-2.1 1.8-2.3 .5-19.9-1.8-16.6 15.5-1.9 1-1.9 .3-7-1.5-2.6-2.1-.9-2.4-2.8-24.1-16-13.6-1.1-1.5-.5-1.9 .4-1.9 1.2-1.5 18.9-13.6 7.1-24.6 1-1.7z", shade: "M52 7.7l14.3 16.1 1 2.9 .3 3.1 19.4-1.3 2-1.4 .7-2.3-.4-1 .5 .5 .5 1.9-.4 1.9-9.8 23.2 5.5 23.1 .1 3.4-2 2.4-2.8 .8-19.4-2.1-1.9 1.4-14.7 14-2.4 1.4-3.3 .1-4.7-1-2-1 .6-.2 3.3 .8 2.8 .1 5.1-2.1 .7-.9 .4-2.4-2.6-22.7-.3-.3-1.4 .2-1.4 .7-5.7 .7-5.6-1.2-16.7-13.8 1-.1 5.2 1 3.8-1.1 1-.7 1.9-.4 .4-.4 1.5 .3 .4-.4 1 .2 18-12.8 6.7-23.5 0-1.8-.4-.5-.3-1.9 .4-2.4z", light: "M40.1 4.4l2-.1 4.7 1 .7 1-.5 1.4-2.8 1.5-6.6 23.1 .7 1.2 .6 .3-18.1 12.5-1.8 2.1-3.4 .7-5.2-1.2-.3-.4 .3-.9 1.4-1.4 18.3-12.9 .9-2.3 6.4-22.7 .8-1.4z", eyes: [[53.9, 53.4, 7.2, 18.8, -10], [65.1, 49.2, 7.2, 18.8, -10]] },
  moon: { label: "Moon", body: "M45.8 4.2l4.7-.2 4.2 .4 10.2 2.4 3.7 1.6 3.6 2.1 3.3 2.5 3 3.1 4.6 6.7 3.4 8.3 1.5 8.8 .1 4.6-.8 7.8-2.6 8.8-3.9 7.7-5.1 6.7-6.1 5.3-4.1 2.6-3.6 1.6-27.2 10.2-2.8 .7-2.6 0-5.7-1.3-2-.8-1.9-1.7-1.1-2.6-6.5-37.7-.2-5.2 .8-7.7 1.3-5.2 3.1-7.8 4.2-6.7 3-3.6 3.9-3.6 6.3-4.2 4.1-1.8z", paints: [["M57.6 9.9l.2-.3 .2 .3 2 4.7 1.9 1.9 2.6 .5 1.5-.7 1.1-1.1 .4 .4-.1 1.6-.7 1.5-2.2 2.5-1.6 .7-2 0-1.6-.8-1.3-1.4-.8-2-.4-2.6 .1-3.1z", "#1783FF", 1]], shade: "M74.3 13.5l2.1 1.5 .3-.4-.3-.6 2.1 2.1 4.6 6.7 3.1 7.4 1.5 7.6 .1 10.4-.6 4.6-2.5 8.3-4.2 8.2-3.1 4.2-5.7 5.7-6.2 4.2-4.6 2-28 10.3-4.1 0-5.2-1.1-2-.9-.5-.7 .5 .5 1.5 0 3.6 1 2.6-.3 5.7-2.1 2.1-2.1-5.4-31.5-.2-4.1 .4-1.1-.1-2.6 .5-3.6 1.8-7.7 2.8-6.7 1.9-3.1 3.9-5.2 3.2-3.1 2.5-2 5.2-2.9 3.1-1.1 3.1-.8 2.1 0 .5-.4 2.6 .2 1-.3 1.6 .4 1-.5 2.1 .8 1-.8 2.1 1.2z", light: "M38 6.3l1.7-.3 2.5 .2 .6 .4 1.5 0 .5 .5 1.6 .3-3.1 1.3 .4 .7-2.5 1.6-.5 1-2.5 2.1-2.7 2.9-6.2 7.9-1.5 2.7-1 .9-1.2 2.6-1.4 1-1.3 3.7-1.3 .3-6-1.4-1 3.6-.8 0 .9-3.6-.5-1 1.1-3.6 2.7-5.7 4.1-6.2 5.7-5.8 3.1-2.4 3.6-2.2z", eyes: [[51.6, 48.5, 8.4, 22.1, -10], [66.8, 42.9, 8.4, 22.1, -10]] },
  wave: { label: "Wave", body: "M46.1 4l6.1 .3 9.6 2.1 4.5 1.8 4.1 2.4 3.5 2.8 4.4 4.8 2.6 4 2.1 4.1 2.2 6 4.8 26 .5 5.3-.3 4.1-1.2 3.8-1.5 2.8-2.4 2.5-2.1 1.4-3.1 1-3 .3-8.1-1.5-3.2 5.3-2.1 2.1-2.5 1.5-2.8 1-3 .4-9.1-1.6-2.7 4.2-3.4 3.1-4 1.7-4.6 .1-7-1.5-3.5-1.9-3.4-3.5-2.1-4-1.5-5.6-3.7-20.7-.6-5.6-.1-5 .5-6.1 2.3-9.6 2.3-5.5 2.7-4.9 2.7-3.7 3.2-3.6 4.2-3.6 4.7-2.9 4.4-2 4-1.2z", paints: [["M61.6 48.5l2.2-.3 2 1.1 1.1 2.2 .3 3-.6 3.1-1.5 3.5-2.5 4.1-2.4 2.8-5-2.2-3-2.2-2.3-3-.7-3.5 .6-2.6 1.8-2.1 1.6-.7 1.5 0 1.5 .6 1.5 1.3 2-3.6z", "#fff", 0.4]], shade: "M69.3 13.6l2.6 1.3 .5-.3 .5-1.3 2 1.7 .5 0 2.5 2.7 3.5 5.5 3.6 8.6 1.5 6.6 3.5 19.7 .5 5.5-.4 4.6-2 5-1 1.6-2.6 2.5-3 1.5-2.1 .5-4 0-6.6-1.4-1.4 2.9-1.9 2.5-2.7 2.6-3.1 1.5-2.5 .6-4 .1-7.1-1.5-1.5 2.8-2.6 3-2 1.6-3 1.4-4.5 .6-7.1-1.5-3.6-1.5-3.5-3.1 6.6 1.5 2.8-.5 .5-.5-.3-.5 3.2-2-.4-1 1.4-1.5-.3-1 .7-1.6-.2-2.5-3.4-19.2 .3-.5-.6-5 .5-.5-.1-4.6 .4-.5 .3-4 1-4.1 1.5-4.5 3.8-7.7 5.5-6.9 3.1-2.6 6.5-3.9 7.6-2.2 3.1 0 .5-.4 3 .5 1-.5 2.5 1z", light: "M36.5 6.1l2-.3 .5 .6 4.1 .5 1 .7-3.3 1.5-.3 1.2-3 2-.3 .8-2.8 2.6-3.5 4-3.9 5-2 3.6-1 .5-1.7 4-1.5 .5-1.4 4.6-1.6 .2-.5-.4-5.6-.9-.4-.4 1.4-5.1 1.5-3.5 2.6-5.1 4-5.5 6.6-6.2 4-2.5z", eyes: [[47.5, 37.2, 8.4, 22.1, -10], [61.6, 31.9, 8.4, 22.1, -10]] },
  squircle: { label: "Squircle", body: "M54.5 4.2l3.9-.2 3.7 .3 11.6 2.7 3.1 1.6 2.8 1.9 2.6 2.7 2.2 3.1 2.4 4.8 1.9 5.8 3.7 19.4 .8 11.1-.4 4.7-1 4.7-1.3 3.5-1.8 3.4-4.8 5.8-6.4 4.7-8 4-14.2 5.3-9.5 2.2-7.4 .1-10.5-2.2-5.3-2.5-4.3-3.7-3.3-4.8-2.7-6.3-2.4-9.5-2.8-17.9-.2-7.8 1.3-7.9 2.2-5.3 2.8-4.2 4.1-4.2 4.3-3.1 6.3-3.4 11.6-4.6 7.9-2.7z", shade: "M80.5 11.6l2.1 2.1 2.1 3.2 3.2 7.3 2.1 8.4 2.7 15.8 .5 7.9-.6 7.4-2 6.3-3.8 6.3-4.2 4.3-2.6 2-6.9 3.8-15.2 6.2-9.5 2.7-6.8 .6-6.2-.7-8.5-2-5.8-3.2-3.2-3.3 .5 .4 1.1-.2 5.8 1.4 2.1-.8 1.4-.7-.3-.5 1.4-1.1-.1-1 .8-.5 0-1.1 1.1-1 .1-2.1 .4-.6-.2-3.6-2.4-17.9-.2-9.5 .8-5.3 1.1-3.6 1.2-2.7 2.2-3.5 2.7-2.8 3.1-2.5 5.8-3.2 17.9-6.9 5.3-1.4 8.4-1.4 1.6-1.1 .5 .1 .9-1.5z", light: "M39.4 8.4l1.2 0-1.6 .7-1-.1 1-.1zM36.8 9.5l1 0 .6 .9 4.2 .6 .7 .6-3.8-.4-.3 .4 1.9 .3 .1 .7-3.2 1.6-6.9 5.8-5.3 6-4.7 6.1-3.8 3.7-.2 .5-1.8 .1-6.8-1.7 .4-3.6 2.1-4.2 2.2-3.2 4.2-4.3 4.2-3 3.1-1.8 5.3-2.5zM35.1 10.5l1.7 0-.5 .4zM36.5 11.1l.3-.5 2.2 .1 .4 .4-.4 .3z", eyes: [[52.6, 52.4, 8.4, 22.1, -10], [67.3, 46.9, 8.4, 22.1, -10]] },
  zed: { label: "Bull", body: "M77 4.4l1.1-.4 1.1 .2 1.2 1.3 2 9.8 2.2 5.9 .4 2.8-.3 2.1-.8 1.7-4.7 5.1-1.3 1.9-.4 1.7 .1 1.6 1 1.7 4.4 .2 3.8 1.3 2 1.7 .6 1.6-.3 1.7-.7 1.1-3.5 2.7 1.7 6 .4 5.9-.8 6.6-1.9 6-3.4 5.9-4.4 5.3-5.5 4.4-6 3.1-6.5 2-7.1 .7-6.5-.7-6.5-2.1-6-3.4-4.8-4.4-3.5-4.9-3.1-6.7-3.3 1.1-2.7 .3-2-.6-1.1-1.1-.3-2.2 .9-2.7 2.9-3.8 4.6-3.8 1.8-7.1-6.3-1.8-1.6-1.3-1.3-1.8-.6-2.7 0-6.6-1.4-8.7 .2-1.1 1.5-1.4 1.1-.1 1 .5 5.5 7.9 2.2 2.2 2.7 1.4 4.9 .4 .5-.1 6.5-5.1 6.6-3.2 6-1.6 8.7-.7 3.8-.9 2.7-1.5 3.9-3.2 3-3.8 2.4-4.9 2.1-10z", paints: [["M61 36.5l1.9 .7 1.4 2-.7 5.4 .3 .4 2.8-1.2 1.1 0 1 .9 .5 1.6-.5 .8-1 .5-7.1 2.4-1.1-.5-.9-1.6 1.4-5.4-.5-.6-3.3 1.1-1.1-.1-1.6-1-1-1.6 .5-.9z", "#fff", 1]], shade: "M80.2 5.5l.6 1.6 1.3 8.2 2.5 6 .2 3.7-.1 1.1-1.2 2.2-5.2 5.4-1.1 3.3 .9 2.7 3.8 3.9 1.6 .1 4.4-1.4 1.2 1.2 .1 1.1-.2 1.7-.6 1.1-3.6 2.7 .9 2.2 1.1 5.4 .1 6-1.1 6.5-2.3 6-3.8 6-6 6-4.9 3.3-5.9 2.6-7.1 1.7-7.1 .1-6-1.1-5.9-2.3-4.4-2.7-4.4-4.5 3.8 .4 5.5-1.5 7.6-3.9 6.8-4.7 7.9-6.5 7.1-6.9 5.4-6.5 4.4-6.7 1.8-4.4 .4-3.2-.3-1.1-3.3-3.8-.8-2.8 .8-2.7 6.2-7 .8-2.2-.1-2.7-1.7-4.4-.8-8.2zM14.9 29.9l.1-.5 4 6.5 2.3 2.7-1.4 .1-2-.6-3.6-7.1zM24.3 44.6l1-.3 1.1 .2 3.3 2.9 1.7 .5 .3 1.6-.5 2.2-1 1.6-1.6 1.5-1.6 .7-1.7 .1-3.2-2.2-2.2 0-2.7-.6-2.9-1.6 3.9-1.6 2.2-1.7 2.2-2.3zM21 68.6l.5-.5 1.1 .1 1.1 .5 .8 1 .6 2.7-.1 1.1-.7 1.1-.6 .1-2.2-1.2-2.7 1.1-3.8 .6-2.7-1.2 3.4-1.6z", light: "M77 4.4l.6-.2 .1 .7-1.2 .8-.1-.8zM74.2 15.8l.6 1.1 .1 2.7-.6 2.2-1 1.6-5.5 5-1.7 .7-3.3 .3 .1-.6 2.1-1.2 4.2-3.6 2.7-3.9zM11.7 28.9l.8 0-.1 .5-1.2 .8-.1-.8zM44.3 32.1l3.1 0 .8 1.1 0 1.1-1.9 4.3-3 4.1-1.7-1.1-2.1-.8-4.4-.6-4.4 .1 5.5-4.4zM22 54.4l.6 0-.3 .6 .2 .5 2.3 2.7 .4 1.7-1 .9-4.8 2.3-7.1 7.8 0-1.8 2.1-3.3 6.4-5.4 1.2-4.3z", eyes: [[61.8, 69, 9.5, 22.3, -10.5], [78.4, 62.7, 6.9, 22.2, -11.2]] },
  hex: { label: "Blossom", body: "M38.8 4.2l2.6-.1 6 1.3 2 1.3 3 3.3 12-4.5 2-.5 6.5 1.1 2.9 1.6 4.9 6 .8 2 .3 2-.2 2.5-1.9 7-1.3 2.2-1.9 1.8 2.9 1.3 1.8 1.7 10.1 12.5 1.5 3 .1 4-1.8 7-.9 2-2.8 2.7-7.1 2.7-5.2 20-.8 2-1.4 1.9-1.5 1.1-6.5 2.6-3 .2-6.5-1.6-2-1.4-4-4.9-16 5.7-2 .1-4.5-1-3-1.2-5.2-6-1.3-3 0-3.5 2-8.5-10.8-13.4-1.4-3-.3-2 .3-2.5 1.7-6.5 1.8-3 2.2-1.8 5.9-2.2 2.1-.4 2.5 .3 .4-.4-.7-2.5 .1-2.5 4.8-18.5 1-2.5 2.9-2.9z", shade: "M49.7 7.7l.2-.4 .5 .4 2 2.3 0 .7 1.6 1.5 1 2 .1 1.5-.3 .5 .6 1.3 17.5-6.5 2.5-1.3 1-1.5 4.5 6 .6 1.5 .3 3-1.9 8-1 2-3 3-.3 1 .4 .5-1.7 3 .1 .5-.5 .5 0 .7 5.5-2.2 1.5-1.5 2 2 8 10 1 1.5 1 2.5-.1 4-1.9 7-1.1 1.9-2.9 2.5-6.8 2.5-4.7 19-1.5 3.5-2.5 2.5-6.5 2.6-4 0-5.5-1.4-2.2-1.7-3.2-4 4.9 .8 2.5-1.4 1.5-2.6 .7-2.3 1.7-6.5-.4-.3-.6 .8-.7 3.5-1.1 1.5 .3 .5-.3 .5-.7-.5-1.4-5.5-.5 1-.2 2-.9 1-.1 1.5-1.1 2-2.7 2.8-1 .4-1 .1-15.5 5.8-3-.1-4.5-1-2-1-2-2-2.2-3 .2-.2 4 .9 2-1.1 1.7-1.6 1.3-3.2 1.7-6.3 1.1-2.5-.3-.3-.5 .2-6.5-.3-.5-.5-2 0-.5-.5-1.7-.1-10.4-13.4 4.1 .7 3.1-1.7 1.3-2 2.5-8.5 .9-1.5 1.7-1.3 6.5-2.7 2-1.5-.3-.5 .3-.5 1.5-1.2 1.5-3 5.6-20.3 1.9-2 6-2.4 1.1-.6zM73.2 31.2l1.5 0-.8 1-34 12.7-1 .1-1.5-.5-2 .8-1.9-2.6 .4-.9 2 .5 1.5 1 .5-.4 1 .5 1-.3 1 .4 3-1.5 1 .1 3-1.6 1 .1 3-1.6 1 .1 3-1.6 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 2.5-.5 1.5-1 1 0zM61.3 74.6l.1-.2 .4 .2-.4 1.7z", light: "M33.4 6.2l3 .1 1.9 .9-.1 .5-1.8 2.5-3.4 3.5-4.5 17-3.6-.9-1 .4 0-1 4.4-16.5 0-1.5 2.1-3.1zM68.2 6.2l1.2 0zM14.9 37.7l3.5 .9 .4 .6-.3 1-5 5.5-1.1 4.6-2.5-.5-2 .1 0-1.7 1-4.5 1-2.5 2-2.1zM19.4 71.6l4 .7 1.8 .8-1.2 1-1.1 5.1-4.5-.5-.5-.6 1.4-5z", eyes: [[49.8, 55.5, 6.7, 17.7, -10], [61.6, 51.1, 6.7, 17.7, -10]] },
  gumdrop: { body: "M38.7 4.5l4.4-.5 4.6 .8 4.1 1.9 3.7 3.2 23.2 36.6 2.3 5 1.4 5.1 .7 6.4-.7 6.4-1.8 6.1-3.1 5.7-4.1 5.1-5.2 4.2-5.8 3.1-6 1.8-6.4 .6-6.4-.6-6-1.8-5.9-3.1-5.1-4.2-4.1-5.1-3-5.4-1.9-6.4-.7-6 .5-5.9 9-41.6 2-4.1 2.6-3.2 3.4-2.5z", shade: "M54.9 9.5l1.9 2.3 22.9 36.5 1.8 4.6 .9 3.7 .6 4.1-.1 5.9-1.4 6.4-2.3 5.5-3.7 5.4-4.1 4.2-4.5 3.3-7.3 3.2-6.4 1.2-6.4 0-5.1-.9-5.9-2.1-5.5-3.3-4.6-4.1 .5-.3 4.1 .8 5.5-1 6.4-2.6 7.3-4.5 7.2-5.7 6.5-6.4 5.5-6.9 3.5-5.9-18.1-37 1.1-3.7 .2-2.3z", light: "M37.1 4.9l2.5 0 .8 1.4-.5 2.1-1.8 2.9-3.2 3.2-3.2 2.1-2.3 .7-1.8-.1-.7-.9 .1-1.8 2.4-4.1 2.7-2.8z", eyes: [[52.1, 40.3, 9.7, 22.9, -15.2], [64.8, 35.6, 6.3, 23, -27]] },
  peanut: { body: "M43.5 4l6.6 .7 5.8 2.2 5.4 3.8 4.1 4.7 2 3.8 1.4 4.3 1.3 11.9 1 4.3 1.6 3.8 5.8 10.5 1.4 3.8 .8 4.3 .1 6.2-1 5.7-2.1 5.5-3.2 4.9-4.1 4.3-4.8 3.4-5.6 2.4-5.7 1.3-6.1 .1-5.8-1.1-5.7-2.2-4.7-3.1-4.3-4.1-3.3-4.8-2.5-5.7-1.2-5.7-.1-6.7 1.7-9 .4-4.3-.5-4.7-2.5-9.6-.6-3.8 .2-5.2 1.2-5.2 1.5-3.4 2.2-3.3 2.5-2.9 2.8-2.3 3.4-2.1 3.4-1.4 3.8-.9z", shade: "M62.7 12.6l2.6 2.8 2.8 5.8 1.1 4.2 1 11.9 1 3.4 2.3 4.7 4.2 6.7 1.9 4.7 .9 3.8 .2 2.9-.1 6.2-.5 3.3-1.9 5.3-3.4 5.7-3.4 3.8-4.2 3.3-5.7 2.9-4.8 1.4-5.7 .6-6.2-.6-3.8-1-5.2-2.3-4.8-3.4-2.9-2.8 3.9 .8 5.2-.7 6.2-2.5 5.7-3.3 6.7-5.1 6.2-5.9 5.1-6.2 3.5-5.7-1.1-2.8-2.4-2.4-3.2-1.7-11.5-4.1-2.7-1.8-1.6-2.4-.2-2.4 .8-2.9 7.8-8 4.9-7.7 1.6-5.2z", light: "M35.9 5.4l3.2-.2 1.3 .7 .5 1-.5 3.3-2.9 4.8-4.1 4.1-4.8 3.3-4.2 1.5-1.5 0-1.4-.6-.7-1.2 .2-2.4 1.9-3.8 2.4-3.3 4.3-3.9z", eyes: [[50.9, 31.5, 8.7, 20.5, -11.9], [64.2, 26.5, 5.7, 20.3, -16.3]] },
  saucer: { body: "M45 22.7l6.7 .1 6.7 1.9 4.3 2.5 3.5 3.1 2.8 3.5 2.5 4.5 6.8 .9 5.6 1.2 4.5 1.6 3.5 2.1 2.8 2.8 1.3 3.5-.5 3.5-2 3.5-2.6 2.8-3.5 2.8-4.5 2.8-5.1 2.6-12 4.4-13.6 3.1-13.6 1.5-12.6-.3-5.5-.7-5-1.2-4.1-1.6-3.5-2-2.8-3.1-1.1-3 .5-3.5 2-3.6 2.7-3 3.7-2.9 10.3-5.6 .7-5.1 1.5-4.5 2.6-4.5 3.1-3.5 3-2.4 3.5-2 3.5-1.4z", shade: "M66.5 31.3l.3-.2 .6 .7 1.9 2.5 2 4.5 1.6 1.5 .1 1.5-1.7 1.7-3 1.2-3.1 .5-3.1-.3 4-8.1 .7-3.5zM94.9 47.4l1.1 3-.5 3.5-2.1 3.5-4 4.1-5 3.5-6.1 3.1-7 2.9-6.6 2.1-8 2-9.1 1.5-6.5 .6-11.6 0-4.5-.2-8-1.4-4.6-1.5-3.6-2.1 4.1 1.2 5.1 .8 7 .3 6-.2 15.1-1.9 15.6-3.6 14.5-5.1 5.4-2.5 5.3-3.1 4-3 2.3-2.5 1.2-2.1zM7.3 71l.7 .5z", light: "M40.6 23.7l2.8 0 .8 .5 .7 1.5-.8 3.6-2.6 4-3.9 4-4.5 3.2-4.6 1.7-2.5-.4-1-1.4 0-1.6 .9-2.5 2.1-3.5 2.6-3 3-2.6 3.5-2.1zM22.4 47.4l.7 0-.5 .5 0 1.5 .4 .8 2 1.4 3 1.2 9.1 2 15.1 1.1-.2 1.5-2.2 3.6-3 2.5-4.9 2.5-6 2-7.9 1.5-6.5 .5-7.1-.4-4.9-1.1-3-1.5-1.6-1.7-.6-2.3 1.1-3.1 2.9-3.5 4.1-3.5 4.1-2.6z", eyes: [[53.6, 45, 7.8, 18.4, -14.5], [66.2, 40.3, 5, 18.3, -25.1]] },
  bunny: { body: "M49.3 4.4l1.5-.4 2 1.2 1.6 2.7 1.2 3.4 1.6 8.9 .2 6-.2 6.4 .6 3 2.4 2.5 5.4 3 3.4 2.4 5.1 5.5 2.4 3.9 1.7 4 1.1 4.4 .4 4.5-.5 5.9-1.6 5.5-2.8 5.4-3.6 4.5-4.6 3.8-4.9 2.7-5.5 1.7-5.9 .7-6-.5-5.4-1.7-4.9-2.5-4.7-3.7-3.8-4.5-2.7-4.9-1.8-5.5-.7-5.9 .6-6.5 1.9-5.9 3.1-5.4 4.6-5.5-.4-2-3.4-8.4-1.8-6.9-.6-6.9 .3-3 .6-2 1.3-1.4 2-.1 2.5 1.5 2.1 2.5 4 6.9 2.1 5.5 1.7 5.9 1.5 2.1 1.8-1.6 .7-2-.4-12.4 1-8.9 1.6-4.9z", shade: "M52.7 5.4l2.1 3.5 1.9 7.4 .7 7.9-.5 8.4 .8 3.6-4.4-2.5-2.1-2.6 1.4-17.3zM31.2 15.3l.3-.5 2 2.5 2.9 4.9 2.5 6 1.7 6.4 1.4 2.5 0 .5-1.1 .9-4.5 1.9-2.4 .2-1.2-.6zM71.5 46l3.6 4.4 2.9 6 1.5 6.4 .1 5.5-1.1 6.3-2 5-3.4 5.4-3.5 3.6-4 2.9-6.4 3-4 1-6.9 .5-5.9-1-5.5-2-5.4-3.5-3.6-3.4 2.6 .7 2.5 .1 2.9-.5 4-1.3 8.4-4.6 8.7-6.8 7.4-7.9 5.3-7.9 1.3-3 1-3.5 .2-2.9-.2-2z", light: "M49.3 4.4l.6 0-3.6 6.2 1-3.7zM26 13.3l.5-.4 .2 .4-1.7 2.2 0-.7zM44.8 34.6l.5-.1 1.2 1.1 .8 1 0 .7-.5 .3-4-.5zM45.1 42.5l.8 0-.3 1-2.4 4.5-3.8 4.4-4.1 3.5-3.8 2.4-4 1.6-2.9 .1-1.8-1.1-.4-2.5 1.1-3.5 3.5-5.4 3-3.1 .2 1.6 .8 .8 3 .1 4.4-1.2z", eyes: [[59.2, 69.2, 8.2, 19.3, -12], [72.9, 64, 5.6, 19.1, -15.4]] },
  kitty: { body: "M62.4 4.2l1.6-.1 1.5 1.2 7.4 21.3 3.7 6.4 6.2 7.4 3.1 5.9 1.5 4.8 .7 5.3-.2 5.4-1.1 5.3-3 7.4-4.4 6.4-5.3 5.4-6.9 4.6-7.5 3.1-8 1.7-8 .2-7.4-1.4-4.3-1.5-3.7-1.8-3.8-2.5-3.1-2.7-2.7-3-2.5-3.7-1.9-3.7-1.4-4.3-.9-5.3 .1-5.8 1.4-7 1.6-4.2 2-3.8 .8-3.2 .2-20.2 1.1-1.4 1.1-.3 1.1 .3 12.2 9.7 5.9-2.5 8-2.1 3.2-1.8 2.3-2.4 8.3-16z", shade: "M64.9 5.8l.1-.3 .7 .3 6.5 19.7 3.1 5.9 2.5 3.2-1.6-.8-2.6-2.4-5.1-8zM79.4 36.7l2.2 2.1 1.6 2.2 3.3 6.9 1.5 6.9-.1 6.4-1.6 7.5-3.1 6.9-3.8 5.3-5.3 5.4-6.4 4.3-7 3.1-6.3 1.6-4.3 .6-5.3 0-7.5-1.1-5.8-2-5.9-3.3-5.9-5.4 2.7 .7 3.2-.1 3.7-.8 5.2-1.9 10.3-5.5 11-7.8 10.7-9.6 7.8-9.1 3-4.6 1.6-3.4 .7-3.2z", light: "M62.4 4.2l.5-.1 0 .6-.8 1.1-4.5 14.4 .2 2.7-.3 1.6-1.1 1-2 .6-6.9-.5 2.6-1.3 3.1-3 8.1-16zM18.7 20.7l1.1-.5 0 .8-1.1 .9-.6-.1zM39.5 27.7l2.6-.3 1.9 .8 .4 1.6-.7 1.8-4.2-1.5-5.4 .2 0-.5zM16 47.4l.3 4.2 1.6 2.2 3 2.1-.6 .5-3.7 .6-1.1-.3-1.1-1.1-.4-1.8 .4-2.7z", eyes: [[59.6, 65.1, 9.4, 22.6, -11.9], [77.5, 58.4, 7, 22.5, -14]] },
  beacon: { body: "M40 4.1l2.7 0 2.5 .9 2 1.7 1.1 2.1 .5 2-.2 2.1-2.1 4.1-.4 1.6 1.5 7.7 9-3.1 4.1-.2 18.5 4 3.1 1.6 2.4 2.3 1.3 2.1 .9 2.6 5.8 33.4-.4 3.1-1.3 3.1-2 2.5-2.6 1.9-41.7 15.7-4.1 .7-19.6-4-3.5-1.9-2.5-2.5-1.2-2.1-.8-2.6-5.7-32.9 .4-3.1 1-2.7 1.7-2.5 2.4-1.9 28.4-10.9-1.5-9.3-.7-1-3.5-3.3-.9-1.9-.4-2 .5-2.6 1.1-2.1 1.7-1.5z", shade: "M47.1 7.2l.4 0 .8 1.6 .3 2-.2 2.6-2.5 4.7 1.5 8.2 0 2 .5 .6 .1 1.5 .5 1-1.2 .4-1.3-.4-.3-.5-1.9-10.3-4.1-1.5-3.2-2.6 3.1-.9 3.2-2.2 2.5-2.6zM84.2 30.9l1.2 1.1 1.5 3.6 5.7 32.4 0 2.6-1 3.6-1 1.5-3.1 3.2-4.2 1.9-40.6 15-4.2 0-16.4-3.6-3.6-1.4-2.6-2.2 .5 .4 17.5 3.4 3.8-1.2 5-3.4 1-1.3-5.4-30.3 .2-.6 3.1-3.4 40.2-15.1 2-3.6z", light: "M38.5 4.7l2 0-.1 1-.8 1.4-2.6 2.2-1 .4-1.1-.1-.1-.8 .7-1.6 1.5-1.6zM55 23.7l1.1 .1-1.6 .6-.9-.2 .9 0zM52.4 24.7l1 0-3 1.2-.9-.1 2.4-.6zM48.3 26.3l1 0-1.5 .6zM40 29.4l1.1 0-3.1 1.2-.9-.2 2.5-.5zM35.9 30.9l1 0-3 1.2-.9-.1 2.5-.6zM31.8 32.5l1 0-3 1.2-.9-.2 2.4-.5zM40.2 33l.4-.4 1-.1 1.6 .8 3 .7-1.5 .5-4.1 0-.9-1zM27.7 34l1 0-3 1.2-1-.2 2.5-.5zM23.6 35.6l1 0-3 1.1-1-.1 2.5-.5zM19.4 37.1l1 0-2.4 .8-.5 .7 15.4 3.3 .5 .3 .3 1.1-1.1 2.6-3.3 3.3-3.1 1.5-17.5-3.6-.6-1.2 .5-1.6 3.2-3.7 2.1-1.4 2.5-1.1 1 0 .6-.5 1 0z", eyes: [[55.5, 65.3, 8.4, 22.1, -10], [74.2, 58.3, 8.4, 22.1, -10]] },
  plus: { body: "M44.6 4.3l3.3-.1 11.9 2.5 2.5 1.3 1.3 1.4 .7 1.6 2.1 11.4 4.1-1.2 2.1 0 12.3 2.6 2.8 1.6 1.2 1.5 .7 1.5 3.8 21.6-.5 3.1-1 1.5-1.3 1.3-17 6.6 3.4 20.4-.4 2.5-1.2 2.1-2.3 1.6-19 6.9-2-.2-11.9-2.5-2.5-1.3-1.3-1.4-.7-1.6-2.1-11.4-4.1 1.2-2.1 0-12.3-2.6-2.8-1.6-1.2-1.5-.7-1.5-3.8-21.6 .5-3.1 1-1.5 1.3-1.3 17-6.6-3.4-20.4 .2-2 1.1-2.2 2.6-2z", shade: "M63.2 9.4l.7 .6 .5 1.5 2.1 13.3 .6 .6 0 2.5 .5 .5 .1 2.6 .5 .5 .1 2.1-.8 3.1 19-7.1 1-1.2 1-2.1 1.1 2.1 .4 2.6 3.2 18 0 3.1-1 2-2.2 2.1-15.9 5.8-.8 .8 3.6 19.5-.1 2.6-1.5 2.6-2.2 1.6-16.4 6.1-2.1 .6-2.5 0-12.4-2.7-2.2-1.5 12.5 2.5 2.4-1 2.7-2-3.9-22.1-3.8 3.5-1 .4-2.6 .5-1.5 1-2.6 .5-1.5 1-2.6 .4-1.5 1-4.6 1.5-2.5 0-11.9-2.6-2.7-1.6 12.4 2.3 2.6-.9 2.4-1.9-3.4-20.5 .3-.5 1.7-1.8 18.6-6.9 .3-.6-.7-1-3.8-22.1 2.1-2.1 16.4-6.1 .6-.5z", light: "M28.4 10.5l1.1 .5 10.2 2.1 .5 .4-.1 1.1-1.9 2.3-2.1 1-12.3-2.5-.1-1.3 1-1.6 1.2-1zM11.4 43.3l11.4 2.2 1 .6 0 .8-1.5 2.3-2.6 1.4-12.3-2.6-.2-1.1 .6-1 2.2-2.1z", eyes: [[54.5, 53.1, 6.1, 15.9, -10], [64.5, 49.4, 6.1, 15.9, -10]] },
  magnet: { body: "M71.9 4.2l1.2-.2 12.1 2.6 .5 .3 .6 1 6.2 35.6 .6 5.8-.1 5.7-.7 5.8-1.5 5.7-2.2 5.8-4.2 7.3-5.5 6.5-6.5 5-7.1 3.4-6.3 1.3-6.3 0-15.2-3.1-5.2-1.8-5.2-3-4.6-4.1-4-5.2-2.9-5.8-2.4-7.8-6.4-36.2 25-9.5 13.1 2.9 .5 .9 6.3 35.3 1.8-3.9 .5-4.7-6.3-36.1 .4-.6z", shade: "M86.2 9.5l.5 1 5.8 33 .6 4.7 0 5.2-.6 5.8-2.1 8.4-3.1 7.3-3.7 5.8-6.3 6.8-5.7 4.1-5.8 2.7-6.8 1.5-6.3 0-15.2-3.1-5.7-2-5.2-3.2-5.9-5.8 .1-.7 11.5 2.5 .3-3.4-1.9-13.6-5.7-32.4 1-.1 18.3-6.9 .9-.9 .4-1 6.1 35 1.6 2.1 .1 .6 4 4.7 3.2 1.1 3.6-.6 3.2-1.9 2.4-2.8 1.9-4.2 .6-3.7-6.4-36.6 19.3-7.1 .8-.8z", light: "M53.6 54.5l.7-.4 12 2.8 .6 1.8-.6 2.1-2.1 2.4-2.6 1-1.5 0-6.3-1.4-1.6-2.6-.2-2.1z", eyes: [[59.6, 82.1, 6.1, 15.9, -10], [72, 77.5, 6.1, 15.9, -10]] },
  acorn: { body: "M47.6 4l2.1 .6 1.3 1.5 .4 1.5-.4 5.2 .3 .3 8.8-.1 7.7 1 7.3 2.1 5.7 2.9 3.6 2.9 2.6 3 1.8 3.4 .9 3.7 0 4.1-1 3.6-1.7 2.2-3.9 3 2.9 8.3 .9 8.3-.9 8.3-2.7 7.7-4.2 6.8-2.9 3.1-3.2 2.6-6.7 3.8-3.7 1.2-4.1 .8-7.2 0-7.3-1.7-7-3.6-5.9-5.1-4.8-6.3-3.3-7.3-1.8-7.7-.1-8.3-4.5-1.5-2.6-1.7-2.6-4.1-1.1-4.1 0-4.2 1.2-4.1 2.2-4.1 2.8-3.7 5.2-4.6 6.3-3.8 7.2-3.2 8.3-2.3 .9-8.3 1.2-1.4z", shade: "M50.6 6.1l.1-.5 .6 2-.6 5.7 .2 2.1-1.2 .2-1.2-.7 .5-6.8zM85.8 23.7l1.7 2 1.6 3.7 .6 2.6-.1 4.1-.5 2.6-1.1 2.1-2.1 2-2.9 2.1 1.4 3.1 1.6 5.2 .9 8.8-.5 5.7-1.4 5.7-2.2 5.1-2.6 4.2-5.1 5.7-5.2 3.6-4.7 2.2-6.2 1.5-7.7 .1-5.7-1.2-6.8-3-4.6-3.2-4.2-4.2 2.1 1 2.1 .3 3.1-.3 3.1-.9 6.4-3.1 6.5-4.6 6.6-5.8 5.9-6.4 5.6-7.9 4-7.4-2.4 .4-.5 .5-1.1 0-.5 .5-1 0-.5 .5-1.1 0-.5 .5-1 0-.5 .6-1.6-.1-.5 .5-1.6 0-.5 .5-3.6 .5-.5 .5-2.1-.1-.5 .6-2.1-.1-.5 .7-3.1-.2-.5 .5-3.1 0-.5 .7-4.7-.2-.5 .7-15.6-.3 0-.3 8.3-.6 11.4-2.4 11.4-3.8 10.5-4.8 9.2-5.7 6-5.2 2.2-2.6 1.6-2.9 .5-1.7z", light: "M46 4.5l1.1-.1 0 .6-1.5 1.6-1.1 .2-.1-.7zM38.5 15.9l5 0 3.3 1.6 1.6 3.1 .1 3.1-.9 3.1-1.9 3.1-3.2 3.6-4 3.1-3.6 2.1-8.5 3.2-4.1 .7-4.2 .1-3.1-.5-2.6-1.5-1.1-2 .1-2.1 .5-1.5 2.1-3.7 4.1-4.6 3.7-3.1 5.1-3.2 6.3-3z", eyes: [[63.6, 63.3, 9.6, 22.7, -11.9], [79.5, 57.3, 6.5, 22.5, -15.5]] },
  pebbles: { body: "M47.3 4.5l2.7-.4 2.7 .1 13.7 3 4.3 2.1 3.3 3.4 1.3 2.2 1 2.8 2 12-.5 4.3-3.1 7.7 .2 .5 8.4 1.9 2.7 1 3.3 2.1 2.7 2.8 2.4 4.3 1.4 6.5 .1 4.4-.8 3.8-1.3 2.7-2 2.8-2.4 2.2-2.7 1.6-45.5 17-3.3 .6-3.2-.2-19.2-4.2-4.9-2.8-3.4-3.8-1.9-4.4-1.3-7.7 .2-3.2 .8-2.8 1.3-2.7 2-2.7 3.2-2.8 7.9-3.8 2.5-2.2-.4-1.6-5.4-6.1-1.8-3.8-2.3-12.5 .2-3.3 .7-2.7 2.6-4.4 2.2-2 2.2-1.4z", shade: "M73.2 12.2l.4 0 1.5 2.2 1.2 3.3 1.8 11.4-.2 4.4-3.3 7.6 0 1.1 .6 1.1-1.2 1.3-26.8 10.1-3.2 .5-5.8-.4-15.2-3.3-1.4-.5-3.5-3.8 .2-.3 1.6 .2 10.9 2.2 2.8-.5 4.4-2.2 5-3.8 .1-.6-1.5-8.7 4-4.5 24.2-9.2 2.4-3.8zM90.9 48.8l2.8 3.8 1 2.8 1.2 6 0 4.3-1.1 3.9-1.7 3.2-3.8 3.9-2.7 1.7-42.1 15.8-5.5 1.6-3.8 0-18-3.8-4.9-2.1-3.4-2.9 17.6 3.8 2.7-.2 3.3-1.2 4.3-2.6 4.4-3.6-.4-3.8 4.4-4.9 42.5-16 2.1-3.1 1.1-2.8 .5-3.3z", light: "M45.6 5.1l1.5 0-.4 .2-22.9 8.5 11.4 2.5 .6 .8 0 1.6-1.5 2.8-1.9 2.2-2.8 2.1-3.1 1.2-13.2-2.8-.1-2.2 1.2-2.2 1.7-2.2 2.7-2.2 2.2-1.1 2.2-.5 .5-.5 2.8-.6 1.6-1.1 2.7-.5 1.7-1.1 2.7-.6 1.6-1 2.8-.6 1.6-1.1 2.8-.5zM21.6 53.2l15.8 3.6 1.2 .7-.1 .9-.8 .8-3.1 1.6-1.3 3.8-3 3.8-3.3 2.5-3.3 1.4-18-3.6-.6-1.3 .6-2.2 1.6-2.7 1.7-1.8 3.8-2.8 5.5-2.2z", eyes: [[51.2, 34.1, 6.9, 18.1, -10], [66.4, 28.4, 6.9, 18.1, -10]] },
  cushion: { body: "M64.2 4.4l3.3-.4 2.8 .2 3.9 .8 2.8 1.1 2.7 1.7 2.4 2.1 1.9 2.4 1.5 2.8 1.2 3.9 7.1 40.6-.1 5-1.4 4.5-1.6 2.9-1.9 2.2-2.2 1.9-2.8 1.7-45.6 17.1-3.4 .9-3.4 .2-4.5-.7-3.4-1.2-3.3-2-2.9-2.7-2.3-3.4-1.5-3.9-7.3-41.7 .1-5 1.4-4.5 1.6-2.9 1.9-2.2 2.2-1.9 2.8-1.7z", shade: "M82.1 10l2.9 4 1.6 4.5 7.3 42.2-.5 5.1-1.1 3.3-1.7 2.9-4.6 4.5-3.3 1.7-46.8 17.4-5.6 .2-4-.7-3.3-1.2-3.4-2.2-1.7-1.8 .6 .4 3.3 .2 4.5-1.2 5.1-2.8 5.3-4.4-6.9-39.4 5-5.7 43.9-16.4 2.3-3.6 1.1-2.8 .5-3.6z", light: "M62.3 4.9l1.8 .1-43.4 16.1 1.1 .4 .8 .9 .1 1.7-1.6 3.4-2.6 3-3.4 2.7-3.4 1.5-3.4-.2-.8-.8-.2-1.2 .4-1.6 1.7-2.9 3.4-3.5 2.3-1.6 3.4-1.6 5.6-1.8 .6-.5 1.1 0 .5-.6 2.3-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.6 2.2-.5 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.6 1.1 0 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1-.1 .6-.5 2.2-.6 .6-.5 1.1 0 .6-.6 2.2-.6 .6-.5 1.1 0z", eyes: [[51.1, 57.2, 8.4, 22.1, -10], [69.9, 50.1, 8.4, 22.1, -10]] },
  ring: { body: "M48.1 4.3l8-.1 7.8 1.8 7.3 3.5 6.7 5.4 5.2 6.7 4.1 8.3 2.3 8.9 .7 9-1 9.5-2.5 8.9-4.1 8.3-5.3 7.3-6.6 6.1-7.3 4.5-7.8 2.7-8.4 .9-7.2-.8-7.3-2.5-6.7-4.1-5.6-5.3-4.5-6.5-3.5-7.8-2-8.4-.6-8.4 .9-8.9 2.2-8.4 3.5-7.8 4.9-7.2 5.8-6.1 6.3-4.5 7.1-3.3zM50.5 33.8l2.3-.3 1.7 .4 1.6 1.1 2 2.2 1.3 2.8 .8 2.7 .4 3.4-.1 3.3-1.4 6.2-3 5.6-2.2 2.4-2.2 1.6-2.3 1-2.2 .3-1.7-.4-1.6-1.1-2.8-3.7-1.5-5.2-.1-5.5 1.2-5.6 2.4-5 3.6-4z", shade: "M76.2 14.9l1.1-.5 3.4 3.8 2.8 3.9 2.3 4.5 1.6 3.9 1.6 5.6 1.1 8.3-.4 10.1-1.3 6.1-2.6 7.8-4.6 8.3-4.4 5.6-6.2 5.7-6.1 3.8-7.2 2.9-6.2 1.1-7.8-.1-7.2-1.7-3.9-1.6-4-2.2-5.5-4.5-2.8-3.4 1.7-.6 2.4-2.1 2-2.8 1.2-2.8 1.2-5 1.1-13.4 1.4-7.8 2.5-7.8 3.8-7.3 3.3-4.5 3.4-3.4 3.9-3.1 4.4-2.6 3.9-1.5 4.5-1.1 12.3-.9zM50.5 33.8l.6-.3 2.8 0 1.6 .9 2.7 2.8 3 1.4 3.3 .5 6.1 .2 3.9 .9 1.7 1 1.7 1.6 2.1 4.4 .7 4.5-.3 5-1.2 5-1.9 4.5-2.8 4.2-3.3 3.6-3.9 2.8-3.9 1.7-3.4 .6-3.3-.1-3.4-1.1-2.5-1.7-2.5-3-3.6-7-2.9-3.4-2.1-5-.6-5.6 .6-4.4 1-3.4 2.3-4.4 1.4-2.1 2.3-2.2 2.7-1.7z", light: "M41.1 5.9l.5 .1 .2 .5-.3 .6-12.4 13.3-13.1 18.1-2.3 2.1-1.1 0-.2-1.2 .2-2.8 1.6-5 4.6-8.3 3.9-5.1 4.4-4.4 4.5-3.4 5-2.8zM60.5 53.3l1.2-.3 1.1 .6 1.1 1.3 .8 1.8-.2 3.3-1.5 2.8-2 1.7-2.6 1-7.3 .2 2.2-1.4 2.6-2.6z", eyes: [[56.2, 84.6, 5.3, 13.3, -6.8], [71.7, 78.8, 5.1, 13.4, -6.5]] },
  gem: { body: "M57 9.3l2.9-.4 14.9 3.5 19.6 14.1 1 1.4 .6 1.6-.5 2.6-27.1 56.5-1.6 1.8-2.1 .7-15.9-3.4-42.9-30.7-1.3-1.6-.6-1.6 .5-2.6 12-25.2 1.1-1.5 1.5-1z", shade: "M75.7 14.6l.1-.4 .6 .2 16.9 12.3 1.1 .7 .5-.2 .5 .7 .6 2.6-.5 1.6-26.4 55.1-1.2 2.1-1.1 1.1-1.6 .6-2.1 0-14.3-3.3-42.8-30.7 1.5-.2 11.6 2.5 2.2-.7 2.8-2.6 11.9-24.9 .6-.8 38.2-14.2z", light: "M19.1 23.6l1.1-.4 .5 .5 11.7 2.2 1 .9-.2 .5-1.8 2.7-11.7 24.4-1.6 .6-13.3-2.8-.5-.5 12.1-25.4 1.2-1.7z", eyes: [[51.4, 42.9, 6.7, 17.7, -10], [66.1, 37.4, 6.7, 17.7, -10]] }
};
var PICKER_SHAPES = Object.keys(CHARACTERS);
var PICKER_COLUMNS = 6;
var DEFAULT_SHAPES = ["star", "moon", "gumdrop", "peanut", "bunny", "kitty", "acorn"];
var FALLBACK_SHAPE = "gumdrop";
var MAIN_LOOK = Object.freeze({ shape: "octopus", color: "deepseek" });
var CHARACTER_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray", "aurora"];
var DEFAULT_COLORS = CHARACTER_COLORS.filter((color) => !["black", "gray", "brown"].includes(color) && !GRADIENTS[color]);
var isColor = (color) => isHex(color) || Object.hasOwn(INKS, color);
function fnv1a(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function defaultColor(id) {
  const t = fnv1a(id) + 1831565813 | 0;
  let n = Math.imul(t ^ t >>> 15, 1 | t);
  n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
  return DEFAULT_COLORS[Math.floor(((n ^ n >>> 14) >>> 0) / 4294967296 * DEFAULT_COLORS.length)];
}
function defaultShape(id) {
  let value = fnv1a(id) | 0;
  value = Math.imul(value ^ value >>> 16, 73244475);
  value = Math.imul(value ^ value >>> 13, 3266489909);
  return DEFAULT_SHAPES[((value ^ value >>> 16) >>> 0) % DEFAULT_SHAPES.length];
}
var colorOf = (bot) => isColor(bot?.color) ? bot.color : bot?.id ? defaultColor(String(bot.id)) : "black";
function lookOf(bot) {
  const avatar = bot?.avatar ?? {};
  return {
    shape: hasShape(avatar.shape) ? avatar.shape : bot?.id ? defaultShape(String(bot.id)) : FALLBACK_SHAPE,
    image: avatar.image,
    color: colorOf(bot)
  };
}
var SHAPES = {};
for (const [id, character] of Object.entries(CHARACTERS)) {
  const layers = [
    ...(character.paints ?? []).map(([d, fill, opacity]) => `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`),
    `<path d="${character.shade}" fill="#000" fill-opacity=".14"/>`,
    `<path d="${character.light}" fill="#fff" fill-opacity=".16"/>`
  ].join("");
  SHAPES[id] = { label: character.label ?? id[0].toUpperCase() + id.slice(1), size: 100, path: character.body, layers, eyes: character.eyes };
}
var hasShape = (id) => typeof id === "string" && Object.hasOwn(SHAPES, id);
var shapeId = (id) => hasShape(id) ? id : FALLBACK_SHAPE;
var shapeOf = (id) => SHAPES[shapeId(id)];
function bodyOf(def, paint, flat = false) {
  if (def.path) return `<g fill-rule="evenodd"><path d="${def.path}" fill="${paint}"/>${flat ? "" : def.layers}</g>`;
  try {
    return def.body(paint);
  } catch {
    return "";
  }
}
var PUPIL = "#0a0f1f";
var pupilMarkup = ([cx, cy, w, h8, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><g class="bt-eye"><rect x="${-w / 2}" y="${-h8 / 2}" width="${w}" height="${h8}" rx="${w / 2}" fill="${PUPIL}"/><circle cx="${w * 0.12}" cy="${-h8 * 0.24}" r="${w * 0.3}" fill="#fff"/><circle cx="${-w * 0.16}" cy="${h8 * 0.22}" r="${w * 0.12}" fill="#fff" fill-opacity=".7"/></g></g>`;
var blushMarkup = ([cx, cy, w, h8, tilt]) => `<ellipse cx="${cx}" cy="${cy + h8 * 0.56}" rx="${w * 0.78}" ry="${w * 0.4}" transform="rotate(${tilt} ${cx} ${cy})" fill="#ff5fb8" fill-opacity=".42"/>`;
var eyeMarkup = ([cx, cy, w, h8, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><rect class="bt-eye" x="${-w / 2}" y="${-h8 / 2}" width="${w}" height="${h8}" rx="${w / 2}"/></g>`;
var happyEyeMarkup = ([cx, cy, w, h8, tilt]) => `<g transform="translate(${cx} ${cy}) rotate(${tilt})"><path class="bt-eye-happy" opacity="0" d="M${-w * 0.62} ${h8 * 0.14}Q0 ${-h8 * 0.42} ${w * 0.62} ${h8 * 0.14}" fill="none" stroke="#000" stroke-width="${w * 0.5}" stroke-linecap="round"/></g>`;
var maskBox = (size) => `maskUnits="userSpaceOnUse" x="${-size}" y="${-size}" width="${size * 3}" height="${size * 3}"`;
var holes = (def, eyes) => `<rect x="${-def.size}" y="${-def.size}" width="${def.size * 3}" height="${def.size * 3}" fill="#fff"/>${eyes}`;
var MASK_ID = "%MASK%";
var markSerial = 0;
var nextMarkSerial = () => markSerial += 1;
var markupCache = /* @__PURE__ */ new Map();
function characterMarkup(shape, color) {
  const key = `${shape}|${color}`;
  let markup = markupCache.get(key);
  if (markup === void 0) {
    const def = shapeOf(shape);
    const eyes = `<g class="bt-gaze"><g class="bt-eyes" fill="#000">${def.eyes.map(eyeMarkup).join("")}${def.eyes.map(happyEyeMarkup).join("")}</g></g>`;
    const ink = inkFill(color);
    const stops = GRADIENTS[color] ?? [[0, `color-mix(in srgb, ${ink} 58%, #fff)`], [0.5, ink], [1, `color-mix(in srgb, ${ink} 72%, #000)`]];
    const box = def.size;
    const gradient = `<linearGradient id="${MASK_ID}g" gradientUnits="userSpaceOnUse" x1="${box * 0.18}" y1="${box * 0.08}" x2="${box * 0.8}" y2="${box * 0.95}">${stops.map(([offset, value]) => `<stop offset="${offset}" style="stop-color:${value}"/>`).join("")}</linearGradient>`;
    const face = `<g class="bt-gaze"><g class="bt-eyes">${def.eyes.map(pupilMarkup).join("")}${def.eyes.map(happyEyeMarkup).join("").replaceAll('stroke="#000"', `stroke="${PUPIL}"`)}</g></g>`;
    const body = `<g mask="url(#${MASK_ID})">${bodyOf(def, `url(#${MASK_ID}g)`)}</g>${def.eyes.map(blushMarkup).join("")}${face}`;
    markup = `<defs>${gradient}<mask id="${MASK_ID}" ${maskBox(def.size)}>${holes(def, eyes)}</mask></defs><g class="bt-b">${def.wrap ? `<g transform="${def.wrap}">${body}</g>` : body}</g>`;
    markupCache.set(key, markup);
  }
  return markup;
}
var svgUrl = (inner, size) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${inner}</svg>`)}")`;
var maskCache = /* @__PURE__ */ new Map();
function maskOf(shape) {
  let mask = maskCache.get(shape);
  if (mask === void 0) {
    const def = shapeOf(shape);
    const body = `<g mask="url(#e)">${bodyOf(def, "#000", true)}</g>`;
    mask = svgUrl(`<mask id="e" ${maskBox(def.size)}>${holes(def, def.eyes.map(eyeMarkup).join("").replaceAll('class="bt-eye"', 'fill="#000"'))}</mask>${def.wrap ? `<g transform="${def.wrap}">${body}</g>` : body}`, def.size);
    maskCache.set(shape, mask);
  }
  return mask;
}
var DEFAULT_MASK = maskOf(FALLBACK_SHAPE);

// src/client/clay.js
var CLAY_TOKENS = `
.oai-overlay{
  --oai-bg:#f6eee2;--oai-card:#fbf5ec;--oai-clay:#f2e6d5;--oai-niche:#ebdecb;
  --oai-ink:#3c3049;--oai-ink2:#6c5f71;--oai-line:#e0d0bd;
  --oai-accent:#1b7f96;--oai-accent-2:#b4498f;--oai-bad:#b93a32;--oai-ok:#2f8a63;--oai-warn:#a8700f;
  --oai-cyan:#8fdcec;--oai-cyan-ink:#1d4753;--oai-pink:#f0bddf;--oai-pink-ink:#5a2550;--oai-lilac:#e0cff3;--oai-lilac-ink:#45305e;
  --oai-shine:#fff;--oai-umber:#5b3b22;--oai-hi:42%;--oai-lo:80%;--oai-ledge:72%;
  --oai-cast:rgba(111,81,53,.2);--oai-cast-far:rgba(121,91,53,.1);--oai-ring:#b4498f;
  --oai-r:19px 22px 18px 21px;--oai-r-sm:12px 14px 12px 13px;
  --oai-font:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --oai-head:Manrope,"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  color-scheme:light}
body[data-ds-dark-theme] .oai-overlay{
  --oai-bg:#1e1923;--oai-card:#2a2330;--oai-clay:#322a39;--oai-niche:#16121a;
  --oai-ink:#f3e9dd;--oai-ink2:#bcadb8;--oai-line:#40364a;
  --oai-accent:#7fd8ea;--oai-accent-2:#f2a6dc;--oai-bad:#ff9a8f;--oai-ok:#7ad9a8;--oai-warn:#f2c25b;
  --oai-cyan:#5cbdd1;--oai-cyan-ink:#0d262c;--oai-pink:#b76aa1;--oai-pink-ink:#fff2fa;--oai-lilac:#55456b;--oai-lilac-ink:#f4ecff;
  --oai-shine:#fff;--oai-umber:#000;--oai-hi:84%;--oai-lo:62%;--oai-ledge:50%;
  --oai-cast:rgba(0,0,0,.42);--oai-cast-far:rgba(0,0,0,.28);--oai-ring:#f2a6dc;
  color-scheme:dark}
`;
var raised = (fill, depth = 4) => `background:${fill};box-shadow:inset 2px 3px 4px color-mix(in srgb,${fill} var(--oai-hi),var(--oai-shine)),inset -3px -4px 6px color-mix(in srgb,${fill} var(--oai-lo),var(--oai-umber)),0 ${depth}px 0 color-mix(in srgb,${fill} var(--oai-ledge),var(--oai-umber)),0 ${depth + 3}px ${depth + 5}px var(--oai-cast),0 ${depth * 3 + 4}px ${depth * 5 + 8}px var(--oai-cast-far)`;
var pressed = (fill, depth = 4) => `transform:translateY(${depth - 1}px);box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oai-lo),var(--oai-umber)),inset -1px -2px 3px color-mix(in srgb,${fill} var(--oai-hi),var(--oai-shine)),0 1px 0 color-mix(in srgb,${fill} var(--oai-ledge),var(--oai-umber)),0 2px 3px var(--oai-cast)`;
var recessed = (fill) => `background:${fill};box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oai-lo),var(--oai-umber)),inset -2px -2px 3px color-mix(in srgb,${fill} var(--oai-hi),var(--oai-shine)),0 1px 0 color-mix(in srgb,var(--oai-bg) var(--oai-hi),var(--oai-shine))`;

// src/client/vendor/art/inline.js
var genieExpressions = "data:image/webp;base64,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";
var lamp = "data:image/webp;base64,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";
var omniExpressions = "data:image/webp;base64,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";

// src/client/vendor/clay-art.js
var CLAY_OMNI = true;
var LAMP = lamp;
var FACES = Object.freeze(["calm", "pleased", "delighted", "focused", "curious", "asleep", "sad"]);
var faceAt = (face) => Math.max(0, FACES.indexOf(face));
var CLAY_ART_CSS = `.oai-overlay{--oai-genie:url("${genieExpressions}");--oai-omni:url("${omniExpressions}")}`;

// src/client/octopus.js
var BODY = "M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z";
var SHADE = "M87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C62 76 70 66 75 56C80 48 80 36 75 26C82 32 87 38 87 46Z";
var OCTOPUS_SVG = `<svg class="oai-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="oai-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff4ff"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
<path class="oai-ghost oai-cyan" d="${BODY}"/><path class="oai-ghost oai-magenta" d="${BODY}"/>
<path d="${BODY}" fill="url(#oai-octo-skin)"/><path d="${SHADE}" fill="#0b4f6c" opacity=".5"/>
<path d="M30 22C36 14 44 11 50 11C40 14 33 20 30 28Z" fill="#fff" opacity=".45"/>
<g class="oai-eyes"><ellipse cx="40" cy="36" rx="6.5" ry="11" fill="#06121f"/><ellipse cx="60" cy="36" rx="6.5" ry="11" fill="#06121f"/>
<circle cx="42" cy="31" r="2.4" fill="#fff"/><circle cx="62" cy="31" r="2.4" fill="#fff"/></g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".6"/>
<g fill="none" stroke="#0e7490" stroke-width="3" stroke-linecap="round"><path d="M20 96Q13 99 12 92"/><path d="M80 96Q87 99 88 92"/></g>
</svg>`;
var omniFace = (face, className = "oai-octo") => `<span class="${className} oai-clay oai-clay-omni" data-face="${face}" style="--oai-face-at:${faceAt(face)}"></span>`;
var omniHero = () => CLAY_OMNI ? omniFace("calm") : OCTOPUS_SVG;
var STAGE_CSS = `${CLAY_TOKENS}
.oai-overlay{position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color:var(--oai-ink);
  font:15px/1.55 var(--oai-font);background:var(--oai-bg)}
.oai-overlay *{box-sizing:border-box}
.oai-overlay ::selection{background:var(--oai-lilac);color:var(--oai-lilac-ink)}
/* The table the stage stands on: a faint pool of light from the upper left, nothing busy. */
.oai-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(1100px 620px at 30% -12%,color-mix(in srgb,var(--oai-bg) 55%,var(--oai-shine)),transparent 70%)}
body[data-ds-dark-theme] .oai-overlay::before{background:radial-gradient(1100px 620px at 30% -12%,color-mix(in srgb,var(--oai-bg) 88%,var(--oai-cyan)),transparent 70%)}
.oai-stage{position:relative;z-index:1;width:min(580px,100%);display:flex;flex-direction:column;align-items:center}
.oai-octo{width:124px;height:124px;animation:oai-float 4.5s ease-in-out infinite}
.oai-clay{display:block;background:var(--oai-clay-atlas) calc(var(--oai-face-at,0) * 100% / 6) 0/700% 100% no-repeat;filter:drop-shadow(0 10px 8px var(--oai-cast)) drop-shadow(0 22px 22px var(--oai-cast-far))}
.oai-clay-omni{--oai-clay-atlas:var(--oai-omni)}
.oai-clay-genie{--oai-clay-atlas:var(--oai-genie)}
.oai-ghost{opacity:0}.oai-cyan{fill:#00f0ff}.oai-magenta{fill:#ff2bd6}
.oai-octo:hover .oai-cyan,.oai-glitch .oai-cyan{opacity:.55;transform:translate(-2.5px,0);animation:oai-glitch 2.4s steps(1) infinite}
.oai-octo:hover .oai-magenta,.oai-glitch .oai-magenta{opacity:.55;transform:translate(2.5px,0);animation:oai-glitch 2.4s steps(1) infinite reverse}
.oai-eyes{transform-origin:50px 36px;animation:oai-blink 5s infinite}
@keyframes oai-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oai-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oai-glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
/* What the companion says: a speech bubble of cyan clay. */
.oai-bubble{position:relative;margin:10px 0 20px;padding:11px 18px;border-radius:var(--oai-r);${raised("var(--oai-cyan)", 4)};color:var(--oai-cyan-ink);font:500 15px/1.45 var(--oai-font);min-height:46px;max-width:100%}
.oai-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:14px;height:14px;border-radius:3px 0 0 0;transform:translateX(-50%) rotate(45deg);background:var(--oai-cyan);box-shadow:inset 2px 2px 3px color-mix(in srgb,var(--oai-cyan) var(--oai-hi),var(--oai-shine))}
.oai-caret{display:inline-block;width:.5em;height:1.05em;margin-left:2px;vertical-align:-2px;border-radius:2px;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
@keyframes oai-caret{50%{opacity:0}}
.oai-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* The steps: clay beads on a string; the current one is lilac and stands up. */
.oai-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:0 0 18px;padding:0;list-style:none;font:600 12px/1 var(--oai-font);letter-spacing:.06em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-rail li{padding:8px 12px;border-radius:var(--oai-r-sm);${recessed("var(--oai-niche)")}}
.oai-rail li.oai-on{color:var(--oai-lilac-ink);${raised("var(--oai-lilac)", 3)};transform:translateY(-2px)}
.oai-rail li.oai-done{color:var(--oai-cyan-ink);${raised("color-mix(in srgb,var(--oai-cyan) 55%,var(--oai-clay))", 2)}}
/* The card: a thick slab of cream clay resting on the table. */
.oai-card{width:100%;border-radius:26px 30px 25px 29px;padding:26px;${raised("var(--oai-card)", 6)}}
.oai-card h1{font:800 24px/1.2 var(--oai-head);letter-spacing:-.02em;margin:0 0 8px;outline:none}.oai-card p{margin:0 0 14px;color:var(--oai-ink2)}
.oai-mark{font:800 12px/1 var(--oai-head);letter-spacing:.3em;color:var(--oai-accent-2);margin-bottom:12px}
/* Buttons are clay pieces: they rest on their ledge, rise under the pointer, sink when pressed. */
.oai-card button{display:block;width:100%;min-height:44px;padding:12px 16px;margin:10px 0 0;border:0;border-radius:var(--oai-r-sm);${raised("var(--oai-clay)", 4)};color:var(--oai-ink);font:inherit;font-weight:600;cursor:pointer;text-align:center;transition:transform .16s cubic-bezier(.3,1.4,.5,1),box-shadow .16s ease,background-color .16s ease}
.oai-card button:hover:not(:disabled){transform:translateY(-2px)}
.oai-card button:active:not(:disabled){${pressed("var(--oai-clay)", 4)}}
.oai-card button:focus-visible{outline:3px solid var(--oai-ring);outline-offset:3px}
.oai-card button.oai-primary{${raised("var(--oai-cyan)", 5)};color:var(--oai-cyan-ink)}
.oai-card button.oai-primary:active:not(:disabled){${pressed("var(--oai-cyan)", 5)}}
.oai-card button:disabled{opacity:.5;cursor:default;transform:none}
.oai-card button.oai-quiet{background:none;box-shadow:none;color:var(--oai-ink2);font-weight:500}
.oai-card button.oai-quiet:active:not(:disabled){transform:none;box-shadow:none}
.oai-group{margin:18px 0 0}.oai-group h2{margin:0 0 4px;font:700 12px/1.4 var(--oai-head);letter-spacing:.12em;text-transform:uppercase;color:var(--oai-accent)}
.oai-group .oai-terms{margin:0 0 4px;font-size:12px}
.oai-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.oai-card button.oai-tile{margin:4px 0 0;text-align:left;padding:12px 14px}.oai-tile strong{display:block}.oai-tile span{display:block;font-size:12px;font-weight:400;color:var(--oai-ink2)}
.oai-card label{display:block;margin:12px 0 6px;font-size:13px;color:var(--oai-ink2)}
.oai-card input{width:100%;min-height:44px;padding:11px 14px;border-radius:var(--oai-r-sm);border:0;${recessed("var(--oai-niche)")};color:var(--oai-ink);font:15px/1.3 var(--oai-font)}
.oai-card input::placeholder{color:color-mix(in srgb,var(--oai-ink2) 80%,transparent)}
.oai-card input:focus{outline:3px solid var(--oai-ring);outline-offset:2px}
.oai-error{color:var(--oai-bad)!important}.oai-muted{font-size:13px}
.oai-models{margin:8px 0 0;padding:10px 12px;border-radius:var(--oai-r-sm);${recessed("var(--oai-niche)")};font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--oai-ink);max-height:120px;overflow:auto}
.oai-card a.oai-link{color:var(--oai-accent);text-decoration:underline;text-underline-offset:3px}
.oai-card a.oai-button{display:block;margin:12px 0 0;padding:12px 14px;border-radius:var(--oai-r-sm);text-align:center;font-weight:600;text-decoration:none;${raised("var(--oai-cyan)", 5)};color:var(--oai-cyan-ink)}
.oai-code{display:flex;align-items:center;gap:10px;margin:6px 0 4px;padding:12px 14px;border-radius:var(--oai-r-sm);${recessed("color-mix(in srgb,var(--oai-pink) 45%,var(--oai-niche))")}}
.oai-code code{flex:1;font:700 24px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:var(--oai-ink)}
.oai-card .oai-code button.oai-ghost{display:inline-block;width:auto;margin:0;padding:8px 12px;font-size:13px}
.oai-choices button{text-align:left}.oai-choices button span{display:block;font-size:12px;font-weight:400;color:var(--oai-ink2)}
.oai-waiting::before{content:"";display:inline-block;width:9px;height:9px;margin-right:8px;border-radius:50%;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
.oai-card button.oai-tile-on{${raised("var(--oai-lilac)", 3)};color:var(--oai-lilac-ink)}
.oai-tile em.oai-on{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;font:700 10px/1.6 var(--oai-font);letter-spacing:.08em;text-transform:uppercase;font-style:normal;color:var(--oai-cyan-ink);background:var(--oai-cyan)}
.oai-list{border-radius:var(--oai-r);overflow:hidden;${recessed("var(--oai-niche)")}}
.oai-ai{border-top:1px solid var(--oai-line)}.oai-ai:first-child{border-top:0}
.oai-ai-row{display:flex;align-items:center;gap:12px;padding:12px 14px}
.oai-logo{width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:11px 12px 10px 12px;${raised("var(--oai-clay)", 2)};font:800 12px/1 var(--oai-head);color:var(--oai-ink)}
.oai-ai-on .oai-logo{${raised("var(--oai-cyan)", 2)};color:var(--oai-cyan-ink)}
.oai-ai-what{flex:1;min-width:0}.oai-ai-what strong{display:block;font-weight:600}.oai-ai-what span{display:block;font-size:12.5px;color:var(--oai-ink2)}
.oai-found{flex:none;font-style:normal;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--oai-cyan) 45%,var(--oai-card));color:var(--oai-cyan-ink);white-space:nowrap;max-width:40%;overflow:hidden;text-overflow:ellipsis}
/* A switch: a bead that slides in a groove; on, the groove fills with cyan. */
.oai-card button.oai-switch{position:relative;flex:none;width:46px;min-height:0;height:26px;margin:0;padding:0;border-radius:999px;${recessed("var(--oai-niche)")};transform:none}
.oai-card button.oai-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;${raised("var(--oai-card)", 2)};transition:transform .18s cubic-bezier(.3,1.4,.5,1)}
.oai-card button.oai-switch[aria-checked="true"]{${recessed("var(--oai-cyan)")}}
.oai-card button.oai-switch[aria-checked="true"]::after{transform:translateX(20px)}
.oai-card button.oai-switch:hover:not(:disabled),.oai-card button.oai-switch:active:not(:disabled){transform:none}
.oai-ai-setup{padding:0 14px 12px 60px}.oai-ai-setup p{margin:8px 0 0}
.oai-ai-problem{margin:0 14px 10px 60px!important;font-size:13px}
.oai-field{display:flex;gap:10px;align-items:stretch}.oai-field input{flex:1;min-width:0}
.oai-card .oai-field button{width:auto;margin:0;white-space:nowrap}
.oai-setup-form input+.oai-field{margin-top:8px}
.oai-dupes{padding:0 14px 10px 60px}.oai-dupes p{margin:0 0 4px;font-size:12.5px}
.oai-card .oai-dupes button.oai-ghost{display:inline-block;width:auto;margin:2px 0 0;padding:6px 10px;font-size:12.5px}
.oai-card button.oai-more{margin:0;border-top:1px solid var(--oai-line);border-radius:0;background:none;box-shadow:none;color:var(--oai-accent);text-align:left;padding:12px 14px;font-weight:600;transform:none}
.oai-every{margin:12px 0 0!important}
.oai-card button.oai-inline{display:inline;width:auto;min-height:0;margin:0;padding:0;border:0;background:none;box-shadow:none;color:var(--oai-accent);font-weight:600;text-decoration:underline;text-underline-offset:3px;transform:none}
.oai-actions{display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:16px;border-top:2px solid color-mix(in srgb,var(--oai-line) 70%,transparent)}
.oai-card .oai-actions button{width:auto;margin:0}.oai-actions .oai-quiet{margin-right:auto!important;padding-left:0}
.oai-count{font-size:13px;color:var(--oai-ink2)}
@media (max-width:520px){.oai-ai-setup,.oai-dupes{padding-left:14px}.oai-ai-problem{margin-left:14px!important}.oai-field{flex-direction:column}.oai-found{display:none}}
@media (prefers-reduced-motion:reduce){.oai-overlay *,.oai-overlay::before,.oai-overlay::after{animation:none!important;transition:none!important}}
`;

// src/client/companion-art.js
var import_react = require("react");
var SHAPES2 = PICKER_SHAPES;
var COLORS = CHARACTER_COLORS;
var serial = 0;
function characterSvg(shape, color, size = 120) {
  serial += 1;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${characterMarkup(shape, color).replaceAll("%MASK%", `oaic${serial}`)}</svg>`;
}
var INK_CSS = `.oai-overlay{${Object.entries(INKS).map(([name, [light]]) => `--bt-ink-${name}:${light}`).join(";")}}
body[data-ds-dark-theme] .oai-overlay{${Object.entries(INKS).map(([name, [, dark]]) => `--bt-ink-${name}:${dark}`).join(";")}}`;
var swatchOf = (color) => GRADIENTS[color] ? `linear-gradient(135deg,${GRADIENTS[color].map(([at2, value]) => `${value} ${at2 * 100}%`).join(",")})` : `var(--bt-ink-${color},${INKS[color]?.[0] ?? color})`;
var cached;
function companionLook(state) {
  if (!state) return void 0;
  if (state.companionImage) return { image: true, name: state.companionName };
  if (state.companionShape) return { shape: state.companionShape, color: state.companionColor ?? "cyan", name: state.companionName };
  return void 0;
}
function useCompanion() {
  const [look, setLook] = (0, import_react.useState)(cached);
  (0, import_react.useEffect)(() => {
    let alive = true;
    call("state").then(async (state) => {
      let next = companionLook(state);
      if (next?.image) {
        const { image } = await call("companion-image").catch(() => ({ image: null }));
        next = image ? { ...next, src: image } : void 0;
      }
      cached = next;
      if (alive) setLook(next);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, []);
  return [look, (next) => {
    cached = next;
    setLook(next);
  }];
}
function Hero({ look, hatching }) {
  const cls = `oai-hero${hatching ? " oai-hatch" : ""}`;
  if (look?.src) return (0, import_react.createElement)("div", { className: cls }, (0, import_react.createElement)("img", { className: "oai-hero-img", src: look.src, alt: look.name ? `${look.name}, your companion` : "Your companion" }));
  if (look?.shape) return (0, import_react.createElement)("div", { className: cls, dangerouslySetInnerHTML: { __html: characterSvg(look.shape, look.color, 132) } });
  return (0, import_react.createElement)("div", { className: cls, dangerouslySetInnerHTML: { __html: omniHero() } });
}
function Egg() {
  return (0, import_react.createElement)(
    "div",
    { className: "oai-hero oai-egg", "aria-hidden": "true" },
    (0, import_react.createElement)("span", { className: "oai-egg-shell" }),
    [0, 1, 2, 3, 4].map((index) => (0, import_react.createElement)("i", { key: index, className: `oai-spark oai-spark-${index}` }))
  );
}

// src/client/stage.js
var import_react2 = require("react");
var import_react_dom = require("react-dom");
var RAIL = [["omni-companion", "Your companion"], ["omni-team", "Your team"], ["omni-connect", "Connect Omni"], ["omni-connect-ai", "Connect AI"]];
var ANNOUNCED = /* @__PURE__ */ Symbol.for("automagik.omni.onboarding-steps");
function announceStep(id, scope = globalThis) {
  const steps = scope[ANNOUNCED] ??= /* @__PURE__ */ new Set();
  steps.add(id);
  return () => steps.delete(id);
}
function railSteps(current, scope = globalThis) {
  const steps = scope[ANNOUNCED];
  return RAIL.filter(([id]) => id === current || steps?.has(id) === true);
}
var FLAG_OF = { "omni-companion": "companionDone", "omni-team": "teamDone", "omni-connect-ai": "connectAiDone" };
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
async function gate({ stepId, explicit, complete }, request2 = call) {
  let state = {};
  try {
    state = await request2("state") ?? {};
  } catch {
  }
  if (explicit !== true && state[FLAG_OF[stepId]] === true) {
    complete();
    return null;
  }
  return state;
}
async function finish({ stepId, complete, connected }, request2 = call) {
  try {
    await request2("done", connected === true ? { stepId, connected } : { stepId });
  } catch {
  }
  complete();
}
async function finishInto(props, section, request2 = call) {
  await finish(props, request2);
  props.openSection(section);
}
function useGate(props) {
  const first = (0, import_react2.useRef)(props);
  const [state, setState] = (0, import_react2.useState)(void 0);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    gate(first.current).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
function useFinish(props) {
  const done = (0, import_react2.useRef)(false);
  return (0, import_react2.useCallback)((section) => {
    if (done.current) return;
    done.current = true;
    if (section) void finishInto(props, section);
    else void finish(props);
  }, [props]);
}
function useGlitch() {
  const [on2, setOn] = (0, import_react2.useState)(false);
  const timer = (0, import_react2.useRef)(0);
  (0, import_react2.useEffect)(() => () => clearTimeout(timer.current), []);
  const glitch = (0, import_react2.useCallback)(() => {
    if (reducedMotion()) return;
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 900);
  }, []);
  return [on2, glitch];
}
function useTypewriter(text) {
  const [shown, setShown] = (0, import_react2.useState)(() => reducedMotion() ? text : "");
  (0, import_react2.useEffect)(() => {
    if (reducedMotion()) {
      setShown(text);
      return void 0;
    }
    let at2 = 0;
    let timer = 0;
    const tick = () => {
      at2 += 1;
      setShown(text.slice(0, at2));
      if (at2 < text.length) timer = setTimeout(tick, 22);
    };
    setShown("");
    timer = setTimeout(tick, 120);
    return () => clearTimeout(timer);
  }, [text]);
  return shown;
}
function Rail({ at: at2 }) {
  const steps = railSteps(at2);
  const here = steps.findIndex(([id]) => id === at2);
  return (0, import_react2.createElement)(
    "ol",
    { className: "oai-rail", "aria-label": "Setup steps" },
    steps.map(([id, label], index) => (0, import_react2.createElement)("li", {
      key: id,
      className: index < here ? "oai-done" : index === here ? "oai-on" : "",
      "aria-current": index === here ? "step" : void 0
    }, label))
  );
}
var SHOWING = /* @__PURE__ */ Symbol.for("automagik.omni.onboarding-showing");
function noteShowing(scope = globalThis) {
  scope[SHOWING] = (scope[SHOWING] ?? 0) + 1;
  return () => {
    scope[SHOWING] -= 1;
  };
}
function Stage({ title, speech, at: at2, glitching, hero, mark = "AUTOMAGIK", wide = false, children }) {
  const titleRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    const root = document.getElementById("root");
    if (root === null) return void 0;
    const previous = root.inert;
    root.inert = true;
    return () => {
      root.inert = previous;
    };
  }, []);
  (0, import_react2.useEffect)(() => noteShowing(), []);
  (0, import_react2.useEffect)(() => {
    titleRef.current?.focus();
  }, [title]);
  const shown = useTypewriter(speech);
  const [look] = useCompanion();
  return (0, import_react_dom.createPortal)((0, import_react2.createElement)(
    "div",
    { className: "oai-overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "oai-title" },
    (0, import_react2.createElement)(
      "div",
      { className: `oai-stage${glitching ? " oai-glitch" : ""}${wide ? " oai-wide" : ""}` },
      hero ?? (0, import_react2.createElement)(Hero, { look }),
      (0, import_react2.createElement)(
        "div",
        { className: "oai-bubble" },
        (0, import_react2.createElement)("span", { className: "oai-hidden", role: "status" }, speech),
        (0, import_react2.createElement)("span", { "aria-hidden": "true" }, shown, shown.length < speech.length ? (0, import_react2.createElement)("span", { className: "oai-caret" }) : null)
      ),
      (0, import_react2.createElement)(Rail, { at: at2 }),
      (0, import_react2.createElement)(
        "main",
        { className: "oai-card" },
        (0, import_react2.createElement)("div", { className: "oai-mark", "aria-hidden": "true" }, mark),
        (0, import_react2.createElement)("h1", { id: "oai-title", ref: titleRef, tabIndex: -1 }, title),
        children
      )
    )
  ), document.body);
}

// src/client/companion.js
var import_react3 = require("react");
var IDEAS = ["a sleepy cyan fox with a lantern tail", "a tiny robot made of moonlight", "a round jellyfish that wears headphones"];
var NAMES = ["Pip", "Nova", "Mochi", "Echo", "Biscuit"];
var NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;
var AVATAR_SIZE = 256;
var MAX_AVATAR = 16e4;
async function avatarOf(src) {
  try {
    const picture = new Image();
    picture.src = src;
    await picture.decode();
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const side = Math.min(picture.naturalWidth, picture.naturalHeight);
    canvas.getContext("2d").drawImage(picture, (picture.naturalWidth - side) / 2, (picture.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const small = [canvas.toDataURL("image/webp", 0.86), canvas.toDataURL("image/png")].find((url) => /^data:image\/(webp|png);/.test(url) && url.length <= MAX_AVATAR);
    return small;
  } catch {
    return void 0;
  }
}
function CompanionStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const [, setLook] = useCompanion();
  const [caps, setCaps] = (0, import_react3.useState)(null);
  const [mode, setMode] = (0, import_react3.useState)("pick");
  const [shape, setShape] = (0, import_react3.useState)(null);
  const [color, setColor] = (0, import_react3.useState)("cyan");
  const [description, setDescription] = (0, import_react3.useState)("");
  const [image, setImage] = (0, import_react3.useState)(null);
  const [drawing, setDrawing] = (0, import_react3.useState)(false);
  const [name, setName] = (0, import_react3.useState)("");
  const [problem, setProblem] = (0, import_react3.useState)(null);
  const [saving, setSaving] = (0, import_react3.useState)(false);
  const [hatching, setHatching] = (0, import_react3.useState)(false);
  (0, import_react3.useEffect)(() => {
    call("companion").then((reply) => {
      setCaps(reply);
      if (reply?.generate) setMode("describe");
    }).catch(() => setCaps({ generate: null }));
  }, []);
  (0, import_react3.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  const generating = caps?.generate;
  const look = image ? { src: image, name } : shape ? { shape, color, name } : null;
  const nameOk = NAME_RULE.test(name.trim());
  const ready = look !== null && nameOk && !saving;
  const draw = async () => {
    setProblem(null);
    setDrawing(true);
    try {
      const reply = await call("companion-generate", { description });
      setImage(reply.image);
      glitch();
    } catch (error) {
      setProblem(error.message);
    } finally {
      setDrawing(false);
    }
  };
  const hatch = async () => {
    if (!ready) return;
    setSaving(true);
    setProblem(null);
    try {
      const avatar = image ? await avatarOf(image) : void 0;
      await call("companion-save", { name: name.trim(), ...image ? { image, ...avatar ? { avatar } : {} } : { shape, color } });
      setLook({ ...image ? { src: image } : { shape, color }, name: name.trim() });
      setHatching(true);
      setTimeout(() => finish2(), 1100);
    } catch (error) {
      setProblem(error.message);
      setSaving(false);
    }
  };
  const speech = look ? nameOk ? `I'm ${name.trim()}! Ready when you are.` : "Oh, that's me! What's my name?" : "Hi! I'm going to be yours. What should I look like?";
  const hero = look ? (0, import_react3.createElement)(Hero, { look, hatching }) : (0, import_react3.createElement)(Egg);
  return (0, import_react3.createElement)(
    Stage,
    { title: "Create your companion", speech, at: "omni-companion", glitching, hero },
    (0, import_react3.createElement)("p", { className: "oai-lede" }, "Your companion runs your team: it talks with you, hands work to the others and keeps an eye on everything. Make it yours."),
    (0, import_react3.createElement)(
      "div",
      { className: "oai-seg", role: "tablist", "aria-label": "How to make it" },
      (0, import_react3.createElement)("button", { type: "button", role: "tab", "aria-selected": mode === "describe", onClick: () => setMode("describe") }, "Describe it"),
      (0, import_react3.createElement)("button", { type: "button", role: "tab", "aria-selected": mode === "pick", onClick: () => setMode("pick") }, "Pick one")
    ),
    mode === "describe" ? (0, import_react3.createElement)(
      "div",
      { className: "oai-describe" },
      (0, import_react3.createElement)("label", { htmlFor: "oai-desc" }, "What does it look like?"),
      (0, import_react3.createElement)("textarea", { id: "oai-desc", rows: 2, value: description, placeholder: IDEAS[0], onChange: (event) => setDescription(event.target.value), disabled: drawing }),
      (0, import_react3.createElement)("div", { className: "oai-chips" }, IDEAS.map((idea) => (0, import_react3.createElement)("button", { key: idea, type: "button", className: "oai-chip", onClick: () => setDescription(idea) }, idea))),
      generating ? (0, import_react3.createElement)(
        "div",
        { className: "oai-row" },
        (0, import_react3.createElement)("button", { type: "button", className: "oai-primary", disabled: drawing || description.trim().length < 3 || !generating.ready, onClick: draw }, drawing ? "Drawing…" : image ? "Draw again" : "Bring it to life"),
        (0, import_react3.createElement)("span", { className: "oai-muted" }, generating.kind === "chatgpt" ? "Drawn with your ChatGPT plan (gpt-image-2)" : "Drawn with your OpenAI key (gpt-image-1)")
      ) : (0, import_react3.createElement)("p", { className: "oai-note" }, "Drawing a companion needs ChatGPT or an OpenAI key. Connect one in the AI step, then come back from Settings. For now, pick one."),
      drawing ? (0, import_react3.createElement)("div", { className: "oai-drawing", "aria-hidden": "true" }) : null
    ) : (0, import_react3.createElement)(
      "div",
      { className: "oai-pick" },
      (0, import_react3.createElement)(
        "div",
        { className: "oai-shapes", role: "radiogroup", "aria-label": "Character" },
        SHAPES2.map((id) => (0, import_react3.createElement)("button", {
          key: id,
          type: "button",
          role: "radio",
          "aria-checked": shape === id && !image,
          "aria-label": id,
          className: "oai-shape",
          onClick: () => {
            setImage(null);
            setShape(id);
          },
          dangerouslySetInnerHTML: { __html: characterSvg(id, color, 54) }
        }))
      ),
      (0, import_react3.createElement)(
        "div",
        { className: "oai-swatches", role: "radiogroup", "aria-label": "Color" },
        COLORS.map((id) => (0, import_react3.createElement)("button", { key: id, type: "button", role: "radio", "aria-checked": color === id, "aria-label": id, className: "oai-swatch", style: { background: swatchOf(id) }, onClick: () => setColor(id) }))
      )
    ),
    (0, import_react3.createElement)(
      "div",
      { className: "oai-name" },
      (0, import_react3.createElement)("label", { htmlFor: "oai-name" }, "Its name"),
      (0, import_react3.createElement)(
        "div",
        { className: "oai-row" },
        (0, import_react3.createElement)("input", { id: "oai-name", value: name, maxLength: 40, placeholder: NAMES[0], autoComplete: "off", onChange: (event) => setName(event.target.value), onKeyDown: (event) => {
          if (event.key === "Enter") void hatch();
        } }),
        (0, import_react3.createElement)("div", { className: "oai-chips" }, NAMES.map((option) => (0, import_react3.createElement)("button", { key: option, type: "button", className: "oai-chip", onClick: () => setName(option) }, option)))
      )
    ),
    problem ? (0, import_react3.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react3.createElement)(
      "div",
      { className: "oai-actions" },
      (0, import_react3.createElement)("button", { type: "button", className: "oai-primary oai-big", disabled: !ready, onClick: hatch }, saving ? "Hatching…" : nameOk ? `Hatch ${name.trim()}` : "Hatch")
    )
  );
}

// src/client/team.js
var import_react4 = require("react");
var WAKE_MS = 1100;
var LOOK_MS = 1800;
var POLL_MS = 900;
var READY_POLLS = 20;
var abortError = () => Object.assign(new Error("Omni was switched off"), { name: "AbortError" });
var sleep = (ms2, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  if (ms2 <= 0) return resolve();
  const timer = setTimeout(resolve, ms2);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(abortError());
  }, { once: true });
});
async function powerOn({ show, signal, omniAi = call, omniUi = callOmniUi, wait = sleep, quick = reducedMotion() }) {
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  const pause = (ms2) => wait(quick ? 0 : ms2, signal);
  const end = (phase, detail) => {
    check();
    show(phase, detail);
    return phase;
  };
  show("waking");
  await pause(WAKE_MS);
  check();
  let plugins = await omniAi("omni-plugins");
  check();
  if (!plugins.ready) {
    show("installing", { plugins });
    if (plugins.install?.phase !== "installing") {
      try {
        plugins = await omniAi("omni-plugins-install");
      } catch (error) {
        return end("failed", { message: error.message });
      }
    }
    let polls = 0;
    while (plugins.install?.phase === "installing" || plugins.install?.phase === "done" && !plugins.ready && polls < READY_POLLS) {
      check();
      show(plugins.install?.phase === "installing" ? "installing" : "starting", { plugins });
      await wait(POLL_MS, signal);
      plugins = await omniAi("omni-plugins");
      if (plugins.install?.phase !== "installing") polls += 1;
    }
    if (plugins.install?.phase === "failed") return end("failed", { message: plugins.install.error });
    if (!plugins.ready) return end("restart", { plugins });
  }
  show("looking");
  const started = Date.now();
  let link = null;
  try {
    link = await omniUi("omni-link");
  } catch (error) {
    if (error?.code === "HTTP_404") return end("restart", { plugins });
  }
  check();
  if (link?.linked === true || link?.configured === true) {
    await pause(LOOK_MS / 2);
    return end("linked", { origin: link.origin ?? null });
  }
  const found = await omniUi("omni-discover").catch(() => null);
  check();
  await pause(Math.max(0, LOOK_MS - (Date.now() - started)));
  const omnis = Array.isArray(found?.omnis) ? found.omnis : [];
  return end(omnis.length > 0 ? "found" : "none", { omnis, sandbox: found?.sandbox ?? null });
}
var onMac = (scope = globalThis) => /Mac/i.test(scope.navigator?.platform ?? "") || /Mac OS X/.test(scope.navigator?.userAgent ?? "");
var hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
var portOf = (url) => {
  try {
    return new URL(url).port;
  } catch {
    return "";
  }
};
function foundChoice(omni, { mac = false } = {}) {
  const here = mac ? "this Mac" : "this computer";
  const title = omni.source === "sandbox" ? `Your Omni on ${here}` : omni.local ? `Omni on ${here}` : hostOf(omni.url);
  const port = omni.local ? portOf(omni.url) : "";
  const sub = [omni.version ? `v${omni.version}` : null, port ? `port ${port}` : null, !omni.local ? "saved in your Omni CLI" : null].filter(Boolean).join(" · ");
  const row = (action, note = null) => ({ id: omni.id, title, sub, action, note });
  if (omni.local && omni.reachable === false) return row(null, "Not answering right now.");
  if (omni.updateTo || omni.pairing === "too-old" && !omni.hasKey) return row(null, "Needs an update first; Connect Omni, next, does it.");
  if (omni.hasKey) return row("use");
  if (omni.pairing === "off") return row(null, "Sign-in from devices is off on it.");
  return row("connect");
}
function readRemote(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  let link = null;
  try {
    link = new URL(value);
  } catch {
  }
  const grant = link?.searchParams.get("grant") ?? "";
  if (/^[A-Za-z0-9_-]{24}$/.test(grant)) {
    if (link.protocol === "omni:") {
      const url = link.searchParams.get("url");
      return url ? { kind: "grant", url, grant } : { kind: "bad-link" };
    }
    if (/\/api\/login\/app\/?$/.test(link.pathname)) return { kind: "grant", url: `${link.origin}${link.pathname.replace(/\/api\/login\/app\/?$/, "")}`, grant };
  }
  if (/^omni:/i.test(value) || /[?&]grant=/.test(value)) return { kind: "bad-link" };
  return { kind: "address", url: value };
}
var TYPE_LABEL = { "whatsapp-baileys": "WhatsApp", "whatsapp-cloud": "WhatsApp Business", slack: "Slack", telegram: "Telegram", discord: "Discord", gupshup: "Gupshup" };
var channelLabel = (channel) => TYPE_LABEL[channel.type] ?? channel.type ?? "Channel";
var GENIE_TYPE = {
  type: "genie",
  groups: [
    { id: "plugins", label: "Plugins", rows: [{ id: "genie", label: "Genie", detail: "Not released for DSH yet" }] },
    { id: "tools", label: "Tools", rows: [{ id: "threads", label: "Threads of itself", detail: "One per wish, under Genie" }, { id: "computer", label: "Shell and files", detail: "In its project" }] },
    { id: "setup", label: "Setup", rows: [{ id: "folder", label: "Folder", detail: "Its own, per wish" }] }
  ]
};
var abilitiesOf = (type) => Object.fromEntries((type?.groups ?? []).find((group) => group.id === "tools")?.rows.filter((row) => typeof row.on === "boolean").map((row) => [row.id, row.on]) ?? []);
function shortPath(path, keep = 2) {
  const parts = String(path).split("/");
  const head = parts[0] === "~" ? "~" : "";
  const tail = parts.slice(-keep).filter(Boolean);
  return parts.length - (head ? 1 : 0) > keep + 1 ? `${head}/…/${tail.join("/")}` : path;
}
var Check = () => (0, import_react4.createElement)("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": true }, (0, import_react4.createElement)("path", { d: "M3 8.5l3 3 7-7", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }));
function Capabilities({ type, abilities = {}, onToggle, disabled = false }) {
  if (!type) return (0, import_react4.createElement)("p", { className: "oai-muted oai-caps-wait" }, "Reading what it starts with…");
  return (0, import_react4.createElement)("div", { className: "oai-caps" }, type.groups.map((group) => (0, import_react4.createElement)(
    "section",
    { key: group.id, className: "oai-cap-group", "aria-label": group.label },
    (0, import_react4.createElement)("h3", null, group.label),
    group.rows.length === 0 ? (0, import_react4.createElement)("p", { className: "oai-muted oai-cap-empty" }, group.empty ?? "None") : (0, import_react4.createElement)("ul", null, group.rows.map((row) => {
      const on2 = typeof row.on === "boolean" ? abilities[row.id] ?? row.on : null;
      return (0, import_react4.createElement)(
        "li",
        { key: row.id, className: `oai-cap${on2 === false ? " oai-off" : ""}`, "data-cap": row.id },
        (0, import_react4.createElement)(
          "span",
          { className: "oai-cap-what" },
          (0, import_react4.createElement)("strong", null, row.label),
          row.detail ? (0, import_react4.createElement)("small", row.path ? { title: row.detail } : null, row.path ? shortPath(row.detail) : row.detail) : null,
          row.installed === false ? (0, import_react4.createElement)("small", null, "Installs when Omni powers on") : null,
          row.tools ? (0, import_react4.createElement)("code", null, row.tools.join(" · ")) : null
        ),
        row.version ? (0, import_react4.createElement)("span", { className: `oai-version${row.installed === false ? " oai-pending" : ""}` }, `v${row.version}`) : null,
        row.installed === true ? (0, import_react4.createElement)("span", { className: "oai-tick", title: "Installed" }, (0, import_react4.createElement)(Check)) : null,
        row.locked ? (0, import_react4.createElement)("span", { className: "oai-core", title: "What this Bot is for: always on" }, "Always on") : on2 !== null && onToggle ? (0, import_react4.createElement)("button", { type: "button", role: "switch", className: "oai-switch", "aria-checked": on2, "aria-label": `${row.label} for this Bot`, disabled, onClick: () => onToggle(row.id, !on2) }) : null
      );
    }))
  )));
}
var CLOSED_EYES = '<g class="oai-closed" fill="none" stroke="#06121f" stroke-width="3" stroke-linecap="round"><path d="M33 37Q40 42 47 37"/><path d="M53 37Q60 42 67 37"/></g>';
var PORTRAIT_SVG = OCTOPUS_SVG.replace("</svg>", `${CLOSED_EYES}</svg>`);
function omniFaceOf(phase) {
  if (phase === "asleep") return "asleep";
  if (phase === "failed") return "sad";
  if (phase === "linked") return "delighted";
  if (["waking", "installing", "starting", "looking"].includes(phase)) return "focused";
  return "curious";
}
var portraitOf = (phase) => CLAY_OMNI ? omniFace(omniFaceOf(phase)) : PORTRAIT_SVG;
var genieExpressionOf = (chosen) => chosen ? "pleased" : "asleep";
var GeniePet = ({ expression }) => (0, import_react4.createElement)("div", { className: "oai-genie-pet oai-clay oai-clay-genie", "data-face": expression, style: { "--oai-face-at": faceAt(expression) } });
var PowerIcon = () => (0, import_react4.createElement)(
  "svg",
  { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": true },
  (0, import_react4.createElement)("path", { d: "M12 3v8", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" }),
  (0, import_react4.createElement)("path", { d: "M6.4 6.6a8 8 0 1 0 11.2 0", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" })
);
var titleOf = (plugins, name) => plugins?.plugins?.find((row) => row.name === name)?.title ?? "Omni";
function statusOf(phase, detail) {
  if (phase === "asleep") return detail?.removed ? "Powered off · not on your team" : "Powered off";
  if (phase === "installing") {
    const rows = detail?.plugins?.plugins ?? [];
    const install = detail?.plugins?.install;
    const at2 = Math.min(rows.length, (install?.done?.length ?? 0) + 1);
    return install?.current ? `Installing ${titleOf(detail.plugins, install.current)} · ${at2} of ${rows.length}` : "Installing Omni…";
  }
  if (phase === "found") {
    const count = (detail?.omnis ?? []).filter((omni) => foundChoice(omni).action).length;
    return count === 1 ? "Found an Omni" : count > 1 ? `Found ${count} Omnis` : "Found Omnis, none ready to connect";
  }
  if (phase === "linked") return detail?.origin ? `Connected to ${detail.origin}` : "Connected";
  return {
    waking: "Waking up…",
    starting: "Starting Omni in this DSH…",
    looking: "Looking for a connection…",
    none: "No Omni found nearby",
    pairing: "Approve this device on your phone",
    restart: "Installed · restart DSH to start it",
    failed: "Could not install Omni"
  }[phase] ?? "";
}
function lightsOf(phase) {
  const ready = ["looking", "found", "none", "pairing", "linked"].includes(phase);
  return [
    ["power", phase === "asleep" ? "off" : "on"],
    ["plugins", ready ? "on" : ["installing", "starting"].includes(phase) ? "busy" : phase === "failed" || phase === "restart" ? "warn" : "off"],
    ["link", phase === "linked" ? "on" : ["looking", "pairing"].includes(phase) ? "busy" : phase === "found" ? "warn" : "off"]
  ];
}
function InstallProgress({ plugins }) {
  const install = plugins?.install;
  const done = new Set(install?.done ?? []);
  return (0, import_react4.createElement)("ol", { className: "oai-install", "aria-label": "The Omni plugins" }, (plugins?.plugins ?? []).map((row) => {
    const state = done.has(row.name) || row.installed && row.enabled !== false ? "done" : install?.current === row.name ? "now" : "next";
    return (0, import_react4.createElement)(
      "li",
      { key: row.name, className: `oai-install-${state}` },
      (0, import_react4.createElement)("span", { className: "oai-install-dot", "aria-hidden": true }, state === "done" ? (0, import_react4.createElement)(Check) : null),
      row.title.replace(/^Omni /, "")
    );
  }));
}
function Pairing({ pairing, onCancel }) {
  return (0, import_react4.createElement)(
    "div",
    { className: "oai-pairing", "aria-live": "polite" },
    (0, import_react4.createElement)("code", { className: "oai-pair-code" }, pairing.code),
    (0, import_react4.createElement)(
      "div",
      { className: "oai-row" },
      pairing.waLink ? (0, import_react4.createElement)("a", { className: "oai-pill oai-pill-primary", href: pairing.waLink, target: "_blank", rel: "noreferrer" }, "Open WhatsApp") : null,
      pairing.approveUrl ? (0, import_react4.createElement)("a", { className: `oai-pill${pairing.waLink ? "" : " oai-pill-primary"}`, href: pairing.approveUrl, target: "_blank", rel: "noreferrer" }, "Approve") : null,
      (0, import_react4.createElement)("button", { type: "button", className: "oai-pill", onClick: onCancel }, "Cancel")
    )
  );
}
function Found({ omnis, busy, onUse }) {
  const mac = onMac();
  return (0, import_react4.createElement)("ul", { className: "oai-found-list" }, omnis.map((omni) => {
    const choice = foundChoice(omni, { mac });
    return (0, import_react4.createElement)(
      "li",
      { key: omni.id, className: `oai-found-row${choice.action ? "" : " oai-quiet"}`, title: choice.note ?? void 0 },
      (0, import_react4.createElement)("span", { className: "oai-found-what" }, (0, import_react4.createElement)("strong", null, choice.title), (0, import_react4.createElement)("small", null, choice.note ?? choice.sub)),
      choice.action ? (0, import_react4.createElement)("button", { type: "button", className: "oai-pill oai-pill-primary", disabled: busy !== null, onClick: () => onUse(omni) }, busy === omni.id ? "Connecting…" : choice.action === "use" ? "Use it" : "Connect") : null
    );
  }));
}
function Elsewhere({ busy, onRemote, onLocal }) {
  const [text, setText] = (0, import_react4.useState)("");
  const wanted = readRemote(text);
  const submit = (event) => {
    event.preventDefault();
    if (wanted !== null) onRemote(wanted);
  };
  return (0, import_react4.createElement)(
    "div",
    { className: "oai-elsewhere" },
    (0, import_react4.createElement)(
      "form",
      { className: "oai-field", onSubmit: submit },
      (0, import_react4.createElement)("input", { type: "text", inputMode: "url", autoComplete: "off", spellCheck: false, value: text, placeholder: "Its address, or the link Omni sent you", "aria-label": "Omni address or link", onChange: (event) => setText(event.target.value) }),
      (0, import_react4.createElement)("button", { type: "submit", className: "oai-pill oai-pill-primary", disabled: busy !== null || wanted === null }, busy === "remote" ? "Connecting…" : "Connect")
    ),
    (0, import_react4.createElement)("button", { type: "button", className: "oai-textlink", onClick: onLocal }, onMac() ? "Or run Omni on this Mac" : "Or run Omni on this computer")
  );
}
function Inside({ phase, detail, power, live, elsewhere, setElsewhere }) {
  const channels = live?.configured ? live.channels ?? [] : [];
  if (phase === "installing") return (0, import_react4.createElement)(InstallProgress, { plugins: detail?.plugins });
  if (phase === "pairing") return (0, import_react4.createElement)(Pairing, { pairing: detail.pairing, onCancel: power.cancelPairing });
  if (phase === "none" || phase === "found" && elsewhere) return (0, import_react4.createElement)(Elsewhere, { busy: power.busy, onRemote: power.remote, onLocal: power.local });
  if (phase === "found") {
    return (0, import_react4.createElement)(
      "div",
      { className: "oai-found-box" },
      (0, import_react4.createElement)(Found, { omnis: detail?.omnis ?? [], busy: power.busy, onUse: power.use }),
      (0, import_react4.createElement)("button", { type: "button", className: "oai-textlink", onClick: () => setElsewhere(true) }, "Somewhere else?")
    );
  }
  if (phase === "linked" && channels.length > 0) {
    return (0, import_react4.createElement)(
      "div",
      { className: "oai-menu" },
      (0, import_react4.createElement)("span", { className: "oai-menu-label" }, "In your menu"),
      (0, import_react4.createElement)("ul", { className: "oai-menu-preview" }, channels.slice(0, 3).map((channel) => (0, import_react4.createElement)("li", { key: channel.id }, (0, import_react4.createElement)("span", { className: `oai-dot ${channel.status === "connected" ? "ok" : "warn"}` }), `${channelLabel(channel)} · ${channel.name}`)))
    );
  }
  if (phase === "restart") return (0, import_react4.createElement)("p", { className: "oai-inside-note" }, "Restart DSH, then power Omni on again.");
  if (phase === "failed") return (0, import_react4.createElement)("p", { className: "oai-inside-note oai-bad", title: detail?.message }, detail?.message ?? "Add the Omni plugins on DSH's Plugins page.");
  return null;
}
function Machine({ kind = "omni", phase, detail, power, live, onPower, children }) {
  const [elsewhere, setElsewhere] = (0, import_react4.useState)(false);
  const awake = phase !== "asleep";
  const omni = kind === "omni";
  return (0, import_react4.createElement)(
    "div",
    { className: `oai-box oai-box-${kind} oai-is-${phase}`, "data-phase": phase },
    (0, import_react4.createElement)(
      "div",
      { className: "oai-box-top" },
      (0, import_react4.createElement)("span", { className: "oai-lights", "aria-hidden": true }, (omni ? lightsOf(phase) : [["power", "off"], ["plugins", "off"], ["link", "off"]]).map(([id, state]) => (0, import_react4.createElement)("i", { key: id, className: `oai-light oai-light-${state}`, title: id }))),
      omni ? (0, import_react4.createElement)("button", { type: "button", className: `oai-power${awake ? " on" : ""}`, "aria-pressed": awake, "aria-label": awake ? "Power Omni off" : "Power Omni on", onClick: onPower, disabled: phase === "installing" || phase === "starting" }, (0, import_react4.createElement)(PowerIcon)) : null
    ),
    (0, import_react4.createElement)(
      "div",
      { className: "oai-screen", "aria-hidden": "true" },
      phase === "looking" ? (0, import_react4.createElement)("div", { className: "oai-scan" }, (0, import_react4.createElement)("i"), (0, import_react4.createElement)("i"), (0, import_react4.createElement)("i")) : null,
      phase === "asleep" && omni ? (0, import_react4.createElement)("div", { className: "oai-zzz" }, (0, import_react4.createElement)("i", null, "z"), (0, import_react4.createElement)("i", null, "z"), (0, import_react4.createElement)("i", null, "z")) : null,
      children
    ),
    (0, import_react4.createElement)("p", { className: `oai-status${["waking", "installing", "starting", "looking"].includes(phase) ? " oai-working" : ""}`, role: "status", "aria-live": "polite" }, omni ? statusOf(phase, detail) : "Coming soon"),
    (0, import_react4.createElement)(
      "div",
      { className: "oai-inside" },
      omni ? (0, import_react4.createElement)(Inside, { phase, detail, power, live, elsewhere, setElsewhere }) : null,
      omni && power?.problem ? (0, import_react4.createElement)("p", { className: "oai-inside-note oai-bad", role: "alert" }, power.problem) : null
    )
  );
}
var StartsWith = (props) => (0, import_react4.createElement)("details", { className: "oai-starts" }, (0, import_react4.createElement)("summary", null, "What it starts with"), (0, import_react4.createElement)(Capabilities, props));
function OmniCard({ power, onPower, type, abilities, onToggle, live }) {
  const { phase, detail } = power;
  const awake = phase !== "asleep";
  return (0, import_react4.createElement)(
    "article",
    { className: `oai-fighter oai-omni${awake ? " oai-chosen" : ""}`, "data-phase": phase },
    (0, import_react4.createElement)(
      Machine,
      { phase, detail, power, live, onPower },
      (0, import_react4.createElement)("div", { className: "oai-octo-wrap", dangerouslySetInnerHTML: { __html: portraitOf(phase) } })
    ),
    (0, import_react4.createElement)(
      "header",
      null,
      (0, import_react4.createElement)("h2", null, "Omni"),
      awake && phase !== "failed" ? (0, import_react4.createElement)("span", { className: "oai-team-line" }, (0, import_react4.createElement)("span", { className: "oai-on-team" }, (0, import_react4.createElement)(Check), "On your team"), (0, import_react4.createElement)("button", { type: "button", className: "oai-remove", onClick: onPower, disabled: phase === "installing" || phase === "starting" }, "Remove")) : null
    ),
    (0, import_react4.createElement)("p", { className: "oai-about" }, "Every chat on every channel, answered by your team."),
    (0, import_react4.createElement)(StartsWith, { type, abilities, onToggle, disabled: !awake })
  );
}
function usePower() {
  const [phase, setPhase] = (0, import_react4.useState)("asleep");
  const [detail, setDetail] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)(null);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const run = (0, import_react4.useRef)(null);
  const back = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => () => run.current?.abort(), []);
  const show = (next, value = null) => {
    setPhase(next);
    setDetail(value);
  };
  const on2 = () => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setProblem(null);
    powerOn({ show, signal: controller.signal }).catch((error) => {
      if (error?.name !== "AbortError") show("failed", { message: error.message });
    });
  };
  const off = () => {
    run.current?.abort();
    if (phase === "pairing") void callOmniUi("omni-pair-cancel").catch(() => {
    });
    setProblem(null);
    setBusy(null);
    show("asleep", { removed: true });
  };
  const connect = async (row, endpoint, payload) => {
    setBusy(row);
    setProblem(null);
    try {
      const reply = await callOmniUi(endpoint, payload);
      if (run.current?.signal.aborted) return;
      if (reply.status === "paired") show("linked", { origin: reply.origin ?? null });
      else if (reply.pairing) {
        back.current = { phase, detail };
        show("pairing", { pairing: reply.pairing });
      } else setProblem(reply.message ?? "That Omni cannot approve this app from here. Connect Omni, next, can use its API key.");
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(null);
    }
  };
  (0, import_react4.useEffect)(() => {
    if (phase !== "pairing") return void 0;
    let timer = 0;
    let alive = true;
    const tick = async () => {
      try {
        const reply = await callOmniUi("omni-pair-poll");
        if (!alive) return;
        if (reply.status === "paired") return show("linked", { origin: reply.origin ?? null });
        if (reply.status !== "pending") {
          setProblem(reply.status === "denied" ? "The sign-in was denied." : "The code expired. Try again for a new one.");
          return show(back.current?.phase ?? "none", back.current?.detail ?? null);
        }
      } catch (error) {
        if (alive) setProblem(error.message);
      }
      if (alive) timer = setTimeout(tick, detail?.pairing?.pollIntervalMs ?? 2e3);
    };
    timer = setTimeout(tick, detail?.pairing?.pollIntervalMs ?? 2e3);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase]);
  return {
    phase,
    detail,
    busy,
    problem,
    toggle: () => phase === "asleep" ? on2() : off(),
    use: (omni) => connect(omni.id, "omni-discover-use", { id: omni.id }),
    remote: (wanted) => wanted.kind === "bad-link" ? setProblem("That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…") : wanted.kind === "grant" ? connect("remote", "omni-connect-grant", { url: wanted.url, grant: wanted.grant }) : connect("remote", "omni-pair-start", { url: wanted.url }),
    cancelPairing: () => {
      void callOmniUi("omni-pair-cancel").catch(() => {
      });
      show(back.current?.phase ?? "none", back.current?.detail ?? null);
    }
  };
}
function teamOrder(preload) {
  return preload === "genie" ? ["genie", "omni"] : ["omni", "genie"];
}
var preselected = (preload) => ({ omni: preload === "omni", genie: preload === "genie" });
var powersOnByItself = (preload, phase, detail, started) => preselected(preload).omni && !started && phase === "asleep" && detail?.removed !== true;
function joinedLabel({ omni, genie }, name) {
  const who = [omni && "Omni", genie && "Genie"].filter(Boolean);
  return who.length === 0 ? `Continue with just ${name}` : `Continue with ${who.join(" and ")}`;
}
var speechOf = (phase, name, origin) => ({
  asleep: `${name} here! Omni is asleep. Press its power button to bring it along.`,
  waking: "Omni is waking up…",
  installing: "Bringing Omni into this DSH. One moment.",
  starting: "Omni is starting up…",
  looking: "Omni is looking for a connection…",
  found: "Omni found where your channels live!",
  none: "No Omni here yet. Tell Omni where yours lives.",
  pairing: "Approve this device, and Omni connects.",
  linked: origin ? `Omni is connected to ${origin}!` : "Omni is connected!",
  restart: "Omni is installed. Restart DSH to wake it.",
  failed: "Omni could not be installed here."
})[phase];
function TeamStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const [glitching, glitch] = useGlitch();
  const power = usePower();
  const [omniType, setOmniType] = (0, import_react4.useState)(null);
  const [abilities, setAbilities] = (0, import_react4.useState)({});
  const [live, setLive] = (0, import_react4.useState)(void 0);
  const [saving, setSaving] = (0, import_react4.useState)(false);
  const [problem, setProblem] = (0, import_react4.useState)(null);
  const [genieChoice, setGenieChoice] = (0, import_react4.useState)(null);
  const autoPowered = (0, import_react4.useRef)(false);
  const { phase } = power;
  const awakeNow = phase === "looking" || phase === "linked";
  (0, import_react4.useEffect)(() => {
    call("bot-type", { type: "omni" }).then(setOmniType, () => {
    });
  }, [awakeNow]);
  (0, import_react4.useEffect)(() => {
    callOmniUi("omni-overview", {}).then(setLive, () => setLive(null));
  }, []);
  (0, import_react4.useEffect)(() => {
    if (phase !== "linked") return;
    callOmniUi("omni-overview", {}).then(setLive, () => setLive(null));
    glitch();
  }, [phase, glitch]);
  (0, import_react4.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  (0, import_react4.useEffect)(() => {
    if (!state || !powersOnByItself(state.preload, power.phase, power.detail, autoPowered.current)) return;
    autoPowered.current = true;
    power.toggle();
  }, [state]);
  if (!state) return null;
  const name = state.companionName ?? "Your companion";
  const omni = phase !== "asleep" && phase !== "failed";
  const genie = genieChoice ?? preselected(state.preload).genie;
  const working = ["waking", "installing", "starting", "looking"].includes(phase);
  const local = () => go2({ omni: true });
  async function go2({ omni: joined = omni } = {}) {
    setSaving(true);
    setProblem(null);
    try {
      await call("team-save", { omni: joined, genie, omniAbilities: { ...abilitiesOf(omniType), ...abilities } });
      finish2();
    } catch (error) {
      setProblem(error.message);
      setSaving(false);
    }
  }
  const omniPower = { ...power, local };
  return (0, import_react4.createElement)(
    Stage,
    {
      title: "Grow your team",
      speech: speechOf(phase, name, power.detail?.origin),
      at: "omni-team",
      glitching,
      wide: true
    },
    (0, import_react4.createElement)("p", { className: "oai-lede" }, `${name} leads. Who comes along?`),
    (0, import_react4.createElement)(
      "div",
      { className: "oai-select" },
      ...teamOrder(state.preload).map((id) => id === "omni" ? (0, import_react4.createElement)(OmniCard, { key: "omni", power: omniPower, onPower: power.toggle, type: omniType, abilities, onToggle: (row, on2) => setAbilities((rows) => ({ ...rows, [row]: on2 })), live }) : (0, import_react4.createElement)(
        "article",
        { key: "genie", className: `oai-fighter oai-genie oai-locked${genie ? " oai-chosen" : ""}` },
        (0, import_react4.createElement)(
          Machine,
          { kind: "genie", phase: "asleep" },
          (0, import_react4.createElement)("div", { className: "oai-genie-wrap" }, (0, import_react4.createElement)(GeniePet, { expression: genieExpressionOf(genie) }))
        ),
        (0, import_react4.createElement)(
          "header",
          null,
          (0, import_react4.createElement)("h2", null, "Genie"),
          genie ? (0, import_react4.createElement)("span", { className: "oai-team-line" }, (0, import_react4.createElement)("span", { className: "oai-on-team" }, (0, import_react4.createElement)(Check), "On your team"), (0, import_react4.createElement)("button", { type: "button", className: "oai-remove", onClick: () => setGenieChoice(false) }, "Remove")) : (0, import_react4.createElement)("button", { type: "button", className: "oai-remove", onClick: () => setGenieChoice(true) }, "Add")
        ),
        (0, import_react4.createElement)(
          "p",
          { className: "oai-about oai-wish" },
          (0, import_react4.createElement)("img", { className: "oai-wish-lamp", src: LAMP, alt: "", draggable: false }),
          "Give it a wish, get one delivery."
        ),
        (0, import_react4.createElement)(StartsWith, { type: GENIE_TYPE })
      ))
    ),
    problem ? (0, import_react4.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react4.createElement)(
      "div",
      { className: "oai-actions" },
      (0, import_react4.createElement)(
        "button",
        { type: "button", className: "oai-primary oai-big", disabled: saving || working, onClick: () => go2() },
        saving ? "Bringing them in…" : working ? "Omni is waking…" : joinedLabel({ omni, genie }, name)
      )
    )
  );
}

// src/client/onboard-css.js
var ONBOARD_CSS = `
.oai-stage.oai-wide{width:min(980px,100%)}
.oai-hero{width:132px;height:132px;display:grid;place-items:center;animation:oai-float 4.5s ease-in-out infinite}
.oai-hero svg{width:132px;height:132px;filter:drop-shadow(0 10px 8px var(--oai-cast)) drop-shadow(0 22px 22px var(--oai-cast-far))}
.oai-hero .oai-octo{width:126px;height:126px;animation:none}
.oai-hero-img{width:132px;height:132px;object-fit:cover;border-radius:30px 34px 29px 33px;box-shadow:0 5px 0 color-mix(in srgb,var(--oai-clay) var(--oai-ledge),var(--oai-umber)),0 12px 16px var(--oai-cast)}
.oai-hatch{animation:oai-hatch 1s cubic-bezier(.2,1.4,.4,1) both}
@keyframes oai-hatch{0%{transform:scale(.6) rotate(-8deg)}60%{transform:scale(1.18) rotate(3deg)}100%{transform:scale(1)}}
/* Before a look is chosen: an egg of the two clays, cyan and magenta, kneaded together. */
.oai-egg{position:relative}
.oai-egg-shell{width:84px;height:104px;border-radius:50% 50% 46% 46%/58% 58% 42% 42%;background:radial-gradient(circle at 36% 28%,color-mix(in srgb,var(--oai-cyan) 40%,var(--oai-shine)) 0,var(--oai-cyan) 34%,color-mix(in srgb,var(--oai-cyan) 50%,var(--oai-pink)) 62%,var(--oai-pink) 100%);box-shadow:inset 4px 5px 8px color-mix(in srgb,var(--oai-cyan) 40%,var(--oai-shine)),inset -6px -8px 12px color-mix(in srgb,var(--oai-pink) 70%,var(--oai-umber)),0 10px 10px var(--oai-cast),0 22px 26px var(--oai-cast-far);animation:oai-wobble 2.6s ease-in-out infinite}
@keyframes oai-wobble{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg) translateY(-4px)}}
.oai-spark{position:absolute;width:7px;height:7px;border-radius:50%;${raised("var(--oai-cyan)", 1)};animation:oai-twinkle-dot 2.4s ease-in-out infinite}
.oai-spark-0{top:8px;left:16px}.oai-spark-1{top:22px;right:10px;animation-delay:.5s}.oai-spark-2{bottom:16px;left:6px;animation-delay:1s;background:var(--oai-pink)}.oai-spark-3{bottom:6px;right:22px;animation-delay:1.5s}.oai-spark-4{top:52px;right:-4px;animation-delay:.8s;background:var(--oai-pink)}
@keyframes oai-twinkle-dot{0%,100%{opacity:.35;transform:scale(.7)}50%{opacity:1;transform:scale(1.1)}}
.oai-lede{color:var(--oai-ink2);margin:0 0 16px}
/* Two-way choice: a groove with a lilac bead in it. */
.oai-seg{display:inline-flex;padding:5px;border-radius:16px 18px 15px 17px;${recessed("var(--oai-niche)")};gap:4px;margin-bottom:16px}
.oai-card .oai-seg button{width:auto;min-height:40px;margin:0;white-space:nowrap;background:transparent;box-shadow:none;color:var(--oai-ink2);font-weight:600;font-size:14px;padding:9px 16px;border-radius:12px 13px 11px 13px;transform:none}
.oai-card .oai-seg button:active:not(:disabled){transform:none;box-shadow:none}
.oai-card .oai-seg button[aria-selected="true"]{${raised("var(--oai-lilac)", 3)};color:var(--oai-lilac-ink);transform:translateY(-2px)}
.oai-describe,.oai-pick,.oai-name{display:grid;gap:10px;margin-bottom:16px}
.oai-describe label,.oai-name label{font-size:13px;color:var(--oai-ink2)}
.oai-describe textarea,.oai-name input{width:100%;border:0;${recessed("var(--oai-niche)")};border-radius:var(--oai-r-sm);color:var(--oai-ink);padding:11px 14px;font:inherit;resize:vertical}
.oai-describe textarea:focus,.oai-name input:focus{outline:3px solid var(--oai-ring);outline-offset:2px}
.oai-name .oai-row{display:grid;gap:10px}
.oai-chips{display:flex;flex-wrap:wrap;gap:8px}
.oai-card button.oai-chip{display:inline-block;width:auto;min-height:32px;margin:0;font-weight:500;${raised("var(--oai-clay)", 2)};color:var(--oai-ink);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.oai-card button.oai-chip:active:not(:disabled){${pressed("var(--oai-clay)", 2)}}
.oai-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.oai-muted{color:var(--oai-ink2);font-size:13px;margin:0}
.oai-note{color:var(--oai-ink);border-radius:var(--oai-r-sm);${recessed("color-mix(in srgb,#f2c25b 30%,var(--oai-niche))")};padding:10px 12px;font-size:13.5px;margin:0}
.oai-drawing{height:8px;border-radius:999px;${recessed("var(--oai-niche)")};background-image:linear-gradient(90deg,transparent,var(--oai-cyan),var(--oai-pink),transparent);background-size:200% 100%;animation:oai-shimmer 1.2s linear infinite}
@keyframes oai-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
/* The characters to pick from: each in its own little dish. */
.oai-shapes{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:10px}
.oai-card button.oai-shape{width:auto;min-height:0;margin:0;aspect-ratio:1;${raised("var(--oai-clay)", 3)};border-radius:16px 18px 15px 17px;padding:4px;display:grid;place-items:center;cursor:pointer}
.oai-card button.oai-shape[aria-checked="true"]{${raised("var(--oai-lilac)", 3)};transform:translateY(-2px)}
.oai-swatches{display:flex;flex-wrap:wrap;gap:10px}
.oai-card button.oai-swatch{display:inline-block;width:28px;height:28px;min-height:0;margin:0;padding:0;border-radius:50%;corner-shape:round;cursor:pointer;box-shadow:inset 2px 3px 3px rgba(255,255,255,.45),inset -2px -3px 4px rgba(0,0,0,.22),0 2px 0 rgba(0,0,0,.18),0 4px 5px var(--oai-cast)}
.oai-card button.oai-swatch[aria-checked="true"]{outline:3px solid var(--oai-ink);outline-offset:3px;transform:translateY(-2px)}
.oai-error{color:var(--oai-bad);margin:0 0 10px}
.oai-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.oai-big{padding:13px 22px;font-size:15px}
/* Who joins: one card per Bot type. A chosen card stands up on a lilac rim. */
.oai-select{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-bottom:14px;align-items:start}
.oai-fighter{position:relative;display:grid;gap:12px;align-content:start;padding:16px;border-radius:24px 27px 23px 26px;${raised("var(--oai-clay)", 4)};transition:transform .3s cubic-bezier(.3,1.4,.5,1),box-shadow .3s ease}
.oai-fighter.oai-chosen{${raised("color-mix(in srgb,var(--oai-lilac) 55%,var(--oai-clay))", 5)};transform:translateY(-3px)}
.oai-fighter header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px}
.oai-fighter h2{margin:0;font:800 21px/1.2 var(--oai-head);letter-spacing:-.02em}
.oai-fighter p{margin:0;color:var(--oai-ink2);font-size:14px}
.oai-about{font-size:13.5px!important}
/* A wish is the clay lamp it comes out of. */
.oai-wish{display:flex;align-items:center;gap:10px}
.oai-wish-lamp{flex:none;width:46px;height:auto;filter:drop-shadow(0 3px 2px rgba(91,59,34,.18));-webkit-user-drag:none;user-select:none}
/* The niche: a hollow in the card where the character rests. Asleep, the light leaves it. */
.oai-box{position:relative;height:340px;display:grid;grid-template-rows:32px 136px 24px 1fr;padding:12px 14px 14px;border-radius:20px 23px 19px 22px;overflow:hidden;
  ${recessed("color-mix(in srgb,var(--oai-cyan) 9%,var(--oai-card))")};transition:background-color .6s ease}
.oai-box.oai-is-asleep{${recessed("color-mix(in srgb,var(--oai-niche) 90%,var(--oai-umber))")}}
body[data-ds-dark-theme] .oai-box.oai-is-asleep{${recessed("var(--oai-niche)")}}
.oai-chosen .oai-box.oai-box-genie{${recessed("color-mix(in srgb,var(--oai-pink) 12%,var(--oai-card))")}}
.oai-box-top{display:flex;align-items:center;justify-content:space-between}
/* Three clay beads: power, plugins, connection. */
.oai-lights{display:flex;gap:7px;padding-left:4px}
.oai-light{width:9px;height:9px;border-radius:50%;font-style:normal;background:color-mix(in srgb,var(--oai-niche) 80%,var(--oai-umber));box-shadow:inset 1px 1px 2px rgba(0,0,0,.25);transition:background-color .3s,box-shadow .3s}
.oai-light-on{background:var(--oai-ok);box-shadow:inset 1px 1px 1px rgba(255,255,255,.55),inset -1px -1px 2px rgba(0,0,0,.25),0 0 6px color-mix(in srgb,var(--oai-ok) 60%,transparent)}
.oai-light-busy{background:var(--oai-cyan);box-shadow:inset 1px 1px 1px rgba(255,255,255,.55),inset -1px -1px 2px rgba(0,0,0,.25),0 0 6px color-mix(in srgb,var(--oai-cyan) 70%,transparent);animation:oai-blink-light 1s steps(2) infinite}
.oai-light-warn{background:var(--oai-warn);box-shadow:inset 1px 1px 1px rgba(255,255,255,.5),inset -1px -1px 2px rgba(0,0,0,.25)}
@keyframes oai-blink-light{50%{opacity:.35}}
.oai-is-waking .oai-light{animation:oai-light-up .3s ease-out both}
.oai-is-waking .oai-light:nth-child(2){animation-delay:.3s}.oai-is-waking .oai-light:nth-child(3){animation-delay:.6s}
@keyframes oai-light-up{to{background:var(--oai-ok)}}
/* The power button: a round clay button. Asleep it breathes to say "press me". */
.oai-card button.oai-power{display:grid;place-items:center;width:34px;height:34px;min-height:0;margin:0;padding:0;border-radius:50%;corner-shape:round;${raised("var(--oai-card)", 3)};color:var(--oai-accent)}
.oai-is-asleep button.oai-power{animation:oai-call 2.4s ease-in-out infinite}
@keyframes oai-call{0%,100%{transform:none}50%{transform:translateY(-2px) scale(1.06)}}
.oai-card button.oai-power.on{${raised("var(--oai-cyan)", 2)};color:var(--oai-cyan-ink);transform:translateY(1px)}
.oai-card button.oai-power:active:not(:disabled){${pressed("var(--oai-card)", 3)}}
.oai-screen{position:relative;display:grid;place-items:end center}
.oai-octo-wrap{position:relative;width:122px;height:122px}
.oai-octo-wrap .oai-octo{position:absolute;inset:0;width:122px;height:122px;animation:oai-float 4.5s ease-in-out infinite}
.oai-is-asleep .oai-octo-wrap .oai-octo{animation:oai-slump 5.2s ease-in-out infinite}
@keyframes oai-slump{0%,100%{transform:translateY(6px) rotate(-7deg) scale(1,.95)}50%{transform:translateY(3px) rotate(-6deg) scale(1.01,.97)}}
.oai-is-waking .oai-octo-wrap .oai-octo{animation:oai-rise-up .9s cubic-bezier(.2,1.3,.4,1) both,oai-float 4.5s ease-in-out .9s infinite}
@keyframes oai-rise-up{0%{transform:translateY(6px) rotate(-7deg)}60%{transform:translateY(-8px) rotate(2deg)}100%{transform:none}}
.oai-closed{display:none}.oai-is-asleep .oai-closed{display:inline}.oai-is-asleep .oai-eyes{display:none}
.oai-is-waking .oai-eyes{animation:oai-open .5s cubic-bezier(.3,1.5,.5,1) both}
@keyframes oai-open{from{transform:scaleY(.08)}to{transform:scaleY(1)}}
/* Genie, from its row of faces (vendor/clay-art.js); asleep is its own face, never dimmed. */
.oai-genie-wrap{align-self:center;justify-self:center;width:118px;height:128px}
.oai-genie-pet{width:100%;height:100%;animation:oai-float 5s ease-in-out infinite}
.oai-genie-pet[data-face=asleep]{animation-duration:6.5s}
.oai-zzz i{position:absolute;left:57%;top:46%;font:800 15px/1 var(--oai-head);font-style:normal;color:var(--oai-ink2);opacity:0;animation:oai-z 3.6s ease-in infinite}
.oai-zzz i:nth-child(2){animation-delay:1.2s;font-size:12px}.oai-zzz i:nth-child(3){animation-delay:2.4s;font-size:10px}
@keyframes oai-z{0%{transform:translate(0,0);opacity:0}20%{opacity:.85}100%{transform:translate(24px,-54px);opacity:0}}
.oai-scan{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.oai-scan i{position:absolute;width:56px;height:56px;border-radius:50%;border:2px solid color-mix(in srgb,var(--oai-cyan) 80%,var(--oai-ink));opacity:0;animation:oai-ping 2.1s cubic-bezier(.2,.6,.4,1) infinite}
.oai-scan i:nth-child(2){animation-delay:.7s;border-color:color-mix(in srgb,var(--oai-pink) 80%,var(--oai-ink))}.oai-scan i:nth-child(3){animation-delay:1.4s}
@keyframes oai-ping{0%{transform:scale(.4);opacity:.9}100%{transform:scale(3.6);opacity:0}}
.oai-status{align-self:center;margin:0!important;text-align:center;font:600 13px/1.3 var(--oai-font)!important;color:var(--oai-ink)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-is-asleep .oai-status,.oai-box-genie .oai-status{color:var(--oai-ink2)!important}
.oai-working::after{content:"";display:inline-block;width:7px;height:7px;margin-left:8px;vertical-align:1px;border-radius:50%;background:var(--oai-accent-2);animation:oai-caret 1s steps(1) infinite}
.oai-inside{min-height:0;overflow:auto;display:grid;align-content:center;gap:6px;padding-top:4px}
.oai-inside-note{margin:0!important;text-align:center;font-size:12.5px!important;color:var(--oai-ink2)!important;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.oai-inside-note.oai-bad{color:var(--oai-bad)!important}
.oai-install{list-style:none;margin:0;padding:0;display:flex;justify-content:center;gap:14px;font-size:12.5px;color:var(--oai-ink2)}
.oai-install li{display:flex;align-items:center;gap:6px}
.oai-install-dot{display:grid;place-items:center;width:16px;height:16px;border-radius:50%;${recessed("var(--oai-niche)")}}
.oai-install-done{color:var(--oai-ink)}.oai-install-done .oai-install-dot{${raised("var(--oai-ok)", 1)};color:var(--oai-card)}
.oai-install-now{color:var(--oai-ink);font-weight:600}.oai-install-now .oai-install-dot{border:2px solid color-mix(in srgb,var(--oai-cyan) 35%,transparent);border-top-color:var(--oai-accent);box-shadow:none;background:none;animation:oai-spin .8s linear infinite}
.oai-install-next{opacity:.6}
@keyframes oai-spin{to{transform:rotate(360deg)}}
.oai-found-box{display:grid;gap:6px;justify-items:center}
.oai-found-list{list-style:none;margin:0;padding:0;display:grid;gap:8px;width:100%}
.oai-found-row{display:flex;align-items:center;gap:10px;padding:7px 7px 7px 12px;border-radius:14px 16px 13px 15px;${raised("var(--oai-card)", 3)}}
.oai-found-row.oai-quiet{box-shadow:none;background:none;opacity:.65}
.oai-found-what{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.oai-found-what strong{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-found-what small{font-size:11.5px;color:var(--oai-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-card .oai-pill,.oai-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:auto;min-height:32px;margin:0;padding:6px 14px;border:0;border-radius:999px;${raised("var(--oai-clay)", 3)};color:var(--oai-ink);font:inherit;font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap;cursor:pointer}
.oai-card .oai-pill-primary,.oai-pill-primary{${raised("var(--oai-cyan)", 3)};color:var(--oai-cyan-ink)}
.oai-card button.oai-textlink{display:inline;width:auto;min-height:0;margin:0;padding:0;border:0;background:none;box-shadow:none;color:var(--oai-accent);font-size:13px;font-weight:600;transform:none;justify-self:center}
.oai-card button.oai-textlink:active:not(:disabled){transform:none;box-shadow:none}
.oai-elsewhere{display:grid;gap:8px}
.oai-elsewhere .oai-field input{min-height:36px;padding:7px 12px;font-size:13px}
.oai-pairing{display:grid;gap:8px;justify-items:center}
.oai-pair-code{font:700 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:var(--oai-ink)}
.oai-menu{display:grid;gap:6px}
.oai-menu-label{font:700 10.5px/1 var(--oai-head);letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-menu-preview{list-style:none;margin:0;padding:8px 10px;border-radius:var(--oai-r-sm);${raised("var(--oai-card)", 2)};display:grid;gap:4px;font-size:12.5px}
.oai-menu-preview li{display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oai-dot{width:8px;height:8px;border-radius:50%;flex:none}.oai-dot.ok{background:var(--oai-ok)}.oai-dot.warn{background:var(--oai-warn)}
.oai-team-line{display:inline-flex;align-items:center;gap:10px}
.oai-on-team{display:inline-flex;align-items:center;gap:5px;color:var(--oai-ok);font-weight:700;font-size:13px}
.oai-card button.oai-remove{width:auto;min-height:30px;margin:0;padding:4px 12px;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--oai-ink);${raised("var(--oai-card)", 2)}}
.oai-card button.oai-remove:active:not(:disabled){${pressed("var(--oai-card)", 2)}}
.oai-starts summary{cursor:pointer;color:var(--oai-ink2);font-size:13px;list-style:none;display:flex;align-items:center;gap:6px;min-height:28px;border-radius:8px}
.oai-starts summary:focus-visible{outline:3px solid var(--oai-ring);outline-offset:2px}
.oai-starts summary::-webkit-details-marker{display:none}
.oai-starts summary::before{content:"›";display:inline-block;transition:transform .15s;color:var(--oai-accent);font-weight:700}
.oai-starts[open] summary::before{transform:rotate(90deg)}
.oai-starts[open] summary{margin-bottom:8px}
.oai-core{font:700 10px/1 var(--oai-font);letter-spacing:.08em;text-transform:uppercase;color:var(--oai-cyan-ink);background:color-mix(in srgb,var(--oai-cyan) 55%,var(--oai-card));border-radius:999px;padding:4px 8px;white-space:nowrap}
.oai-caps{display:grid;gap:12px;padding-top:6px;border-top:2px solid color-mix(in srgb,var(--oai-line) 70%,transparent)}
.oai-cap-group h3{margin:8px 0 6px;font:700 11px/1 var(--oai-head);letter-spacing:.14em;text-transform:uppercase;color:var(--oai-ink2)}
.oai-cap-group ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.oai-cap{display:flex;align-items:center;gap:10px;font-size:13.5px}
.oai-cap.oai-off .oai-cap-what{opacity:.55}
.oai-cap-what{flex:1;min-width:0;display:flex;flex-direction:column}
.oai-cap-what strong{font-weight:600}
.oai-cap-what small{color:var(--oai-ink2);font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis}
.oai-cap-what code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--oai-accent);overflow-wrap:anywhere}
.oai-cap-empty{font-size:12.5px!important}
.oai-version{flex:none;font:11px/1 ui-monospace,Menlo,monospace;color:var(--oai-ink2);padding:4px 8px;border-radius:999px;${recessed("var(--oai-niche)")}}
.oai-version.oai-pending{opacity:.7}
.oai-tick{flex:none;display:grid;place-items:center;color:var(--oai-ok)}
@media (prefers-reduced-motion: reduce){.oai-hero,.oai-egg-shell,.oai-spark,.oai-octo-wrap .oai-octo,.oai-genie-pet,.oai-drawing,.oai-zzz i,.oai-scan i,.oai-power,.oai-eyes,.oai-light,.oai-box,.oai-fighter{animation:none!important;transition:none!important}.oai-scan i:nth-child(n+2){display:none}.oai-zzz i{opacity:.7}.oai-zzz i:nth-child(2){transform:translate(12px,-22px)}.oai-zzz i:nth-child(3){transform:translate(22px,-40px)}.oai-scan i{opacity:.6;transform:scale(2.2)}.oai-is-asleep .oai-octo-wrap .oai-octo{transform:translateY(6px) rotate(-7deg)}}
`;

// src/client/subscriptions.js
var import_react5 = require("react");
var BASE = "dsh-subscriptions";
var SUBSCRIPTION_TILES = [
  { id: "perplexity", provider: "perplexity", name: "Perplexity", note: "Perplexity Pro", kind: "browser" },
  { id: "jetbrains", provider: "jetbrains", name: "JetBrains AI", note: "Your JetBrains AI plan", kind: "browser" },
  { id: "cursor", provider: "cursor", name: "Cursor", note: "Your Cursor plan", kind: "token", where: "https://cursor.com/settings", what: "Cursor session token" },
  { id: "kiro", provider: "kiro", name: "Kiro", note: "AWS Kiro", kind: "token", where: "https://kiro.dev", what: "Kiro token" },
  { id: "glm", provider: "glm", name: "Zhipu GLM", note: "GLM coding plan", kind: "token", where: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", what: "GLM API key" },
  { id: "qwen", provider: "qwen", name: "Qwen", note: "Alibaba Bailian", kind: "token", where: "https://bailian.console.aliyun.com/", what: "DashScope API key" },
  { id: "cody", provider: "cody", name: "Sourcegraph Cody", note: "Cody Pro", kind: "token", where: "https://sourcegraph.com/user/settings/tokens", what: "Sourcegraph access token" },
  { id: "replit", provider: "replit", name: "Replit", note: "Replit Core", kind: "token", where: "https://replit.com/account", what: "Replit token" }
];
async function request(path, init) {
  let response;
  try {
    response = await fetch(`${BASE}/${path}`, { credentials: "same-origin", ...init });
  } catch {
    throw new Error("Could not reach the subscriptions plugin.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}
var post = (path, payload) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
async function subscriptionAccounts() {
  try {
    return (await request("config")).accounts ?? [];
  } catch {
    return null;
  }
}
function nextIndex(accounts, provider) {
  const own = (accounts ?? []).filter((account) => account.provider === provider);
  const free = own.find((account) => !account.configured);
  if (free) return free.index;
  return own.reduce((top, account) => Math.max(top, account.index), 0) + 1;
}
var signedInCount = (accounts, provider) => (accounts ?? []).filter((account) => account.provider === provider && account.configured).length;
function SubscriptionSignIn({ tile, onBack, onSaved, glitch }) {
  const [step, setStep] = (0, import_react5.useState)(null);
  const [problem, setProblem] = (0, import_react5.useState)(null);
  const [value, setValue] = (0, import_react5.useState)("");
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [index, setIndex] = (0, import_react5.useState)(null);
  (0, import_react5.useEffect)(() => {
    let live = true;
    let timer = 0;
    const done = () => {
      if (!live) return;
      glitch();
      onSaved({ name: tile.name });
    };
    const start = async () => {
      try {
        const slot = nextIndex(await subscriptionAccounts(), tile.provider);
        if (!live) return;
        setIndex(slot);
        if (tile.kind === "device") {
          const device = await post("oauth/device/start", { provider: tile.provider, index: slot });
          if (!live) return;
          setStep({ code: device.userCode, url: device.authUrl });
          const every = Math.max(device.intervalMs ?? 5e3, 2e3);
          const poll = async () => {
            try {
              const out = await post("oauth/device/poll", { state: device.state });
              if (out.status === "authorized") return done();
              if (!live) return;
              if (out.status === "expired") return setProblem("The code expired before the sign-in finished. Go back and start again.");
              setProblem(null);
            } catch (error) {
              if (!live) return;
              setProblem(error.message);
            }
            timer = setTimeout(poll, every);
          };
          timer = setTimeout(poll, every);
        } else if (tile.kind === "browser") {
          const started = await request(`oauth/start?provider=${encodeURIComponent(tile.provider)}&index=${slot}`);
          if (!live) return;
          setStep({ url: started.url, state: started.state, autoCatch: started.autoCatch });
          const watch = async () => {
            const accounts = await subscriptionAccounts();
            if (accounts?.some((account) => account.provider === tile.provider && account.index === slot && account.configured)) return done();
            if (live) timer = setTimeout(watch, 2e3);
          };
          timer = setTimeout(watch, 2e3);
        } else setStep({ url: tile.where });
      } catch (error) {
        if (live) setProblem(error.message);
      }
    };
    start();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tile.provider]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (tile.kind === "token") await post("import-token", { provider: tile.provider, index, apiKey: value.trim() });
      else {
        const pasted = value.trim();
        await post("oauth/complete", { provider: tile.provider, index, state: step.state, .../^https?:\/\//i.test(pasted) ? { url: pasted } : { code: pasted } });
      }
      setValue("");
      glitch();
      onSaved({ name: tile.name });
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react5.createElement)(
    "div",
    { className: "oai-signin" },
    !step && !problem ? (0, import_react5.createElement)("p", { className: "oai-muted" }, `Starting the ${tile.name} sign-in…`) : null,
    step?.code ? (0, import_react5.createElement)("p", null, `Open ${tile.name}, sign in, and enter this code:`) : null,
    step?.code ? (0, import_react5.createElement)("div", { className: "oai-code" }, (0, import_react5.createElement)("code", null, step.code)) : null,
    step?.url && tile.kind !== "token" ? (0, import_react5.createElement)("a", { className: "oai-primary oai-button", href: step.url, target: "_blank", rel: "noreferrer" }, `Open ${tile.name} to sign in`) : null,
    tile.kind === "device" && step ? (0, import_react5.createElement)("p", { className: "oai-muted oai-waiting" }, "Waiting for you to finish signing in…") : null,
    tile.kind === "browser" && step ? (0, import_react5.createElement)("p", { className: "oai-muted" }, step.autoCatch ? "Sign in on their page; this finishes on its own. If it ends on a page that does not load, paste its address here." : "Sign in on their page, then paste the address it ends on here.") : null,
    tile.kind === "token" && step ? (0, import_react5.createElement)("p", null, `Copy your ${tile.what} from `, (0, import_react5.createElement)("a", { className: "oai-link", href: tile.where, target: "_blank", rel: "noreferrer" }, tile.name), " and paste it here. It stays in DSH's credential store on this computer.") : null,
    step && tile.kind !== "device" ? (0, import_react5.createElement)(
      "form",
      { onSubmit: submit },
      (0, import_react5.createElement)("label", { htmlFor: "oai-sub-value" }, tile.kind === "token" ? tile.what : "The address you landed on"),
      (0, import_react5.createElement)("input", { id: "oai-sub-value", type: tile.kind === "token" ? "password" : "text", required: true, autoComplete: "off", spellCheck: false, value, onChange: (e) => setValue(e.target.value) }),
      (0, import_react5.createElement)("button", { type: "submit", className: tile.kind === "token" ? "oai-primary" : "", disabled: busy }, busy ? "Connecting…" : "Connect")
    ) : null,
    problem ? (0, import_react5.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    (0, import_react5.createElement)("button", { type: "button", className: "oai-quiet", onClick: onBack }, "Back")
  );
}

// node_modules/@xterm/xterm/css/xterm.css
var xterm_default = `/**
 * Copyright (c) 2014 The xterm.js authors. All rights reserved.
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * https://github.com/chjj/term.js
 * @license MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 *   The original design remains. The terminal itself
 *   has been extended to include xterm CSI codes, among
 *   other features.
 */

/**
 *  Default styles for xterm.js
 */

.xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
}

.xterm.focus,
.xterm:focus {
    outline: none;
}

.xterm .xterm-helpers {
    position: absolute;
    top: 0;
    /**
     * The z-index of the helpers must be higher than the canvases in order for
     * IMEs to appear on top.
     */
    z-index: 5;
}

.xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    /* Move textarea out of the screen to the far left, so that the cursor is not visible */
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    /** Prevent wrapping so the IME appears against the textarea at the correct position */
    white-space: nowrap;
    overflow: hidden;
    resize: none;
}

.xterm .composition-view {
    /* TODO: Composition position got messed up somewhere */
    background: #000;
    color: #FFF;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
}

.xterm .composition-view.active {
    display: block;
}

.xterm .xterm-viewport {
    /* On OS X this is required in order for the scroll bar to appear fully opaque */
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
}

.xterm .xterm-screen {
    position: relative;
}

.xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
}

.xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
}

.xterm.enable-mouse-events {
    /* When mouse events are enabled (eg. tmux), revert to the standard pointer cursor */
    cursor: default;
}

.xterm.xterm-cursor-pointer,
.xterm .xterm-cursor-pointer {
    cursor: pointer;
}

.xterm.column-select.focus {
    /* Column selection mode */
    cursor: crosshair;
}

.xterm .xterm-accessibility:not(.debug),
.xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
}

.xterm .xterm-accessibility-tree:not(.debug) *::selection {
  color: transparent;
}

.xterm .xterm-accessibility-tree {
  font-family: monospace;
  user-select: text;
  white-space: pre;
}

.xterm .xterm-accessibility-tree > div {
  transform-origin: left;
  width: fit-content;
}

.xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
}

.xterm-dim {
    /* Dim should not apply to background, so the opacity of the foreground color is applied
     * explicitly in the generated class and reset to 1 here */
    opacity: 1 !important;
}

.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }

.xterm-overline {
    text-decoration: overline;
}

.xterm-overline.xterm-underline-1 { text-decoration: overline underline; }
.xterm-overline.xterm-underline-2 { text-decoration: overline double underline; }
.xterm-overline.xterm-underline-3 { text-decoration: overline wavy underline; }
.xterm-overline.xterm-underline-4 { text-decoration: overline dotted underline; }
.xterm-overline.xterm-underline-5 { text-decoration: overline dashed underline; }

.xterm-strikethrough {
    text-decoration: line-through;
}

.xterm-screen .xterm-decoration-container .xterm-decoration {
	z-index: 6;
	position: absolute;
}

.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer {
	z-index: 7;
}

.xterm-decoration-overview-ruler {
    z-index: 8;
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
}

.xterm-decoration-top {
    z-index: 2;
    position: relative;
}



/* Derived from vs/base/browser/ui/scrollbar/media/scrollbar.css */

/* xterm.js customization: Override xterm's cursor style */
.xterm .xterm-scrollable-element > .scrollbar {
    cursor: default;
}

/* Arrows */
.xterm .xterm-scrollable-element > .scrollbar > .scra {
	cursor: pointer;
	font-size: 11px !important;
}

.xterm .xterm-scrollable-element > .visible {
	opacity: 1;

	/* Background rule added for IE9 - to allow clicks on dom node */
	background:rgba(0,0,0,0);

	transition: opacity 100ms linear;
	/* In front of peek view */
	z-index: 11;
}
.xterm .xterm-scrollable-element > .invisible {
	opacity: 0;
	pointer-events: none;
}
.xterm .xterm-scrollable-element > .invisible.fade {
	transition: opacity 800ms linear;
}

/* Scrollable Content Inset Shadow */
.xterm .xterm-scrollable-element > .shadow {
	position: absolute;
	display: none;
}
.xterm .xterm-scrollable-element > .shadow.top {
	display: block;
	top: 0;
	left: 3px;
	height: 3px;
	width: 100%;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 0 6px 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.left {
	display: block;
	top: 3px;
	left: 0;
	height: 100%;
	width: 3px;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.top-left-corner {
	display: block;
	top: 0;
	left: 0;
	height: 3px;
	width: 3px;
}
.xterm .xterm-scrollable-element > .shadow.top.left {
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
`;

// src/client/terminal.js
var import_react6 = require("react");
var READ_MS = 150;
var ROWS = 10;
var FONT = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
var THEME = {
  background: "#05080e",
  foreground: "#cfe3ee",
  cursor: "#22d3ee",
  cursorAccent: "#05080e",
  selectionBackground: "#1f4b5c",
  black: "#0b111d",
  red: "#ff6b6b",
  green: "#4fe0a8",
  yellow: "#f0c86a",
  blue: "#5fa8f0",
  magenta: "#ff3bd4",
  cyan: "#22d3ee",
  white: "#cfe3ee",
  brightBlack: "#5d6b82",
  brightRed: "#ff8f8f",
  brightGreen: "#7ef0c2",
  brightYellow: "#ffd98a",
  brightBlue: "#8cc3ff",
  brightMagenta: "#ff7fe3",
  brightCyan: "#8ff4ff",
  brightWhite: "#ffffff"
};
var ENDED = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function columnsFor(width, charWidth2) {
  if (!(width > 0) || !(charWidth2 > 0)) return 80;
  return Math.max(30, Math.min(400, Math.floor((width - 24) / charWidth2)));
}
var measured = 0;
function charWidth() {
  if (measured > 0) return measured;
  const context = document.createElement("canvas").getContext?.("2d");
  if (!context) return 7.8;
  context.font = FONT;
  measured = context.measureText("W").width || 7.8;
  return measured;
}
function footFor({ state, entered, exitCode, error }) {
  if (state === "preparing") return "Opening a terminal…";
  if (state === "ready") return entered ? "Signing in… Finish in the browser page Claude Code opens." : "The command is ready. Press Enter to run it, or edit it first.";
  if (state === "checking") return "Finished. Checking that Claude Code is signed in…";
  if (state === "done") return "Signed in. Closing the terminal…";
  if (state === "cancelled") return "Nothing ran. Open it again when you are ready.";
  if (error) return error;
  return `It stopped with exit code ${exitCode ?? "?"}. Read what it printed above, then try again.`;
}
function ClaudeLoginTerminal({ onEnded, onClose }) {
  const box = (0, import_react6.useRef)(null);
  const [status, setStatus] = (0, import_react6.useState)({ state: "preparing", entered: false });
  const ended = (0, import_react6.useRef)(onEnded);
  ended.current = onEnded;
  (0, import_react6.useEffect)(() => {
    let alive = true;
    let timer = 0;
    let terminal = null;
    let offset = 0;
    let entered = false;
    let writing = Promise.resolve();
    let term = null;
    let typed = null;
    let observer = null;
    const fit = () => {
      const cols = columnsFor(box.current?.clientWidth, charWidth());
      if (term === null || cols === term.cols) return;
      term.resize(cols, ROWS);
      if (terminal !== null) void call("ai-terminal-resize", { terminal, cols, rows: ROWS }).catch(() => {
      });
    };
    const read = async () => {
      try {
        const reply = await call("ai-terminal-read", { terminal, from: offset });
        if (!alive) return;
        if (reply.data) term.write(reply.data);
        offset = reply.next ?? offset;
        setStatus({ state: reply.state, entered, exitCode: reply.exitCode, error: reply.error });
        if (ENDED.has(reply.state)) {
          ended.current?.(reply);
          return;
        }
      } catch (error) {
        if (!alive) return;
        setStatus({ state: "failed", error: error.message, entered });
        return;
      }
      timer = setTimeout(read, READ_MS);
    };
    const start = async () => {
      const { Terminal } = await Promise.resolve().then(() => (init_xterm(), xterm_exports));
      if (!alive) return;
      term = new Terminal({ rows: ROWS, cols: columnsFor(box.current?.clientWidth, charWidth()), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 2e3, theme: THEME });
      term.open(box.current);
      typed = term.onData((data) => {
        if (terminal === null) return;
        if (/[\r\n]/.test(data) && !entered) {
          entered = true;
          setStatus((previous) => ({ ...previous, entered: true }));
        }
        writing = writing.then(() => call("ai-terminal-write", { terminal, data })).catch(() => {
        });
      });
      observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
      observer?.observe(box.current);
      const reply = await call("ai-terminal-open", { kind: "claude-login", cols: term.cols, rows: ROWS });
      if (!alive) {
        void call("ai-terminal-close", { terminal: reply.terminal }).catch(() => {
        });
        return;
      }
      terminal = reply.terminal;
      setStatus((previous) => ({ ...previous, state: reply.state }));
      term.focus();
      void read();
    };
    start().catch((error) => {
      if (alive) setStatus({ state: "failed", error: error.message, entered: false });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      observer?.disconnect();
      typed?.dispose();
      term?.dispose();
      if (terminal !== null) void call("ai-terminal-close", { terminal }).catch(() => {
      });
    };
  }, []);
  const stopped = status.state === "failed" || status.state === "cancelled";
  return (0, import_react6.createElement)(
    "div",
    { className: `oai-term${stopped ? " oai-term-stopped" : ""}` },
    (0, import_react6.createElement)(
      "div",
      { className: "oai-term-bar" },
      (0, import_react6.createElement)("span", { className: "oai-term-dots", "aria-hidden": true }, (0, import_react6.createElement)("i"), (0, import_react6.createElement)("i"), (0, import_react6.createElement)("i")),
      (0, import_react6.createElement)("span", { className: "oai-term-title" }, "Sign in to Claude Code"),
      onClose ? (0, import_react6.createElement)("button", { type: "button", className: "oai-term-close", onClick: onClose, "aria-label": "Close the terminal" }, "×") : (0, import_react6.createElement)("span")
    ),
    (0, import_react6.createElement)("div", { className: "oai-term-screen", ref: box, role: "application", "aria-label": "Claude Code sign-in terminal" }),
    (0, import_react6.createElement)("div", { className: "oai-term-foot", role: "status" }, footFor(status))
  );
}
var TERMINAL_CSS = xterm_default + `
.oai-term{margin-top:10px;border:1px solid var(--oai-line);border-radius:12px;overflow:hidden;background:#05080e}
.oai-term.oai-term-stopped{border-color:color-mix(in srgb,var(--oai-bad) 55%,transparent)}
.oai-term-bar{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--oai-line);color:var(--oai-ink2);font-size:12px}
.oai-term-dots{display:inline-flex;gap:6px}.oai-term-dots i{width:9px;height:9px;border-radius:50%;background:#253247}
.oai-term-title{text-align:center}
.oai-card button.oai-term-close{justify-self:end;width:auto;margin:0;padding:0 2px;background:none;border:0;color:var(--oai-ink2);font-size:16px;line-height:1}
.oai-term-screen{padding:10px 12px;min-height:150px}
.oai-term-screen .xterm-viewport{background:#05080e!important}
.oai-term-foot{padding:8px 14px;border-top:1px solid var(--oai-line);color:var(--oai-ink2);font-size:12.5px}
`;

// src/client/connect-ai.js
var import_react7 = require("react");
var VENDOR_TERMS = "Personal use under the vendor's terms";
var FIRST_OTHERS = 4;
var LOGOS = { claude: "C", chatgpt: "G", deepseek: "D", kimi: "K", copilot: "P", grok: "X", openai: "O", anthropic: "A", openrouter: "R", zai: "Z", moonshot: "M", opencode: "OC", cliproxy: "⇄", ollama: "L" };
var CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";
function subscriptionRows(subscriptions) {
  if (!subscriptions) return [];
  return SUBSCRIPTION_TILES.map((tile) => {
    const count = signedInCount(subscriptions.accounts.map((account) => ({ ...account, configured: true })), tile.provider);
    const on2 = count > 0 && !subscriptions.hidden.includes(tile.provider);
    return { id: `sub:${tile.provider}`, name: tile.name, via: `${tile.note} · dsh-subscriptions`, kind: "subscription", tile, ready: count > 0, on: on2, found: count > 1 ? `${count} accounts` : count === 1 ? "Signed in" : null };
  });
}
function sections(rows) {
  const found = rows.filter((row) => row.found || row.on);
  const others = rows.filter((row) => !found.includes(row));
  return { found, others };
}
var onCount = (rows) => rows.filter((row) => row.on).length;
function flipAction(row) {
  if (row.on) return "off";
  return row.ready ? "on" : "setup";
}
function Copyable({ text }) {
  const [copied, setCopied] = (0, import_react7.useState)(false);
  return (0, import_react7.createElement)(
    "div",
    { className: "oai-code oai-command" },
    (0, import_react7.createElement)("code", null, text),
    (0, import_react7.createElement)("button", { type: "button", className: "oai-ghost", onClick: () => navigator.clipboard?.writeText(text).then(() => setCopied(true)) }, copied ? "Copied" : "Copy")
  );
}
function KeyForm({ row, provider, onSaved }) {
  const [apiKey, setApiKey] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [problem, setProblem] = (0, import_react7.useState)(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await call("provider-key", { provider, apiKey });
      setApiKey("");
      onSaved();
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react7.createElement)(
    "form",
    { onSubmit: submit, className: "oai-setup-form" },
    (0, import_react7.createElement)(
      "div",
      { className: "oai-field" },
      (0, import_react7.createElement)("input", { type: "password", required: true, autoComplete: "off", spellCheck: false, autoFocus: true, placeholder: `Paste your ${row.name} key`, "aria-label": `${row.name} key`, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
      (0, import_react7.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Turning on…" : "Turn on")
    ),
    (0, import_react7.createElement)("p", { className: "oai-muted" }, "It stays on this computer, in DSH's own credential store.", row.keyUrl ? [" ", (0, import_react7.createElement)("a", { key: "k", className: "oai-link", href: row.keyUrl, target: "_blank", rel: "noreferrer" }, `Get a ${row.name} key`)] : null),
    problem ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null
  );
}
function SignIn({ row, provider, onSaved, onCancel }) {
  const [attempt, setAttempt] = (0, import_react7.useState)(null);
  const [problem, setProblem] = (0, import_react7.useState)(null);
  const [answer, setAnswer] = (0, import_react7.useState)("");
  const [copied, setCopied] = (0, import_react7.useState)(false);
  (0, import_react7.useEffect)(() => {
    let live = true;
    let timer = 0;
    const poll = async (first) => {
      try {
        const next = await call(first ? "signin-start" : "signin-status", { provider });
        if (!live) return;
        setAttempt(next);
        if (next.status === "authorized") return onSaved();
        if (next.status === "running") timer = setTimeout(() => poll(false), 1e3);
      } catch (error) {
        if (live) setProblem(error.message);
      }
    };
    poll(true);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [provider]);
  const reply = async (value) => {
    setProblem(null);
    try {
      setAttempt(await call("signin-answer", { provider, promptId: attempt.prompt.id, value }));
      setAnswer("");
    } catch (error) {
      setProblem(error.message);
    }
  };
  const cancel = async () => {
    await call("signin-cancel", { provider }).catch(() => {
    });
    onCancel();
  };
  const notice = attempt?.notice;
  const prompt = attempt?.prompt;
  const ended = attempt && ["cancelled", "failed", "none"].includes(attempt.status);
  const endedText = { failed: `The sign-in did not finish: ${attempt?.error}`, cancelled: "The sign-in was cancelled. Nothing was turned on.", none: "The sign-in stopped before it finished. Flip the switch to start again." };
  return (0, import_react7.createElement)(
    "div",
    { className: "oai-signin" },
    !attempt && !problem ? (0, import_react7.createElement)("p", { className: "oai-muted" }, `Starting the ${row.name} sign-in…`) : null,
    notice?.message ? (0, import_react7.createElement)("p", null, notice.message) : null,
    notice?.code ? (0, import_react7.createElement)(
      "div",
      { className: "oai-code" },
      (0, import_react7.createElement)("code", null, notice.code),
      (0, import_react7.createElement)("button", { type: "button", className: "oai-ghost", onClick: () => navigator.clipboard?.writeText(notice.code).then(() => setCopied(true)) }, copied ? "Copied" : "Copy code")
    ) : null,
    notice?.url ? (0, import_react7.createElement)("a", { className: "oai-primary oai-button", href: notice.url, target: "_blank", rel: "noreferrer" }, `Sign in with ${row.name}`) : null,
    prompt?.kind === "select" ? (0, import_react7.createElement)(
      "div",
      { className: "oai-choices", role: "group", "aria-label": prompt.message },
      (0, import_react7.createElement)("p", null, prompt.message),
      prompt.options.map((option) => (0, import_react7.createElement)("button", { key: option.id, type: "button", onClick: () => reply(option.id) }, (0, import_react7.createElement)("strong", null, option.label), option.description ? (0, import_react7.createElement)("span", null, option.description) : null))
    ) : null,
    prompt && prompt.kind !== "select" ? (0, import_react7.createElement)(
      "form",
      { onSubmit: (event) => {
        event.preventDefault();
        reply(answer);
      } },
      (0, import_react7.createElement)("label", { htmlFor: `oai-answer-${row.id}` }, prompt.message),
      (0, import_react7.createElement)("input", { id: `oai-answer-${row.id}`, type: prompt.kind === "secret" ? "password" : "text", required: true, autoComplete: "off", spellCheck: false, autoFocus: true, placeholder: prompt.placeholder, value: answer, onChange: (e) => setAnswer(e.target.value) }),
      (0, import_react7.createElement)("button", { type: "submit", className: "oai-primary" }, "Continue")
    ) : null,
    attempt?.status === "running" && !prompt ? (0, import_react7.createElement)("p", { className: "oai-muted oai-waiting" }, "Finish signing in on their page…") : null,
    ended ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, endedText[attempt.status]) : null,
    problem ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null,
    !ended && !problem ? (0, import_react7.createElement)("button", { type: "button", className: "oai-quiet", onClick: cancel }, "Cancel") : null
  );
}
function CliproxyForm({ onSaved }) {
  const [baseURL, setBaseURL] = (0, import_react7.useState)("");
  const [apiKey, setApiKey] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [problem, setProblem] = (0, import_react7.useState)(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await call("cliproxy", { baseURL, apiKey });
      setApiKey("");
      onSaved();
    } catch (error) {
      setProblem(error.message);
      setBusy(false);
    }
  };
  return (0, import_react7.createElement)(
    "form",
    { onSubmit: submit, className: "oai-setup-form" },
    (0, import_react7.createElement)("input", { type: "url", required: true, placeholder: "http://localhost:8317/v1", "aria-label": "Gateway address", autoComplete: "off", value: baseURL, onChange: (e) => setBaseURL(e.target.value) }),
    (0, import_react7.createElement)(
      "div",
      { className: "oai-field" },
      (0, import_react7.createElement)("input", { type: "password", required: true, placeholder: "Gateway key", "aria-label": "Gateway key", autoComplete: "off", spellCheck: false, value: apiKey, onChange: (e) => setApiKey(e.target.value) }),
      (0, import_react7.createElement)("button", { type: "submit", className: "oai-primary", disabled: busy }, busy ? "Turning on…" : "Turn on")
    ),
    (0, import_react7.createElement)("p", { className: "oai-muted" }, "Omni lists the gateway's models with your key and keeps the key in DSH's credential store."),
    problem ? (0, import_react7.createElement)("p", { className: "oai-error", role: "alert" }, problem) : null
  );
}
function ClaudeSetup({ row, onSaved, onClose }) {
  if (row.needs === "plugin") return (0, import_react7.createElement)("p", null, "Claude runs through the Oh My Claude plugin, which this DSH does not have. Add it from Settings → Plugins.");
  if (row.needs === "install") {
    return (0, import_react7.createElement)(
      "div",
      null,
      (0, import_react7.createElement)("p", null, "Install Claude Code, Anthropic's own app. In a terminal:"),
      (0, import_react7.createElement)(Copyable, { text: CLAUDE_INSTALL }),
      (0, import_react7.createElement)("p", { className: "oai-muted" }, "Or follow ", (0, import_react7.createElement)("a", { className: "oai-link", href: "https://code.claude.com/docs/en/setup", target: "_blank", rel: "noreferrer" }, "Anthropic's setup guide"), ". Then flip this again.")
    );
  }
  if (row.needs === "restart") return (0, import_react7.createElement)("p", { className: "oai-error" }, "Claude Code is signed in, but this app cannot start it from where it is installed. Restart the app to pick it up.");
  return (0, import_react7.createElement)(
    "div",
    null,
    (0, import_react7.createElement)(ClaudeLoginTerminal, { onClose, onEnded: (reply) => {
      if (reply.state === "done") onSaved();
    } }),
    (0, import_react7.createElement)("p", { className: "oai-muted" }, "Press Enter in the terminal. Claude Code signs in with your own Claude account; Omni only talks to the Claude Code app.")
  );
}
function Setup({ row, onSaved, onClose }) {
  if (row.kind === "claude") return (0, import_react7.createElement)(ClaudeSetup, { row, onSaved, onClose });
  if (row.kind === "key") return (0, import_react7.createElement)(KeyForm, { row, provider: providerOf(row), onSaved });
  if (row.kind === "signin") {
    if (row.signIn) return (0, import_react7.createElement)(SignIn, { row, provider: providerOf(row), onSaved, onCancel: onClose });
    if (row.keyUrl) return (0, import_react7.createElement)(KeyForm, { row, provider: providerOf(row), onSaved });
    return (0, import_react7.createElement)("p", null, `This DSH offers no ${row.name} sign-in.`);
  }
  if (row.kind === "gateway") return (0, import_react7.createElement)(CliproxyForm, { onSaved });
  if (row.kind === "local") return (0, import_react7.createElement)("p", { className: "oai-muted" }, "Ollama is not running on this computer. Start it, then flip this again.");
  if (row.kind === "subscription") return (0, import_react7.createElement)(SubscriptionSignIn, { tile: row.tile, onBack: onClose, onSaved, glitch: () => {
  } });
  return null;
}
var PROVIDER_OF = { chatgpt: "openai-codex", kimi: "kimi-coding", copilot: "github-copilot", grok: "xai", openai: "openai", anthropic: "anthropic", openrouter: "openrouter", zai: "zai", moonshot: "moonshotai", opencode: "opencode", deepseek: "deepseek" };
var providerOf = (row) => PROVIDER_OF[row.id] ?? row.id;
function Duplicates({ row, onDedupe }) {
  if (!row.duplicates?.length) return null;
  const shown = row.duplicates.filter((duplicate) => !duplicate.hidden);
  return (0, import_react7.createElement)(
    "div",
    { className: "oai-dupes" },
    row.duplicates.map((duplicate) => (0, import_react7.createElement)(
      "p",
      { key: `${duplicate.via}:${duplicate.provider}`, className: "oai-muted" },
      `Also connected through ${duplicate.via}; Omni uses ${row.name} ${row.kind === "claude" ? "through Claude Code" : "here"}.`,
      duplicate.hidden ? " Its models are hidden." : null
    )),
    shown.length && row.on ? (0, import_react7.createElement)("button", { type: "button", className: "oai-ghost", onClick: onDedupe }, `Use only this ${row.name}`) : null
  );
}
function Row({ row, open, busy, problem, onFlip, onSaved, onClose, onDedupe }) {
  const logo = LOGOS[row.id] ?? row.name.slice(0, 1);
  return (0, import_react7.createElement)(
    "div",
    { className: `oai-ai${row.on ? " oai-ai-on" : ""}` },
    (0, import_react7.createElement)(
      "div",
      { className: "oai-ai-row" },
      (0, import_react7.createElement)("div", { className: "oai-logo", "aria-hidden": true }, logo),
      (0, import_react7.createElement)(
        "div",
        { className: "oai-ai-what" },
        (0, import_react7.createElement)("strong", null, row.name),
        (0, import_react7.createElement)("span", null, row.detail ? `${row.via} · ${row.detail}` : row.via)
      ),
      row.found ? (0, import_react7.createElement)("em", { className: "oai-found" }, row.found) : null,
      (0, import_react7.createElement)("button", { type: "button", role: "switch", className: "oai-switch", "aria-checked": row.on ? "true" : "false", "aria-label": row.name, disabled: busy, onClick: onFlip })
    ),
    open && !row.on ? (0, import_react7.createElement)("div", { className: "oai-ai-setup" }, (0, import_react7.createElement)(Setup, { row, onSaved, onClose })) : null,
    problem ? (0, import_react7.createElement)("p", { className: "oai-error oai-ai-problem", role: "alert" }, problem) : null,
    (0, import_react7.createElement)(Duplicates, { row, onDedupe })
  );
}
function ConnectAiStep(props) {
  const state = useGate(props);
  const finish2 = useFinish(props);
  const proceed = useFinish((0, import_react7.useMemo)(() => ({ ...props, connected: true }), [props]));
  const [glitching, glitch] = useGlitch();
  const [rows, setRows] = (0, import_react7.useState)(null);
  const [subs, setSubs] = (0, import_react7.useState)(null);
  const [open, setOpen] = (0, import_react7.useState)(null);
  const [busy, setBusy] = (0, import_react7.useState)(null);
  const [problems, setProblems] = (0, import_react7.useState)({});
  const [showAll, setShowAll] = (0, import_react7.useState)(false);
  const refresh = (0, import_react7.useCallback)(async () => {
    const reply = await call("ais").catch(() => ({ rows: [], subscriptions: null }));
    setRows(reply.rows ?? []);
    setSubs(reply.subscriptions ?? null);
  }, []);
  (0, import_react7.useEffect)(() => {
    void refresh();
  }, [refresh]);
  (0, import_react7.useEffect)(() => {
    if (state) glitch();
  }, [state, glitch]);
  if (!state) return null;
  const all = rows === null ? null : [...rows, ...subscriptionRows(subs)];
  const say = (id, message) => setProblems((previous) => ({ ...previous, [id]: message }));
  const flip = async (row) => {
    const action = flipAction(row);
    say(row.id, null);
    if (action === "setup") {
      setOpen((current) => current === row.id ? null : row.id);
      return;
    }
    setBusy(row.id);
    try {
      if (row.kind === "subscription") await call("ai-subscription", { provider: row.tile.provider, on: action === "on" });
      else await call("ai-switch", { id: row.id, on: action === "on" });
      if (action === "on") glitch();
      await refresh();
    } catch (error) {
      say(row.id, error.message);
    }
    setBusy(null);
  };
  const saved = (row) => async () => {
    setOpen(null);
    glitch();
    if (row.kind !== "subscription") await call("ai-dedupe", { id: row.id }).catch(() => {
    });
    await refresh();
  };
  const dedupe = (row) => async () => {
    say(row.id, null);
    try {
      await call("ai-dedupe", { id: row.id });
      await refresh();
    } catch (error) {
      say(row.id, error.message);
    }
  };
  const count = all ? onCount(all) : 0;
  const { found, others } = sections(all ?? []);
  const visible = showAll ? others : others.slice(0, FIRST_OTHERS);
  const rowOf = (row) => (0, import_react7.createElement)(Row, { key: row.id, row, open: open === row.id, busy: busy !== null, problem: problems[row.id], onFlip: () => flip(row), onSaved: saved(row), onClose: () => setOpen(null), onDedupe: dedupe(row) });
  return (0, import_react7.createElement)(
    Stage,
    {
      title: "Turn on your AIs",
      speech: count > 0 ? `Turn on everything you have. More brains, more ${state.companionName ?? "Omni"}.` : "Now give me a brain. Turn on every AI you have; you can change it any time.",
      at: "omni-connect-ai",
      glitching
    },
    all === null ? (0, import_react7.createElement)("p", { className: "oai-muted" }, "Looking at what this computer has…") : [
      found.length ? (0, import_react7.createElement)(
        "section",
        { key: "found", className: "oai-group", "aria-label": "Found on this computer" },
        (0, import_react7.createElement)("h2", null, "Found on this computer"),
        (0, import_react7.createElement)("div", { className: "oai-list" }, found.map(rowOf))
      ) : null,
      (0, import_react7.createElement)(
        "section",
        { key: "others", className: "oai-group", "aria-label": found.length ? "Add another" : "Your AIs" },
        (0, import_react7.createElement)("h2", null, found.length ? "Add another" : "Your AIs"),
        (0, import_react7.createElement)("p", { className: "oai-terms oai-muted" }, `Subscriptions: ${VENDOR_TERMS.toLowerCase()}.`),
        (0, import_react7.createElement)(
          "div",
          { className: "oai-list" },
          visible.map(rowOf),
          !showAll && others.length > FIRST_OTHERS ? (0, import_react7.createElement)("button", { type: "button", className: "oai-more", onClick: () => setShowAll(true) }, `Show ${others.length - FIRST_OTHERS} more`) : null
        )
      ),
      (0, import_react7.createElement)("p", { key: "more", className: "oai-muted oai-every" }, "Every other provider DSH knows is in ", (0, import_react7.createElement)("button", { type: "button", className: "oai-inline", onClick: () => finish2("models") }, "Settings → Models"), ".")
    ],
    (0, import_react7.createElement)(
      "div",
      { className: "oai-actions" },
      (0, import_react7.createElement)("button", { type: "button", className: "oai-quiet", onClick: () => finish2() }, "Skip for now"),
      (0, import_react7.createElement)("span", { className: "oai-count" }, count > 0 ? `${count} on` : "Turn on at least one"),
      (0, import_react7.createElement)("button", { type: "button", className: "oai-primary", disabled: count === 0, onClick: () => proceed() }, count > 0 ? "Continue →" : "Continue")
    )
  );
}

// src/client/index.js
var STEPS = [
  { id: "omni-companion", order: -300, component: CompanionStep },
  { id: "omni-team", order: -270, component: TeamStep },
  { id: "omni-connect-ai", order: -200, component: ConnectAiStep }
];
var inject = ["slots"];
function installStyles() {
  const style = document.createElement("style");
  style.dataset.omniAi = "";
  style.textContent = STAGE_CSS + ONBOARD_CSS + INK_CSS + CLAY_ART_CSS + TERMINAL_CSS;
  document.head.append(style);
  return () => style.remove();
}
function apply(ctx) {
  ctx.effect(installStyles, "omni-ai: stage styles");
  for (const step of STEPS) {
    ctx.effect(() => announceStep(step.id), `omni-ai: ${step.id} on the rail`);
    ctx.slots.inject("settings.onboarding", () => ctx.slots.register({ name: "settings.onboarding", id: step.id, order: step.order }, step.component));
  }
}
/*! Bundled license information:

@xterm/xterm/lib/xterm.mjs:
  (**
   * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved.
   * @license MIT
   *
   * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
   * @license MIT
   *
   * Originally forked from (with the author's permission):
   *   Fabrice Bellard's javascript vt100 for jslinux:
   *   http://bellard.org/jslinux/
   *   Copyright (c) 2011 Fabrice Bellard
   *)
*/
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
