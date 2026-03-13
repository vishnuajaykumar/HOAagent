from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from database import get_db
from models import Client, ClientStatus
from auth import hash_password, verify_password, create_token
from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    company_name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup")
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    client = Client(
        company_name=data.company_name,
        email=data.email,
        password_hash=hash_password(data.password),
        status=ClientStatus.pending
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    return {
        "message": "Account created. Pending approval from administrator.",
        "id": client.id
    }


@router.post("/login")
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.email == data.email))
    client = result.scalar_one_or_none()

    if not client or not verify_password(data.password, client.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if client.status == ClientStatus.pending:
        raise HTTPException(status_code=403, detail="Account pending approval")
    if client.status in [ClientStatus.suspended, ClientStatus.cancelled]:
        raise HTTPException(status_code=403, detail="Account is not active")

    token = create_token({"sub": client.id, "role": "client", "email": client.email})
    return {"access_token": token, "token_type": "bearer", "company": client.company_name}


@router.post("/super/login")
async def super_login(data: LoginRequest):
    if data.email != settings.super_admin_email or data.password != settings.super_admin_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token({"sub": "super", "role": "super_admin"})
    return {"access_token": token, "token_type": "bearer"}
