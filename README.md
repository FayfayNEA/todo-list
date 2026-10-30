# failenn playground

A daily checklist that syncs across your devices, with a small API your agents can post
priorities into. One static `index.html`, three serverless functions, and Vercel Blob as
the store. Live at **https://checklist-tracker-pi.vercel.app**.

## Accounts

Anyone with the URL can make an account; no invite code is needed. Setting
`SIGNUP_CLOSED=1` shuts that again, leaving invitations as the only way in. Each account gets its own
list; nothing is shared between them.

Three environment variables turn accounts on:

| Variable | What it does |
|---|---|
| `AUTH_SECRET` | Signs session and agent tokens. Must be at least 16 characters — until it is, accounts stay switched off and `/api/auth` answers `503`. Never rotate it casually: everyone gets signed out. |
| `INVITE_CODE` | Only matters while `SIGNUP_CLOSED=1`: then it's what someone has to type to create an account. |
| `SIGNUP_CLOSED` | Optional. `1` turns open signup off, so only invitations work. |
| `OWNER_EMAIL` | The account that inherits the list which predates accounts. Set this **before** signing up with that email. |
| `APP_SECRET` | The original single passphrase. Still valid, still points at the owner's list, so scripts and bookmarks made before accounts keep working. Safe to remove once nothing uses it. |
| `RESEND_API_KEY` | Optional. Lets the owner email an invitation instead of copying the link by hand. Without it, invitations are still created — they just aren't delivered. |
| `MAIL_FROM` | Optional, required alongside `RESEND_API_KEY`. The sending address, e.g. `hello@yourdomain.com`. It has to be on a domain verified with Resend; their sandbox sender only delivers to your own address. |

Setting them up:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | vercel env add AUTH_SECRET production
echo "some-code-you-pick" | vercel env add INVITE_CODE production
echo "you@example.com" | vercel env add OWNER_EMAIL production
vercel --prod
```

Then open the app, choose *make one*, and sign up with the `OWNER_EMAIL` address — that
account picks up the existing list rather than starting empty.

## Inviting people

The owner gets an **invite someone** panel under the gear. Give it an email address and it
makes a code of its own — good once, revocable until it's used — along with a link that
fills the code in for whoever opens it. That link is the reliable path; emailing it is a
convenience on top.

If `RESEND_API_KEY` and `MAIL_FROM` are set, the invitation is emailed as well. Be aware
that Resend's sandbox sender only delivers to the address that owns the Resend account, so
sending to a friend needs a domain you've verified with them. The panel says plainly when
a message didn't go out, and the invitation still exists to copy by hand.

The original shared `INVITE_CODE` keeps working alongside personal codes, so anything
already handed out is unaffected.

## Feeding Notion

The Design To-Do page in Notion is what other people read to see what design is working
on. Keeping it current by hand means maintaining the same list twice, so the checklist
writes into it instead: **put a star at the end of a work task and it becomes a row in
the Backlog database.**

```
Website handoff *          -> a row in Notion, dated to the day it sits on
check in with website      -> stays here
order mascaura *           -> stays here; personal never leaves this app
```

The star is what makes it deliberate. A day here is mostly small chatter, and sending all
of it would bury the real priorities in a page other people read.

What crosses over, and when:

| in the checklist | in Notion |
|---|---|
| a starred task appears | a row is created — or the row of the same name is adopted, so nothing is duplicated |
| you tick it off | `Status` becomes **Done** |
| you untick it | back to **In progress** |
| you drag it to another day | `Date` and `Week` follow it |
| you take the star off | it stops syncing; the row stays as it is |
| you delete the task | the row stays as it is |

It is one direction only, and it never deletes. Notion is not read back into the
checklist: `Status` is written only when this app actually knows it (ticked, or a brand
new row), so **In progress** and **Blocked** set by hand in Notion survive. Rows nobody
starred are left alone entirely.

Syncing happens inside the save, within a second or so of you typing the star. A task
whose text, day and tick state have not changed costs nothing — no Notion call is made at
all — and if Notion is down the save still succeeds and says so in its response.

### Turning it on

Two environment variables, both required; without them the whole thing is a no-op and the
app behaves exactly as it did before.

| Variable | What it does |
|---|---|
| `NOTION_TOKEN` | An internal integration token from [notion.so/my-integrations](https://www.notion.so/my-integrations). It needs **Insert content** and **Update content** on top of read. |
| `NOTION_BACKLOG_DB` | The Backlog database's id — `f0cb3a6bf2a047e8b284aff447b93ed3` for the current Design To-Do page. |

Make the integration, then open the Design To-Do page in Notion, and under **⋯ →
Connections** add it. A token that has not been given the page sees nothing, which looks
exactly like a wrong database id.

```bash
echo "ntn_..." | vercel env add NOTION_TOKEN production
echo "f0cb3a6bf2a047e8b284aff447b93ed3" | vercel env add NOTION_BACKLOG_DB production
vercel --prod
```

Then check the stars are where you think they are, and push the first batch:

```bash
curl -s https://checklist-tracker-pi.vercel.app/api/notion-sync \
  -H "Authorization: Bearer $TRACKER_TOKEN"            # what is starred, no Notion calls

curl -s -X POST https://checklist-tracker-pi.vercel.app/api/notion-sync \
  -H "Authorization: Bearer $TRACKER_TOKEN"            # push all of it, changed or not
```

`GET` answers before a token is ever set, so it is also the way to check the stars on
their own. `POST` is the one to reach for after Notion has been down.

## How the data is laid out

```
state.json                 the owner's list  (predates accounts; left exactly where it was)
inbox.json                 the owner's queue of agent-posted tasks
notion-map.json            which Notion row each starred task became
u/<id>/state.json          one list per account
u/<id>/inbox.json          one queue per account
u/<id>/notion-map.json     one row map per account
users/<sha256(email)>.json { id, email, salt, scrypt hash }
invites/index.json         every invitation and whether it's been used
```

Passwords are scrypt hashes with a per-account salt. Sessions are HMAC-signed tokens
rather than rows in a table, so there's nothing to expire or clean up.

## Things it deliberately does not do

- **No password reset.** There's no mail sending, so a forgotten password means editing
  that account's `users/<hash>.json` out of the blob store by hand.
- **No rate limiting** on sign-in or signup. Signup is open, so if junk accounts show up, set
  `SIGNUP_CLOSED=1`; scrypt is
  what makes guessing a password slow.
- **No email verification.** The address is an identifier; the only thing ever sent to it
  is an invitation, and only if mail is configured.
- **Only the owner can invite.** Accounts made through an invitation cannot make their own.
- The eight polaroids are baked into `index.html` and only *shown* to the owner's account.
  Anyone determined enough to read the page source can still see them.

## Practice copy with pretend accounts

```bash
npm run dev:local     # then open http://localhost:4325/dev
```

The real page and the real `api/` handlers over an in-memory store, seeded with an owner
account and three pretend people (Mika, Jo, Ren) who each have a colour, a background,
stickers, a day, a backlog and a mood, and follow each other. `/dev` switches between
them with one tap. Nothing touches the live site's data, it all resets on restart, and
`dev/` is kept out of deploys by `.vercelignore`.

## Local development

```bash
vercel dev            # needs the env vars above, and writes to the real blob store
```

`api/` is Node serverless functions; `index.html` is the whole client.

```bash
npm test              # the Notion sync, against a stubbed Notion and the in-memory blob
```
