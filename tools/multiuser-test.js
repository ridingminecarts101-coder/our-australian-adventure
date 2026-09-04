/* End-to-end multi-user test — run this instead of buying three phones.
 *
 * WHY
 *
 * "How do I test sharing before the app is on a store" has a real answer:
 * a Supabase account is not a phone. Two independent clients in one browser
 * tab are two accounts as far as the server is concerned, and the server is
 * where every one of these bugs lived. This creates throwaway accounts, puts
 * them through the exact flows three phones would, and deletes them again.
 *
 * WHAT IT PROVES
 *
 *   - each device gets its OWN identity (the bug: they all shared one)
 *   - a third device joining does not disturb the first two
 *   - one device leaving does not remove the group from the others
 *     (the bug: one shared member row meant leaving deleted it for everyone)
 *   - a rename on one device is visible on the others
 *   - a stranger who is not in the group cannot read its rows
 *
 * HOW TO RUN
 *
 *   1. Run supabase/schema-cutover.sql.
 *   2. Turn ON Authentication -> Sign In / Providers -> Allow new users to
 *      sign up.  (Without it every account below is refused and the test
 *      says so rather than pretending to pass.)
 *   3. Open the app, then in the browser console:
 *
 *        const s = document.createElement('script');
 *        s.src = 'tools/multiuser-test.js'; document.head.appendChild(s);
 *        await runMultiuserTest();
 *
 * It writes only to throwaway accounts and removes them at the end. It never
 * touches your own account or your own list.
 */
