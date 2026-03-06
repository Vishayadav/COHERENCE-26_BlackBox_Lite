from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="OutreachFlow AI Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).resolve().parent / "data" / "context_db.json"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


class CampaignContext(BaseModel):
    industry: str = Field(min_length=1)
    company_name: str = Field(min_length=1)
    product: str = Field(min_length=1)
    target_customer: str = Field(min_length=1)
    region: List[str] = []
    preferred_channel: str = "Email"
    campaign_goal: str = Field(min_length=1)
    created_at: str | None = None


def _load_data() -> list[dict]:
    if not DB_PATH.exists():
        return []
    with DB_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save_data(data: list[dict]) -> None:
    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "outreachflow-backend"}


@app.post("/api/context")
def save_context(payload: CampaignContext) -> dict:
    data = _load_data()
    record = payload.model_dump()
    if not record.get("created_at"):
        record["created_at"] = datetime.now(timezone.utc).isoformat()
    record["id"] = len(data) + 1
    data.append(record)
    _save_data(data)
    return {"message": "saved", "id": record["id"]}


@app.get("/api/context")
def list_contexts() -> dict:
    try:
        data = _load_data()
        return {"count": len(data), "items": data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
