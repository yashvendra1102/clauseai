# Clause Guard (clauseai)

AI-powered contract-review dashboard with offline rule-based heuristics and OpenAI analysis capabilities.

## Architecture & Project Structure
- [`frontend/`](file:///c:/Users/HP/Desktop/yassssh/frontend): Static dashboard ready for deployment on Vercel.
- [`backend/`](file:///c:/Users/HP/Desktop/yassssh/backend): Node.js API with Vercel Serverless Functions (`api/analyze.js`, `api/health.js`, `api/config.js`) and standalone server support.
- [`clause-guard-full-app/`](file:///c:/Users/HP/Desktop/yassssh/clause-guard-full-app): Original monolithic bundle (kept for reference).

## Quick Start

### Backend
```bash
cd backend
npm test       # Run test suite
npm start      # Run local API server on http://localhost:3000
```

### Frontend
```bash
cd frontend
npx serve .    # Serve dashboard locally
```
