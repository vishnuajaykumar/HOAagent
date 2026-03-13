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
from models import Client, ClientStatus, Community, UsageLog
from rag.retriever import retrieve_context
from config import settings

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = """You are a helpful HOA (Homeowners Association) assistant.
Your role is to answer residents' questions based ONLY on the HOA documents provided.

STRICT RULES:
1. Answer ONLY based on the provided document context below
2. If the answer is not in the documents, say: "I don't have information about that in the HOA documents. Please contact your HOA management office directly."
3. Never make up rules, fees, or policies
4. Be friendly, clear, and concise
5. If asked about something outside HOA topics, politely redirect"""

MODEL_MAP = {"sonnet": "claude-sonnet-4-6", "haiku": "claude-haiku-4-5"}

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
    api_key: str
    community_id: Optional[str] = None


@router.post("")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    # Validate API key
    result = await db.execute(select(Client).where(Client.api_key == request.api_key))
    client = result.scalar_one_or_none()

    if not client:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if client.status != ClientStatus.active:
        raise HTTPException(status_code=403, detail="Account is not active")

    # Check token limit
    if client.tokens_used_this_month >= client.token_limit_monthly:
        raise HTTPException(
            status_code=429,
            detail="Monthly token limit reached. Please contact your HOA management company."
        )

    # Validate community_id ownership — prevent cross-client data access
    if request.community_id:
        comm_result = await db.execute(
            select(Community).where(
                Community.id == request.community_id,
                Community.client_id == client.id
            )
        )
        if not comm_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Community not found")

    # Check Redis cache — use pooled connection as async context manager
    cache_key = f"chat:{client.id}:{request.community_id}:{request.question}"
    async with aioredis.Redis(connection_pool=get_redis_pool()) as redis:
        cached = await redis.get(cache_key)

    if cached:
        async def cached_stream():
            yield f"data: {json.dumps({'text': cached})}\n\n"
            yield f"data: {json.dumps({'done': True, 'cached': True})}\n\n"
        return StreamingResponse(cached_stream(), media_type="text/event-stream")

    # Retrieve relevant document chunks
    context_chunks = await retrieve_context(
        question=request.question,
        client_id=client.id,
        community_id=request.community_id
    )

    if not context_chunks:
        async def no_docs_stream():
            msg = "No HOA documents have been uploaded yet. Please ask your HOA management to upload the relevant documents."
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(no_docs_stream(), media_type="text/event-stream")

    # Build prompt with context
    context_text = "\n\n---\n\n".join(context_chunks)
    user_message = f"""HOA Document Context:
{context_text}

Resident Question: {request.question}"""

    # If no API key configured yet, return placeholder
    if not settings.anthropic_api_key:
        async def no_key_stream():
            msg = "AI service not configured yet. API key pending setup."
            yield f"data: {json.dumps({'text': msg})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        return StreamingResponse(no_key_stream(), media_type="text/event-stream")

    client_id = client.id
    model = MODEL_MAP.get(client.model_tier or "haiku", "claude-haiku-4-5")
    ac = get_anthropic_client()

    async def stream_response():
        full_response = ""
        total_input = 0
        total_output = 0

        # AsyncAnthropic stream — does NOT block the event loop
        async with ac.messages.stream(
            model=model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}]
        ) as stream:
            async for event in stream:
                if hasattr(event, "type"):
                    if event.type == "content_block_delta" and hasattr(event.delta, "text"):
                        chunk = event.delta.text
                        full_response += chunk
                        yield f"data: {json.dumps({'text': chunk})}\n\n"

            final = await stream.get_final_message()
            total_input = final.usage.input_tokens
            total_output = final.usage.output_tokens

        # Cache the full response for 1 hour
        async with aioredis.Redis(connection_pool=get_redis_pool()) as redis_cache:
            await redis_cache.setex(cache_key, 3600, full_response)

        # Log usage
        async with AsyncSessionLocal() as session:
            log = UsageLog(
                client_id=client_id,
                community_id=request.community_id,
                tokens_input=total_input,
                tokens_output=total_output,
                question=request.question[:500]
            )
            session.add(log)
            result = await session.execute(select(Client).where(Client.id == client_id))
            c = result.scalar_one_or_none()
            if c:
                c.tokens_used_this_month += total_input + total_output
            await session.commit()

        yield f"data: {json.dumps({'done': True, 'tokens': total_input + total_output})}\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")
