from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Workflow Builder API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = Path(__file__).resolve().parent / "storage"
WORKFLOW_DB = STORAGE_DIR / "workflow_config.json"
EXECUTION_LOG_DB = STORAGE_DIR / "workflow_execution_logs.json"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

NODE_TYPES = {"send_email", "wait", "condition", "follow_up", "end"}


class WorkflowNode(BaseModel):
    id: str
    type: Literal["send_email", "wait", "condition", "follow_up", "end"]
    label: str
    config: dict[str, Any] = {}


class WorkflowPayload(BaseModel):
    workflow_name: str = Field(min_length=2)
    channel: Literal["email", "whatsapp", "mixed"] = "mixed"
    mode: Literal["sales_outreach"] = "sales_outreach"
    nodes: list[WorkflowNode] = Field(min_length=1)


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


def _validate_workflow(payload: WorkflowPayload) -> list[str]:
    issues: list[str] = []
    nodes = payload.nodes
    channel = payload.channel

    if not nodes:
        issues.append("Workflow must contain at least one node.")
        return issues

    if nodes[0].type not in {"send_email", "follow_up"}:
        issues.append("Workflow should start with 'send_email' or 'follow_up'.")

    if nodes[-1].type != "end":
        issues.append("Workflow must end with an 'end' node.")

    for idx, node in enumerate(nodes, start=1):
        if node.type not in NODE_TYPES:
            issues.append(f"Node {idx} has invalid type: {node.type}")
            continue

        if node.type == "wait":
            days = node.config.get("days")
            if days is None or not isinstance(days, int) or days < 1 or days > 30:
                issues.append(f"Node {idx} wait config must include integer 'days' between 1 and 30.")

        if node.type in {"send_email", "follow_up"}:
            node_channel = str(node.config.get("channel", "email")).strip().lower()
            if node_channel not in {"email", "whatsapp"}:
                issues.append(f"Node {idx} ({node.type}) requires config.channel as 'email' or 'whatsapp'.")
                continue
            subject = str(node.config.get("subject", "")).strip()
            body = str(node.config.get("body", "")).strip()
            if node_channel == "email":
                if not subject or not body:
                    issues.append(f"Node {idx} ({node.type}) requires subject and body for email channel.")
            else:
                if not body:
                    issues.append(f"Node {idx} ({node.type}) requires body for whatsapp channel.")

        if node.type == "condition":
            condition_key = str(node.config.get("condition", "")).strip()
            if not condition_key:
                issues.append(f"Node {idx} condition node requires a 'condition' value.")

    return issues


def _simulate_execution(nodes: list[WorkflowNode]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    for order, node in enumerate(nodes, start=1):
        event: dict[str, Any] = {
            "order": order,
            "node_id": node.id,
            "node_type": node.type,
            "label": node.label,
            "timestamp": _now_iso(),
            "status": "executed",
            "details": {},
        }
        if node.type in {"send_email", "follow_up"}:
            node_channel = str(node.config.get("channel", "email")).strip().lower()
            event["details"] = {
                "action": "message_prepared",
                "channel": node_channel,
                "subject": node.config.get("subject", ""),
                "recipient_placeholder": "{{lead_email}}" if node_channel == "email" else "{{lead_whatsapp}}",
            }
        elif node.type == "wait":
            event["details"] = {"action": "delay_applied", "days": node.config.get("days", 1)}
        elif node.type == "condition":
            event["details"] = {
                "action": "condition_evaluated",
                "condition": node.config.get("condition", "email_opened"),
                "result": "simulated_true",
            }
        elif node.type == "end":
            event["details"] = {"action": "workflow_completed"}

        events.append(event)

    return events


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "workflow-builder-api"}


@app.post("/api/workflow/validate")
def validate_workflow(payload: WorkflowPayload) -> dict:
    issues = _validate_workflow(payload)
    return {"valid": len(issues) == 0, "issues": issues}


@app.post("/api/workflow/save")
def save_workflow(payload: WorkflowPayload) -> dict:
    issues = _validate_workflow(payload)
    if issues:
        raise HTTPException(status_code=400, detail={"message": "Validation failed", "issues": issues})

    records = _load_json(WORKFLOW_DB)
    workflow_id = len(records) + 1
    record = payload.model_dump()
    record["workflow_id"] = workflow_id
    record["created_at"] = _now_iso()
    records.append(record)
    _save_json(WORKFLOW_DB, records)
    return {"message": "workflow_saved", "workflow_id": workflow_id}


@app.get("/api/workflow/list")
def list_workflows() -> dict:
    items = _load_json(WORKFLOW_DB)
    return {"count": len(items), "items": items}


@app.post("/api/workflow/simulate")
def simulate_workflow(payload: WorkflowPayload) -> dict:
    issues = _validate_workflow(payload)
    if issues:
        raise HTTPException(status_code=400, detail={"message": "Validation failed", "issues": issues})

    events = _simulate_execution(payload.nodes)
    logs = _load_json(EXECUTION_LOG_DB)
    log_record = {
        "run_id": len(logs) + 1,
        "workflow_name": payload.workflow_name,
        "channel": payload.channel,
        "mode": payload.mode,
        "created_at": _now_iso(),
        "events": events,
    }
    logs.append(log_record)
    _save_json(EXECUTION_LOG_DB, logs)
    return {"message": "simulation_complete", "run_id": log_record["run_id"], "events": events}
