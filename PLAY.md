# Getting Wayfinder onto Google Play

Twelve steps. Steps 1–4 and 9 need you in a browser; the rest can be run from
the Claude chat once step 6 is done.

**Read step 0 before paying anything.** It decides whether this takes three
days or three weeks, and it cannot be changed afterwards.

---

## 0. The decision that sets your timeline

Google asks you to pick a **personal** or an **organisation** account when you
register, and the choice is permanent for that account.

| | Personal | Organisation |
|---|---|---|
| Cost | $25 once | $25 once |
| Verification | your government ID and address | a **D-U-N-S number** for the business |
| Setup delay | none | 0 if the business has a D-U-N-S already, **up to 30 days** if not (free to request) |
| **Closed test before you may publish** | **12 testers, opted in continuously for 14 days** | **not required** |
| Realistic time to a public listing | **~3–4 weeks** | ~1 week |

The 12-tester rule applies to personal accounts created after 13 November 2023,
which yours will be. Three things about it catch people out:

- **Internal testing does not count.** It has to be a *closed* test. Internal
  testing is still worth using — it is instant and needs no review — but the
  14-day clock only runs on closed.
- **The 14 days must be continuous, and the same 12 people must still be opted
  in when you apply.** Somebody who joins, tests for a week and leaves does not
  count, and their replacement starts the clock again for that slot.
- After 14 days you *apply* for production access, and that application is
  reviewed — usually under 7 days, sometimes longer.

So: personal account, start the closed test as early as you possibly can. It is
the long pole and everything else fits around it. If you have or can get a
D-U-N-S number for a registered business, the organisation account skips the
whole thing.

**Twelve testers is twelve Google accounts, not twelve devices.** Friends,
family, anyone with a Gmail address who will tap Accept once and leave the app
installed. They do not have to do anything after opting in, though Google has
started checking that the app was actually opened, so ask them to have a look.

---

## 1. Register — $25, once

<https://play.google.com/console/signup>

Pay with a card, verify your identity, pick the account type from step 0.
Verification is usually same-day but can take 48 hours.

## 2. Create the app

Play Console → **Create app**.

| Field | Value |
|---|---|
| App name | `Wayfinder: Places Worth Going` |
| Default language | English (Australia) |
| App or game | App |
| Free or paid | **Free** (the gem packs are in-app purchases) |

Free is not reversible — a free app can never become paid. It is the right
choice here regardless: the whole design is a large free list with an optional
unlock.

## 3. The store listing

Play Console → **Grow → Store presence → Main store listing**. Draft text,
already inside the character limits:

**Short description** (80 max, 79 used):

> 2,356 real places worth going, in 123 countries. Tick them off together.

**Full description** (4,000 max):

> Wayfinder is a list of places that are actually worth the trip — 2,356 of
> them, across 123 countries, each one written up by hand with what it is, how
> hard it is, what it costs and when to go.
>
> It is not a map you fill in yourself. It arrives full.
>
> **Tick them off together**
> Share one list with the people you travel with. Everyone sees what has been
> done and who did it, in real time, on their own phone.
>
> **Works with no signal**
> The whole list lives on your phone. Tick things off on a mountain, in a
> tunnel, on a plane — it catches up when you are back.
>
> **A passport that fills itself**
> A stamp for every country you tick something off in, dated. Achievements for
> the ones worth chasing.
>
> **Your own photos and notes**
> Attach a photo and write down what actually happened, against the place it
> happened. Private to you and the people you share with.
>
> **Trips**
> Bundle adventures into a plan with dates, and share the plan.
>
> **Hidden gems**
> Some entries are the places locals send you to rather than the ones on every
> list. They are an optional one-off purchase, by continent or all at once, and
> nothing else is behind them — every stamp, achievement and completion target
> counts only what you can already reach. You are never blocked by declining to
> pay.
>
> **What it does not do**
> No ads. No tracking. Your location is used once, when you press Near me, and
> never stored.

**Graphics** — Play will not let you publish without these:

