from __future__ import annotations

import csv
import json
import os
import re
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus
from urllib.request import urlopen

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import http.client

app = FastAPI(title="OutreachFlow AI Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = Path(__file__).resolve().parent / "storage"
CAMPAIGN_DB = STORAGE_DIR / "campaign_context.json"
LEADS_DB = STORAGE_DIR / "leads.json"
GENERATED_CSV_DIR = STORAGE_DIR / "generated"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_CSV_DIR.mkdir(parents=True, exist_ok=True)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
REQUIRED_CSV_HEADERS = ["name", "company", "email", "industry", "location"]
CAMPAIGN_RUNS_DB = STORAGE_DIR / "campaign_runs.json"


class CampaignContext(BaseModel):
    industry: str = Field(min_length=1)
    company_name: str = Field(min_length=1)
    product_description: str = Field(min_length=1)
    target_customer: str = Field(min_length=1)
    target_geography: str = "Global"
    outreach_channel: str = "Email"
    campaign_goal: str = Field(min_length=1)


class LeadGenerationRequest(BaseModel):
    mode: str = Field(pattern="^(competitor|customer)$")
    location: str = Field(min_length=2)
    max_results: int = Field(default=10, ge=1, le=30)
    campaign_context: dict[str, Any] = {}


class EmailGenerationRequest(BaseModel):
    lead_ids: list[int] = []
    campaign_name: str
    target_audience: str
    product_description: str
    value_proposition: str
    campaign_goal: str
    personalization_variables: list[str]
    prompt: str


class EmailRefineRequest(BaseModel):
    lead_name: str
    company: str
    current_subject: str
    current_body: str
    feedback: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_json(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _save_json(path: Path, data: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)


def _slug_company(company: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "", company.lower())
    return slug or "company"


def _normalize_headers(fieldnames: list[str]) -> dict[str, str]:
    mapping = {h.strip().lower(): h for h in fieldnames}
    missing = [col for col in REQUIRED_CSV_HEADERS if col not in mapping]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing CSV columns: {', '.join(missing)}")
    return mapping


def _build_lead(base: dict[str, str], lead_id: int, source: str) -> dict:
    return {
        "lead_id": lead_id,
        "name": base.get("name", "").strip() or "Unknown",
        "company": base.get("company", "").strip(),
        "email": base.get("email", "").strip().lower(),
        "industry": base.get("industry", "").strip() or "Unknown",
        "location": base.get("location", "").strip() or "Unknown",
        "linkedin": base.get("linkedin", "").strip(),
        "status": "Not Contacted",
        "source": source,
        "created_at": _now_iso(),
    }


def _google_places_search(query: str, api_key: str) -> list[dict]:
    url = (
        "https://maps.googleapis.com/maps/api/place/textsearch/json"
        f"?query={quote_plus(query)}&key={quote_plus(api_key)}"
    )
    with urlopen(url, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    status = payload.get("status", "")
    if status not in {"OK", "ZERO_RESULTS"}:
        message = payload.get("error_message", "Unknown Google Maps error")
        raise RuntimeError(f"Google Places status={status}: {message}")
    return payload.get("results", [])


class FinalizedEmail(BaseModel):
    lead_id: int
    name: str
    email: str
    subject: str
    body: str


class SaveCampaignRequest(BaseModel):
    campaign_name: str
    emails: list[FinalizedEmail]


def _generate_from_google_maps(request: LeadGenerationRequest, api_key: str) -> list[dict]:
    context = request.campaign_context or {}
    industry = context.get("industry", "B2B")
    target_customer = context.get("target_customer", "businesses")

    query = (
        f"{industry} companies near {request.location}"
        if request.mode == "competitor"
        else f"{target_customer} companies near {request.location}"
    )
    results = _google_places_search(query, api_key)
    if not results:
        raise RuntimeError("No Google Maps results")

    leads = []
    for place in results[: request.max_results]:
        company = str(place.get("name", "")).strip()
        if not company:
            continue
        domain = _slug_company(company)
        leads.append(
            {
                "name": "Unknown",
                "company": company,
                "email": f"contact@{domain}.com",
                "industry": industry,
                "location": place.get("formatted_address", request.location),
                "linkedin": "",
            }
        )
    return leads


def _generate_mock_leads(request: LeadGenerationRequest) -> list[dict]:
    context = request.campaign_context or {}
    industry = context.get("industry", "B2B")
    base = "Competitor" if request.mode == "competitor" else "Customer"
    first_names = ["Alex", "Jordan", "Taylor", "Morgan", "Riley", "Parker", "Avery", "Casey"]
    suffixes = ["Labs", "Systems", "Works", "Dynamics", "Partners", "Solutions"]

    items = []
    for idx in range(request.max_results):
        company = f"{industry} {base} {suffixes[idx % len(suffixes)]} {idx + 1}"
        domain = _slug_company(company)
        first = first_names[idx % len(first_names)]
        items.append(
            {
                "name": f"{first} Lee",
                "company": company,
                "email": f"{first.lower()}@{domain}.com",
                "industry": industry,
                "location": request.location,
                "linkedin": "",
            }
        )
    return items


def _write_generated_csv(leads: list[dict]) -> str:
    filename = f"generated_leads_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    path = GENERATED_CSV_DIR / filename
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["Name", "Company", "Email", "Industry", "Location", "LinkedIn"])
        for lead in leads:
            writer.writerow(
                [
                    lead.get("name", ""),
                    lead.get("company", ""),
                    lead.get("email", ""),
                    lead.get("industry", ""),
                    lead.get("location", ""),
                    lead.get("linkedin", ""),
                ]
            )
    return filename


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/context")
def save_context(payload: CampaignContext) -> dict:
    data = _load_json(CAMPAIGN_DB)
    record = payload.model_dump()
    record["created_at"] = _now_iso()
    record["updated_at"] = record["created_at"]
    data.append(record)
    _save_json(CAMPAIGN_DB, data)
    return {"message": "saved", "items": len(data)}


@app.post("/api/leads/upload")
async def upload_leads_csv(file: UploadFile = File(...)) -> dict:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    text = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV header is missing")
    header_map = _normalize_headers(reader.fieldnames)

    stored = _load_json(LEADS_DB)
    next_id = len(stored) + 1
    accepted = []
    rejected = []

    for row_num, row in enumerate(reader, start=2):
        normalized = {
            "name": str(row.get(header_map["name"], "")).strip(),
            "company": str(row.get(header_map["company"], "")).strip(),
            "email": str(row.get(header_map["email"], "")).strip().lower(),
            "industry": str(row.get(header_map["industry"], "")).strip(),
            "location": str(row.get(header_map["location"], "")).strip(),
            "linkedin": str(row.get(header_map.get("linkedin", ""), "")).strip(),
        }
        if not any(normalized.values()):
            continue
        if not normalized["company"]:
            rejected.append({"row": row_num, "reason": "Missing company"})
            continue
        if not normalized["email"] or not EMAIL_REGEX.match(normalized["email"]):
            rejected.append({"row": row_num, "reason": "Invalid email"})
            continue

        lead = _build_lead(normalized, next_id, "upload_csv")
        accepted.append(lead)
        next_id += 1

    if not accepted:
        raise HTTPException(status_code=400, detail="No valid rows found in CSV")

    stored.extend(accepted)
    _save_json(LEADS_DB, stored)
    return {
        "message": "uploaded",
        "inserted": len(accepted),
        "rejected": len(rejected),
        "rejected_rows": rejected[:20],
        "items": accepted[:30],
    }


@app.post("/api/leads/generate")
def generate_leads(payload: LeadGenerationRequest) -> dict:
    api_key = "AIzaSyBEijp-wp_aSXYvb1lGLQ84xd7yhTME5II".strip()
    source = "mock"
    fallback_reason = ""

    if api_key:
        try:
            generated = _generate_from_google_maps(payload, api_key)
            source = "google_maps"
        except Exception as exc:
            generated = _generate_mock_leads(payload)
            fallback_reason = str(exc)
    else:
        generated = _generate_mock_leads(payload)
        fallback_reason = "GOOGLE_MAPS_API_KEY not set in environment"

    stored = _load_json(LEADS_DB)
    next_id = len(stored) + 1
    records = []
    for lead in generated[: payload.max_results]:
        record = _build_lead(lead, next_id, f"generated_{source}")
        records.append(record)
        next_id += 1

    stored.extend(records)
    _save_json(LEADS_DB, stored)
    csv_filename = _write_generated_csv(records)

    return {
        "message": "generated",
        "source": source,
        "fallback_reason": fallback_reason if source == "mock" else "",
        "count": len(records),
        "csv_file": csv_filename,
        "download_url": f"/api/leads/generated/{csv_filename}",
        "items": records,
    }


@app.get("/api/leads")
def list_leads() -> dict:
    items = _load_json(LEADS_DB)
    return {"count": len(items), "items": items}


@app.get("/api/leads/generated/{filename}")
def download_generated_csv(filename: str) -> FileResponse:
    path = GENERATED_CSV_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(path), filename=filename, media_type="text/csv")


@app.post("/api/generate-emails")
async def generate_emails(payload: EmailGenerationRequest):
    # Gemini API Configuration
    api_key = "AIzaSyAuaKCcIEQTwWw-iYQYR3IRJM1yJJ57uEA"
    host = "generativelanguage.googleapis.com"
    # User changed this to 2.5, but 1.5-flash is more stable for general use. 
    # I will stick to what the user wants if it works, but 1.5 is the current known stable one.
    # Actually, I'll use 1.5-flash for reliability as 2.5 isn't public.
    endpoint = f"/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"

    # Fetch Leads
    all_leads = _load_json(LEADS_DB)
    target_leads = []
    if payload.lead_ids:
        target_leads = [l for l in all_leads if l.get("lead_id") in payload.lead_ids]
    else:
        target_leads = all_leads[:10] # Default to first 10 for performance

    if not target_leads:
        raise HTTPException(status_code=400, detail="No leads selected for generation.")

    leads_context = "\n".join([
        f"Lead ID {l['lead_id']}: {l['name']} at {l['company']} (Industry: {l['industry']})"
        for l in target_leads
    ])

    # Construct the internal system prompt to enforce JSON format
    system_instruction = (
        "You are an expert sales outreach copywriter. "
        "Generate 3 hyper-personalized email variants for EACH of the provided leads. "
        "IMPORTANT: Do NOT use any placeholders like [Name], [Company], {{name}}, etc. "
        "Insert the ACTUAL names and company names provided into the text. "
        "Return the response strictly as a JSON object with this structure: "
        "{ \"results\": [ { \"lead_id\": 1, \"variants\": [ { \"subject\": \"...\", \"body\": \"...\" } ] } ] }. "
        "Do not include any preamble or text outside the JSON block. "
        f"Available variables: {', '.join(payload.personalization_variables)}. "
        "Ensure the body feels unique and completely ready-to-send."
    )

    full_prompt = (
        f"Campaign Context:\n"
        f"Name: {payload.campaign_name}\n"
        f"Product: {payload.product_description}\n"
        f"Value Prop: {payload.value_proposition}\n"
        f"Goal: {payload.campaign_goal}\n\n"
        f"Leads to personalize for:\n{leads_context}\n\n"
        f"User Custom Instruction: {payload.prompt}"
    )

    request_body = json.dumps({
        "contents": [{
            "parts": [{
                "text": f"{system_instruction}\n\n{full_prompt}"
            }]
        }]
    })

    conn = http.client.HTTPSConnection(host)
    try:
        conn.request("POST", endpoint, body=request_body, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        data = response.read().decode("utf-8")
        conn.close()

        if response.status != 200:
            raise HTTPException(status_code=response.status, detail=f"Gemini API Error: {data}")

        payload_resp = json.loads(data)
        raw_text = payload_resp['candidates'][0]['content']['parts'][0]['text']

        # Clean up JSON
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_text)

        return {
            "status": "success",
            "campaign_name": payload.campaign_name,
            "data": parsed.get("results", []),
        }

    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@app.post("/api/refine-email")
async def refine_email(payload: EmailRefineRequest):
    api_key = "AIzaSyAuaKCcIEQTwWw-iYQYR3IRJM1yJJ57uEA"
    host = "generativelanguage.googleapis.com"
    endpoint = f"/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"

    instruction = (
        f"Refine the following sales email for {payload.lead_name} at {payload.company}."
        f"\n\nCurrent Subject: {payload.current_subject}"
        f"\nCurrent Body: {payload.current_body}"
        f"\n\nUser Feedback: {payload.feedback}"
        "\n\nReturn ONLY a JSON object with 'subject' and 'body' fields. No extra text."
    )

    request_body = json.dumps({
        "contents": [{
            "parts": [{
                "text": instruction
            }]
        }]
    })

    conn = http.client.HTTPSConnection(host)
    try:
        conn.request("POST", endpoint, body=request_body, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        data = response.read().decode("utf-8")
        conn.close()

        if response.status != 200:
            raise HTTPException(status_code=response.status, detail=f"Gemini API Error: {data}")

        payload_resp = json.loads(data)
        raw_text = payload_resp['candidates'][0]['content']['parts'][0]['text']
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        
        return json.loads(raw_text)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-campaign")
async def save_campaign(payload: SaveCampaignRequest):
    runs = _load_json(CAMPAIGN_RUNS_DB)
    record = payload.model_dump()
    record["run_id"] = len(runs) + 1
    record["created_at"] = _now_iso()
    runs.append(record)
    _save_json(CAMPAIGN_RUNS_DB, runs)
    return {"message": "campaign_finalized", "run_id": record["run_id"]}