async function runMultiuserTest({ keep = false } = {}) {
  const cfg = window.OAA_CONFIG || {};
  const R = { pass: 0, fail: 0, FAIL: [], notes: [] };
  const ok = (name, cond, detail) => {
    if (cond) { R.pass++; }
    else { R.fail++; R.FAIL.push(detail ? `${name} — ${detail}` : name); }
  };
  const mk = () => window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Three devices, three accounts ───────────────────────────────────
  const dev = { riley: mk(), elli: mk(), ryno: mk(), stranger: mk() };
  const id = {};
  for (const [name, client] of Object.entries(dev)) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) {
      return {
        blocked: true,
        why: error.message,
        advice: /signup|disabled/i.test(error.message)
          ? 'Anonymous sign-up is switched off, so devices cannot get their own '
            + 'identities and every phone falls back to the one shared account — '
            + 'which is the bug. Run supabase/schema-cutover.sql, then turn on '
            + '"Allow new users to sign up".'
          : 'Could not create a test account.',
      };
    }
    id[name] = data.user.id;
  }

  ok('each device gets its own identity',
     new Set(Object.values(id)).size === 4,
     Object.entries(id).map(([k, v]) => `${k}=${String(v).slice(0, 8)}`).join(' '));

  const code = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
  let groupId = null;
  const cleanup = [];

  try {
    // ── Riley makes a group ───────────────────────────────────────────
    const g = await dev.riley.from('groups')
      .insert({ name: 'Test group', join_code: code, created_by: id.riley })
      .select().single();
    ok('a device can create a group', !g.error, g.error && g.error.message);
    if (g.error) return finish();
    groupId = g.data.id;
    cleanup.push(() => dev.riley.from('groups').delete().eq('id', groupId));

    await dev.riley.from('group_members')
      .insert({ group_id: groupId, user_id: id.riley, display_name: 'Riley' });

    // ── Elli and then Ryno join ───────────────────────────────────────
    const joinAs = async (client, uid, name) => client.from('group_members')
      .insert({ group_id: groupId, user_id: uid, display_name: name });

    const e = await joinAs(dev.elli, id.elli, 'Elli');
    ok('a second device can join', !e.error, e.error && e.error.message);

    const before = await dev.riley.from('group_members').select('user_id').eq('group_id', groupId);
    const r = await joinAs(dev.ryno, id.ryno, 'Ryno');
    ok('a THIRD device can join', !r.error, r.error && r.error.message);

    const after = await dev.riley.from('group_members').select('user_id').eq('group_id', groupId);
    ok('the third device does not displace the others',
       (after.data || []).length === (before.data || []).length + 1,
       `${(before.data || []).length} members before, ${(after.data || []).length} after`);

    // ── Everyone can see everyone's name ──────────────────────────────
    const seen = await dev.ryno.from('group_members')
      .select('user_id, display_name').eq('group_id', groupId);
    const names = new Set((seen.data || []).map(m => m.display_name));
    ok('a device can read the other members', !seen.error, seen.error && seen.error.message);
    ok('names resolve for everyone, not just yourself',
       names.has('Riley') && names.has('Elli') && names.has('Ryno'),
       [...names].join(', ') || 'none visible');

    // ── A rename is visible to the others ─────────────────────────────
    await dev.ryno.from('group_members').update({ display_name: 'Ryno B' })
      .eq('group_id', groupId).eq('user_id', id.ryno);
    const renamed = await dev.riley.from('group_members')
      .select('display_name').eq('group_id', groupId).eq('user_id', id.ryno).maybeSingle();
    ok('a rename on one device shows on another',
       renamed.data && renamed.data.display_name === 'Ryno B',
       renamed.data ? renamed.data.display_name : 'not visible');

    // ── The shared list really is shared ──────────────────────────────
    const tick = await dev.elli.from('progress').upsert({
      adventure_id: 999901, completed: true, completed_by: 'Elli',
      completed_by_id: id.elli, user_id: id.elli, group_id: groupId,
    }, { onConflict: 'adventure_id,scope_id' });
    ok('a tick writes into the group', !tick.error, tick.error && tick.error.message);
    if (!tick.error) cleanup.push(() => dev.elli.from('progress').delete().eq('adventure_id', 999901));

    const sees = await dev.ryno.from('progress').select('*').eq('adventure_id', 999901);
    ok('another member sees that tick',
       (sees.data || []).length === 1, `${(sees.data || []).length} rows`);
    ok('the tick is attributed to a person, not a string',
       sees.data && sees.data[0] && sees.data[0].completed_by_id === id.elli);

    // ── A stranger sees nothing ───────────────────────────────────────
    const nosy = await dev.stranger.from('progress').select('*').eq('adventure_id', 999901);
    ok('someone outside the group cannot read it',
       (nosy.data || []).length === 0,
       `${(nosy.data || []).length} rows leaked to a stranger`);

    const nosyMembers = await dev.stranger.from('group_members')
      .select('user_id').eq('group_id', groupId);
    ok('a stranger cannot list the members',
       (nosyMembers.data || []).length === 0,
       `${(nosyMembers.data || []).length} members leaked`);

    // ── The bug that started this: one device leaving ─────────────────
    await dev.ryno.from('group_members').delete()
      .eq('group_id', groupId).eq('user_id', id.ryno);
    const left = await dev.riley.from('group_members').select('user_id').eq('group_id', groupId);
    ok('one device leaving does NOT delete the group for the others',
       (left.data || []).length === 2,
       `${(left.data || []).length} members left, expected 2`);

    const stillThere = await dev.elli.from('groups').select('id').eq('id', groupId).maybeSingle();
    ok('the group itself survives someone leaving', !!(stillThere.data));

  } finally {
    if (!keep) {
      for (const undo of cleanup.reverse()) { try { await undo(); } catch { /* best effort */ } }
      for (const client of Object.values(dev)) {
        try { await client.rpc('delete_my_account'); } catch { /* best effort */ }
        try { await client.auth.signOut(); } catch { /* best effort */ }
      }
    }
  }

  function finish() { return R; }
  return {
    passed: R.pass, failed: R.fail, FAIL: R.FAIL,
    verdict: R.fail === 0
      ? 'Sharing works with three devices, and outsiders see nothing.'
      : 'Something is wrong — see FAIL.',
  };
}

if (typeof window !== 'undefined') window.runMultiuserTest = runMultiuserTest;
