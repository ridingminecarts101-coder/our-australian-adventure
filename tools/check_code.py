"""Static sweep for dead ends: unreferenced code, orphan DOM ids, unused CSS.

None of these break the app. They are the things that quietly rot - a function
nobody calls, an id the JS reaches for that no longer exists in the markup, a
style for a class that was renamed. Left alone they make every later change
harder to reason about.

Run from the repo root:  python tools/check_code.py
"""
import io
import os
import re
import sys

APP_FILES = ['app.js', 'world.js', 'config.js', 'land.js', 'countries.js', 'store.js']
HTML = 'index.html'
CSS = 'styles.css'

# Entry points and browser callbacks. Never "unused" even when nothing in our
# own source calls them by name.
ENTRY_POINTS = {
    'boot', 'runDiagnostics',
    # assigned to window / called from inline handlers
    'toggle', 'detail', 'rate', 'note',
}


def read(path):
    return io.open(path, encoding='utf-8') .read() if os.path.exists(path) else ''


def strip_noise(js):
    """Remove comments and string bodies so matches are real references."""
    js = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
    js = re.sub(r'(?m)//.*$', '', js)
    return js


def main():
    html = read(HTML)
    css = read(CSS)
    js_raw = '\n'.join(read(f) for f in APP_FILES)
    js = strip_noise(js_raw)

    problems, notes = [], []

    # ── 1. Functions nobody calls ─────────────────────────────────────
    defined = set(re.findall(r'(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', js))
    dead = []
    for name in sorted(defined):
        if name in ENTRY_POINTS:
            continue
        # A definition plus at least one other mention means it is used.
        uses = len(re.findall(r'\b' + re.escape(name) + r'\b', js))
        if uses <= 1:
            dead.append(name)
    if dead:
        problems.append(('Functions defined but never called', dead))

    # ── 2. Ids the JS reaches for that the markup does not have ──────
    html_ids = set(re.findall(r'\bid="([^"]+)"', html))
    wanted = set(re.findall(r"""[$(]\s*['"]#([A-Za-z][\w-]*)['"]""", js))
    wanted |= set(re.findall(r"""getElementById\(\s*['"]([\w-]+)['"]""", js))
    # Ids the app creates at runtime rather than declaring in index.html
    RUNTIME_IDS = {'memoryBox', 'tripStart', 'tripEnd', 'tripNotes', 'sql',
               'recTitle', 'recPlace', 'recAdmin', 'recCountry',
               'recCategory', 'recDesc'}
    missing = sorted(wanted - html_ids - RUNTIME_IDS)
    if missing:
        problems.append(('JS looks for ids that are not in index.html', missing))

    # ── 3. Ids in the markup nothing ever touches ────────────────────
    # Panel ids are resolved dynamically as '#' + b.dataset.tab, so they never
    # appear as literals. They are referenced by the data-tab values instead.
    dynamic_ids = set(re.findall(r'\bdata-tab="([^"]+)"', html))
    unused_ids = sorted(i for i in html_ids
                        if i not in wanted
                        and i not in dynamic_ids
                        and not re.search(r'\b' + re.escape(i) + r'\b', js)
                        and not re.search(r'#' + re.escape(i) + r'\b', css))
    if unused_ids:
        notes.append(('Ids in index.html that nothing references', unused_ids))

    # ── 4. CSS classes with nothing to style ─────────────────────────
    css_classes = set(re.findall(r'\.([a-z][\w-]*)', css))
    html_classes = set()
    for attr in re.findall(r'class="([^"]+)"', html):
        html_classes |= set(attr.split())
    orphan = []
    for c in sorted(css_classes):
        if c in html_classes:
            continue
        # class names built in template literals, e.g. class="stamp ${...}"
        if re.search(r'\b' + re.escape(c) + r'\b', js):
            continue
        orphan.append(c)
    if orphan:
        notes.append(('CSS classes not used in markup or JS', orphan))

    # ── 5. data-* hooks that nothing listens for ─────────────────────
    data_attrs = set(re.findall(r'\bdata-([a-z]+)\b', html)) | set(re.findall(r'\bdata-([a-z]+)=', js))
    unheard = sorted(a for a in data_attrs
                     if not re.search(r'dataset\.' + re.sub(r'-(.)', lambda m: m.group(1).upper(), a) + r'\b', js)
                     and not re.search(r'\[data-' + re.escape(a) + r'\]', js))
    if unheard:
        notes.append(('data- attributes with no handler', unheard))

    # ── 6. Files in the repo nothing points at ───────────────────────
    referenced = html + js_raw + read('manifest.json') + read('sw.js')
    loose = []
    for f in sorted(os.listdir('.')):
        if not os.path.isfile(f) or f.startswith('.'):
            continue
        if f.endswith(('.md', '.json', '.py')) or f in {'index.html', 'styles.css'}:
            continue
        if f not in referenced:
            loose.append(f)
    if loose:
        notes.append(('Files nothing references', loose))

    # ── 7. Leftovers from the rename ─────────────────────────────────
    stale = []
    for f in [HTML, CSS] + APP_FILES + ['manifest.json', 'sw.js']:
        body = read(f)
        if re.search(r'Our Australian Adventure', body):
            stale.append(f)
    if stale:
        problems.append(('Still says "Our Australian Adventure"', stale))

    # ── Report ────────────────────────────────────────────────────────
    print(f'app.js {len(read("app.js").splitlines())} lines · '
          f'world.js {len(read("world.js").splitlines())} lines · '
          f'{len(defined)} functions\n')

    for title, items in problems:
        print(f'PROBLEM — {title}:')
        for i in items:
            print(f'  x {i}')
        print()
    for title, items in notes:
        print(f'note — {title}:')
        for i in items:
            print(f'  · {i}')
        print()

    if not problems and not notes:
        print('Nothing dead, nothing orphaned.')
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
