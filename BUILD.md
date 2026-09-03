# Wayfinder — native build

Everything that can be done without a Mac, Node or an Apple account is done.
This file is where it picks up.

---

## Where it stopped, and why

| Step | State |
|---|---|
| App renamed to Wayfinder | ✅ done |
| Ownership + groups in the app code | ✅ done |
| Account deletion flow | ✅ done |
| Location, share, camera, reminders | ✅ done |
| Capacitor config, package.json, ignore list | ✅ written |
| Icons at every iOS and Android size | ✅ generated |
| `npx cap add ios` | ⛔ **needs Node** — not installed on this machine |
| Xcode build and signing | ⛔ **needs a Mac or cloud CI** |
| Supabase multi-user migration | ⛔ **needs you to run SQL** |

---

## 1. Run the migration (you, ~5 min)

This is the thing that makes the app safe for more than two people, and it has
to happen **before** anyone else installs it.

Open `supabase/schema-multiuser.sql`. It is written to be run in three passes:

1. **Sections 1 and 2** — creates the `groups` and `group_members` tables, adds
   `user_id` / `group_id` columns, re-keys `progress`. Safe to run now; changes
   no behaviour on its own.
2. **Backfill** — the commented block that puts your existing rows onto your
   account and a group. Replace the two UUIDs first. Your user id is in
   Supabase → Authentication → Users.
3. **Section 3, the cutover** — uncomment and run. This swaps the policies from
   "any signed-in user sees everything" to "you see your own rows and your
   group's".

> Run section 3 **after** the app build carrying ownership is live, not before.
> The app already writes `user_id`, so once it is deployed you are clear.

Also enable anonymous sign-in while you are in there:
**Authentication → Sign In / Providers → Anonymous** → on.

---

## 2. Install Node, then add the platforms (you, ~15 min)

Node is not on this machine. Get the LTS from [nodejs.org](https://nodejs.org),
then from the repo root:

```bash
npm install
npx cap add ios
npx cap add android
npm run sync
```

`webDir` is `.` — the site root — so `cap sync` copies the whole app in,
minus everything listed in `.capacitorignore`. The 1.2&nbsp;MB of adventure
data ships **inside the bundle**, so the app works on first launch with no
signal.

---

## 3. Wire the native plugins (me, once Node exists)

The web APIs the app uses now — `navigator.geolocation`, `navigator.share`,
`Notification`, the camera file input — all work inside a Capacitor WebView,
but the native plugins behave better and are what a reviewer expects to see:

| Web API in use today | Capacitor plugin to swap to |
|---|---|
| `navigator.geolocation` | `@capacitor/geolocation` |
| `navigator.share` | `@capacitor/share` |
| `Notification` | `@capacitor/local-notifications` |
| `<input capture>` | `@capacitor/camera` |

All four are already in `package.json`. The swap is a thin adapter layer —
the app keeps calling one function, which picks native or web at runtime.

---

## 4. Info.plist strings (me, in the Xcode project)

iOS rejects builds that request a permission without explaining why. These go
into `ios/App/App/Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Wayfinder uses your location to show adventures in the part of the world you are actually in.</string>

<key>NSCameraUsageDescription</key>
<string>Wayfinder uses the camera so you can add a photo to an adventure you have just done.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Wayfinder needs access to your photos so you can attach ones you have already taken.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>Wayfinder can save adventure photos back to your library.</string>
```

Write these as if a reviewer is reading them, because one is.

---

## 5. What Apple will want (you)

- **Developer Program**, US$99/year. Enrolment can take several days — start it
  before you need it.
- **Bundle ID** is `app.wayfinder.mobile`, set in `capacitor.config.json`.
  Change it now if you want something else; it is **permanent** after the first
  submission.
- **Screenshots** at the required device sizes, taken from a real build.
- **Privacy policy URL** and **support URL** — both can be plain pages on the
  existing GitHub Pages site.
- **Privacy labels**: this app collects photos and an account identifier.
  Declare both accurately.
- **Review notes**: say plainly that it works offline, uses location to find
  your region, and stores photos against adventures. Reviewers reject faster
  when they cannot tell what an app does.

---

## Still outstanding, and honestly assessed

**Coordinates.** `lat` and `lon` are `null` on all 1,204 entries. Today "Near
me" resolves your continent from the map's own boxes, which is genuinely useful
and needs no coordinates. Real distance sorting — "what is within 50km" — needs
a geocoding pass over every entry with human review of the ambiguous ones.
That is the largest remaining piece of work in the project, and it is worth
doing properly rather than fast.

**A home screen widget.** Would need native Swift, not Capacitor. Worth it
eventually — a stamp count on the home screen is exactly the sort of thing that
keeps an app open — but not before launch.
