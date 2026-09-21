# Exhibition Lead Capture

A phone-friendly web app for capturing leads at a trade show. Your team opens a
link, photographs a business card, and the details are read automatically. They
tag the lead **Hot / Warm / Cold / Not a lead**, type what was discussed, and
carry on. At the end of the show, one button downloads an Excel file with
everyone's leads in it.

It is built to work with **no signal**. Exhibition halls have terrible wifi, so
every lead is saved on the phone first and uploaded whenever a connection comes
back. Nothing is lost mid-conversation.

---

## What it does

| | |
|---|---|
| **Scan a card** | Photograph the front and back. Claude reads the name, company, title, email, phone, website and address. Handles two-sided and non-English cards. |
| **Or type it in** | Every field is editable. The scan only fills in blanks — it never overwrites something you typed. |
| **Rate the lead** | Four big buttons: Hot, Warm, Cold, Not a lead. |
| **Record the conversation** | A free-text box for what you actually talked about, plus products discussed, a follow-up action and a due date. |
| **Works offline** | Leads save instantly on the phone. A badge at the top always tells you whether your work has reached the server. |
| **Installs like an app** | "Add to Home Screen" gives it an icon and a full screen, no browser bar. |
| **Exports to Excel** | One `.xlsx` with every lead, colour-coded by rating, clickable email and photo links, plus a summary tab counting leads per person. |

---

## Setting it up

You will do this once, and it takes about 20 minutes. You need three free
accounts: **GitHub** (you have this), **Supabase**, and **Vercel**. Plus an
**Anthropic API key** for the card reading.

