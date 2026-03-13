import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer
from config import settings

_chroma_host = settings.chroma_url.replace("http://", "").split(":")[0]
_chroma_port = int(settings.chroma_url.split(":")[-1])

chroma_client = chromadb.HttpClient(
    host=_chroma_host,
    port=_chroma_port,
    settings=ChromaSettings(anonymized_telemetry=False)
)

embedder = SentenceTransformer("all-MiniLM-L6-v2")


def get_collection_name(client_id: str, community_id: str = None) -> str:
    if community_id:
        return f"client_{client_id}_community_{community_id}"
    return f"client_{client_id}_general"


def retrieve_context(
    question: str,
    client_id: str,
    community_id: str = None,
    n_results: int = 5
) -> list:
    """
    Embed the question and find the most relevant document chunks.
    Returns list of relevant text passages.
    """
    collection_name = get_collection_name(client_id, community_id)

    try:
        collection = chroma_client.get_collection(name=collection_name)
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

    if not results or not results["documents"]:
        return []

    return results["documents"][0]
