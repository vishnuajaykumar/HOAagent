import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, BigInteger, Enum as SAEnum
from sqlalchemy.orm import relationship
from database import Base


class ClientStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    suspended = "suspended"
    cancelled = "cancelled"


class Client(Base):
    __tablename__ = "clients"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    company_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    api_key = Column(String, unique=True, default=lambda: "hoa_" + str(uuid.uuid4()).replace("-", ""))
    status = Column(SAEnum(ClientStatus), default=ClientStatus.pending)
    token_limit_monthly = Column(BigInteger, default=1_000_000)
    tokens_used_this_month = Column(BigInteger, default=0)
    model_tier = Column(String, default="haiku")  # haiku | sonnet
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_at = Column(DateTime, nullable=True)

    communities = relationship("Community", back_populates="client")
    usage_logs = relationship("UsageLog", back_populates="client")
    documents = relationship("Document", back_populates="client")


class Community(Base):
    __tablename__ = "communities"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = Column(String, ForeignKey("clients.id"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="communities")
    documents = relationship("Document", back_populates="community")


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
