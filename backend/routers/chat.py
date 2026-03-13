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
from models import Client, ClientStatus, UsageLog
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

    # Check Redis cache
    redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    cache_key = f"chat:{client.id}:{request.community_id}:{request.question}"
    cached = await redis.get(cache_key)
    if cached:
        await redis.close()
        return {"answer": cached, "cached": True}

    # Retrieve relevant document chunks
    context_chunks = retrieve_context(
        question=request.question,
        client_id=client.id,
        community_id=request.community_id
    )

    if not context_chunks:
        await redis.close()
        return {
            "answer": "No HOA documents have been uploaded yet. Please ask your HOA management to upload the relevant documents.",
            "cached": False
        }

    # Build prompt with context
    context_text = "\n\n---\n\n".join(context_chunks)
    user_message = f"""HOA Document Context:
{context_text}

Resident Question: {request.question}"""

    # If no API key configured yet, return placeholder
    if not settings.anthropic_api_key:
        await redis.close()
        return {
            "answer": "AI service not configured yet. API key pending setup.",
            "cached": False
        }

    client_id = client.id
    anthropic_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    async def stream_response():
        full_response = ""
        total_input = 0
        total_output = 0

        with anthropic_client.messages.stream(
            model="claude-opus-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}]
        ) as stream:
            for event in stream:
                if hasattr(event, "type"):
                    if event.type == "content_block_delta" and hasattr(event.delta, "text"):
                        chunk = event.delta.text
                        full_response += chunk
                        yield f"data: {json.dumps({'text': chunk})}\n\n"

            final = stream.get_final_message()
            total_input = final.usage.input_tokens
            total_output = final.usage.output_tokens

        # Cache for 1 hour
        await redis.setex(cache_key, 3600, full_response)
        await redis.close()

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
