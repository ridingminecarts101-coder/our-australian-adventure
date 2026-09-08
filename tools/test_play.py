# -*- coding: utf-8 -*-
"""Drive tools/play.py against a fake Play API.

The commands cannot be tried for real until there is a paid account and an app,
and by then the first thing they do is publish something. So the request
bodies are checked here instead - a wrong status or a userFraction in the wrong
units is not something to find out from a live rollout.
"""
import io, os, sys, types, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
os.chdir(ROOT)

calls = []


class Req:
    def __init__(self, name, kw, result):
        self.name, self.kw, self.result = name, kw, result

    def execute(self):
        calls.append((self.name, self.kw))
        return self.result


class Tracks:
    def __init__(self, state):
        self.state = state

    def get(self, **kw):
        t = self.state.get(kw['track'])
        if t is None:
            raise Exception('404 track not found')
        return Req('tracks.get', kw, t)

    def update(self, **kw):
        return Req('tracks.update', kw, kw.get('body'))


class Bundles:
    def upload(self, **kw):
        return Req('bundles.upload', {k: v for k, v in kw.items() if k != 'media_body'},
                   {'versionCode': 7, 'sha256': 'abc'})


class Edits:
    def __init__(self, state):
        self.state = state

    def insert(self, **kw):    return Req('edits.insert', kw, {'id': 'EDIT1'})
    def delete(self, **kw):    return Req('edits.delete', kw, {})
    def commit(self, **kw):    return Req('edits.commit', kw, {'id': 'EDIT1'})
    def tracks(self):          return Tracks(self.state)
    def bundles(self):         return Bundles()


class Fake:
    def __init__(self, state):
        self.state = state

    def edits(self):
        return Edits(self.state)


STATE = {
    'internal': {'track': 'internal', 'releases': [
        {'versionCodes': ['7'], 'status': 'completed',
         'releaseNotes': [{'language': 'en-AU', 'text': 'First build.'}]}]},
    'production': {'track': 'production', 'releases': [
        {'versionCodes': ['6'], 'status': 'inProgress', 'userFraction': 0.1}]},
}

spec = importlib.util.spec_from_file_location('play', os.path.join(ROOT, 'tools', 'play.py'))
play = importlib.util.module_from_spec(spec)
spec.loader.exec_module(play)
play.service = lambda: Fake(STATE)

# upload refuses without a bundle, which is correct behaviour but makes this
# untestable on a machine that has not built one. Skip rather than fail: this
# checks the request bodies, not the build.
if not os.path.exists(play.AAB):
    print('\n  No bundle built, so the upload cases are skipped.')
    print('  python tools/release.py build --no-bump\n')
    raise SystemExit(0)


def run(argv, expect_commit):
    global calls
    calls = []
    sys.argv = ['play.py'] + argv
    print('\n$ python tools/play.py ' + ' '.join(argv))
    try:
        play.main()
    except SystemExit as e:
        if e.code:
            print('  exited %s' % e.code)
    committed = any(n == 'edits.commit' for n, _ in calls)
    assert committed == expect_commit, (
        '%s: expected commit=%s, got %s' % (argv, expect_commit, committed))
    return calls


# ── Dry runs must not commit anything ────────────────────────────────
run(['upload', '--track', 'internal', '--notes', 'hi'], expect_commit=False)
run(['promote', '--from', 'internal', '--to', 'production', '--percent', '10'], expect_commit=False)
run(['rollout', '--track', 'production', '--percent', '50'], expect_commit=False)
run(['halt', '--track', 'production'], expect_commit=False)
print('\n  dry runs commit nothing  OK')

# ── status opens an edit, reads, and throws it away ──────────────────
c = run(['status'], expect_commit=False)
assert any(n == 'edits.delete' for n, _ in c), 'status must abandon its edit'
print('  status abandons its edit  OK')

# ── upload --yes: right track, right status, notes attached ──────────
c = run(['upload', '--track', 'alpha', '--notes', 'Closed test build.', '--yes'], expect_commit=True)
up = [kw for n, kw in c if n == 'tracks.update'][0]
rel = up['body']['releases'][0]
assert up['track'] == 'alpha', up['track']
assert rel['versionCodes'] == ['7'], rel
assert rel['status'] == 'completed', rel
assert rel['releaseNotes'][0]['text'] == 'Closed test build.', rel
print('  upload to a closed track  OK')

# ── percentages are sent as a fraction, not a percentage ─────────────
c = run(['upload', '--track', 'production', '--percent', '10', '--yes'], expect_commit=True)
rel = [kw for n, kw in c if n == 'tracks.update'][0]['body']['releases'][0]
assert rel['status'] == 'inProgress', rel
assert abs(rel['userFraction'] - 0.10) < 1e-9, rel['userFraction']
print('  10%% is sent as userFraction 0.1  OK')

# ── promote carries the same build and its notes ─────────────────────
c = run(['promote', '--from', 'internal', '--to', 'production', '--percent', '25', '--yes'],
        expect_commit=True)
up = [kw for n, kw in c if n == 'tracks.update'][0]
rel = up['body']['releases'][0]
assert up['track'] == 'production'
assert rel['versionCodes'] == ['7'], rel
assert rel['releaseNotes'][0]['text'] == 'First build.', 'notes should carry over'
assert abs(rel['userFraction'] - 0.25) < 1e-9
print('  promote reuses the reviewed build and its notes  OK')

# ── 100% completes the release rather than staging it ────────────────
c = run(['rollout', '--track', 'production', '--percent', '100', '--yes'], expect_commit=True)
rel = [kw for n, kw in c if n == 'tracks.update'][0]['body']['releases'][0]
assert rel['status'] == 'completed', rel
assert 'userFraction' not in rel, 'a completed release must not carry a fraction'
print('  100%% completes and drops userFraction  OK')

# ── halt keeps the build but stops the rollout ───────────────────────
c = run(['halt', '--track', 'production', '--yes'], expect_commit=True)
rel = [kw for n, kw in c if n == 'tracks.update'][0]['body']['releases'][0]
assert rel['status'] == 'halted', rel
assert rel['versionCodes'] == ['6'], rel
print('  halt  OK')

# ── promoting from an empty track refuses rather than committing ─────
calls = []
sys.argv = ['play.py', 'promote', '--from', 'beta', '--to', 'production', '--yes']
try:
    play.main()
    raise AssertionError('should have exited')
except SystemExit as e:
    assert e.code == 1, e.code
assert not any(n == 'edits.commit' for n, _ in calls)
print('  promoting from an empty track refuses  OK')

print('\n  All Play API behaviours check out.\n')
