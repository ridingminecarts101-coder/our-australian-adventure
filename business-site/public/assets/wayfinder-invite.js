(() => {
  'use strict';
  const status = document.getElementById('inviteStatus');
  const actions = document.getElementById('inviteActions');
  const codeField = document.getElementById('inviteCode');
  const open = document.getElementById('openInstalledApp');
  const copy = document.getElementById('copyInviteCode');
  const values = new URLSearchParams(location.search);
  const raw = values.get('join');
  if (values.getAll('join').length !== 1 || raw === null || !/^[A-Za-z0-9]{6,32}$/.test(raw)) {
    status.textContent = 'This invitation has no valid group code. Ask the sender for a fresh link.';
    return;
  }
  const code = raw.toUpperCase();
  codeField.value = code;
  open.href = `wayfinder://invite?join=${encodeURIComponent(code)}`;
  actions.hidden = false;
  status.textContent = 'Invitation code ready. Open the installed app or copy the code.';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); }
    catch {
      codeField.select();
      if (!document.execCommand('copy')) {
        status.textContent = 'Select and copy the code shown above.';
        return;
      }
    }
    status.textContent = 'Join code copied. Open Wayfinder and choose Join Group.';
  });
})();
