import asyncio
import pypdf
import chromadb
from sentence_transformers import SentenceTransformer
from config import settings

# Lazy-initialized singletons — not created at import time so startup
# doesn't fail if ChromaDB or the model aren't ready yet.
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


def get_collection_name(client_id: str, community_id: str = None) -> str:
    if community_id:
        return f"client_{client_id}_community_{community_id}"
    return f"client_{client_id}_general"


def _parse_pdf_chunks(pdf_path: str, chunk_size: int = 800, overlap: int = 100) -> list[dict]:
    """Read a PDF and return a list of {text, page} dicts. Pure CPU/IO — run in thread."""
    reader = pypdf.PdfReader(pdf_path)
    chunks = []
    for page_num, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        start = 0
        while start < len(text):
            chunk_text = text[start:start + chunk_size].strip()
            if chunk_text:
                chunks.append({"text": chunk_text, "page": page_num})
            start += chunk_size - overlap
    return chunks


def _embed_and_upsert(collection_name: str, chunks: list[dict], document_id: str) -> int:
    """Embed chunks and upsert into ChromaDB. Blocking — run in thread."""
    chroma = _get_chroma()
    embedder = _get_embedder()

    collection = chroma.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"}
    )

    texts = [c["text"] for c in chunks]
    embeddings = embedder.encode(texts).tolist()
    ids = [f"{document_id}_{i}" for i in range(len(texts))]
    metadatas = [{"page": c["page"], "document_id": document_id} for c in chunks]

    collection.upsert(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)
    return len(chunks)


async def ingest_pdf(
    pdf_path: str,
    client_id: str,
    community_id: str = None,
    document_id: str = None
) -> dict:
    """
    Load a PDF, chunk it, embed it, and store in ChromaDB.
    All blocking operations run in a thread pool to avoid blocking the event loop.
    Returns dict with chunk count and collection name.
    """
    doc_id = str(document_id or "doc")
    collection_name = get_collection_name(client_id, community_id)

    # PDF parsing is CPU/IO bound — run in thread
    chunks = await asyncio.to_thread(_parse_pdf_chunks, pdf_path)

    if not chunks:
        raise ValueError("No text extracted from PDF")

    # Embedding + ChromaDB write are both blocking — run in thread
    count = await asyncio.to_thread(_embed_and_upsert, collection_name, chunks, doc_id)

    return {"chunks": count, "collection": collection_name}