| Asset | Size | Notes |
|---|---|---|
| App icon | 512×512 PNG | `icons/icon-512.png` — already the right size |
| Feature graphic | 1024×500 | required; the dot map on rust works |
| Phone screenshots | 2–8, min 1080px on the short side | see below |

Five screenshots that show what it actually is: the world map, a continent
drilled in, an adventure with a photo, the passport with stamps, a trip.
Take them on a real phone with the APK installed — Play accepts them straight
from the gallery.

## 4. The declarations

Play Console → **Policy → App content**. Every one of these is required. The
honest answers:

| Question | Answer |
|---|---|
| Privacy policy URL | `https://ridingminecarts101-coder.github.io/our-australian-adventure/privacy.html` |
| Ads | **No ads** |
| App access | All functionality available without restrictions — anonymous sign-in, no login |
| Content rating | Fill in the questionnaire. Expect **PEGI 3 / Everyone**, but see below |
| Target audience | 13+ (the community tab carries user content) |
| News app | No |
| COVID-19 apps | No |
| Data safety | see the table below |
| Government app | No |
| Financial features | No |
| Health | No |

**Content rating — the two questions that need care.** Say **yes** to
user-generated content (the Community tab), and mention that several entries
reference alcohol as part of describing a place — wineries, distilleries, pubs.
Both are true and both are minor; declaring them costs you a rating tier and
declaring them falsely gets the app pulled later.

**Data safety.** Say yes to collecting, and then:

| | |
|---|---|
| Photos | collected, **not** shared, optional, for app functionality |
| App activity (which places you ticked) | collected, not shared, required, app functionality |
| User IDs (anonymous account id) | collected, not shared, required, app functionality |
| Approximate location | collected, **not stored**, optional, app functionality |
| Data encrypted in transit | Yes |
| Users can request deletion | Yes — Me → Delete my account and all my data |
| Data used for tracking or advertising | **No** |

## 5. The in-app purchases

Play Console → **Monetise → Products → In-app products**. One **one-off**
product per continent plus the bundle (Play calls these "in-app products", not
subscriptions), ids exactly:

| Product ID | Name | Price |
|---|---|---|
| `app.wayfinder.mobile.gems.all` | Every hidden gem | $9.99 |
| `app.wayfinder.mobile.gems.oceania` | Oceania gems | $1.99 |
| `app.wayfinder.mobile.gems.north_america` | North America gems | $1.99 |
| `app.wayfinder.mobile.gems.europe` | Europe gems | $1.99 |
| `app.wayfinder.mobile.gems.asia` | Asia gems | $1.99 |
| `app.wayfinder.mobile.gems.middle_east` | Middle East gems | $1.99 |
| `app.wayfinder.mobile.gems.south_america` | South America gems | $1.99 |
| `app.wayfinder.mobile.gems.africa` | Africa gems | $1.99 |

**Only create the ones that hold gems.** An empty product is a refund request
and fails review. Which ones those are changes as content is added, so do not
trust a list written here - run:

```bash
python tools/check_parity.py
```

It counts the gems in each pack from the data and marks every product either
*create in both* or *do not create - empty*. The same list applies to App Store
Connect. The app hides empty packs by itself, by the same count.

See `REVENUE.md` before you commit to those prices — the evidence says the
bundle is worth $19.99.

Products cannot be created until a build carrying the Play Billing library has
been uploaded, so **do step 8 first and come back here.**

## 6. The service account — this is what lets the chat drive it

Ten minutes, once. Afterwards every release can happen from here.

1. **Play Console → Setup → API access → Choose a project to link → Create new
   project.** This makes a Google Cloud project and turns on the Play Developer
   API for it.
2. On the same page, **Create new service account** → follow the link into
   Google Cloud.
3. In Google Cloud: **Create service account**, name it `wayfinder-release`,
   no roles needed at the Cloud end, **Done**.
4. Click into it → **Keys → Add key → Create new key → JSON**. A file
   downloads. This is the only copy.
5. Save it as `play-service-account.json` in the project root. It is gitignored.
   **It can publish releases as you — treat it exactly like the keystore.**
6. Back in **Play Console → Users and permissions → Invite new user**, paste
   the service account's email (it ends `@…iam.gserviceaccount.com`), and grant
   it for this app only:
   - Release to testing tracks
   - Release to production
   - View app information

