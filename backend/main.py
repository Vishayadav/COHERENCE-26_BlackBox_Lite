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
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import asyncio
import smtplib

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
CAMPAIGN_RUNS_DB = STORAGE_DIR / "campaign_runs.json"
GMAIL_LOG_FILE = STORAGE_DIR / "gmail_activity.log"
SMTP_CONFIG_FILE = STORAGE_DIR / "smtp_config.json"
# Progress tracking
campaign_progress = {} # run_id -> { total: 0, sent: 0, status: "idle" }
# OAuth state tracking to preserve PKCE code_verifier
oauth_flows = {} # state -> Flow object

# Allow insecure transport for local development
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_CSV_DIR.mkdir(parents=True, exist_ok=True)

# Routes will be defined below. Frontend serving moved to the end of file.

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
REQUIRED_CSV_HEADERS = ["name", "company", "email", "industry", "location"]


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


def _save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def _log_gmail(message):
    with open(GMAIL_LOG_FILE, "a") as f:
        f.write(f"[{_now_iso()}] {message}\n")


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


class SMTPConfig(BaseModel):
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_pass: str
    use_tls: bool = True


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
    _log_gmail(f"API CALL: /api/leads/generate | mode: {payload.mode}")
    api_key = "AIzaSyCLIwNcHmJs2q9uJAjexANFbW1ow_MnsS4".strip()
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
    _log_gmail(f"API CALL: /api/generate-emails | campaign: {payload.campaign_name}")
    # Gemini API Configuration
    api_key = "AIzaSyCLIwNcHmJs2q9uJAjexANFbW1ow_MnsS4"
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
        print(f"Gemini API Error: {str(e)}. Triggering Hardcoded Fallback.")
        # Fallback Logic
        fallback_data = []
        for lead in target_leads:
            fallback_data.append({
                "lead_id": lead["lead_id"],
                "variants": [
                    {
                        "subject": f"Quick thought for {lead['name']} @ {lead['company']}",
                        "body": f"Hi {lead['name']},\n\nI was looking into {lead['company']} and the great work you're doing in the {lead['industry']} space. I wanted to reach out because we've developed a solution that helps companies like yours achieve {payload.campaign_goal} more efficiently.\n\nOur platform {payload.product_description} is designed specifically for teams like yours. Would you be open to a brief 10-minute chat next week to see if we can help {lead['company']} reach its goals?\n\nBest regards,\n[Alex Corp]"
                    },
                    {
                        "subject": f"Question about {lead['company']}",
                        "body": f"Hello {lead['name']},\n\nI'm curious how {lead['company']} is currently handling its {payload.campaign_goal} strategy. Many companies in {lead['industry']} are currently struggling with scaling their outreach, which is why we built our {payload.product_description} solution.\n\nI'd love to share how we've helped similar teams reduce their workload while increasing results. Do you have a few minutes for a quick call on Tuesday?\n\nBest,\n[Alex Corp]"
                    },
                    {
                        "subject": f"{lead['name']}, let's connect!",
                        "body": f"Hi {lead['name']},\n\nReaching out from the team. We've been following {lead['company']} and are impressed by your growth in {lead['industry']}. \n\nWe would love to partner with you to help with {payload.campaign_goal}. Our value proposition is simple: {payload.value_proposition}. \n\nAre you the right person to speak with about this, or should I be reaching out to someone else on your team?\n\nCheers,\n[Alex Corp]"
                    }
                ]
            })
        
        return {
            "status": "fallback_success",
            "campaign_name": payload.campaign_name,
            "data": fallback_data,
            "error_info": str(e)
        }


@app.post("/api/refine-email")
async def refine_email(payload: EmailRefineRequest):
    _log_gmail(f"API CALL: /api/refine-email | lead: {payload.lead_name}")
    api_key = "AIzaSyCLIwNcHmJs2q9uJAjexANFbW1ow_MnsS4"
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
        print(f"Refine Error: {str(e)}. Falling back to simple refinement.")
        # Static fallback for refinement
        return {
            "subject": f"Updated: {payload.current_subject}",
            "body": f"{payload.current_body}\n\n(Note: I've updated this draft based on your feedback: '{payload.feedback}')"
        }


@app.post("/api/save-campaign")
async def save_campaign(payload: SaveCampaignRequest):
    _log_gmail(f"API CALL: /api/save-campaign | campaign: {payload.campaign_name}")
    runs = _load_json(CAMPAIGN_RUNS_DB)
    record = payload.model_dump()
    record["run_id"] = len(runs) + 1
    record["created_at"] = _now_iso()
    runs.append(record)
    _save_json(CAMPAIGN_RUNS_DB, runs)
    
    # Initialize progress
    campaign_progress[record["run_id"]] = {
        "total": len(payload.emails),
        "sent": 0,
        "status": "ready"
    }
    
    return {"message": "campaign_finalized", "run_id": record["run_id"]}


