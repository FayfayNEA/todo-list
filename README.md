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

## How the data is laid out

```
state.json                 the owner's list  (predates accounts; left exactly where it was)
inbox.json                 the owner's queue of agent-posted tasks
u/<id>/state.json          one list per account
u/<id>/inbox.json          one queue per account
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
