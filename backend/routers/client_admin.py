import os
import re
import asyncio
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db, AsyncSessionLocal
from models import Client, Document, UsageLog
from auth import decode_token
from rag.ingest import ingest_pdf
from config import settings

router = APIRouter(prefix="/api/client", tags=["client-admin"])
security = HTTPBearer()


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
    """Strip path components and remove characters that aren't alphanumeric, dot, dash, or underscore."""
    name = os.path.basename(name)
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or "upload"


async def _run_ingest(doc_id: str, pdf_path: str, client_id: str, community_id: str):
    """Background task: ingest the PDF and update document status."""
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


@router.get("/embed-code")
async def get_embed_code(client: Client = Depends(get_current_client)):
    app_url = settings.app_url
    snippet = f'<script src="{app_url}/widget.js" data-key="{client.api_key}"></script>'
    return {"embed_code": snippet, "api_key": client.api_key}


@router.post("/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    community_id: str = None,
    client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db)
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    safe_name = _safe_filename(file.filename)
    os.makedirs("/app/documents", exist_ok=True)

    # Avoid collisions: prefix with client_id
    file_path = f"/app/documents/{client.id}_{safe_name}"

    # Async file write — read content first, then write in thread to avoid blocking
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

    # Kick off ingestion in the background — return immediately to the client
    background_tasks.add_task(
        _run_ingest,
        doc_id=str(doc.id),
        pdf_path=file_path,
        client_id=str(client.id),
        community_id=str(community_id) if community_id else None
    )

    return {
        "message": "Document uploaded and processing in background",
        "document_id": doc.id,
        "filename": safe_name,
        "status": "processing"
    }


def _write_file(path: str, content: bytes) -> None:
    with open(path, "wb") as f:
        f.write(content)


@router.get("/documents")
async def list_documents(
    client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Document).where(Document.client_id == client.id)
    )
    docs = result.scalars().all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "status": d.status,
            "uploaded_at": d.uploaded_at,
        }
        for d in docs
    ]


@router.get("/usage")
async def get_usage(
    client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db)
):
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
                "tokens_input": l.tokens_input,
                "tokens_output": l.tokens_output,
                "question": l.question,
                "created_at": l.created_at,
            }
            for l in logs
        ],
    }
