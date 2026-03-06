# OutreachFlow AI - Phase 1

Phase 1 implementation includes:
- Landing page with `Start Automation` CTA
- User context form
- Campaign context object generation
- Local browser storage (`localStorage`)
- Python backend API storing records in a local JSON file

## Run frontend

Open `frontend/index.html` directly in browser, or serve with a static server.

## Run backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

API endpoints:
- `GET /health`
- `POST /api/context`
- `GET /api/context`

Local backend DB file:
- `backend/data/context_db.json` (created automatically on first save)
