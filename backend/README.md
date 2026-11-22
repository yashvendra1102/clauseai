# Clause Guard — Backend API

Backend analysis API for the Clause Guard contract-review dashboard. Supports local offline rule analysis and OpenAI-backed analysis.

## Deployment on Vercel
1. Import this `backend` directory into Vercel as a new project.
2. Root Directory: `backend` (or repository root if deploying from repo subdirectory).
3. The serverless functions are located in `/api` (`/api/analyze`, `/api/health`, `/api/config`).
4. Set Environment Variables in the Vercel dashboard:
   - `OPENAI_API_KEY`: (Optional) Your OpenAI key if using AI mode.
   - `ANALYSIS_ENGINE`: `auto` (default), `rules`, or `openai`.
   - `ALLOWED_ORIGIN`: Your frontend URL (e.g. `https://clause-guard-frontend.vercel.app`), or leave unset to allow all origins.

## Local Development
```bash
# Run standalone server
npm start

# Run with file watch
npm run dev

# Run unit tests
npm test
```
