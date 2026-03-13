import os
import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from config import settings

# Parse host/port from CHROMA_URL
_chroma_host = settings.chroma_url.replace("http://", "").split(":")[0]
_chroma_port = int(settings.chroma_url.split(":")[-1])

chroma_client = chromadb.HttpClient(
    host=_chroma_host,
    port=_chroma_port,
    settings=ChromaSettings(anonymized_telemetry=False)
)

# Embedding model — runs locally, no API needed
embedder = SentenceTransformer("all-MiniLM-L6-v2")


def get_collection_name(client_id: str, community_id: str = None) -> str:
    if community_id:
        return f"client_{client_id}_community_{community_id}"
    return f"client_{client_id}_general"


async def ingest_pdf(
    pdf_path: str,
    client_id: str,
    community_id: str = None,
    document_id: str = None
) -> dict:
    """
    Load a PDF, chunk it, embed it, and store in ChromaDB.
    Returns dict with chunk count and collection name.
    """
    collection_name = get_collection_name(client_id, community_id)

    loader = PyPDFLoader(pdf_path)
    pages = loader.load()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100,
        length_function=len
    )
    chunks = splitter.split_documents(pages)

    if not chunks:
        raise ValueError("No text extracted from PDF")

    collection = chroma_client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"}
    )

    texts = [chunk.page_content for chunk in chunks]
    embeddings = embedder.encode(texts).tolist()

    ids = [f"{document_id or 'doc'}_{i}" for i in range(len(texts))]
    metadatas = [
        {
            "page": chunk.metadata.get("page", 0),
            "source": chunk.metadata.get("source", ""),
            "document_id": document_id or ""
        }
        for chunk in chunks
    ]

    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=texts,
        metadatas=metadatas
    )

    return {"chunks": len(chunks), "collection": collection_name}
