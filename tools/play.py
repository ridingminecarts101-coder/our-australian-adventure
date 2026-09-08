# -*- coding: utf-8 -*-
"""Google Play, from the command line.

Everything the Play Console does to a release, this does over the Publishing
API: upload a bundle, put it on a track, move it between tracks, run a staged
rollout up or down, halt one, and read back what is actually live.

WHY THIS EXISTS RATHER THAN JUST USING THE CONSOLE

The console is fine for the parts that happen once - creating the app, the
store listing, the content rating questionnaire. It is a poor fit for the parts
that happen every time: uploading a build, writing the same release notes
again, nudging a rollout from 10% to 20% on a Tuesday. Those are the parts
worth having in a script, because a script can be read, reviewed and repeated,
and because it can be run from a chat window without anybody logging in.

WHAT IT WILL NOT DO

Nothing here publishes without being told to. Every command that changes
anything is a dry run unless you pass --yes, and it prints exactly what it
would do first. A release going out is not something to discover afterwards.

There is also no "publish at 3pm on Thursday" here, because Play has no such
API. What Play has is staged rollout, and a scheduled job that calls
`rollout --percent` is how a timed release is actually built. See PLAY.md.

CREDENTIALS

A Google Cloud service account with the Play Developer API enabled, invited to
the Play Console with release permissions. Put its JSON key at
play-service-account.json in the project root - it is gitignored, and it is a
key to your store account, so treat it like the keystore.

    python tools/play.py doctor          check the credentials work
    python tools/play.py status          what is on each track
    python tools/play.py upload --track internal --notes "..."
    python tools/play.py promote --from internal --to production --percent 10
    python tools/play.py rollout --track production --percent 50
    python tools/play.py halt --track production
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE = 'app.wayfinder.mobile'
KEY_FILE = os.path.join(ROOT, 'play-service-account.json')
AAB = os.path.join(ROOT, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

# Play's four standard tracks. The console's names and the API's names do not
# match, and "Closed testing" being `alpha` over the API is the single most
# common way a script like this fails with a confusing 404.
#
# A custom closed track gets a generated id instead, so any name is accepted
# on the command line; these are only the ones worth suggesting. internal is
# the one to live on while anything is uncertain - it reaches testers in
# minutes with no review at all.
TRACKS = ['internal', 'alpha', 'beta', 'production']
CONSOLE_NAME = {
    'internal': 'Internal testing',
    'alpha': 'Closed testing',
    'beta': 'Open testing',
    'production': 'Production',
}
TRACK_HELP = ('internal | alpha (the console calls it "Closed testing") | '
              'beta ("Open testing") | production | a custom track id')
LANGUAGE = 'en-AU'


def die(msg, hint=None):
    print('\n  ' + msg)
    if hint:
        print('  ' + hint)
    sys.exit(1)


def service():
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        die('The Google API client is not installed.',
            'python -m pip install google-api-python-client google-auth')

    path = os.environ.get('PLAY_SERVICE_ACCOUNT', KEY_FILE)
    if not os.path.exists(path):
        die('No service account key at %s' % path,
            'See PLAY.md step 6. Set PLAY_SERVICE_ACCOUNT to use a different path.')

    creds = service_account.Credentials.from_service_account_file(path, scopes=[SCOPE])
    # cache_discovery is off because it wants a writable cache directory and
    # warns loudly when it cannot find one, which buries the real output.
    return build('androidpublisher', 'v3', credentials=creds, cache_discovery=False)


class Edit:
    """An edit is Play's unit of change: open one, make changes, commit.

    Nothing you do inside an edit is visible until commit, and abandoning one
    leaves the store exactly as it was. That is what makes a dry run here an
    honest dry run rather than a promise - the read-only commands genuinely
    open an edit, look, and throw it away.
    """

    def __init__(self, svc, commit=False):
        self.svc, self.should_commit, self.id = svc, commit, None

    def __enter__(self):
        self.id = self.svc.edits().insert(body={}, packageName=PACKAGE).execute()['id']
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is not None or not self.should_commit:
            try:
                self.svc.edits().delete(packageName=PACKAGE, editId=self.id).execute()
            except Exception:
                pass                      # an edit left open expires by itself
            return False
        self.svc.edits().commit(packageName=PACKAGE, editId=self.id).execute()
        return False


def track_state(svc, edit_id, name):
    try:
        return svc.edits().tracks().get(
            packageName=PACKAGE, editId=edit_id, track=name).execute()
    except Exception:
        return None


def describe(track):
    """One line per release on a track, in the words a person would use."""
    out = []
    for rel in track.get('releases', []) or []:
        codes = ', '.join(rel.get('versionCodes', []) or ['none'])
        status = rel.get('status', '?')
        if status == 'inProgress':
            pct = float(rel.get('userFraction', 0)) * 100
            status = 'rolling out to %g%% of people' % pct
        elif status == 'completed':
            status = 'live for everyone'
        elif status == 'halted':
            status = 'HALTED'
        elif status == 'draft':
            status = 'draft, not sent'
        out.append('      build %s — %s%s' % (
            codes, status,
            '  “%s”' % rel['name'] if rel.get('name') else ''))
    return out or ['      nothing']


# ── Commands ─────────────────────────────────────────────────────────

def cmd_doctor(args):
    """Everything that has to be true before a release can happen."""
    print('\nChecking the way to Google Play\n')

    path = os.environ.get('PLAY_SERVICE_ACCOUNT', KEY_FILE)
    print('  key file            %s' % ('found' if os.path.exists(path) else 'MISSING — ' + path))
    if not os.path.exists(path):
        die('Stop here and do PLAY.md step 6.')

    try:
        info = json.load(open(path, encoding='utf-8'))
        print('  service account     %s' % info.get('client_email', '?'))
        print('  cloud project       %s' % info.get('project_id', '?'))
    except Exception as e:
        die('That key file is not readable JSON: %s' % e)

    svc = service()
    try:
        with Edit(svc) as e:
            print('  API access          ok')
            for name in TRACKS:
                t = track_state(svc, e.id, name)
                print('  track %-11s %-17s %s' % (
                    name, CONSOLE_NAME[name], 'exists' if t else 'not used yet'))
    except Exception as e:
        msg = str(e)
        if 'not found' in msg.lower() or '404' in msg:
            die('Play does not know about %s.' % PACKAGE,
                'The app has to be created in the console first — PLAY.md step 4.')
        if '401' in msg or '403' in msg or 'permission' in msg.lower():
            die('The service account cannot touch this app.',
                'Invite it in Play Console → Users and permissions — PLAY.md step 7.')
        die('Could not reach Play: %s' % msg)

    print('  bundle             %s' % (
        '%.1f MB  %s' % (os.path.getsize(AAB) / 1048576, AAB) if os.path.exists(AAB)
        else 'not built yet — python tools/release.py build'))
    print('\n  Ready.\n')


def cmd_status(args):
    svc = service()
    print('\n%s on Google Play\n' % PACKAGE)
    with Edit(svc) as e:
        for name in TRACKS:
            t = track_state(svc, e.id, name)
            print('  %s  (%s)' % (CONSOLE_NAME[name], name))
            for line in (describe(t) if t else ['      nothing']):
                print(line)
    print()


def cmd_upload(args):
    if not os.path.exists(AAB):
        die('No bundle at %s' % AAB, 'python tools/release.py build')

    svc = service()
    size = os.path.getsize(AAB) / 1048576

    print('\n  Upload %s (%.1f MB)' % (os.path.basename(AAB), size))
    print('  to track            %s' % args.track)
    print('  release notes       %s' % (args.notes or '(none)'))
    if args.percent is not None:
        print('  staged rollout      %g%% of people' % args.percent)
    else:
        print('  rollout             everyone on that track')

    if not args.yes:
        print('\n  Dry run. Nothing was uploaded. Add --yes to do it.\n')
        return

    from googleapiclient.http import MediaFileUpload
    with Edit(svc, commit=True) as e:
        media = MediaFileUpload(AAB, mimetype='application/octet-stream', resumable=True)
        result = svc.edits().bundles().upload(
            packageName=PACKAGE, editId=e.id, media_body=media).execute()
        code = result['versionCode']
        print('\n  uploaded build %s' % code)

        release = {'versionCodes': [str(code)]}
        if args.notes:
            release['releaseNotes'] = [{'language': LANGUAGE, 'text': args.notes}]
        if args.percent is not None:
            release['status'] = 'inProgress'
            release['userFraction'] = args.percent / 100.0
        else:
            release['status'] = 'completed'

        svc.edits().tracks().update(
            packageName=PACKAGE, editId=e.id, track=args.track,
            body={'releases': [release]}).execute()
        print('  put on %s' % args.track)

    print('\n  Done. Internal testers see it within minutes; other tracks wait '
          'for review.\n')


def cmd_promote(args):
    """Move the build that is on one track onto another.

    Promotion rather than re-upload matters: it is the same bundle, already
    reviewed, so production gets the exact bytes the testers used.
    """
    svc = service()
    with Edit(svc) as e:
        src = track_state(svc, e.id, args.source)
        if not src or not src.get('releases'):
            die('Nothing is on %s to promote.' % args.source)
        codes = src['releases'][0].get('versionCodes') or []
        notes = src['releases'][0].get('releaseNotes')

    print('\n  Promote build %s' % ', '.join(codes))
    print('  from                %s' % args.source)
    print('  to                  %s' % args.target)
    if args.percent is not None:
        print('  staged rollout      %g%% of people' % args.percent)
    else:
        print('  rollout             everyone')

    if not args.yes:
        print('\n  Dry run. Nothing moved. Add --yes to do it.\n')
        return

    with Edit(svc, commit=True) as e:
        release = {'versionCodes': codes}
        if args.notes:
            release['releaseNotes'] = [{'language': LANGUAGE, 'text': args.notes}]
        elif notes:
            release['releaseNotes'] = notes
        if args.percent is not None:
            release['status'] = 'inProgress'
            release['userFraction'] = args.percent / 100.0
        else:
            release['status'] = 'completed'
        svc.edits().tracks().update(
            packageName=PACKAGE, editId=e.id, track=args.target,
            body={'releases': [release]}).execute()
    print('\n  Promoted.\n')


def cmd_rollout(args):
    """Change how many people a staged release reaches.

    100 finishes it and gives the build to everybody, which is a one-way door;
    anything less is reversible with halt.
    """
    svc = service()
    with Edit(svc) as e:
        t = track_state(svc, e.id, args.track)
        if not t or not t.get('releases'):
            die('Nothing is on %s.' % args.track)
        rel = dict(t['releases'][0])

    now = ('%g%%' % (float(rel.get('userFraction', 0)) * 100)
           if rel.get('status') == 'inProgress' else rel.get('status'))
    print('\n  Track               %s' % args.track)
    print('  build               %s' % ', '.join(rel.get('versionCodes', [])))
    print('  now                 %s' % now)
    print('  change to           %s' % ('everyone (this cannot be undone)'
                                        if args.percent >= 100 else '%g%%' % args.percent))

    if not args.yes:
        print('\n  Dry run. Nothing changed. Add --yes to do it.\n')
        return

    if args.percent >= 100:
        rel['status'] = 'completed'
        rel.pop('userFraction', None)
    else:
        rel['status'] = 'inProgress'
        rel['userFraction'] = args.percent / 100.0

    with Edit(svc, commit=True) as e:
        svc.edits().tracks().update(
            packageName=PACKAGE, editId=e.id, track=args.track,
            body={'releases': [rel]}).execute()
    print('\n  Done.\n')


def cmd_halt(args):
    """Stop a rollout.

    People who already have the build keep it - Play cannot take it back - but
    nobody else gets it, and the previous version stays what new installs
    receive. It is the first thing to reach for when something is wrong.
    """
    svc = service()
    with Edit(svc) as e:
        t = track_state(svc, e.id, args.track)
        if not t or not t.get('releases'):
            die('Nothing is on %s.' % args.track)
        rel = dict(t['releases'][0])

    print('\n  Halt the rollout of build %s on %s' % (
        ', '.join(rel.get('versionCodes', [])), args.track))
    print('  People who already have it keep it. Nobody else gets it.')
    if not args.yes:
        print('\n  Dry run. Nothing changed. Add --yes to do it.\n')
        return

    rel['status'] = 'halted'
    with Edit(svc, commit=True) as e:
        svc.edits().tracks().update(
            packageName=PACKAGE, editId=e.id, track=args.track,
            body={'releases': [rel]}).execute()
    print('\n  Halted.\n')


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = p.add_subparsers(dest='cmd', required=True)

    sub.add_parser('doctor', help='check credentials and permissions')
    sub.add_parser('status', help='what is on each track')

    up = sub.add_parser('upload', help='upload the built bundle to a track')
    up.add_argument('--track', default='internal', help=TRACK_HELP)
    up.add_argument('--notes', help="what changed, in the user's words")
    up.add_argument('--percent', type=float, help='staged rollout, 1-100')
    up.add_argument('--yes', action='store_true', help='actually do it')

    pr = sub.add_parser('promote', help='move a build between tracks')
    pr.add_argument('--from', dest='source', default='internal', help=TRACK_HELP)
    pr.add_argument('--to', dest='target', default='production', help=TRACK_HELP)
    pr.add_argument('--notes')
    pr.add_argument('--percent', type=float)
    pr.add_argument('--yes', action='store_true')

    ro = sub.add_parser('rollout', help='change a staged rollout percentage')
    ro.add_argument('--track', default='production', help=TRACK_HELP)
    ro.add_argument('--percent', type=float, required=True)
    ro.add_argument('--yes', action='store_true')

    ha = sub.add_parser('halt', help='stop a rollout')
    ha.add_argument('--track', default='production', help=TRACK_HELP)
    ha.add_argument('--yes', action='store_true')

    args = p.parse_args()
    {'doctor': cmd_doctor, 'status': cmd_status, 'upload': cmd_upload,
     'promote': cmd_promote, 'rollout': cmd_rollout, 'halt': cmd_halt}[args.cmd](args)


if __name__ == '__main__':
    main()
