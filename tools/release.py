# -*- coding: utf-8 -*-
"""Cut a release: bump the version, build the data, build the bundle.

One command owns the version number, because two places owning it is how a
build gets rejected at 11pm for reusing a versionCode. The rules Play enforces:

  versionCode   an integer that must rise with every single upload and may
                never repeat - not even for a build that was rejected, deleted
                or never published. It is invisible to buyers.
  versionName   what the listing shows. Ours is semver, and it is allowed to
                stay the same across two uploads if nothing user-facing moved.

    python tools/release.py show
    python tools/release.py build                  # bump code, keep name
    python tools/release.py build --version 1.1.0  # bump both
    python tools/release.py build --no-bump        # rebuild the same version
    python tools/release.py build --store-release  # require sale prerequisites
"""
import argparse
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRADLE = os.path.join(ROOT, 'android', 'app', 'build.gradle')
PBXPROJ = os.path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')
SW = os.path.join(ROOT, 'sw.js')
AAB = os.path.join(ROOT, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
APK = os.path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
DIST = os.path.join(ROOT, 'dist')

# Set at User scope by the toolchain install; repeated here so the script works
# from a bare shell, a scheduled task, or anywhere PATH has not been arranged.
ENV = {
    'ANDROID_HOME': r'C:\Android\sdk',
    'ANDROID_SDK_ROOT': r'C:\Android\sdk',
    'JAVA_HOME': r'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot',
}


def read_gradle():
    s = open(GRADLE, encoding='utf-8').read()
    code = int(re.search(r'versionCode (\d+)', s).group(1))
    name = re.search(r'versionName "([^"]+)"', s).group(1)
    return s, code, name


def run(cmd, cwd=ROOT, shell=False):
    env = dict(os.environ, **ENV)
    print('  $ %s' % (cmd if isinstance(cmd, str) else ' '.join(cmd)))
    r = subprocess.run(cmd, cwd=cwd, env=env, shell=shell)
    if r.returncode != 0:
        print('\n  Failed: %s' % (cmd if isinstance(cmd, str) else ' '.join(cmd)))
        sys.exit(r.returncode)


def cmd_show(_):
    _, code, name = read_gradle()
    print('\n  versionName   %s     (what buyers see)' % name)
    print('  versionCode   %-8s(what Play counts)' % code)
    for label, path in (('bundle', AAB), ('apk', APK)):
        print('  %-13s %s' % (label, '%.1f MB' % (os.path.getsize(path) / 1048576)
                              if os.path.exists(path) else 'not built'))
    print()


def cmd_build(args):
    # Run before changing either platform's version. Ordinary builds validate
    # billing behaviour; a store candidate also requires real public SDK keys
    # while the ordinary guard proves developer preview is local-browser only.
    guard = [sys.executable, os.path.join(ROOT, 'tools', 'check_billing.py')]
    if args.store_release:
        guard.extend(['--store-release', '--platform', 'android'])
    run(guard)

    s, code, name = read_gradle()
    new_code = code if args.no_bump else code + 1
    new_name = args.version or name

    if new_code != code or new_name != name:
        s = re.sub(r'versionCode \d+', 'versionCode %d' % new_code, s, count=1)
        s = re.sub(r'versionName "[^"]+"', 'versionName "%s"' % new_name, s, count=1)
        open(GRADLE, 'w', encoding='utf-8', newline='\n').write(s)

    # iOS carries the same numbers under different names. Bumping only one
    # is how the two stores end up shipping "the same" release under two
    # different version strings, which is then impossible to talk about.
    if os.path.exists(PBXPROJ):
        x = io.open(PBXPROJ, encoding='utf-8').read()
        x2 = re.sub(r'MARKETING_VERSION = [^;]+;', 'MARKETING_VERSION = %s;' % new_name, x)
        x2 = re.sub(r'CURRENT_PROJECT_VERSION = [^;]+;',
                    'CURRENT_PROJECT_VERSION = %d;' % new_code, x2)
        if x2 != x:
            io.open(PBXPROJ, 'w', encoding='utf-8', newline=chr(10)).write(x2)
            print('  ios project           %s (build %d)' % (new_name, new_code))

    # The web build's cache key rides along, so a native release and a web
    # release never disagree about which version of the files is current.
    sw = open(SW, encoding='utf-8').read()
    m = re.search(r'wayfinder-v(\d+)', sw)
    if m and not args.no_bump:
        bumped = 'wayfinder-v%d' % (int(m.group(1)) + 1)
        open(SW, 'w', encoding='utf-8', newline='\n').write(sw.replace(m.group(0), bumped))
        print('\n  service worker cache  %s' % bumped)

    print('  version               %s (build %d)\n' % (new_name, new_code))

    run(['npm', 'run', 'stage'], shell=True)
    # Both platforms, not just the one being built. Copying only Android is
    # how the iOS project quietly falls a release behind, and the next Mac
    # build ships last month's app.js without anybody noticing.
    run(['npx', 'cap', 'copy'], shell=True)
    # Absolute path on purpose. cmd does not put the working directory on PATH,
    # so a bare gradlew.bat is not found even when it is sitting right there.
    android = os.path.join(ROOT, 'android')
    run('"%s" bundleRelease assembleRelease' % os.path.join(android, 'gradlew.bat'),
        cwd=android, shell=True)

    os.makedirs(DIST, exist_ok=True)
    import shutil
    for src, ext in ((AAB, 'aab'), (APK, 'apk')):
        if os.path.exists(src):
            dst = os.path.join(DIST, 'wayfinder-%s-%d.%s' % (new_name, new_code, ext))
            shutil.copy2(src, dst)
            print('  %s  (%.1f MB)' % (dst, os.path.getsize(dst) / 1048576))

    print('\n  Next:  python tools/play.py upload --track internal '
          '--notes "..." --yes\n')


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('show', help='current version and what is built')
    b = sub.add_parser('build', help='bump the version and build the bundle')
    b.add_argument('--version', help='new versionName, e.g. 1.1.0')
    b.add_argument('--no-bump', action='store_true',
                   help='rebuild without changing anything; Play will reject '
                        'the upload as a duplicate versionCode')
    b.add_argument('--store-release', action='store_true',
                   help='require configured billing and sale-safe preview guards before building')
    args = p.parse_args()
    {'show': cmd_show, 'build': cmd_build}[args.cmd](args)


if __name__ == '__main__':
    main()
