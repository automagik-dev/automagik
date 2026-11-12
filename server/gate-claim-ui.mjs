// Static first-party UI. No owner secret or private state is interpolated into the page.
export function claimPage(mode, nonce) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Automagik sign-in</title><style nonce="${nonce}">
body{font:16px system-ui;max-width:42rem;margin:4rem auto;padding:0 1.5rem;background:#10131b;color:#eef0f8}button,input{font:inherit;padding:.7rem;margin:.3rem 0}button{cursor:pointer}input{width:90%}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:1.5rem 0}a{color:#b4c9ff}.hidden{display:none}li{margin:1rem 0}
</style><h1>Automagik</h1><p id="intro"></p><p id="message" role="status"></p>
<section id="claim" class="hidden"><label>Claim code from the host<input id="claim-code" type="password" autocomplete="off"></label><button id="claim-button">Claim with a passkey</button></section>
<section id="signin" class="hidden"><button id="signin-button">Sign in with a passkey</button><p><a href="/_gate/recovery">Use a recovery code</a></p></section>
<section id="recovery" class="hidden"><label>One-time recovery code<input id="recovery-code" type="password" autocomplete="off"></label><button id="recover-button">Recover and add a passkey</button></section>
<section id="settings" class="hidden"><h2>Your passkeys</h2><p>Add a second passkey now so another device can sign you in.</p><button id="add-button">Add a second passkey</button><ul id="keys"></ul><button id="codes-button">Replace recovery codes</button><p id="trust"></p><button id="logout-button">Sign out everywhere</button></section>
<section id="backup" class="hidden"><h2>Save these recovery codes</h2><p>Each works once. Store them somewhere safe; this list is shown only now.</p><pre id="codes"></pre></section>
<p><a href="/">Open workspace</a> · <a href="/_gate/sign-in">Sign in</a> · <a href="/_gate/settings">Sign-in settings</a></p>
<script nonce="${nonce}">
const mode=${JSON.stringify(mode)}, $=id=>document.getElementById(id), show=id=>$(id).classList.remove('hidden');
$('intro').textContent=mode==='claim'?'Claim this instance with the code available only on its host.':mode==='recovery'?'Use a recovery code to register a new passkey.':'One human, with passkeys on several devices.';
show(mode==='sign-in'?'signin':mode);
const from64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const to64=b=>b?btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null;
async function api(path,data){const r=await fetch('/_gate/'+path,{method:data?'POST':'GET',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'Request refused');return v}
function options(o){o.challenge=from64(o.challenge);if(o.user)o.user.id=from64(o.user.id);for(const list of [o.allowCredentials,o.excludeCredentials])if(list)for(const c of list)c.id=from64(c.id);return o}
function response(c){const r=c.response,out={id:c.id,rawId:to64(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),response:{clientDataJSON:to64(r.clientDataJSON)}};if(r.attestationObject){out.response.attestationObject=to64(r.attestationObject);out.response.transports=r.getTransports?.()||[]}else{out.response.authenticatorData=to64(r.authenticatorData);out.response.signature=to64(r.signature);out.response.userHandle=to64(r.userHandle)}return out}
function backup(v){if(v.recoveryCodes){$('codes').textContent=v.recoveryCodes.join('\\n');show('backup')}if(v.signInAgain){$('message').textContent='All previous sessions ended. Sign in again with your passkey.';show('signin')}}
async function register(kind,code){const p=await api(kind+'/options',code?{code}:{});const c=await navigator.credentials.create({publicKey:options(p.options)});const v=await api(kind+'/verify',{id:p.id,credential:response(c),...(code?{code}:{})});backup(v);if(v.offerSecondPasskey){$('claim-code').value='';$('claim').classList.add('hidden');show('settings');await keys()}return v}
async function keys(){const v=await api('passkeys');$('keys').replaceChildren();for(const key of v.passkeys){const li=document.createElement('li'),b=document.createElement('button');li.textContent='Passkey '+key.id.slice(0,12)+' ';b.textContent='Remove';b.onclick=()=>run(async()=>{const out=await api('passkeys/remove',{id:key.id});backup(out)});li.append(b);$('keys').append(li)}$('trust').textContent=v.local_trust_notice+' '+v.bot_trust_notice}
async function run(work){try{$('message').textContent='';if(!window.PublicKeyCredential)throw Error('This browser requires localhost or HTTPS for passkeys.');await work()}catch(e){$('message').textContent=e.message||'Passkey operation failed'}}
$('claim-button').onclick=()=>run(()=>register('claim',$('claim-code').value));
$('add-button').onclick=()=>run(()=>register('passkeys'));
$('recover-button').onclick=()=>run(async()=>{await register('recovery',$('recovery-code').value);$('recovery-code').value=''});
$('signin-button').onclick=()=>run(async()=>{const p=await api('signin/options',{});const c=await navigator.credentials.get({publicKey:options(p.options)});await api('signin/verify',{id:p.id,credential:response(c)});location.assign('/')});
$('codes-button').onclick=()=>run(async()=>backup(await api('recovery/codes',{})));
$('logout-button').onclick=()=>run(async()=>{await api('sign-out-everywhere',{});location.assign('/_gate/sign-in')});
if(mode==='settings')run(keys);
</script></html>`
}
