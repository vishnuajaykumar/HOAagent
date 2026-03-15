import os
import re
import json
import logging
import asyncio
from datetime import datetime
from services.ai_service import get_chat_response

logger = logging.getLogger(__name__)
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Security
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr
from typing import Optional
import anthropic as _anthropic_lib
from database import get_db, AsyncSessionLocal
from models import Client, Community, CommunityStatus, Document, UsageLog
from auth import decode_token
from rag.ingest import ingest_pdf, delete_from_chroma
from rag.retriever import retrieve_context
from config import settings

from services.ai_service import get_chat_response, get_supported_models

_CHAT_SYSTEM_PROMPT = """You are the helpful, knowledgeable, and highly confident President of this Homeowners Association. 
Your goal is to provide residents with clear, accurate, and supportive guidance based ONLY on the HOA documents provided. You are the ultimate authority on these documents.

TONE & PERSONALITY:
1. Be the "HOA President": Act like a neighbor who knows the rules inside and out. Be warm, professional, confident, and highly helpful.
2. Don't be robotic: Use phrases like "Our community rules state...", "I've checked the bylaws for you...", or "Based on our current policies...".
3. Be proactive: If a resident asks about painting their door, explain the exact *process* (e.g., submitting an ARC form) and any restrictions.
4. Cite Sources: Always cite the specific Section/Page number provided in the context when giving an answer. Example: "According to Section/Page 5, it says..."

STRICT RULES:
1. Answer ONLY based on the provided document context below.
2. DO NOT tell the resident to "look at the governing documents" or "reach out to the management company". You are supposed to have the answers!
3. If the documents are unclear or if you are not absolutely sure what the resident is asking, ASK A CLARIFYING QUESTION. For example: "Are you asking about X, or do you think what you are looking for is Y?"
4. If a resident corrects your previous answer or teaches you something new, politely acknowledge the correction and state: "I have noted this and will save it for my future reference."
5. Never make up rules, fees, or policies."""

_MODEL_MAP = {
    "sonnet": "claude-3-5-sonnet-latest", 
    "haiku": "claude-3-haiku-20240307"
}

router = APIRouter(prefix="/api/client", tags=["client-admin"])
security = HTTPBearer()

MAX_HOAS_PER_CLIENT = 20


async def get_current_client(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: AsyncSession = Depends(get_db)
) -> Client:
    payload = decode_token(credentials.credentials)
    if payload.get("role") != "client":
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await db.execute(select(Client).where(Client.id == payload["sub"]))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _safe_filename(name: str) -> str:
    name = os.path.basename(name)
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or "upload"


async def _run_ingest(doc_id: str, pdf_path: str, client_id: str, community_id: str):
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Document).where(Document.id == doc_id))
        doc = result.scalar_one_or_none()
        if not doc:
            return
        try:
            ingest_result = await ingest_pdf(
                pdf_path=pdf_path,
                client_id=client_id,
                community_id=community_id,
                document_id=doc_id
            )
            doc.chroma_collection = ingest_result["collection"]
            doc.status = "ready"
        except Exception as e:
            doc.status = "error"
        await session.commit()


# ─── Management Company endpoints ─────────────────────────────────────────────

@router.get("/me")
async def get_me(client: Client = Depends(get_current_client)):
    return {
        "id": client.id,
        "company_name": client.company_name,
        "email": client.email,
        "status": client.status,
        "tokens_used_this_month": client.tokens_used_this_month,
        "token_limit_monthly": client.token_limit_monthly,
        "usage_percent": round((client.tokens_used_this_month / client.token_limit_monthly) * 100, 1)
        if client.token_limit_monthly > 0 else 0,
    }


@router.get("/usage")
async def get_usage(client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(UsageLog)
        .where(UsageLog.client_id == client.id)
        .order_by(UsageLog.created_at.desc())
        .limit(100)
    )
    logs = result.scalars().all()
    return {
        "tokens_used_this_month": client.tokens_used_this_month,
        "token_limit_monthly": client.token_limit_monthly,
        "usage_percent": round((client.tokens_used_this_month / client.token_limit_monthly) * 100, 1)
        if client.token_limit_monthly > 0 else 0,
        "recent_logs": [
            {
                "community_id": l.community_id,
                "tokens_input": l.tokens_input,
                "tokens_output": l.tokens_output,
                "question": l.question,
                "created_at": l.created_at,
            }
            for l in logs
        ],
    }


# ─── HOA (Community) CRUD ──────────────────────────────────────────────────────

