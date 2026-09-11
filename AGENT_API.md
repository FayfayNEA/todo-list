# Tracker API — for agents

Post daily priorities into a checklist at **https://checklist-tracker-pi.vercel.app**

## Auth

Every request needs this header:

```
Authorization: Bearer <your agent token>
```

Each account has its own token and its own list — a token only ever reads and writes the
list of the account it belongs to. To find yours: sign in to the app and click **agent
token** under the title, then copy it.

Requests without a token, or with one that has been signed with the wrong secret, get `401`.

The single shared passphrase this app started with also still works and still points at
the owner's list, so scripts written before accounts existed keep running unchanged. It
should be retired (unset `APP_SECRET`) once the owner has an account: it was documented
here in plain text for eight days, on a file this project served publicly, so treat it as
known to anyone who looked.

---

## Post tasks to a day

`POST /api/day`

Queues one or more tasks. They appear in the app the next time it loads or the tab regains focus.

### Body

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | yes | Strings, or objects (see below) |
| `date` | string | no | `YYYY-MM-DD`. Defaults to today (UTC). |
| `category` | string | no | `work` or `personal`. Default `work`. Applies to every item unless an item overrides it. |

Each entry in `items` is either a plain string, or an object:

```json
{ "text": "Review Venice feedback", "category": "personal", "date": "2026-09-05" }
```

Per-item `category` and `date` override the top-level values.

### Example — simple

```bash
curl -X POST https://checklist-tracker-pi.vercel.app/api/day \
  -H "Authorization: Bearer $TRACKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      "Review Venice feedback",
      "Ship reverify flow",
      "Redesign auth email"
    ]
  }'
```

### Example — specific day, mixed categories

```bash
curl -X POST https://checklist-tracker-pi.vercel.app/api/day \
  -H "Authorization: Bearer $TRACKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-09-05",
    "items": [
      "Finish SDK liveness changes",
      { "text": "Call the vet", "category": "personal" }
    ]
  }'
```

### Response

```json
{ "ok": true, "queued": 3 }
```

Errors: `400` if no valid items, `401` if the token is wrong, `500` on server trouble.

---

## Read the current checklist

`GET /api/sync`

```bash
curl https://checklist-tracker-pi.vercel.app/api/sync \
  -H "Authorization: Bearer $TRACKER_TOKEN"
```

The response also carries an `account` object saying which account the token belongs to:

```json
{ "email": "you@example.com", "isOwner": false, "apiToken": "..." }
```

```json
{
  "days": {
    "2026-09-02": [
      { "id": "...", "text": "Check SDK for updates", "done": false, "category": "work" }
    ]
  },
  "backlog": [
    { "id": "...", "text": "Overhaul toasts", "done": false, "category": "work" }
  ]
}
```

Note: calling `GET /api/sync` also flushes the queue from `POST /api/day` into `days`.

---

## Accounts

`POST /api/auth`

The app uses this; an agent does not need it. `{ "action": "login", "email", "password" }`
returns `{ token, account }`, where `token` is a 90-day session token. Creating an account
takes `{ "action": "signup", "email", "password", "invite" }` and a valid invite code.

Failures: `400` malformed email or a password under 8 characters, `401` wrong email or
password, `403` wrong invite code, `409` that email already has an account, `503` accounts
are not configured on the server (see the env vars in the README of this repo).

---

## Notes

- Task text is capped at 500 characters.
- A token scopes every request to one account. There is no way to read or write another
  account's list, and no shared list.
- Posting the same task twice creates two entries — the API does not dedupe.
- Dates are plain `YYYY-MM-DD` with no timezone. The default is UTC's current date, so pass `date` explicitly if you're posting late at night in a US timezone.
- There is no endpoint for editing or completing a task — agents add, Fay checks off in the app.
