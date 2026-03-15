import json
import logging
import asyncio
from typing import AsyncGenerator, Optional
import anthropic
import google.generativeai as genai
from openai import AsyncOpenAI
from config import settings

logger = logging.getLogger(__name__)

# Provider Constants
ANTHROPIC = "anthropic"
GEMINI = "gemini"
OPENAI = "openai"

# Model Mappings for standard aliases and supported models
MODEL_MAP = {
    ANTHROPIC: {
        "haiku": "claude-3-haiku-20240307",
        "sonnet": "claude-3-5-sonnet-latest",
        "opus": "claude-3-opus-20240229",
        "claude-2.1": "claude-2.1",
    },
    GEMINI: {
        "flash": "models/gemini-1.5-flash",
        "pro": "models/gemini-1.5-pro",
        "pro-1.0": "models/gemini-1.0-pro",
        # Backward compatibility for old UI aliases
        "haiku": "models/gemini-1.5-flash",
        "sonnet": "models/gemini-1.5-pro",
    },
    OPENAI: {
        "4o": "gpt-4o",
        "4o-mini": "gpt-4o-mini",
        "gpt-4-turbo": "gpt-4-turbo",
        "gpt-3.5-turbo": "gpt-3.5-turbo",
        # Backward compatibility for old UI aliases
        "haiku": "gpt-4o-mini",
        "sonnet": "gpt-4o",
    }
}

def get_supported_models():
    """Returns a dictionary of supported providers and their models."""
    return {
        provider: list(models.keys())
        for provider, models in MODEL_MAP.items()
    }

async def get_chat_response(
    provider: str,
    model_alias: str,
    system_prompt: str,
    user_message: str,
    api_key: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """Unified chat response generator for multiple AI providers."""
    
    provider = provider.lower() if provider else ANTHROPIC
    model_alias = model_alias.lower() if model_alias else "haiku"
    
    # Resolve the actual model ID
    # Use the alias if it exists in the map, otherwise assume it's a specific model ID
    model_id = MODEL_MAP.get(provider, {}).get(model_alias, model_alias)
    
    logger.info(f"Chat request - Provider: {provider}, Model: {model_id}")
    
    if provider == ANTHROPIC:
        # Use existing async generator pattern
        async for chunk in _stream_anthropic(model_id, system_prompt, user_message, api_key):
            yield chunk
    elif provider == GEMINI:
        async for chunk in _stream_gemini(model_id, system_prompt, user_message, api_key):
            yield chunk
    elif provider == OPENAI:
        async for chunk in _stream_openai(model_id, system_prompt, user_message, api_key):
            yield chunk
    else:
        yield f"data: {json.dumps({'text': f'[System: Unknown AI provider: {provider}]'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

async def _stream_anthropic(model_id, system, user, api_key):
    key = api_key or settings.anthropic_api_key
    if not key:
        yield f"data: {json.dumps({'text': '[System: Anthropic API key not configured.]'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
        return

    ac = anthropic.AsyncAnthropic(api_key=key)
    try:
        async with ac.messages.stream(
            model=model_id,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user}],
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and hasattr(event.delta, "text"):
                    yield f"data: {json.dumps({'text': event.delta.text})}\n\n"
            
            # Send done signal
            yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as e:
        async for err in _handle_error(e, "Anthropic"):
            yield err
    finally:
        await ac.close()

async def _stream_gemini(model_id, system, user, api_key):
    key = api_key or settings.gemini_api_key
    if not key:
        logger.error("Gemini API key missing")
        yield f"data: {json.dumps({'text': '[System: Gemini API key not configured.]'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
        return

    try:
        logger.info(f"Configuring Gemini with model: {model_id}")
        genai.configure(api_key=key)
        model = genai.GenerativeModel(
            model_name=model_id,
            system_instruction=system
        )
        response = await model.generate_content_async(user, stream=True)
        async for chunk in response:
            if chunk.text:
                yield f"data: {json.dumps({'text': chunk.text})}\n\n"
        
        yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as e:
        logger.error(f"Gemini streaming error: {str(e)}")
        async for err in _handle_error(e, "Gemini"):
            yield err

async def _stream_openai(model_id, system, user, api_key):
    key = api_key or settings.openai_api_key
    if not key:
        yield f"data: {json.dumps({'text': '[System: OpenAI API key not configured.]'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"
        return

    client = AsyncOpenAI(api_key=key)
    try:
        stream = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ],
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield f"data: {json.dumps({'text': chunk.choices[0].delta.content})}\n\n"
        
        yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as e:
        async for err in _handle_error(e, "OpenAI"):
            yield err
    finally:
        await client.close()

async def _handle_error(e, provider_name):
    err_msg = str(e)
    logger.error(f"{provider_name} error: {err_msg}")
    
    friendly_msg = f"An unexpected error occurred with {provider_name}. Please try again later."
    
    if "credit" in err_msg.lower() or "quota" in err_msg.lower() or "429" in err_msg:
        friendly_msg = f"The {provider_name} service is currently unavailable due to credit or rate limits."
    elif "not_found" in err_msg.lower() or "404" in err_msg:
        friendly_msg = f"The selected {provider_name} model ID ({err_msg}) is currently unavailable."
    elif "invalid_api_key" in err_msg.lower() or "401" in err_msg:
        friendly_msg = f"The {provider_name} API key is invalid or unauthorized."

    error_text = f"\n\n[System Error ({provider_name}): {friendly_msg}]"
    yield f"data: {json.dumps({'text': error_text})}\n\n"
    yield f"data: {json.dumps({'done': True})}\n\n"
