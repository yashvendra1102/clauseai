# Clause Guard AI — backend

A small, dependency-free Node.js backend for the Clause Guard AI dashboard in `public/index.html`.

It does three things:

1. Serves the dashboard at `/`.
2. Exposes `POST /api/analyze`, which the dashboard already calls.
3. Runs contract checks with either **built-in policy rules** (no API key needed) or **OpenAI** (optional).

> ⚠️ Clause Guard AI flags risks to help users ask better questions. It is not legal advice.

---

## Quick start

Requires Node.js 18+ (tested on Node 26). No `npm install` needed.

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Health check:

```bash
curl http://localhost:3000/api/health
```

You should see:

```json
{ "ok": true, "engine": "rules", "version": "1.0.0", "maxTextChars": 60000, "now": "..." }
```

For auto-reload during development:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

---

## Configuration

Copy `.env.example` to `.env` and edit what you need:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the server listens on. |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` locally if you prefer. |
| `MAX_TEXT_CHARS` | `60000` | Matches the dashboard’s character limit. |
| `MAX_BODY_BYTES` | `262144` | Hard cap on request size. |
| `MAX_POLICY_CHARS` | `20000` | Cap on custom policy text. |
| `RATE_LIMIT_WINDOW_MS` | `3600000` | Rate-limit window (1 hour). |
| `RATE_LIMIT_MAX` | `30` | Requests allowed per IP per window. |
| `ALLOWED_ORIGIN` | *(empty)* | Set only if the frontend is hosted on a different origin. |
| `ANALYSIS_ENGINE` | `auto` | `auto`, `rules`, or `openai`. |
| `OPENAI_API_KEY` | *(empty)* | Enables AI analysis in `auto` mode. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used in OpenAI mode. |
| `PUBLIC_DIR` | `public` | Folder containing `index.html`. |

### Engine behavior

| `ANALYSIS_ENGINE` | Key present | Behavior |
| --- | --- | --- |
| `auto` | No | Local rule-based checks. |
| `auto` | Yes | OpenAI; falls back to local rules if the provider fails. |
| `rules` | Any | Always local rules. No outbound AI calls. |
| `openai` | Yes | Always OpenAI. Errors are returned if it fails. |
| `openai` | No | Requests return a 502-style error message. |

The response includes an `engine` field (`"rules"` or `"openai"`) so you can tell which path ran.

---

## API

### `POST /api/analyze`

Request:

```json
{
  "text": "RESIDENTIAL LEASE AGREEMENT\n\n1. TERM AND RENEWAL...",
  "policy": "Optional custom policy rules. Omit to use the dashboard default."
}
```

Success response:

```json
{
  "title": "Residential Lease Agreement",
  "engine": "rules",
  "risks": [
    {
      "level": "high",
      "title": "Automatic renewal with a 90-day notice trap",
      "section": "Section 1 · Term and Renewal",
      "quote": "this Lease shall renew automatically for successive twelve (12) month terms",
      "found": "The agreement renews by itself unless you give notice 90 days ahead.",
      "rule": "Policy 1 — renewal should need explicit consent; notice windows over 30 days are a risk.",
      "plain": "If you do nothing, you are locked in for another whole term."
    }
  ]
}
```

`level` is one of `high`, `medium`, or `ok`. The dashboard normalizes anything else to `medium`.

Error responses use `{ "error": "message" }`:

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, missing `text`, or invalid `policy`. |
| `405` | Wrong method. Use `POST`. |
| `413` | Text or policy exceeds configured limits. |
| `429` | Rate limit reached. |
| `500` | Unexpected server error. |
| `502`-style message | OpenAI mode failed and the server was configured not to fall back. |

Other endpoints:

- `GET /api/health` — liveness + active engine.
- `GET /api/config` — public runtime config.
- `OPTIONS /api/*` — CORS preflight.

---

## Hosting the frontend separately

The dashboard calls a relative URL (`/api/analyze`) by default, which works when it is served by this backend.

If you keep the dashboard on another host (for example an Arena preview), do both:

1. Set the allowed origin on the backend:

   ```env
   ALLOWED_ORIGIN=https://your-frontend.example
   ```

2. Tell the dashboard where the API lives by defining this **before** the dashboard script:

   ```html
   <script>window.CLAUSE_GUARD_API_BASE = "https://your-backend.example";</script>
   ```

`public/index.html` already uses `window.CLAUSE_GUARD_API_BASE` when present, so no other frontend changes are required.

---

## Security notes

- Contract text is processed in memory; this backend does not store it in a database.
- Request bodies, text length, and request rate are capped.
- Static file serving blocks path traversal.
- Do not expose `OPENAI_API_KEY` in browser code. Keep it only in the server environment.
- Put the service behind HTTPS in production.
- The rate limiter is per-process and in-memory. Use a shared limiter if you run multiple instances.

---

## Project layout

```text
.
├── server.js              # HTTP server and routes
├── src/
│   ├── analyzer.js        # Rule-based + OpenAI analysis engines
│   ├── env.js             # .env loader and config
│   └── http-utils.js      # Body parsing, CORS, static files, helpers
├── public/
│   └── index.html         # Your dashboard
├── test/
│   └── analyzer.test.js   # Engine smoke tests
├── .env.example
└── README.md
```