Then, in the chat:

```bash
python tools/play.py doctor
```

It checks the key, the API, the permissions and each track, and tells you which
step is wrong if one is.

## 7. Build

```bash
python tools/release.py build --version 1.0.0
```

Bumps the Play build number, stages the web files, syncs Capacitor, and
produces a signed bundle and a signed APK in `dist/`. One command owns the
version number so an upload can never be rejected for reusing one.

## 8. Internal testing — the same day

```bash
python tools/play.py upload --track internal --notes "First build." --yes
```

Play Console → **Testing → Internal testing → Testers** — add your own email
and the other two phones, copy the opt-in link, open it on each phone, install
from Play.

Internal testing has no review and reaches testers in minutes. This is where
the group flow gets its real test, and where you find out whether a real
purchase works. **Come back and do step 5 now** — the billing library is
uploaded, so the products can be created.

**Test a real purchase.** Play Console → Setup → License testing → add your
own Gmail. Licence testers see the real payment sheet and are never charged.

## 9. Closed testing — start this the moment step 8 works

Play Console → **Testing → Closed testing → Create track**.

Add the 12 testers by email, or make a Google Group and add the group — the
group is easier, because you can add people later without touching the console.

```bash
python tools/play.py promote --from internal --to alpha --yes
```

**`alpha` is not a typo.** The console says "Closed testing"; the API calls
that same track `alpha`. Getting this wrong gives you a 404 that says nothing
useful. `python tools/play.py doctor` prints both names side by side.

Send everyone the opt-in link. Ask them to install it and open it once. **Then
wait 14 days**, and do not let anybody opt out.

Meanwhile: finish the screenshots, the feature graphic and the listing.

## 10. Apply for production

After 14 continuous days with 12 testers still enrolled: Play Console →
**Dashboard → Apply for production**. It asks how you recruited testers, what
feedback you got and what you changed. Answer it properly — it is read by a
person. Usually under 7 days.

## 11. Go live, slowly

```bash
python tools/play.py promote --from alpha --to production --percent 10 --yes
```

Ten per cent first. Watch **Quality → Android vitals** for a day — crash rate
and ANR rate are the two that matter — then:

```bash
python tools/play.py rollout --track production --percent 50 --yes
python tools/play.py rollout --track production --percent 100 --yes
```

If something is wrong:

```bash
python tools/play.py halt --track production --yes
```

Halting stops anybody new getting the build. People who already have it keep it
— Play cannot take an app back — so the fix is a new build, not a rollback.

---

## Afterwards: shipping an update from this chat

```bash
python tools/release.py build --version 1.1.0
python tools/play.py upload --track internal --notes "What changed." --yes
# testers confirm it works
python tools/play.py promote --from internal --to production --percent 10 --yes
python tools/play.py rollout --track production --percent 100 --yes
```

`python tools/play.py status` prints what is on every track at any time.

**Every command that changes anything is a dry run unless you add `--yes`.** It
prints exactly what it would do first. Ask me to run any of them and I will
show you the dry run before doing it for real.

### About scheduling

Play has no "publish at 9am on Thursday" API — the console does not have that
button either. What it has is staged rollout, and the honest way to build a
timed release is a scheduled job that calls `rollout --percent` on a clock.

That can be set up from this chat if you want it. Be aware of what it means: a
machine increasing your live rollout while nobody is watching the crash graph.
The safer shape, and the one worth defaulting to, is a scheduled job that
*checks vitals and tells you*, leaving the decision to you.

---

## Not needed, in case you are wondering

- **No Android Studio.** `BUILD.md` covers the toolchain; it is the SDK, a JDK
  and Gradle's own wrapper.
- **No Mac.** That is Apple's half.
- **No CI.** Everything runs on this machine, from this chat.

## Reference

- Testing requirements: <https://support.google.com/googleplay/android-developer/answer/14151465>
- Account types: <https://support.google.com/googleplay/android-developer/answer/13634885>
- Publishing API: <https://developers.google.com/android-publisher>
