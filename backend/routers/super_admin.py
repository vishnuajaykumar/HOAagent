from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from database import get_db
from models import Client, ClientStatus, Community, CommunityStatus
from auth import get_super_admin
from services.ai_service import get_supported_models

router = APIRouter(prefix="/api/super", tags=["super-admin"])


@router.get("/ai/models")
async def list_supported_models(_=Depends(get_super_admin)):
    return get_supported_models()


class LimitUpdate(BaseModel):
    token_limit_monthly: int


class AIUpdate(BaseModel):
    ai_provider: str  # anthropic | gemini | openai
    ai_model: str     # haiku | sonnet | specific_id


# ─── Management Company endpoints ──────────────────────────────────────────────

@router.get("/clients")
async def list_clients(db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    result = await db.execute(select(Client).order_by(Client.created_at.desc()))
    clients = result.scalars().all()

    client_list = []
    for c in clients:
        # Load HOAs for this client
        comm_result = await db.execute(
            select(Community).where(Community.client_id == c.id).order_by(Community.created_at.desc())
        )
        communities = comm_result.scalars().all()
        client_list.append({
            "id": c.id,
            "company_name": c.company_name,
            "email": c.email,
            "status": c.status,
            "is_archived": c.is_archived,
            "token_limit_monthly": c.token_limit_monthly,
            "tokens_used_this_month": c.tokens_used_this_month,
            "created_at": c.created_at,
            "communities": [_format_community(comm) for comm in communities],
        })
    return client_list


@router.put("/clients/{client_id}/suspend")
async def suspend_client(client_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    client = await _get_client(client_id, db)
    client.status = ClientStatus.suspended
    await db.commit()
    return {"message": "Client suspended"}


@router.put("/clients/{client_id}/activate")
async def activate_client(client_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    client = await _get_client(client_id, db)
    client.status = ClientStatus.active
    await db.commit()
    return {"message": "Client activated"}


@router.put("/clients/{client_id}/archive")
async def archive_client(client_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    client = await _get_client(client_id, db)
    client.is_archived = True
    await db.commit()
    return {"message": "Client archived"}


@router.put("/clients/{client_id}/limits")
async def set_limits(client_id: str, data: LimitUpdate, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    client = await _get_client(client_id, db)
    client.token_limit_monthly = data.token_limit_monthly
    await db.commit()
    return {"message": "Limits updated"}


# ─── HOA (Community) endpoints ─────────────────────────────────────────────────

@router.put("/communities/{community_id}/approve")
async def approve_community(community_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    community = await _get_community(community_id, db)
    community.status = CommunityStatus.active
    community.approved_at = datetime.utcnow()
    await db.commit()
    return {"message": "HOA approved and activated"}


@router.put("/communities/{community_id}/suspend")
async def suspend_community(community_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    community = await _get_community(community_id, db)
    community.status = CommunityStatus.suspended
    await db.commit()
    return {"message": "HOA suspended"}


@router.put("/communities/{community_id}/archive")
async def archive_community(community_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    community = await _get_community(community_id, db)
    community.is_archived = True
    await db.commit()
    return {"message": "HOA archived"}


@router.put("/communities/{community_id}/ai")
async def set_community_ai(community_id: str, data: AIUpdate, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    community = await _get_community(community_id, db)
    community.ai_provider = data.ai_provider
    community.ai_model = data.ai_model
    # Keep model_tier in sync for backwards compatibility if needed
    if data.ai_model in ("haiku", "sonnet"):
        community.model_tier = data.ai_model
    await db.commit()
    return {"message": f"HOA AI set to {data.ai_provider} / {data.ai_model}"}


@router.delete("/communities/{community_id}")
async def delete_community(community_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    community = await _get_community(community_id, db)
    await db.delete(community)
    await db.commit()
    return {"message": "HOA community deleted"}


@router.get("/usage")
async def get_all_usage(db: AsyncSession = Depends(get_db), _=Depends(get_super_admin)):
    result = await db.execute(
        select(Client.id, Client.company_name, Client.tokens_used_this_month, Client.token_limit_monthly, Client.status)
    )
    rows = result.all()
    return [
        {
            "client_id": r[0],
            "company_name": r[1],
            "tokens_used_this_month": r[2],
            "token_limit_monthly": r[3],
            "status": r[4],
            "usage_percent": round((r[2] / r[3]) * 100, 1) if r[3] > 0 else 0,
        }
        for r in rows
    ]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _format_community(c: Community) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "manager_name": c.manager_name,
        "manager_email": c.manager_email,
        "location": c.location,
        "status": c.status,
        "model_tier": c.model_tier,
        "ai_provider": c.ai_provider,
        "ai_model": c.ai_model,
        "api_key": c.api_key,
        "is_archived": c.is_archived,
        "created_at": c.created_at,
        "approved_at": c.approved_at,
    }


async def _get_client(client_id: str, db: AsyncSession) -> Client:
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _get_community(community_id: str, db: AsyncSession) -> Community:
    result = await db.execute(select(Community).where(Community.id == community_id))
    community = result.scalar_one_or_none()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
    return community
