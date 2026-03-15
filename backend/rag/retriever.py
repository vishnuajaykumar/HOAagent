import asyncio
import chromadb
from sentence_transformers import SentenceTransformer
from config import settings

# Lazy-initialized singletons shared with ingest.py would cause a circular
# import, so we keep separate module-level state here.
_chroma_client = None
_embedder = None


def _get_chroma() -> chromadb.HttpClient:
    global _chroma_client
    if _chroma_client is None:
        host = settings.chroma_url.replace("http://", "").split(":")[0]
        port = int(settings.chroma_url.split(":")[-1])
        _chroma_client = chromadb.HttpClient(
            host=host,
            port=port
        )
    return _chroma_client


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedder


import hashlib

def get_collection_name(client_id: str, community_id: str = None) -> str:
    """Generate a safe, short collection name (max 63 chars for Chroma)."""
    combined = f"{client_id}_{community_id}" if community_id else f"{client_id}_general"
    h = hashlib.md5(combined.encode()).hexdigest()
    return f"col_{h}"


def _query_chroma(collection_name: str, question: str, n_results: int) -> list[str]:
    """Blocking ChromaDB query — run in thread."""
    chroma = _get_chroma()
    embedder = _get_embedder()

    try:
        collection = chroma.get_collection(name=collection_name)
    except Exception:
        return []

    count = collection.count()
    if count == 0:
        return []

    query_embedding = embedder.encode([question]).tolist()
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=min(n_results, count)
    )

    if not results or not results.get("documents") or len(results["documents"]) == 0:
        return []

    docs = results["documents"][0]
    metas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []
    
    formatted_chunks = []
    for i, doc in enumerate(docs):
        meta_info = ""
        if metas and i < len(metas):
            page = metas[i].get("page", "Unknown")
            # If "page" is just a chunk index, we'll label it "Section/Chunk"
            # so the AI can at least reference it.
            meta_info = f"[Found in Section/Page: {page}]\n"
        formatted_chunks.append(f"{meta_info}{doc}")

    return formatted_chunks


async def retrieve_context(
    question: str,
    client_id: str,
    community_id: str = None,
    n_results: int = 10
) -> list[str]:
    """
    Embed the question and find the most relevant document chunks.
    Blocking operations run in a thread pool.
    Returns list of relevant text passages.
    """
    collection_name = get_collection_name(client_id, community_id)
    return await asyncio.to_thread(_query_chroma, collection_name, question, n_results)