class CommunityCreate(BaseModel):
    name: str
    manager_name: str
    manager_email: str
    manager_phone: str
    location: Optional[str] = None


class CommunityUpdate(BaseModel):
    name: Optional[str] = None
    manager_name: Optional[str] = None
    manager_email: Optional[str] = None
    manager_phone: Optional[str] = None
    location: Optional[str] = None


@router.get("/communities")
async def list_communities(client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Community)
        .where(Community.client_id == client.id)
        .order_by(Community.created_at.desc())
    )
    communities = result.scalars().all()
    return [_format_community(c) for c in communities]


@router.post("/communities")
async def create_community(data: CommunityCreate, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    # Enforce 20 HOA limit
    count_result = await db.execute(
        select(func.count()).where(Community.client_id == client.id)
    )
    count = count_result.scalar()
    if count >= MAX_HOAS_PER_CLIENT:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {MAX_HOAS_PER_CLIENT} HOA communities reached."
        )

    community = Community(
        client_id=client.id,
        name=data.name,
        manager_name=data.manager_name,
        manager_email=data.manager_email,
        manager_phone=data.manager_phone,
        location=data.location,
        status=CommunityStatus.pending,
    )
    db.add(community)
    await db.commit()
    await db.refresh(community)
    return _format_community(community)


