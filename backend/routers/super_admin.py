from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from database import get_db
from models import Client, ClientStatus
from auth import get_super_admin

router = APIRouter(prefix="/api/super", tags=["super-admin"])


class LimitUpdate(BaseModel):
    token_limit_monthly: int


class TierUpdate(BaseModel):
    model_tier: str  # haiku | sonnet


@router.get("/clients")
async def list_clients(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    result = await db.execute(select(Client).order_by(Client.created_at.desc()))
    clients = result.scalars().all()
    return [
        {
            "id": c.id,
            "company_name": c.company_name,
            "email": c.email,
            "status": c.status,
            "api_key": c.api_key,
            "token_limit_monthly": c.token_limit_monthly,
            "tokens_used_this_month": c.tokens_used_this_month,
            "model_tier": c.model_tier or "haiku",
            "created_at": c.created_at,
            "approved_at": c.approved_at,
        }
        for c in clients
    ]


@router.put("/clients/{client_id}/approve")
async def approve_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = ClientStatus.active
    client.approved_at = datetime.utcnow()
    await db.commit()
    return {"message": "Client approved"}


@router.put("/clients/{client_id}/suspend")
async def suspend_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = ClientStatus.suspended
    await db.commit()
    return {"message": "Client suspended"}


@router.put("/clients/{client_id}/cancel")
async def cancel_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = ClientStatus.cancelled
    await db.commit()
    return {"message": "Client cancelled"}


@router.put("/clients/{client_id}/limits")
async def set_limits(
    client_id: str,
    data: LimitUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.token_limit_monthly = data.token_limit_monthly
    await db.commit()
    return {"message": "Limits updated"}


@router.put("/clients/{client_id}/tier")
async def set_tier(
    client_id: str,
    data: TierUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    if data.model_tier not in ("haiku", "sonnet"):
        raise HTTPException(status_code=400, detail="Invalid tier. Use haiku or sonnet.")
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.model_tier = data.model_tier
    await db.commit()
    return {"message": "Tier updated"}


@router.get("/usage")
async def get_all_usage(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_super_admin)
):
    result = await db.execute(
        select(
            Client.id,
            Client.company_name,
            Client.tokens_used_this_month,
            Client.token_limit_monthly,
            Client.status,
            Client.model_tier
        )
    )
    rows = result.all()
    return [
        {
            "client_id": r[0],
            "company_name": r[1],
            "tokens_used_this_month": r[2],
            "token_limit_monthly": r[3],
            "status": r[4],
            "model_tier": r[5] or "haiku",
            "usage_percent": round((r[2] / r[3]) * 100, 1) if r[3] > 0 else 0,
        }
        for r in rows
    ]
