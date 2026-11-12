/* Automagik ID: the sign-in and allow-access pages. One small same-origin script, no build
   step. It follows apps/id/PAGES-CONTRACT.md: it calls only that contract's endpoints, keeps
   nothing in browser storage, writes nothing to the console and shows only its own words,
   never text or HTML that came back from a failed call. */
(() => {
  'use strict';

  // Never inside a frame: an Allow button must not be clickable through someone else's page.
  if (window.top !== window.self) { document.documentElement.hidden = true; return; }

  // The provider's query exactly as it arrived. It is read here and sent back whole; it is
  // never edited, sorted or rebuilt, and nothing in it is trusted for display.
  const oauthQuery = window.location.search.slice(1);
  const asked = new URLSearchParams(oauthQuery);
  const clientId = asked.get('client_id') || '';
  const prompts = (asked.get('prompt') || '').split(' ').filter(Boolean);
  const hasRequest = oauthQuery !== '';
  const mustCreate = prompts.includes('create');
  const mustBeFresh = prompts.includes('login') || asked.has('max_age');

  const T = {
    moment: 'One moment…',
    passkey: 'A passkey is your fingerprint, face or screen lock. No password.',
    prompt: 'Follow the prompt on your device.',
    promptSave: 'Follow the prompt to save your passkey.',
    waiting: 'Waiting for your passkey…',
    checking: 'Checking…',
    cancelled: 'Cancelled. Try again whenever you’re ready.',
    failedUse: 'That passkey didn’t work here. Try again, or create a new one.',
    failedSave: 'The passkey wasn’t saved. Try again.',
    already: 'This device already has your passkey. Use it to continue.',
    cannot: 'This device can’t make a passkey here. Try another one.',
    unsupported: 'This browser can’t use passkeys.',
    unsupportedNote: 'Open this page in an up-to-date Safari, Chrome, Edge or Firefox.',
    unsupportedPhone: 'This browser can’t use passkeys. Use a phone code.',
    saved: 'Passkey saved. You’re in!',
    in: 'You’re in!',
    here: 'You’re already signed in on this browser.',
    again: 'Please sign in again.',
    signedOut: 'Signed out.',
    back: name => `Taking you back to ${name}…`,
    backPlain: 'Taking you back…',
    returned: name => `All set. You can go back to ${name}.`,
    close: 'You can close this page.',
    phone: 'We’ll send a 6-digit code on WhatsApp.',
    phoneHint: 'With the country code, starting with +.',
    phoneHintPasskey: 'With the country code, starting with +. Your passkey may show up here too.',
    phoneBad: 'Use the full number with the country code, like +55 11 91234 5678.',
    sending: 'Sending…',
    sent: number => `Code sent to ${number}. It can take a moment.`,
    codeShort: 'Enter the 6 digits.',
    codeWrong: 'That code isn’t right. Check it and try again.',
    codeExpired: 'That code expired. Send a new one.',
    codeLocked: 'Too many wrong codes. Send a new code to keep going.',
    sendAgain: 'Send again',
    sendAgainIn: left => `Send again in ${left} s`,
    rate: 'Too many tries. Take a short break.',
    tryIn: left => `Try again in ${left} s`,
    offline: 'Can’t reach Automagik. Check your connection.',
    broken: 'Something went wrong on our side.',
    expiredTitle: 'This link has expired',
    expired: 'Let’s start over.',
    expiredNote: 'Go back to the app you came from and start again.',
    trust: name => `${name} never sees your passkey.`,
    allowing: 'Allowing…',
    cancelling: 'Cancelling…',
    allowed: ['Allowed', 'Done!'],
    refused: ['Cancelled', 'No problem.'],
    timedOut: 'Your sign-in timed out.',
    notAllowed: 'This account can’t allow that.',
    notAllowedNote: name => `Go back to ${name} and try another account.`,
    scopes: {
      openid: ['Know it’s you', 'Your Automagik ID'],
      profile: ['See your profile', 'Your name and picture'],
      offline_access: ['Stay connected', 'Keeps working while you’re away'],
    },
    otherScope: 'Other access this app asks for',
    claims: 'Extra details',
  };

  const $ = id => document.getElementById(id);
  const pet = $('pet');
  const bubble = $('say');
  const card = $('card');
  let product = '';
  let acting = false;

  // ---- The host: the pet's mood and what it says -------------------------------------
  const THEN = { wave: 'idle', jump: 'idle' };
  function mood(name) { if (pet.dataset.mood !== name) pet.dataset.mood = name; }
  pet.addEventListener('animationend', (event) => {
    const next = THEN[pet.dataset.mood];
    if (next && event.animationName.startsWith('pet-')) pet.dataset.mood = next;
  });
  function say(text, tone) {
    bubble.textContent = text;
    if (tone) bubble.dataset.tone = tone; else delete bubble.dataset.tone;
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
  }
  function title(lead, name) {
    $('lead').textContent = lead;
    $('product').textContent = name || '';
    $('product').hidden = !name;
  }
  function show(view, focus) {
    for (const part of card.querySelectorAll('[data-view]')) part.hidden = part.dataset.view !== view;
    card.setAttribute('aria-busy', view === 'loading' ? 'true' : 'false');
    if (focus) focus.focus({ preventScroll: true });
  }

  // ---- Calls: same origin, JSON, cookies the page never reads ------------------------
  function problem(kind, more) { return Object.assign(new Error(kind), { kind }, more); }
  function retryAfter(response) {
    const seconds = Number(response.headers.get('X-Retry-After') || response.headers.get('Retry-After'));
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 3600) : 30;
  }
  async function call(path, body) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20000);
    let response;
    let text;
    try {
      response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'manual',
        signal: abort.signal,
        headers: body === undefined ? { Accept: 'application/json' } :
          { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      text = await response.text();
    } catch {
      throw problem('network');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429) throw problem('rate', { wait: retryAfter(response) });
    let data = null;
    let readable = true;
    try { data = text ? JSON.parse(text) : null; } catch { readable = false; }
    if (response.ok) {
      if (!readable) throw problem('service');
      return data;
    }
    if (response.status < 400 || response.status >= 500) throw problem('service');
    const code = data && typeof data === 'object' ? String(data.code || data.error || '') : '';
    throw problem('refused', { status: response.status, code });
  }

  // Go where the server says, and only there. The query's own return address is never used.
  function go(url) {
    let target = null;
    try { target = new URL(String(url), window.location.origin); } catch { target = null; }
    if (!target || /^(javascript|data|vbscript|blob|file|about):$/i.test(target.protocol)) {
      throw problem('service');
    }
    window.location.assign(target.href);
    // A desktop app's own page may open elsewhere: do not spin for ever once it has been sent.
    setTimeout(() => {
      const spin = card.querySelector('[data-view="going"]:not([hidden]) .spin');
      if (!spin) return;
      spin.hidden = true;
      mood('idle');
      say(product ? T.returned(product) : T.in);
      $('going-text').textContent = T.close;
    }, 6000);
  }
  function follow(result) {
    if (!result || result.redirect !== true || typeof result.url !== 'string') return false;
    go(result.url);
    return true;
  }

  // The client's name, verified by the service against the signed query.
  async function verifiedName() {
    if (!clientId) throw problem('refused');
    const client = await call('/api/auth/oauth2/public-client-prelogin', {
      client_id: clientId, oauth_query: oauthQuery,
    });
    if (!client || typeof client !== 'object') throw problem('service');
    const name = typeof client.client_name === 'string' ? client.client_name.trim() : '';
    return name || clientId;
  }
  // After a refusal: is the request itself still good? A stale or changed one ends here.
  async function requestEnded() {
    if (!hasRequest) return false;
    try { await verifiedName(); return false; } catch (error) { return error.kind === 'refused'; }
  }

  // ---- One action at a time; waits; busy buttons -------------------------------------
  async function act(button, label, run) {
    if (acting) return;
    acting = true;
    const controls = [...card.querySelectorAll('button,input')];
    for (const control of controls) { control.disabled = true; control.setAttribute('data-acting', ''); }
    const text = button.querySelector('[data-label]') || button;
    const kept = [...text.childNodes];
    const spin = document.createElement('span');
    spin.className = 'spin';
    spin.setAttribute('aria-hidden', 'true');
    text.replaceChildren(label);
    button.dataset.busy = '';
    button.prepend(spin);
    try {
      await run();
    } finally {
      spin.remove();
      delete button.dataset.busy;
      text.replaceChildren(...kept);
      for (const control of controls) {
        control.removeAttribute('data-acting');
        control.disabled = control.hasAttribute('data-hold');
      }
      acting = false;
      if (document.activeElement === document.body && !button.disabled && button.offsetParent) {
        button.focus({ preventScroll: true });
      }
    }
  }
  const holds = new Map();
  function hold(key, seconds, controls, paint, done) {
    release(key);
    const until = Date.now() + seconds * 1000;
    for (const control of controls) { control.disabled = true; control.setAttribute('data-hold', ''); }
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left > 0) return paint(left);
      release(key);
    };
    holds.set(key, { timer: setInterval(tick, 250), controls, done });
    tick();
  }
  function release(key) {
    const held = holds.get(key);
    if (!held) return;
    clearInterval(held.timer);
    holds.delete(key);
    for (const control of held.controls) {
      control.removeAttribute('data-hold');
      control.disabled = control.hasAttribute('data-acting');
    }
    if (held.done) held.done();
  }
  // A 429: say so, show the wait, and keep the buttons still until it is over.
  function rateLimited(seconds, waitId, controls) {
    const wait = $(waitId);
    mood('fail');
    say(T.rate, 'oops');
    wait.hidden = false;
    hold(waitId, seconds, controls, (left) => { wait.textContent = T.tryIn(left); }, () => { wait.hidden = true; });
  }
  function trouble(error, waitId, controls) {
    if (error.kind === 'rate') return rateLimited(error.wait, waitId, controls);
    mood('fail');
    say(error.kind === 'network' ? T.offline : T.broken, 'oops');
  }

  // ---- Shared ends ---------------------------------------------------------------------
  function stop(lead, name, line, note) {
    title(lead, name);
    mood('fail');
    say(line, 'oops');
    $('stop-text').textContent = note;
    show('stop', $('title'));
  }
  function ended() { stop(T.expiredTitle, '', T.expired, T.expiredNote); }
  function retry(error, again) {
    const button = $('retry');
    show('retry');
    button.onclick = () => { release('retry-wait'); again(); };
    trouble(error, 'retry-wait', [button]);
  }
  function going(lead) {
    if (lead) title(lead, '');
    $('going-text').textContent = product ? T.back(product) : T.backPlain;
    show('going', $('title'));
  }

  // ====================================================================================
  // Sign in
  // ====================================================================================
  const webauthn = window.isSecureContext && typeof window.PublicKeyCredential === 'function' &&
    !!navigator.credentials && typeof navigator.credentials.get === 'function' &&
    typeof navigator.credentials.create === 'function';
  let phoneOn = false;
  let signedIn = false;
  let phoneNumber = '';
  let wrongCodes = 0;
  let conditional = null;

  const bytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const text64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const listed = list => (Array.isArray(list) ? list : []).map(entry => ({ ...entry, id: bytes(entry.id) }));
  function requestOptions(json) {
    if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function') {
      try { return PublicKeyCredential.parseRequestOptionsFromJSON(json); } catch { /* by hand */ }
    }
    return { ...json, challenge: bytes(json.challenge), allowCredentials: listed(json.allowCredentials) };
  }
  function creationOptions(json) {
    if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function') {
      try { return PublicKeyCredential.parseCreationOptionsFromJSON(json); } catch { /* by hand */ }
    }
    return {
      ...json, challenge: bytes(json.challenge), user: { ...json.user, id: bytes(json.user.id) },
      excludeCredentials: listed(json.excludeCredentials),
    };
  }
  // WebAuthn JSON: the browser's own toJSON where it has one, the same shape by hand otherwise.
  function credentialJSON(credential) {
    if (typeof credential.toJSON === 'function') return credential.toJSON();
    const from = credential.response;
    const response = { clientDataJSON: text64(from.clientDataJSON) };
    if (from.attestationObject) {
      response.attestationObject = text64(from.attestationObject);
      if (typeof from.getTransports === 'function') response.transports = from.getTransports();
    } else {
      response.authenticatorData = text64(from.authenticatorData);
      response.signature = text64(from.signature);
      if (from.userHandle) response.userHandle = text64(from.userHandle);
    }
    return {
      id: credential.id, rawId: text64(credential.rawId), type: credential.type, response,
      clientExtensionResults: typeof credential.getClientExtensionResults === 'function' ?
        credential.getClientExtensionResults() : {},
      ...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
    };
  }

  // Signed in. The service may already have resumed the request; otherwise ask it to.
  async function entered(result, created, omitted) {
    signedIn = true;
    if (!hasRequest) return done(created);
    mood('jump');
    say(created ? T.saved : T.in);
    going('You’re signed in');
    // A new account gets a beat to see that its passkey was saved.
    if (created) await new Promise(resolve => setTimeout(resolve, 900));
    try {
      if (follow(result)) return;
      const next = await call('/api/auth/oauth2/continue', mustCreate && omitted ?
        { oauth_query: oauthQuery, created: true } : { oauth_query: oauthQuery, selected: true });
      if (!follow(next)) throw problem('service');
    } catch (error) {
      if (error.kind === 'refused') return ended();
      session();
      trouble(error, 'session-wait', [$('continue'), $('switch')]);
    }
  }
  function done(created) {
    title('You’re signed in', '');
    mood('jump');
    say(created ? T.saved : T.in);
    show('done', $('title'));
  }

  function passkeys(line, tone) {
    title(mustCreate ? 'Create your account for' : 'Sign in to', product || 'Automagik');
    const use = $('use-passkey');
    const create = $('create-passkey');
    if (mustCreate && create.classList.contains('secondary')) {
      // Asked to create: the same two choices, the new account first.
      create.classList.replace('secondary', 'primary');
      use.classList.replace('primary', 'secondary');
      create.querySelector('.aside').hidden = true;
      use.querySelector('[data-label]').textContent = 'I have a passkey';
      create.prepend(use.querySelector('svg'));
      use.before(create);
    }
    $('phone-offer').hidden = !phoneOn;
    say(line || T.passkey, tone);
    show('passkey');
  }
  function passkeyTrouble(error, creating) {
    const controls = [$('use-passkey'), $('create-passkey'), $('use-phone')];
    if (error.kind) return trouble(error, 'passkey-wait', controls);
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'AbortError') { mood('idle'); return say(T.cancelled); }
    mood('fail');
    if (creating && name === 'InvalidStateError') return say(T.already, 'oops');
    if (name === 'NotSupportedError' || name === 'SecurityError' || name === 'ConstraintError') {
      return say(T.cannot, 'oops');
    }
    say(creating ? T.failedSave : T.failedUse, 'oops');
  }
  async function refused(error, creating) {
    if (error.kind !== 'refused') return passkeyTrouble(error, creating);
    if (await requestEnded()) return ended();
    mood('fail');
    say(creating ? T.failedSave : T.failedUse, 'oops');
  }
  function stopConditional() {
    if (conditional) { conditional.abort(); conditional = null; }
  }

  function usePasskey() {
    stopConditional();
    return act($('use-passkey'), T.waiting, async () => {
      mood('wait');
      say(T.prompt);
      try {
        const options = await call('/api/auth/passkey/generate-authenticate-options');
        const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
        mood('work');
        say(T.checking);
        const result = await call('/api/auth/passkey/verify-authentication', {
          response: credentialJSON(credential), ...(hasRequest ? { oauth_query: oauthQuery } : {}),
        });
        await entered(result, false, false);
      } catch (error) {
        await refused(error, false);
      }
    });
  }
  function createPasskey() {
    stopConditional();
    return act($('create-passkey'), T.waiting, async () => {
      mood('wait');
      say(T.promptSave);
      // Asked to create: the new account's sign-in is reported with `created`, not the query.
      const omitted = mustCreate;
      try {
        if (omitted && signedIn) { await call('/api/auth/sign-out', {}); signedIn = false; }
        const options = await call('/api/auth/passkey/generate-register-options');
        const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
        mood('work');
        say(T.checking);
        const result = await call('/api/auth/passkey/verify-registration', {
          response: credentialJSON(credential), createSession: true,
          ...(hasRequest && !omitted ? { oauth_query: oauthQuery } : {}),
        });
        await entered(result, true, omitted);
      } catch (error) {
        await refused(error, true);
      }
    });
  }

  // Already signed in here: carry on, or pick another account.
  function session() {
    title('Continue to', product);
    mood('wave');
    say(T.here);
    show('session');
  }
  function carryOn() {
    return act($('continue'), T.backPlain, async () => {
      try {
        const next = await call('/api/auth/oauth2/continue', { oauth_query: oauthQuery, selected: true });
        if (!follow(next)) throw problem('service');
        going();
      } catch (error) {
        if (error.kind !== 'refused') return trouble(error, 'session-wait', [$('continue'), $('switch')]);
        if (await requestEnded()) return ended();
        signedIn = false;
        mood('idle');
        passkeys(T.again);
      }
    });
  }
  function signOut(button) {
    return act(button, 'Signing out…', async () => {
      try {
        await call('/api/auth/sign-out', {});
        signedIn = false;
        mood('idle');
        passkeys(button.id === 'sign-out' ? T.signedOut : undefined);
      } catch (error) {
        trouble(error, 'session-wait', [$('continue'), $('switch')]);
      }
    });
  }

  // ---- Phone code: only when the service has it on -------------------------------------
  function phone(line, tone) {
    $('back-to-passkey').hidden = !webauthn;
    $('phone-hint').textContent = T.phoneHint;
    delete $('phone-hint').dataset.tone;
    $('phone').removeAttribute('aria-invalid');
    mood('idle');
    say(line || T.phone, tone);
    show('phone', $('phone'));
    waitForPasskeyInField();
  }
  // Conditional mediation: a saved passkey can be offered from the number field. The pending
  // request is aborted before any other ceremony starts.
  async function waitForPasskeyInField() {
    if (conditional || !webauthn || typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function') return;
    const abort = new AbortController();
    conditional = abort;
    let credential;
    try {
      if (!(await PublicKeyCredential.isConditionalMediationAvailable())) return;
      const options = await call('/api/auth/passkey/generate-authenticate-options');
      if (abort.signal.aborted) return;
      $('phone-hint').textContent = T.phoneHintPasskey;
      credential = await navigator.credentials.get({
        publicKey: requestOptions(options), mediation: 'conditional', signal: abort.signal,
      });
    } catch {
      return; // aborted or not offered: the number field works without it
    } finally {
      if (conditional === abort) conditional = null;
    }
    act($('send-code'), T.checking, async () => {
      mood('work');
      say(T.checking);
      try {
        const result = await call('/api/auth/passkey/verify-authentication', {
          response: credentialJSON(credential), ...(hasRequest ? { oauth_query: oauthQuery } : {}),
        });
        await entered(result, false, false);
      } catch (error) {
        await refused(error, false);
      }
    });
  }
  async function sendCode(button) {
    const input = $('phone');
    const hint = $('phone-hint');
    const number = input.value.replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(number)) {
      input.setAttribute('aria-invalid', 'true');
      hint.textContent = T.phoneBad;
      hint.dataset.tone = 'oops';
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    const shown = input.value.trim();
    await act(button, T.sending, async () => {
      try {
        await call('/api/auth/phone-number/send-otp', { phoneNumber: number });
      } catch (error) {
        const first = button.id === 'send-code';
        if (error.kind !== 'refused') {
          return trouble(error, first ? 'phone-wait' : 'code-wait', first ? [button] : [button, $('check-code')]);
        }
        mood('fail');
        if (error.code !== 'INVALID_PHONE_NUMBER') return (await requestEnded()) ? ended() : say(T.broken, 'oops');
        if (!first) return say(T.phoneBad, 'oops');
        input.setAttribute('aria-invalid', 'true');
        hint.textContent = T.phoneBad;
        hint.dataset.tone = 'oops';
        return undefined;
      }
      phoneNumber = number;
      stopConditional();
      code(shown);
    });
  }
  function code(shown) {
    const input = $('code');
    release('locked');
    wrongCodes = 0;
    input.value = '';
    input.removeAttribute('aria-invalid');
    $('code-hint').textContent = '';
    delete $('code-hint').dataset.tone;
    mood('wait');
    say(T.sent(shown.replace(/ /g, '\u00a0')));
    show('code', input);
    const resend = $('resend');
    hold('resend', 30, [resend], (left) => { resend.textContent = T.sendAgainIn(left); },
      () => { resend.textContent = T.sendAgain; });
  }
  function codeTrouble(line, locked) {
    const input = $('code');
    mood('fail');
    say(line, 'oops');
    input.setAttribute('aria-invalid', 'true');
    $('code-hint').textContent = '';
    if (locked) {
      // A locked code cannot be tried again: only a new send goes on. No count is promised.
      const locks = [input, $('check-code')];
      for (const control of locks) { control.disabled = true; control.setAttribute('data-hold', ''); }
      holds.set('locked', { timer: 0, controls: locks });
      release('resend');
    } else {
      input.select();
    }
  }
  async function checkCode() {
    const input = $('code');
    const digits = input.value.replace(/\D/g, '');
    if (digits.length !== 6) {
      input.setAttribute('aria-invalid', 'true');
      $('code-hint').textContent = T.codeShort;
      $('code-hint').dataset.tone = 'oops';
      input.focus();
      return;
    }
    await act($('check-code'), T.checking, async () => {
      mood('work');
      const omitted = mustCreate;
      try {
        if (omitted && signedIn) { await call('/api/auth/sign-out', {}); signedIn = false; }
        const result = await call('/api/auth/phone-number/verify', {
          phoneNumber, code: digits, ...(hasRequest && !omitted ? { oauth_query: oauthQuery } : {}),
        });
        await entered(result, false, omitted);
      } catch (error) {
        if (error.kind !== 'refused') return trouble(error, 'code-wait', [$('check-code'), $('resend')]);
        if (error.code === 'TOO_MANY_ATTEMPTS' || error.status === 403) return codeTrouble(T.codeLocked, true);
        if (error.code === 'OTP_EXPIRED' || error.code === 'OTP_NOT_FOUND') return codeTrouble(T.codeExpired, false);
        // The service locks a code after three wrong answers and only says so on the next
        // try, so the page keeps that count itself. It never shows how many are left.
        if (error.code === 'INVALID_OTP') {
          wrongCodes += 1;
          return wrongCodes >= 3 ? codeTrouble(T.codeLocked, true) : codeTrouble(T.codeWrong, false);
        }
        if (await requestEnded()) return ended();
        codeTrouble(T.codeWrong, false);
      }
    });
    if (!input.disabled && input.getAttribute('aria-invalid') === 'true') input.focus();
  }

  async function signIn() {
    title('Sign in', '');
    mood('work');
    say(T.moment);
    show('loading');
    const [config, current, name] = await Promise.allSettled([
      call('/api/id/config'), call('/api/auth/get-session'), hasRequest ? verifiedName() : Promise.resolve(''),
    ]);
    if (name.status === 'rejected') {
      return name.reason.kind === 'refused' ? ended() : retry(name.reason, signIn);
    }
    product = name.value;
    // A config failure leaves passkeys usable and the phone option hidden.
    phoneOn = config.status === 'fulfilled' && !!config.value && config.value.phoneEnabled === true;
    signedIn = current.status === 'fulfilled' && !!current.value && !!current.value.session;
    if (signedIn && !mustCreate && !hasRequest) return done(false);
    if (signedIn && !mustCreate && !mustBeFresh) return session();
    if (!webauthn) {
      if (phoneOn) { title('Sign in to', product || 'Automagik'); return phone(T.unsupportedPhone, 'oops'); }
      return stop('Sign in to', product || 'Automagik', T.unsupported, T.unsupportedNote);
    }
    mood('wave');
    passkeys();
  }

  // ====================================================================================
  // Allow access
  // ====================================================================================
  function asks() {
    const list = $('asks');
    const row = (strong, detail) => {
      const item = document.createElement('li');
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.setAttribute('aria-hidden', 'true');
      const ask = document.createElement('div');
      ask.className = 'ask';
      const head = document.createElement('strong');
      head.append(strong);
      const sub = document.createElement('span');
      sub.textContent = detail;
      ask.append(head, sub);
      item.append(tick, ask);
      list.append(item);
    };
    list.replaceChildren();
    for (const scope of new Set((asked.get('scope') || '').split(' ').filter(Boolean))) {
      const known = Object.hasOwn(T.scopes, scope) ? T.scopes[scope] : null;
      if (known) { row(known[0], known[1]); continue; }
      // A scope this page has no words for is shown as it is, never hidden.
      const raw = document.createElement('code');
      raw.textContent = scope;
      row(raw, T.otherScope);
    }
    let claims = null;
    try { claims = JSON.parse(asked.get('claims') || 'null'); } catch { claims = null; }
    const names = new Set();
    for (const part of ['userinfo', 'id_token']) {
      if (claims && claims[part] && typeof claims[part] === 'object') {
        for (const key of Object.keys(claims[part])) names.add(key);
      }
    }
    if (names.size) row(T.claims, [...names].join(', '));
    $('asks-label').hidden = !list.children.length;
  }
  function decide(accept) {
    const buttons = [$('allow'), $('deny')];
    return act(accept ? $('allow') : $('deny'), accept ? T.allowing : T.cancelling, async () => {
      try {
        const result = await call('/api/auth/oauth2/consent', { accept, oauth_query: oauthQuery });
        if (!follow(result)) throw problem('service');
        const [lead, line] = accept ? T.allowed : T.refused;
        mood(accept ? 'jump' : 'idle');
        say(line);
        going(lead);
      } catch (error) {
        if (error.kind !== 'refused') return trouble(error, 'ask-wait', buttons);
        if (error.status === 401) return timedOut();
        if (error.status === 403) return stop('Not allowed', '', T.notAllowed, T.notAllowedNote(product));
        ended();
      }
    });
  }
  function timedOut() {
    title('Sign in again', '');
    mood('idle');
    say(T.timedOut);
    show('expired', $('title'));
  }
  async function consent() {
    title('Allow access', '');
    mood('work');
    say(T.moment);
    show('loading');
    if (!hasRequest) return ended();
    const [current, name] = await Promise.allSettled([call('/api/auth/get-session'), verifiedName()]);
    if (name.status === 'rejected') {
      return name.reason.kind === 'refused' ? ended() : retry(name.reason, consent);
    }
    if (current.status === 'rejected') {
      return current.reason.kind === 'refused' ? timedOut() : retry(current.reason, consent);
    }
    product = name.value;
    if (!current.value || !current.value.session) return timedOut();
    asks();
    title('Allow', `${product}?`);
    mood('idle');
    say(T.trust(product));
    show('ask');
  }

  // ---- Wiring --------------------------------------------------------------------------
  const on = (id, event, handler) => { const node = $(id); if (node) node.addEventListener(event, handler); };
  on('use-passkey', 'click', usePasskey);
  on('create-passkey', 'click', createPasskey);
  on('use-phone', 'click', () => { stopConditional(); phone(); });
  on('back-to-passkey', 'click', () => { stopConditional(); mood('idle'); passkeys(); });
  on('continue', 'click', carryOn);
  on('switch', 'click', () => signOut($('switch')));
  on('sign-out', 'click', () => signOut($('sign-out')));
  on('phone-form', 'submit', (event) => { event.preventDefault(); sendCode($('send-code')); });
  on('code-form', 'submit', (event) => { event.preventDefault(); checkCode(); });
  on('resend', 'click', () => sendCode($('resend')));
  on('change-number', 'click', () => { release('resend'); release('locked'); phone(); });
  on('code', 'input', () => {
    const input = $('code');
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    input.removeAttribute('aria-invalid');
    if (input.value.length === 6 && !acting) checkCode();
  });
  on('allow', 'click', () => decide(true));
  on('deny', 'click', () => decide(false));
  on('sign-in-again', 'click', () => { window.location.assign(`/sign-in?${oauthQuery}`); });
  // Back from the product: start clean instead of showing a finished state.
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });

  if (document.body.dataset.page === 'consent') consent(); else signIn();
})();
