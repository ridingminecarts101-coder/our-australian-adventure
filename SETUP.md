# Wayfinder — setup

Four stages. Stages 1 and 2 only you can do (they involve signing in and setting
a password). Stage 3 is one file. Stage 4 is the phones.

Total time: about 20 minutes.

---

## Stage 1 — Supabase (10 min)

### 1.1 Create the tables

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and open your
   `our-australian-adventure` project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this repo, copy the **whole file**, paste it in.
4. Click **Run**.

You should see `Success. No rows returned.` That's correct — it created an empty
table, the security rules, and turned on live sync.

To check it worked, run this in a new query:

```sql
select * from public.progress;
```

Empty result, no error = good.

### 1.2 Create the one shared account

Both phones sign in as the same account. The passphrase you set here is the
passphrase you'll both type into the app.

1. Left sidebar → **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Fill in:
   - **Email**: something you both have access to, e.g. `rileyandelli@gmail.com`
   - **Password**: pick a passphrase you'll both remember. Make it a real
     passphrase — four random words is far better than one word with a `1` on the end.
   - **Auto Confirm User**: ✅ **tick this**. Without it the account can't sign in
     until someone clicks a confirmation email.
4. Click **Create user**.

> **Why one shared account instead of two?** You asked for a single passphrase
> and no personal accounts. Doing it this way keeps that exact experience while
> still letting the database reject everyone else — the alternative (no accounts
> at all) would mean leaving the database open to anyone who reads the app's
> JavaScript. The app still asks each phone "Riley or Elli?" so completions get
> attributed correctly.

### 1.3 Turn off public sign-ups

Otherwise strangers could create their own accounts and read your data.

1. **Authentication** → **Sign In / Providers** → **Email**.
2. Turn **Allow new users to sign up** ❌ **off**.
3. Save.

### 1.4 Copy your two keys

1. **Project Settings** (gear icon) → **Data API**.
2. Copy the **Project URL** — looks like `https://abcdefgh.supabase.co`
3. Go to **Project Settings** → **API Keys**.
4. Copy the **anon** / **publishable** key — a long string starting `eyJ...`

⚠️ Copy the **anon** key, **not** the `service_role` key. The service_role key
bypasses all security and must never go near this repo.

---

### 1.5 Add the photo album (optional, 1 min)

Only needed if you want photos attached to adventures.

1. **SQL Editor** → **New query**
2. Paste the whole of `supabase/schema-photos.sql`
3. **Run**

That creates a `photos` table and a **private** storage bucket called `memories`.
Private matters: the photos aren't readable by URL, so the app mints short-lived
signed links instead of leaving them open to anyone who guesses the address.

**How photos are handled:**

- Each one is resized to a 1600px long edge before upload — roughly 300–500 KB
  instead of the 3–5 MB an iPhone produces. On the free 1 GB tier that's around
  2,000 photos rather than about 250.
- The date shown is the **camera's own EXIF timestamp**, not the file date. File
  dates change whenever a photo is copied or synced between devices; EXIF doesn't.
  If a photo has no EXIF, the app falls back to the file date, then the date you
  ticked the adventure off, and says which it used.
- No signal? Photos are resized and queued on the phone, and upload themselves
  when you're back in range. The queue survives closing the app.
- Viewing photos needs a connection — the signed links can't be fetched offline.

### 1.6 Add trip planning (optional, 30 sec)

SQL Editor → New query → paste `supabase/schema-trips.sql` → Run.

Creates a `trips` table so a plan made on one phone shows up on the other.
Without it, trips still work but stay on the phone that made them.

---

## Stage 2 — GitHub Pages (5 min)

1. Go to your repo → **Settings** → **Pages**.
2. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`, folder `/ (root)`
3. **Save**.

Wait 1–2 minutes, then reload the Settings → Pages screen. It'll show your URL:

```
https://ridingminecarts101-coder.github.io/our-australian-adventure/
```

Every push to `main` from now on redeploys automatically.

> Using "Deploy from a branch" rather than GitHub Actions is deliberate — this is
> a plain static site with no build step, so a workflow file would be extra
> machinery doing nothing. It redeploys on push either way.

---

## Stage 3 — Fill in config.js (1 min)

Edit `config.js` and replace the three placeholders with the values from 1.2 and 1.4:

```js
window.OAA_CONFIG = {
  supabaseUrl:     'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
  sharedEmail:     'rileyandelli@gmail.com',
};
```

Commit and push. GitHub Pages redeploys in about a minute.

**Also delete `Our_Australian_Adventure_PWA.zip` from the repo** — it's the old
prototype and it's what's currently sitting in there instead of the site.

---

## Stage 4 — Both phones (2 min each)

On each iPhone:

1. Open **Safari** (this must be Safari — Chrome on iOS can't install web apps).
2. Go to your Pages URL.
3. Tap **Share** (the box with the arrow) → scroll down → **Add to Home Screen**.
4. Name it, tap **Add**.
5. Open it from the new home screen icon — ⚠️ **not** from Safari.
6. Type the passphrase.
7. Tap **Riley** or **Elli** as appropriate.

Do it on the other phone too, picking the other name.

### Test it

Tick something off on one phone. Within a few seconds the other phone should
show it, plus a note saying who ticked it.

> **Why "open it from the home screen icon, not Safari"?** On iOS, a home-screen
> web app has a completely separate storage container from Safari. Signing in
> inside Safari does not sign you in inside the app icon. Always use the icon.

---

## Troubleshooting

**"That passphrase didn't work."**
Check the email in `config.js` matches the user you created exactly, and that
you ticked Auto Confirm User in 1.2. In Supabase → Authentication → Users, the
account should not say "Waiting for verification".

**Page loads but says "Not connected to the shared database yet"**
`config.js` still has the `YOUR_...` placeholders, or the push hasn't deployed
yet. Check Actions/Pages in GitHub, then hard-refresh.

**One phone doesn't see the other's changes**
Both must be signed in and online. Go to **Me** → **Force refresh from server**.
If it says "Live updates reconnecting", realtime didn't attach — re-run the last
block of `schema.sql`.

**The app looks stale after a deploy**
The service worker serves the cached copy first and updates in the background,
so changes appear on the *second* launch. To force it: close the app fully
(swipe up from the app switcher) and reopen twice. When you change files, bump
`CACHE_VERSION` in `sw.js`.

**Changed the adventure data?**
Edit `data/src/*.jsonl`, then regenerate:

```bash
python tools/build_data.py
```

---

## What's deliberately not here

- **Two separate logins.** Not needed while it's the two of you sharing one list.
- **A map view.** Would need 500 accurate coordinates. Better to add real ones
  gradually than to generate 500 plausible-looking wrong ones.