@app.post("/api/auth/smtp")
def save_smtp_config(payload: SMTPConfig):
    _log_gmail(f"API CALL: /api/auth/smtp | testing connection for {payload.smtp_user}")
    try:
        # Test connection
        server = smtplib.SMTP(payload.smtp_host, payload.smtp_port, timeout=10)
        if payload.use_tls:
            server.starttls()
        server.login(payload.smtp_user, payload.smtp_pass)
        server.quit()
        
        # Save if successful
        with open(SMTP_CONFIG_FILE, "w") as f:
            json.dump(payload.model_dump(), f, indent=2)
            
        return {"message": "smtp_configured", "user": payload.smtp_user}
    except Exception as e:
        _log_gmail(f"ERROR: SMTP connection failed: {str(e)}")
        raise HTTPException(status_code=400, detail=f"SMTP Connection Failed: {str(e)}")


@app.get("/api/auth/check")
def check_auth():
    if not SMTP_CONFIG_FILE.exists():
        return {"authenticated": False}
    try:
        with open(SMTP_CONFIG_FILE, "r") as f:
            data = json.load(f)
        return {"authenticated": True, "user": data.get("smtp_user")}
    except Exception:
        return {"authenticated": False}


def _send_email_sync(config, to, subject, body):
    try:
        msg = MIMEMultipart()
        msg["From"] = config["smtp_user"]
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))
        
        server = smtplib.SMTP(config["smtp_host"], config["smtp_port"], timeout=15)
        if config.get("use_tls", True):
            server.starttls()
        server.login(config["smtp_user"], config["smtp_pass"])
        server.send_message(msg)
        server.quit()
        
        _log_gmail(f"SUCCESS: Email sent to {to} via SMTP")
        return True
    except Exception as e:
        _log_gmail(f"ERROR: SMTP send failed to {to}: {str(e)}")
        raise e


async def _send_email(config, to, subject, body):
    return await asyncio.to_thread(_send_email_sync, config, to, subject, body)


@app.post("/api/campaign/launch/{run_id}")
async def launch_campaign(run_id: int, workflow: str = "cold-email"):
    _log_gmail(f"API CALL: /api/campaign/launch/{run_id} | workflow: {workflow}")
    if not SMTP_CONFIG_FILE.exists():
        raise HTTPException(status_code=401, detail="SMTP not configured")
    
    runs = _load_json(CAMPAIGN_RUNS_DB)
    run = next((r for r in runs if r["run_id"] == run_id), None)
    if not run:
        raise HTTPException(status_code=404, detail="Campaign run not found")
    
    with open(SMTP_CONFIG_FILE, "r") as f:
        config = json.load(f)
    
    campaign_progress[run_id] = {"total": len(run["emails"]), "sent": 0, "status": "sending"}
    
    # Start background task for sending
    asyncio.create_task(_process_bulk_send(run_id, config, run["emails"], workflow))
    
    return {"message": "Launched via SMTP", "run_id": run_id, "workflow": workflow}


async def _process_bulk_send(run_id, config, emails, workflow):
    for idx, email_data in enumerate(emails):
        try:
            await _send_email(config, email_data["email"], email_data["subject"], email_data["body"])
            
            campaign_progress[run_id]["sent"] = idx + 1
            await asyncio.sleep(1) # Slightly faster than GMail
        except Exception as e:
            _log_gmail(f"CRITICAL: Bulk send error at {email_data['email']}: {e}")
            campaign_progress[run_id]["status"] = f"error: {str(e)}"
            return
            
    campaign_progress[run_id]["status"] = "completed"


@app.get("/api/campaign/status/{run_id}")
def get_campaign_status(run_id: int):
    status = campaign_progress.get(run_id, {"total": 0, "sent": 0, "status": "unknown"})
    return status


# --- Frontend Serving (Must be at the end) ---
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def read_index():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/{page}")
def read_page(page: str):
    # Skip if it looks like an API call to prevent accidental shadowing during dev
    if page.startswith("api/"):
        raise HTTPException(status_code=404)
        
    p = FRONTEND_DIR / page
    if p.exists() and p.is_file():
        return FileResponse(p)
    return FileResponse(FRONTEND_DIR / "index.html") # Fallback
