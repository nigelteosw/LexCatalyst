from datetime import datetime
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.database import Base
from app.services.field_encryption import decrypt_text, encrypt_text

EMBEDDING_DIMENSIONS = get_settings().openai_embedding_dimensions


def new_uuid() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    default_team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    firm_role: Mapped[str] = mapped_column(String(24), nullable=False, default="associate")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    threads: Mapped[list["ChatThread"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    memories: Mapped[list["Memory"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    wiki_pages: Mapped[list["WikiPage"]] = relationship(
        back_populates="owner",
        cascade="all, delete-orphan",
        foreign_keys="WikiPage.owner_user_id",
    )


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    matter_id: Mapped[str | None] = mapped_column(
        ForeignKey("matters.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="threads")
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    thread: Mapped[ChatThread] = relationship(back_populates="messages")
    memories: Mapped[list["Memory"]] = relationship(back_populates="source_message")


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    category: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    source_message_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    confidence: Mapped[float] = mapped_column(default=1.0, nullable=False)
    scope: Mapped[str] = mapped_column(String(24), index=True, nullable=False, default="personal")
    matter_id: Mapped[str | None] = mapped_column(
        ForeignKey("matters.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="memories")
    source_thread: Mapped[ChatThread | None] = relationship()
    source_message: Mapped[ChatMessage | None] = relationship(back_populates="memories")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(String(24), index=True, nullable=False, default="uploaded")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    matter_id: Mapped[str | None] = mapped_column(
        ForeignKey("matters.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="documents")
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentChunk.chunk_index",
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    citation_label: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    document: Mapped[Document] = relationship(back_populates="chunks")


class WikiPage(Base):
    __tablename__ = "wiki_pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    author_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    latest_editor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    workspace_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    matter_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(240), index=True, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), index=True, nullable=False, default="draft")
    created_by: Mapped[str] = mapped_column(String(24), nullable=False, default="user")
    source_document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    owner: Mapped[User] = relationship(
        back_populates="wiki_pages",
        foreign_keys=[owner_user_id],
    )
    author: Mapped[User] = relationship(foreign_keys=[author_user_id])
    latest_editor: Mapped[User | None] = relationship(foreign_keys=[latest_editor_user_id])
    source_document: Mapped[Document | None] = relationship()
    revisions: Mapped[list["WikiPageRevision"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="WikiPageRevision.created_at",
    )
    sources: Mapped[list["WikiPageSource"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
    )
    outgoing_links: Mapped[list["WikiLink"]] = relationship(
        back_populates="source_page",
        cascade="all, delete-orphan",
        foreign_keys="WikiLink.source_page_id",
    )


class WikiPageRevision(Base):
    __tablename__ = "wiki_page_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    page_id: Mapped[str] = mapped_column(
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    edited_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    edit_source: Mapped[str] = mapped_column(String(40), nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    page: Mapped[WikiPage] = relationship(back_populates="revisions")
    edited_by: Mapped[User | None] = relationship()


class WikiPageSource(Base):
    __tablename__ = "wiki_page_sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    page_id: Mapped[str] = mapped_column(
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    chunk_id: Mapped[str | None] = mapped_column(
        ForeignKey("document_chunks.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    memory_id: Mapped[str | None] = mapped_column(
        ForeignKey("memories.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    chat_message_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    citation_label: Mapped[str] = mapped_column(String(512), nullable=False)
    relevance_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    page: Mapped[WikiPage] = relationship(back_populates="sources")
    document: Mapped[Document | None] = relationship()
    chunk: Mapped[DocumentChunk | None] = relationship()
    memory: Mapped[Memory | None] = relationship()
    chat_message: Mapped[ChatMessage | None] = relationship()


class WikiLink(Base):
    __tablename__ = "wiki_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    source_page_id: Mapped[str] = mapped_column(
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    target_page_id: Mapped[str | None] = mapped_column(
        ForeignKey("wiki_pages.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    link_text: Mapped[str] = mapped_column(String(255), nullable=False)
    link_type: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    source_page: Mapped[WikiPage] = relationship(
        back_populates="outgoing_links",
        foreign_keys=[source_page_id],
    )
    target_page: Mapped[WikiPage | None] = relationship(foreign_keys=[target_page_id])


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    practice_area: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(24), nullable=False, default="associate")
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    team: Mapped[Team] = relationship()
    user: Mapped[User] = relationship(foreign_keys=[user_id])


class Matter(Base):
    __tablename__ = "matters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    case_number: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    _client_name: Mapped[str | None] = mapped_column("client_name", Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), index=True, nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    team: Mapped[Team] = relationship()

    @property
    def client_name(self) -> str | None:
        return decrypt_text(self._client_name)

    @client_name.setter
    def client_name(self, value: str | None) -> None:
        self._client_name = encrypt_text(value)


class MatterMember(Base):
    __tablename__ = "matter_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    matter_id: Mapped[str] = mapped_column(
        ForeignKey("matters.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(24), nullable=False, default="associate")
    granted_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    matter: Mapped[Matter] = relationship()
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    grantor: Mapped[User | None] = relationship(foreign_keys=[granted_by])


class KnowledgeBankEntry(Base):
    __tablename__ = "kb_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    matter_id: Mapped[str | None] = mapped_column(
        ForeignKey("matters.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    source_entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("kb_entries.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    source_document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    scope: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    entry_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    pii_status: Mapped[str] = mapped_column(String(24), index=True, nullable=False, default="clean")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    created_by_role: Mapped[str] = mapped_column(String(24), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    team: Mapped[Team | None] = relationship()
    matter: Mapped[Matter | None] = relationship()
    creator: Mapped[User] = relationship(foreign_keys=[created_by])
    source_entry: Mapped["KnowledgeBankEntry | None"] = relationship(remote_side=[id])
    source_document: Mapped[Document | None] = relationship()


class KnowledgeBankAccessLog(Base):
    __tablename__ = "kb_access_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    kb_entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("kb_entries.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    action: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    context_matter_id: Mapped[str | None] = mapped_column(
        ForeignKey("matters.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    context_thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    entry: Mapped[KnowledgeBankEntry | None] = relationship()
    user: Mapped[User] = relationship()


class PiiRedaction(Base):
    __tablename__ = "pii_redactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    kb_entry_id: Mapped[str] = mapped_column(
        ForeignKey("kb_entries.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    source_matter_id: Mapped[str | None] = mapped_column(
        ForeignKey("matters.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    target_scope: Mapped[str] = mapped_column(String(24), nullable=False)
    redacted_fields: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    approved_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    _original_content: Mapped[str] = mapped_column("original_content", Text, nullable=False)
    redacted_content: Mapped[str] = mapped_column(Text, nullable=False)

    entry: Mapped[KnowledgeBankEntry] = relationship()
    approver: Mapped[User | None] = relationship()

    @property
    def original_content(self) -> str:
        return decrypt_text(self._original_content) or ""

    @original_content.setter
    def original_content(self, value: str) -> None:
        self._original_content = encrypt_text(value) or ""
