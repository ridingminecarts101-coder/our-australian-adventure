'use strict';
const assert = require('assert');
const { harness, deferred } = require('./test_auth_upgrade');

async function main() {
  const h = harness(), run = h.run;
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const anonymous = { id: A, is_anonymous: true };
  const verified = { id: A, email: 'fixture@example.test', email_confirmed_at: '2026-09-14', is_anonymous: false };
  h.context.anonymous = anonymous; h.context.verified = verified;
  h.context.location.pathname = '/our-australian-adventure/';
  h.context.location.search = '?a=123&error=access_denied';
  h.context.location.hash = '#error_code=otp_expired&error_description=%3Cscript%3Eevil%3C%2Fscript%3E';
  let replaced;
  h.context.history.replaceState = (_state, _title, url) => { replaced = url; };
  const message = run('consumeAuthLinkError()');
  assert(message.includes('expired'));
  assert(!message.includes('evil'));
  assert.equal(replaced, '/our-australian-adventure/?a=123');
  h.context.location.search = ''; h.context.location.hash = '#access_token=untouched';
  replaced = null;
  assert.equal(run('consumeAuthLinkError()'), '');
  assert.equal(replaced, null, 'valid callback belongs to Supabase and is left intact');

  let sends = 0, supplied;
  h.context.mockSb = { auth: { resend: async args => { sends++; supplied = args; return {error:null}; } } };
  run('sb=mockSb; userId=null; authGeneration=1');
  assert.equal(await run("resendVerificationEmail('')"), false);
  assert.equal(sends, 0);
  assert.equal(await run("resendVerificationEmail(' fixture@example.test ')"), true);
  assert.equal(supplied.type, 'signup');
  assert.equal(supplied.email, 'fixture@example.test');
  assert.equal(supplied.options.emailRedirectTo, 'https://example.test/wayfinder/');
  const waiting = deferred(); h.context.mockSb.auth.resend = () => { sends++; return waiting.promise; };
  const pendingSend = run("resendVerificationEmail('fixture@example.test')");
  assert.equal(await run("resendVerificationEmail('fixture@example.test')"), false);
  run(`userId='${B}'; authGeneration++`);
  h.elements.get('#lockMsg').textContent = 'New account screen';
  waiting.resolve({error:null});
  assert.equal(await pendingSend, false);
  assert.equal(h.elements.get('#lockMsg').textContent, 'New account screen');
  assert.equal(run('verificationResendBusy'), false);

  function reset() {
    run(`userId='${A}'; accountUser=anonymous; accountIsAnonymous=true; authGeneration++;
      accountUiReady=true; passwordRecoveryMode=false; accountDeletionInProgress=false;
      writeAccountUpgrade(userId,'awaiting-email'); writeLS(LS.progress,[{memory:'keep'}]);`);
  }
  reset();
  const savedProgress = h.values.get('oaa.progress.v1');
  h.context.mockSb.auth.getUser = async () => ({data:{user:anonymous},error:null});
  assert.equal(await run('refreshPendingEmailVerification()'), false);
  assert.equal(run('readAccountUpgrade().stage'), 'awaiting-email');
  h.context.mockSb.auth.getUser = async () => {throw new Error('offline');};
  assert.equal(await run('refreshPendingEmailVerification()'), false);
  assert.equal(run('verificationRefreshBusy'), false);
  h.context.mockSb.auth.getUser = async () => ({data:{user:{...verified,id:B}},error:null});
  assert.equal(await run('refreshPendingEmailVerification()'), false);
  assert.equal(run('accountUser.id'), A);
  assert.equal(run('readAccountUpgrade().stage'), 'awaiting-email');
  h.context.mockSb.auth.getUser = async () => ({data:{user:verified},error:null});
  assert.equal(await run('refreshPendingEmailVerification()'), true);
  assert.equal(run('readAccountUpgrade().stage'), 'set-password');
  assert.equal(run('accountUser.id'), A);
  assert.equal(h.values.get('oaa.progress.v1'), savedProgress);
  assert.equal(h.elements.get('#lockBtn').textContent, 'Save password');

  reset();
  const late = deferred(); h.context.mockSb.auth.getUser = () => late.promise;
  const pendingRefresh = run('refreshPendingEmailVerification()');
  assert.equal(await run('refreshPendingEmailVerification()'), false);
  run(`userId='${B}'; authGeneration++; clearAccountUpgrade();`);
  late.resolve({data:{user:verified},error:null});
  assert.equal(await pendingRefresh, false);
  assert.equal(run('readAccountUpgrade()'), null);
  assert.equal(h.values.get('oaa.progress.v1'), savedProgress);
  reset(); run('passwordRecoveryMode=true');
  assert.equal(await run('refreshPendingEmailVerification()'), false);
  run('passwordRecoveryMode=false; accountDeletionInProgress=true');
  assert.equal(await run('refreshPendingEmailVerification()'), false);

  // The real native lifecycle registration and manual button must both reach
  // the same guarded refresh path; an inactive transition must do nothing.
  const nativeListeners = new Map(); let refreshCalls = 0;
  h.context.refreshProbe = () => { refreshCalls++; };
  h.context.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {
    App: { addListener: (name, callback) => nativeListeners.set(name, callback), exitApp() {} },
  } };
  run(`refreshPendingEmailVerification=async()=>{ refreshProbe(); return true; };
    wireNative(); wireAccountLock();`);
  assert(nativeListeners.has('appStateChange'));
  nativeListeners.get('appStateChange')({isActive:false});
  assert.equal(refreshCalls, 0);
  nativeListeners.get('appStateChange')({isActive:true});
  assert.equal(refreshCalls, 1);
  await h.elements.get('#checkVerificationBtn').onclick();
  assert.equal(refreshCalls, 2);

  // Startup failure keeps only a usable retry submission visible.
  run('showStartupError()');
  assert.equal(h.elements.get('#lockBtn').textContent, 'Try again');
  assert(!h.elements.get('#lockForm').classList.contains('hidden'));
  for (const id of ['#accountEmail','#accountPassword','#resendVerificationBtn','#checkVerificationBtn',
    '#createAccountBtn','#forgotPasswordBtn']) {
    assert(h.elements.get(id).classList.contains('hidden'), `${id} must not remain active on startup failure`);
  }
  console.log('Auth configuration: invalid-link recovery, exact redirects, resend, deduplication, verified same-owner resume, failures and account boundaries passed');
}
main().catch(error=>{console.error(error);process.exit(1);});
