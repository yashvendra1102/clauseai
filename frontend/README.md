# Clause Guard — Frontend Dashboard

Static frontend interface for Clause Guard AI contract-review dashboard.

## Deployment on Vercel
1. Import this `frontend` directory into Vercel as a new project.
2. Framework Preset: **Other** (Static HTML).
3. Root Directory: `frontend` (or repository root if deploying from repo subdirectory).
4. Build Command: Leave empty.
5. Output Directory: Leave empty (or `.`).

## Configuring Backend URL
To connect the frontend to your deployed backend:
- Option A: Set `localStorage.setItem('clauseguard.api_base', 'https://your-backend.vercel.app')` in your browser devtools console.
- Option B: Add `<script>window.CLAUSE_GUARD_API_BASE = "https://your-backend.vercel.app";</script>` in the `<head>` of `index.html`.
- Option C: If using a reverse proxy or same-domain deployment, leave it empty to use relative `/api/*` paths.

## Local Development
Run with any static server:
```bash
npx serve .
# or
python -m http.server 8080
```