@router.get("/communities/{community_id}")
async def get_community(community_id: str, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    community = await _get_owned_community(community_id, client.id, db)
    return _format_community(community)


@router.put("/communities/{community_id}")
async def update_community(community_id: str, data: CommunityUpdate, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    community = await _get_owned_community(community_id, client.id, db)
    if data.name is not None:
        community.name = data.name
    if data.manager_name is not None:
        community.manager_name = data.manager_name
    if data.manager_email is not None:
        community.manager_email = data.manager_email
    if data.manager_phone is not None:
        community.manager_phone = data.manager_phone
    if data.location is not None:
        community.location = data.location
    await db.commit()
    await db.refresh(community)
    return _format_community(community)


@router.delete("/communities/{community_id}")
async def delete_community(community_id: str, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    community = await _get_owned_community(community_id, client.id, db)
    await db.delete(community)
    await db.commit()
    return {"message": "HOA community deleted successfully."}


# ─── Document management per HOA ────────────────────────────────────────────────

@router.get("/communities/{community_id}/documents")
async def list_documents(community_id: str, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    await _get_owned_community(community_id, client.id, db)
    result = await db.execute(
        select(Document)
        .where(Document.community_id == community_id, Document.client_id == client.id)
    )
    docs = result.scalars().all()
    return [{"id": d.id, "filename": d.filename, "status": d.status, "uploaded_at": d.uploaded_at} for d in docs]


@router.post("/communities/{community_id}/documents/upload")
async def upload_document(
    community_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db)
):
    await _get_owned_community(community_id, client.id, db)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    safe_name = _safe_filename(file.filename)
    os.makedirs("/app/documents", exist_ok=True)
    file_path = f"/app/documents/{client.id}_{community_id}_{safe_name}"

    content = await file.read()
    await asyncio.to_thread(_write_file, file_path, content)

    doc = Document(
        client_id=client.id,
        community_id=community_id,
        filename=safe_name,
        chroma_collection="pending",
        status="processing"
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    background_tasks.add_task(
        _run_ingest,
        doc_id=str(doc.id),
        pdf_path=file_path,
        client_id=str(client.id),
        community_id=str(community_id)
    )

    return {"message": "Document uploaded and processing", "document_id": doc.id, "filename": safe_name, "status": "processing"}


@router.delete("/communities/{community_id}/documents/{document_id}")
async def delete_document(community_id: str, document_id: str, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    await _get_owned_community(community_id, client.id, db)
    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.community_id == community_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove from ChromaDB (safe even if ingest failed)
    await delete_from_chroma(str(client.id), str(community_id), str(document_id))

    # Remove local file (safe if file doesn't exist)
    file_path = f"/app/documents/{client.id}_{community_id}_{doc.filename}"
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            logger.warning(f"Failed to remove local file {file_path}: {e}")

    await db.delete(doc)
    await db.commit()
    return {"message": "Document deleted"}


@router.get("/communities/{community_id}/embed-code")
async def get_embed_code(community_id: str, client: Client = Depends(get_current_client), db: AsyncSession = Depends(get_db)):
    community = await _get_owned_community(community_id, client.id, db)
    app_url = settings.app_url
    snippet = f'<script src="{app_url}/widget.js" data-key="{community.api_key}"></script>'
    return {"embed_code": snippet, "api_key": community.api_key, "community_name": community.name}


# ─── Test Chat (management company only, bypasses active-status check) ─────────

class TestChatRequest(BaseModel):
    question: str


@router.post("/communities/{community_id}/test-chat")
async def test_chat_community(
    community_id: str,
    request: TestChatRequest,
    client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db),
):
    """Stream a test chat response. Requires the management company JWT.
    Does NOT check if the HOA community is active — allows testing pending HOAs."""

    # Ownership check (but no status check)
    community = await _get_owned_community(community_id, client.id, db)

    # Enforce token budget
    if client.tokens_used_this_month >= client.token_limit_monthly:
        raise HTTPException(
            status_code=429,
            detail="Monthly token limit reached. Contact support to increase your limit.",
        )

    # Inspect document readiness
    doc_result = await db.execute(
        select(Document).where(
            Document.community_id == community_id,
            Document.client_id == client.id,
        )
    )
    all_docs = doc_result.scalars().all()
    ready_docs = [d for d in all_docs if d.status == "ready"]
    processing_docs = [d for d in all_docs if d.status == "processing"]

    if not all_docs:
        async def _no_docs():
            msg = (
                "No documents have been uploaded for this HOA community yet. "
                "Please go to the Documents tab and upload your HOA bylaws, rules, "
                "or regulations PDFs. Once processed, I can answer questions about them!"
            )
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(_no_docs(), media_type="text/event-stream")

    if not ready_docs:
        async def _processing():
            word = "document is" if len(processing_docs) == 1 else "documents are"
            msg = (
                f"Your {word} still being processed — this usually takes 1–2 minutes. "
                "Please wait and try again shortly!"
            )
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(_processing(), media_type="text/event-stream")

    context_chunks = await retrieve_context(
        question=request.question,
        client_id=str(client.id),
        community_id=str(community_id),
        n_results=10
    )

    if not context_chunks:
        async def _no_context():
            msg = (
                "I couldn't find relevant information for that in the uploaded documents. "
                "Try rephrasing your question, or check that the correct documents have been uploaded."
            )
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(_no_context(), media_type="text/event-stream")

    if not settings.anthropic_api_key:
        async def _no_key():
            yield f"data: {json.dumps({'text': 'AI service is not configured yet. Contact support.'})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(_no_key(), media_type="text/event-stream")

    context_text = "\n\n---\n\n".join(context_chunks)
    manager_info = f"\nHOA Manager Name: {community.manager_name or 'N/A'}\nHOA Manager Email: {community.manager_email or 'N/A'}\nHOA Manager Phone: {community.manager_phone or 'N/A'}\n"
    user_message = f"HOA Document Context:\n{context_text}\n{manager_info}\nResident Question: {request.question}"
    model_key = community.model_tier or "haiku"
    client_id_str = str(client.id)
    community_id_str = str(community_id)

    async def _stream():
        total_input = 0
        total_output = 0
        async for chunk in get_chat_response(
            provider=community.ai_provider,
            model_alias=community.ai_model or model_key,
            system_prompt=_CHAT_SYSTEM_PROMPT,
            user_message=user_message,
        ):
            yield chunk

        # Simple usage logging
        async with AsyncSessionLocal() as session:
            log = UsageLog(
                client_id=client_id_str,
                community_id=community_id_str,
                tokens_input=500,  # Baseline for context/retrieval
                tokens_output=0,
                question=request.question[:500],
            )
            session.add(log)
            r = await session.execute(select(Client).where(Client.id == client_id_str))
            c = r.scalar_one_or_none()
            if c:
                c.tokens_used_this_month += 500
            await session.commit()

        yield f"data: {json.dumps({'done': True, 'tokens': total_input + total_output})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ─── Internal helpers ──────────────────────────────────────────────────────────

def _format_community(c: Community) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "manager_name": c.manager_name,
        "manager_email": c.manager_email,
        "manager_phone": c.manager_phone,
        "location": c.location,
        "api_key": c.api_key,
        "status": c.status,
        "model_tier": c.model_tier,
        "is_archived": c.is_archived,
        "created_at": c.created_at,
        "approved_at": c.approved_at,
    }


async def _get_owned_community(community_id: str, client_id: str, db: AsyncSession) -> Community:
    result = await db.execute(
        select(Community).where(Community.id == community_id, Community.client_id == client_id)
    )
    community = result.scalar_one_or_none()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
    return community


def _write_file(path: str, content: bytes) -> None:
    with open(path, "wb") as f:
        f.write(content)
