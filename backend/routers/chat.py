import json
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import anthropic
import redis.asyncio as aioredis
from database import get_db, AsyncSessionLocal
from models import Client, Community, CommunityStatus, UsageLog
from rag.retriever import retrieve_context
from config import settings
from services.ai_service import get_chat_response

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = """You are the helpful, knowledgeable, and highly confident President of this Homeowners Association. 
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

MODEL_MAP = {
    "sonnet": "claude-3-5-sonnet-latest", 
    "haiku": "claude-3-haiku-20240307"
}

# Module-level async client and Redis pool — created once, reused across requests
_anthropic_client: Optional[anthropic.AsyncAnthropic] = None
_redis_pool: Optional[aioredis.ConnectionPool] = None


def get_anthropic_client() -> anthropic.AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def get_redis_pool() -> aioredis.ConnectionPool:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.ConnectionPool.from_url(
            settings.redis_url, decode_responses=True
        )
    return _redis_pool


async def close_clients():
    """Called from lifespan shutdown to release connections cleanly."""
    global _anthropic_client, _redis_pool
    if _anthropic_client is not None:
        await _anthropic_client.close()
        _anthropic_client = None
    if _redis_pool is not None:
        await _redis_pool.aclose()
        _redis_pool = None


class ChatRequest(BaseModel):
    question: str
    api_key: str  # Now this is the Community (HOA) api_key
    community_id: Optional[str] = None  # Optional, community resolved from api_key


@router.post("")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    # Authenticate via HOA (Community) API key
    result = await db.execute(
        select(Community).where(Community.api_key == request.api_key)
    )
    community = result.scalar_one_or_none()

    if not community:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # HOA must be approved by Super Admin before it can be used
    if community.status != CommunityStatus.active:
        if community.status == CommunityStatus.pending:
            raise HTTPException(
                status_code=403,
                detail="This HOA is pending Super Admin approval. Please contact your HOA administrator."
            )
        raise HTTPException(status_code=403, detail="This HOA is not active.")

    # Load parent Management Company to check token limits
    client_result = await db.execute(select(Client).where(Client.id == community.client_id))
    client = client_result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Management company not found")

    if client.tokens_used_this_month >= client.token_limit_monthly:
        raise HTTPException(
            status_code=429,
            detail="Monthly token limit reached. Please contact your HOA management company."
        )

    # Check Redis cache
    cache_key = f"chat:{community.id}:{request.question}"
    async with aioredis.Redis(connection_pool=get_redis_pool()) as redis:
        cached = await redis.get(cache_key)

    if cached:
        async def cached_stream():
            yield f"data: {json.dumps({'text': cached})}\n\n"
            yield f"data: {json.dumps({'done': True, 'cached': True})}\n\n"
        return StreamingResponse(cached_stream(), media_type="text/event-stream")

    # Retrieve relevant document chunks for this specific HOA
    context_chunks = await retrieve_context(
        question=request.question,
        client_id=community.client_id,
        community_id=community.id,
        n_results=10
    )

    if not context_chunks:
        async def no_docs_stream():
            msg = "No HOA documents have been uploaded yet. Please ask your HOA management to upload the relevant documents."
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(no_docs_stream(), media_type="text/event-stream")

    # Build prompt with context
    context_text = "\n\n---\n\n".join(context_chunks)
    manager_info = f"\nHOA Manager Name: {community.manager_name or 'N/A'}\nHOA Manager Email: {community.manager_email or 'N/A'}\nHOA Manager Phone: {community.manager_phone or 'N/A'}\n"
    
    user_message = f"""HOA Document Context:
{context_text}
{manager_info}
Resident Question: {request.question}"""

    # If no Anthropic API key configured yet, return placeholder
    if not settings.anthropic_api_key:
        async def no_key_stream():
            msg = "AI service not configured yet. API key pending setup."
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(no_key_stream(), media_type="text/event-stream")

    community_id = community.id
    client_id = community.client_id

    async def stream_response():
        full_response = ""
        async for chunk in get_chat_response(
            provider=community.ai_provider,
            model_alias=community.ai_model,
            system_prompt=SYSTEM_PROMPT,
            user_message=user_message,
        ):
            # The chunk is already formatted as "data: {...}\n\n" from ai_service
            # We need to extract the text if we want to cache it
            if '"text":' in chunk:
                try:
                    data = json.loads(chunk.replace("data: ", "").strip())
                    if "text" in data:
                        full_response += data["text"]
                except:
                    pass
            yield chunk

        # Cache the full response for 1 hour
        if full_response:
            async with aioredis.Redis(connection_pool=get_redis_pool()) as redis_cache:
                await redis_cache.setex(cache_key, 3600, full_response)

        # Log usage
        async with AsyncSessionLocal() as session:
            log = UsageLog(
                client_id=client_id,
                community_id=community_id,
                tokens_input=0,
                tokens_output=0,
                question=request.question[:500]
            )
            session.add(log)
            result = await session.execute(select(Client).where(Client.id == client_id))
            c = result.scalar_one_or_none()
            if c:
                c.tokens_used_this_month += 500
            await session.commit()

    return StreamingResponse(stream_response(), media_type="text/event-stream")
