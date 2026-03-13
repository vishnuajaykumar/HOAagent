import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
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
    file: UploadFile = File(...),
    community_id: str = None,
    client: Client = Depends(get_current_client),
    db: AsyncSession = Depends(get_db)
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    os.makedirs("/app/documents", exist_ok=True)
    file_path = f"/app/documents/{client.id}_{file.filename}"

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    doc = Document(
        client_id=client.id,
        community_id=community_id,
        filename=file.filename,
        chroma_collection="pending",
        status="processing"
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    try:
        result = await ingest_pdf(
            pdf_path=file_path,
            client_id=client.id,
            community_id=community_id,
            document_id=doc.id
        )
        doc.chroma_collection = result["collection"]
        doc.status = "ready"
        await db.commit()
        return {
            "message": "Document uploaded and processed",
            "document_id": doc.id,
            "chunks": result["chunks"]
        }
    except Exception as e:
        doc.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


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