### Step 1 — Create the database (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign up.
2. Click **New project**. Name it anything, e.g. `lead-capture`. Pick a region
   close to you (Singapore if you're in SEA). Set a database password and save
   it somewhere — you won't need it again, but Supabase will ask you to confirm
   you've stored it.
3. Wait about two minutes for it to finish setting up.
4. In the left sidebar click **SQL Editor** → **New query**.
5. Open the file [`supabase/schema.sql`](supabase/schema.sql) in this
   repository, copy all of it, paste it into the editor, and click **Run**.

   This creates the two tables, locks them down, and creates the `cards`
   storage bucket for the photos. It is safe to run again if you ever need to.

6. Now collect two values.

   **Project URL** — you don't need to hunt for this on a page. It is built
   from the project ID that is already in your dashboard's web address:

   ```
   https://supabase.com/dashboard/project/abcdefghijklmnop/...
                                          ^^^^^^^^^^^^^^^^ your project ID

   your Project URL = https://abcdefghijklmnop.supabase.co
   ```

   **The secret key** — go to **Project Settings** (the gear icon) →
   **API Keys**. Supabase is part-way through renaming these, so you will see
   one of two things. Take the secret one either way:

   | If the page shows | Copy this | Not this |
   |---|---|---|
   | New-style keys | **Secret key** (`sb_secret_…`) | `sb_publishable_…` |
   | Legacy keys | **`service_role`** (a long `eyJ…` string) | `anon` / `public` |

   Both work with this app. If the page offers both, take the **Secret key**:
   Supabase is retiring the legacy pair, and a secret key can be revoked on its
   own, whereas killing a leaked `service_role` key means rotating your
   project's whole JWT secret. If **API Keys** isn't in the sidebar, look under
   **API** or **Data API**; the page has moved around between Supabase versions.

   > That key is a master key for your database. It goes into Vercel's
   > environment variables and nowhere else — not into a chat, a doc, or the
   > code. It is only ever used on the server and never reaches a browser.

### Step 2 — Get an Anthropic API key

This is what reads the business cards. It is **separate from a Claude
subscription** — it's a pay-as-you-go developer account.

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in.
2. Go to **Billing** and add a small amount of credit. US$5 is plenty — reading
   a card costs roughly one US cent, so that's around 500 cards.
3. Go to **API keys** → **Create key**. Copy it. It starts with `sk-ant-`.
   You cannot view it again after closing the dialog.

### Step 3 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in **with GitHub**.
2. Click **Add New** → **Project**, and pick this repository.
3. Before clicking Deploy, open **Environment Variables** and add these five:

   | Name | Value |
   |---|---|
   | `SESSION_SECRET` | Any 32+ random characters. See below for how to make one. |
   | `TEAM_PASSCODE` | The shared code your team will type. e.g. `booth-2026` |
   | `TEAM_MEMBERS` | Your team's names, comma-separated. e.g. `Shas,Alice,Bob` |
   | `SUPABASE_URL` | The Project URL from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` key from step 1 |
   | `ANTHROPIC_API_KEY` | The `sk-ant-…` key from step 2 |

   To generate a `SESSION_SECRET`, run this in a terminal:

   ```bash
   openssl rand -base64 32
   ```

   Or just mash the keyboard for 40-odd characters — it only needs to be long
   and unguessable.

4. Click **Deploy**. After a minute you'll get a link like
   `https://lead-capture-xyz.vercel.app`.

If you miss a variable, opening the link shows you exactly which one is missing
rather than an error page.

### Step 4 — Hand it to your team

Send them the link and the team code. On their phone they should:

1. Open the link.
2. Tap their name, type the team code, tap **Sign in**.
3. **Add it to the home screen** — this is worth doing:
   - **iPhone (Safari):** Share button → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Add to Home screen*

   It then opens full-screen like a normal app and works without signal.

They stay signed in for 30 days.

### Step 5 — Before the show

Open the **Export** tab and create the exhibition (e.g. `OTC Asia 2026`). Every
lead captured after that is tagged with it, so you can export one show at a
time. Each person does this once on their own phone.

---

## Using it at the booth

1. Tap **Capture**.
2. Tap **Front**, photograph the card. The details fill in after a second or
   two, highlighted in green so you can check them.
3. Tap **Back** if the card has a second side worth reading.
4. Tap **Hot**, **Warm**, **Cold** or **Not a lead**.
5. Type what you talked about while it's fresh.
6. Tap **Save lead**. The form clears, ready for the next person.

**If there's no signal:** everything still works. The card photo is stored and
read automatically once you're back online, and the badge at the top says how
many leads are waiting. Don't sign out while it says leads are waiting —
signing out clears the phone.

---

## Getting the leads out

Open the **Export** tab and tap **Download**. You get an `.xlsx` file with:

- **Leads** sheet — one row per lead, with the rating colour-coded, email
  addresses and card photos as clickable links, and a filter row so you can sort
  by rating or by who captured it.
- **Summary** sheet — how many Hot / Warm / Cold each person captured.

By default leads marked *Not a lead* are left out; there's a checkbox to
include them.

The file always covers **everyone's** leads, not just the phone you're on. Any
leads still sitting unsynced on that phone are pushed first.

---

## Things worth knowing

**Cost.** Supabase and Vercel both have free tiers that comfortably cover this.
The only running cost is card reading, at roughly one US cent per card.

**Who can see what.** Anyone with the link and the team code can see and edit
every lead. That's deliberate — it's a shared booth pipeline, not private
notebooks. Change `TEAM_PASSCODE` in Vercel after a show if the code has been
passed around.

**Card photos are public-by-link.** The photo URLs contain a random ID and
can't be guessed, but anyone holding one can open it. This is what makes the
photo links in the Excel file work for whoever you send it to. If you'd rather
they expire, change `getPublicUrl` in `src/app/api/upload/route.ts` to
`createSignedUrl` — the trade-off is that the links in old exports stop working.

**Personal data.** You're storing names, emails and phone numbers of people who
handed you a card. Delete the rows in Supabase once you've moved them into your
CRM, and keep in mind whatever data rules apply to you.

**Deleting a lead** removes it for everyone, not just on your phone.

**Keys go in Vercel and nowhere else.** Not in a chat, a doc, a screenshot, a
support ticket or a commit. Nobody — no colleague, no support agent, no AI
assistant — needs to see them to help you: the app reads them from Vercel's
environment variables at run time.

### If a key leaks anyway

It happens. Rotate it, don't agonise:

| Key | How to rotate |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys → delete it → **Create key**. Do this one first; it's the one attached to a card. |
| `SUPABASE_SERVICE_ROLE_KEY`, new-style (`sb_secret_…`) | Supabase → Settings → API Keys → `⋮` next to the key → revoke → **New secret key**. |
| `SUPABASE_SERVICE_ROLE_KEY`, legacy (`eyJ…`) | Can't be revoked on its own. Either disable legacy keys on the **Legacy anon, service_role API keys** tab, or rotate the JWT secret under **JWT Keys** — both also invalidate the `anon` key. |
| `TEAM_PASSCODE` | Just change it in Vercel. Everyone re-enters it next time. |
| `SESSION_SECRET` | Change it in Vercel. Signs everyone out; they sign back in with the team code. |

Then update the value in Vercel → **Settings** → **Environment Variables** and
redeploy. A leaked Supabase key is the urgent one — it reads and writes your
whole leads table.

---

## Running it on your own machine

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev                    # http://localhost:3000
```

Other commands:

```bash
npm run build       # production build
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm run smoke       # end-to-end browser test, needs `npm run dev` running
npm run icons       # re-render the app icons from public/icon.svg
```

`npm run smoke` drives a real browser through the whole flow — sign in, go
offline, capture a lead, reload, come back online — and fails if anything is
lost along the way. It doesn't need real Supabase or Anthropic credentials.

---

## How it is put together

```
src/
  app/
    page.tsx              Session check, then the app
    login/                Team code + name picker
    api/
      auth/login          Checks the passcode, sets a signed cookie
      scan                Sends card photos to Claude, returns the fields
      upload              Puts a photo in Supabase Storage
      leads               GET everyone's leads, POST a batch from a phone
      events              The exhibitions you can tag leads with
      export              Builds the Excel file
  components/             The screens
  lib/
    local-db.ts           IndexedDB — the phone's copy, the source of truth
    sync.ts               Pushes the queue, pulls the team's leads
    card-scan.ts          The Claude prompt and tool schema
supabase/schema.sql       Tables, lockdown, storage bucket, upsert function
```

**Why the phone is the source of truth.** Each lead gets its ID generated on
the device, so a lead captured with no signal keeps its identity when it finally
uploads — re-sending can never create a duplicate. If the same lead is edited on
two phones while both are offline, the edit made later wins.

**The browser never talks to Supabase.** Everything goes through this app's own
API routes, which hold the keys and check the team code first. That's why the
database has row-level security on with no policies: even a leaked key grants
nothing.
