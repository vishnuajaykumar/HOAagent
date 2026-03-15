import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, BigInteger, Enum as SAEnum, Boolean
from sqlalchemy.orm import relationship
from database import Base


class ClientStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    suspended = "suspended"
    cancelled = "cancelled"


class CommunityStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    suspended = "suspended"


class Client(Base):
    """A Management Company that manages multiple HOA communities."""
    __tablename__ = "clients"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    company_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    # Client-level API key kept for backwards compatibility but HOA chat uses Community.api_key
    api_key = Column(String, unique=True, default=lambda: "hoa_" + str(uuid.uuid4()).replace("-", ""))
    status = Column(SAEnum(ClientStatus), default=ClientStatus.active)  # Auto-approved
    token_limit_monthly = Column(BigInteger, default=10_000_000)  # shared pool across all HOAs
    tokens_used_this_month = Column(BigInteger, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_at = Column(DateTime, nullable=True, default=datetime.utcnow)
    is_archived = Column(Boolean, default=False)

    communities = relationship("Community", back_populates="client", cascade="all, delete-orphan")
    usage_logs = relationship("UsageLog", back_populates="client")
    documents = relationship("Document", back_populates="client")


class Community(Base):
    """An individual HOA community managed by a Management Company."""
    __tablename__ = "communities"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = Column(String, ForeignKey("clients.id"), nullable=False)

    # HOA details
    name = Column(String, nullable=False)
    manager_name = Column(String, nullable=True)
    manager_email = Column(String, nullable=True)
    manager_phone = Column(String, nullable=True)
    location = Column(String, nullable=True)

    # Each HOA has its own API key for the chat widget
    api_key = Column(String, unique=True, default=lambda: "hoa_" + str(uuid.uuid4()).replace("-", ""))

    # Approval and model settings controlled by Super Admin
    status = Column(SAEnum(CommunityStatus), default=CommunityStatus.pending)
    model_tier = Column(String, default="haiku")  # legacy
    ai_provider = Column(String, default="anthropic") # anthropic | gemini | openai
    ai_model = Column(String, default="haiku") # specific model id or haiku/sonnet alias
    approved_at = Column(DateTime, nullable=True)
    is_archived = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="communities")
    documents = relationship("Document", back_populates="community", cascade="all, delete-orphan")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = Column(String, ForeignKey("clients.id"), nullable=False)
    community_id = Column(String, ForeignKey("communities.id"), nullable=True)
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
    question = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="usage_logs")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = Column(String, ForeignKey("clients.id"), nullable=False)
    community_id = Column(String, ForeignKey("communities.id"), nullable=True)
    filename = Column(String, nullable=False)
    chroma_collection = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="processing")

    client = relationship("Client", back_populates="documents")
    community = relationship("Community", back_populates="documents")
