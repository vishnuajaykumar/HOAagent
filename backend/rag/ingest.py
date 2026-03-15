import asyncio
import logging
import pypdf
import chromadb
from sentence_transformers import SentenceTransformer
from config import settings

logger = logging.getLogger(__name__)

# Lazy-initialized singletons
_chroma_client = None
_embedder = None


def _get_chroma() -> chromadb.HttpClient:
    global _chroma_client
    if _chroma_client is None:
        host = settings.chroma_url.replace("http://", "").split(":")[0]
        port = int(settings.chroma_url.split(":")[-1])
        _chroma_client = chromadb.HttpClient(host=host, port=port)
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


def _extract_text_pdfplumber(pdf_path: str) -> str:
    """Try pdfplumber first — handles more PDF types than pypdf."""
    try:
        import pdfplumber
        full_text = ""
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text + "\n"
        return full_text.strip()
    except Exception as e:
        logger.warning(f"pdfplumber failed: {e}")
        return ""


def _extract_text_pymupdf(pdf_path: str) -> str:
    """Fallback to PyMuPDF (fitz) — handles some scanned PDFs with embedded text."""
    try:
        import fitz  # PyMuPDF
        full_text = ""
        doc = fitz.open(pdf_path)
        for page in doc:
            full_text += page.get_text() + "\n"
        doc.close()
        return full_text.strip()
    except Exception as e:
        logger.warning(f"PyMuPDF failed: {e}")
        return ""


def _extract_text_ocr(pdf_path: str) -> str:
    """Last resort — OCR the PDF pages using pytesseract."""
    try:
        from pdf2image import convert_from_path
        import pytesseract
        import numpy as np
        from PIL import Image

        logger.info(f"Starting OCR for {pdf_path} (this may take a while)...")
        images = convert_from_path(pdf_path)
        full_text = ""
        for i, image in enumerate(images):
            page_text = pytesseract.image_to_string(image)
            if page_text:
                full_text += page_text + "\n"
            logger.info(f"OCR: processed page {i+1}/{len(images)}")
        
        return full_text.strip()
    except Exception as e:
        logger.warning(f"OCR failed: {e}")
        return ""


def _extract_text_pypdf(pdf_path: str) -> str:
    """Final fallback — pypdf."""
    try:
        reader = pypdf.PdfReader(pdf_path)
        full_text = ""
        for page in reader.pages:
            text = page.extract_text() or ""
            full_text += text + "\n"
        return full_text.strip()
    except Exception as e:
        logger.warning(f"pypdf failed: {e}")
        return ""


def _parse_pdf_chunks(pdf_path: str, chunk_size: int = 800, overlap: int = 100) -> list[dict]:
    """
    Extract text from a PDF using multiple strategies, then chunk it.
    Returns list of {text, page} dicts.
    """
    # Try each extractor in order of reliability
    full_text = _extract_text_pdfplumber(pdf_path)
    if not full_text:
        logger.info("pdfplumber got no text, trying PyMuPDF...")
        full_text = _extract_text_pymupdf(pdf_path)
    if not full_text:
        logger.info("PyMuPDF got no text, trying pypdf...")
        full_text = _extract_text_pypdf(pdf_path)
    if not full_text:
        logger.info("pypdf got no text, using OCR fallback (slow)...")
        full_text = _extract_text_ocr(pdf_path)

    if not full_text:
        logger.error(f"All extractors failed for {pdf_path}. PDF may be fully scanned images with no embedded text.")
        raise ValueError(
            "Could not extract text from this PDF. The document appears to be a scanned image PDF. "
            "Please provide a PDF with selectable/searchable text, or a text-layer PDF."
        )

    logger.info(f"Extracted {len(full_text)} characters from {pdf_path}")

    # Chunk the full document text
    chunks = []
    start = 0
    chunk_index = 0
    while start < len(full_text):
        chunk_text = full_text[start:start + chunk_size].strip()
        if chunk_text:
            chunks.append({"text": chunk_text, "page": chunk_index})
        start += chunk_size - overlap
        chunk_index += 1

    logger.info(f"Created {len(chunks)} chunks from {pdf_path}")
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


async def delete_from_chroma(client_id: str, community_id: str, document_id: str):
    """Delete all chunks belonging to a document from ChromaDB."""
    # Run in thread since Chroma client is blocking
    def _do_delete():
        chroma = _get_chroma()
        collection_name = get_collection_name(client_id, community_id)
        try:
            collection = chroma.get_collection(name=collection_name)
            collection.delete(where={"document_id": str(document_id)})
            logger.info(f"Deleted {document_id} from Chroma collection {collection_name}")
        except Exception as e:
            logger.warning(f"Chroma delete failed for {document_id}: {e}")

    await asyncio.to_thread(_do_delete)


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

    # Embedding + ChromaDB write are both blocking — run in thread
    count = await asyncio.to_thread(_embed_and_upsert, collection_name, chunks, doc_id)

    return {"chunks": count, "collection": collection_name}
