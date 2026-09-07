# Wayfinder — the build machine

What is installed, where, and how to get a second machine to the same place.
The store process lives in `PUBLISHING.md`; this is only the toolchain.

---

## What the Android build needs

| | Version | Where |
|---|---|---|
| Node.js | 24.19.0 LTS | `C:\Program Files\nodejs` |
| npm | 11.17.0 | with Node |
| JDK | Microsoft OpenJDK 21 | `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot` |
| Android SDK | command-line tools only | `C:\Android\sdk` |
| SDK packages | `platform-tools`, `platforms;android-36`, `build-tools;36.0.0` | |
| Python | 3.x with Pillow | for `tools/` |

No Android Studio. Capacitor only needs the SDK, the build tools and a JDK,
and Gradle brings its own wrapper — the IDE is 1 GB of things nothing here
calls.

Capacitor 8 requires Node 22 or newer, compileSdk 36 and JDK 21. All three are
above are current as of this build.

### Environment variables

Set at User scope, so they survive a reboot:

```
ANDROID_HOME      C:\Android\sdk
ANDROID_SDK_ROOT  C:\Android\sdk
JAVA_HOME         C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot
```

### Setting up from scratch

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Microsoft.OpenJDK.21
# then the command-line tools zip from developer.android.com, unpacked to
# C:\Android\sdk\cmdline-tools\latest
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

**Licences.** `sdkmanager --licenses` reads from a terminal and returns
"7 of 7 SDK package licenses not accepted" when it is fed from a pipe, which is
how it will be run from any script. Writing the SHA-1 hash files into
`C:\Android\sdk\licenses\` directly is the reliable way, and is what was done
here.

---

## What the iOS build needs

A Mac with Xcode 16 or newer. Nothing else — Capacitor 8 uses Swift Package
Manager, so there is no CocoaPods install and no `pod install` step, which is
also why `npx cap add ios` succeeded on Windows.

The whole `ios/` project is in git and already carries the permission strings,
the URL scheme, the encryption declaration and the app icon. On the Mac:

```bash
npm install
npm run stage
npx cap sync ios
npx cap open ios
```

Then set the signing team in Xcode and archive.

---

## Icons and splash screens

`npm run build:icons` regenerates every size for Android, iOS and the web from
one file, `icons/icon-512.png`.

It uses Pillow rather than `@capacitor/assets`, which depends on `sharp`, which
has no prebuilt binary for Node 24 and therefore wants a C++ toolchain to
install. `tools/build_icons.py` does the same job in about a hundred lines with
no compiler.

The fiddly part is the Android adaptive icon: Android draws a 108dp square and
crops it to whatever shape the launcher wants, so only the middle 72dp is
guaranteed to survive. The script keys the stars out of the rust gradient by
brightness and insets them to 60%, with the rust becoming a flat background
colour underneath. Handing Android the flat 512 would get the corners shaved
off.

---

## The staging step

`webDir` is `www`, and `tools/stage.mjs` builds it. Run it before any `cap
copy` or `cap sync` — `npm run sync`, `npm run android:aab` and
`npm run android:apk` all do it for you.

It exists because `webDir` used to be `.`, which was fine when the folder held
nothing but the app. It now holds `node_modules`, `android/` and `ios/`, and
Capacitor copies `webDir` wholesale into the bundle. The `SHIP` list in that
file is the definition of what is in the app; anything not on it is not.

---

## Checks

```bash
npm run check     # geography, dead code, content quality, SQL
```

and in a browser with the app open:

```js
const s = document.createElement('script'); s.src = 'tools/selftest.js';
document.head.appendChild(s); await runDiagnostics();
```

A full self-test run takes a few minutes and is much slower in a background
tab, because browsers clamp `setTimeout` to about a second in one — a 120 ms
wait becomes 1,000 ms and the suite has hundreds of them. Keep the tab in front
if you are timing it.
