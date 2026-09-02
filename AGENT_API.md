# Tracker API — for agents

Post daily priorities into Fay's checklist at **https://checklist-tracker-pi.vercel.app**

## Auth

Every request needs this header:

```
Authorization: Bearer todolist123
```

Requests without it get `401`.

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
  -H "Authorization: Bearer todolist123" \
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
  -H "Authorization: Bearer todolist123" \
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
  -H "Authorization: Bearer todolist123"
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

## Notes

- Task text is capped at 500 characters.
- Posting the same task twice creates two entries — the API does not dedupe.
- Dates are plain `YYYY-MM-DD` with no timezone. The default is UTC's current date, so pass `date` explicitly if you're posting late at night in a US timezone.
- There is no endpoint for editing or completing a task — agents add, Fay checks off in the app.
