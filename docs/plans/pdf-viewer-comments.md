# Plan: PDF viewer + matter-wide comments

> Implemented June 14, 2026. The final migration is `p1e2f3a4b5c6` because the migration ID proposed below was already used. The implementation also includes uploader-only document renaming and widens the Documents list to owner-or-matter-member visibility.

## Why

Today the Documents panel lists uploaded files but you can't actually *read* them in-app — you'd have to download. For a legal workflow that's wrong: a lawyer reviewing a draft NDA wants the PDF open next to the chat, and wants to leave a comment for a teammate (*"check clause 7.2"*) without leaving the platform.

Two distinct asks bundled into one:
1. **View** the PDF in-place.
2. **Comment** so a colleague on the matter can see annotations.

Why bundle them: opening a PDF inevitably leads to *"and what did Sarah think of this?"*. Building view-only first means we ship something that nobody actually uses to collaborate.

## What we're building

### View — inline right-side drawer

- Click a document row in the Documents panel → drawer slides in from the right, ~640px wide.
- Drawer contents: filename + status badge in the header, an embedded PDF viewer below, a comments thread at the bottom that stays visible (sticky-input pattern).
- Close button or click-outside dismisses; the underlying Documents panel stays mounted so navigation feels instant.
- For DOCX files, we fall back to a "Preview not available — download" affordance. PDF only for the first cut.

### Viewer implementation

Browser-native `<iframe>` pointing to a new authenticated route `/documents/{id}/file`. Pros: zero bundle cost, scroll/zoom/search built in. Cons: no overlay annotations. For this MVP that's fine — we have a separate comments thread.

Future option: drop in `react-pdf` if we want highlight-anchored comments. Not for v1.

### Comments — matter-wide

- Visible to: anyone who is a member of the document's matter; or, if the document has no matter, only the uploader.
- Editable by: the comment author.
- Deletable by: the comment author or a partner+ in the matter.

Comment shape: short markdown (3KB max). Multi-line OK. No threading — flat list ordered chronologically. We avoid Slack-style threads because legal context tends to be a few terse remarks per document, not deep discussions.

## Backend changes

### Migration `k8f9a0b1c2d3` — `document_comments`

```python
op.create_table(
    "document_comments",
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "document_id", sa.String(36),
        sa.ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column(
        "user_id", sa.String(36),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    ),
    sa.Column("content", sa.Text(), nullable=False),
    sa.Column(
        "created_at", sa.DateTime(timezone=True),
        server_default=sa.func.now(), nullable=False,
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True),
        server_default=sa.func.now(), nullable=False,
    ),
)
```

### Model

```python
class DocumentComment(Base):
    __tablename__ = "document_comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )
    author: Mapped[User] = relationship()
```

### Access predicate (reuse pattern)

`get_document_full_text` was widened in an earlier change to allow access when the user owns the doc OR is a member of the doc's matter. Re-use the same predicate for:
- Serving the PDF file
- Listing comments
- Creating comments

A helper in `app/services/document_service.py`:

```python
def can_access_document(db: Session, *, user: User, document: Document) -> bool:
    if document.user_id == user.id:
        return True
    if document.matter_id and db.scalar(
        select(MatterMember.id).where(
            MatterMember.matter_id == document.matter_id,
            MatterMember.user_id == user.id,
        )
    ):
        return True
    return False
```

### Service — `app/services/document_comment_service.py` (new)

```python
def list_comments(db, *, document_id, user) -> list[DocumentComment]
def create_comment(db, *, document_id, user, content) -> DocumentComment
def delete_comment(db, *, comment_id, user) -> bool
```

Each function calls `can_access_document` (or, for delete, checks author/partner-on-matter) before touching the DB. The delete-by-partner case re-uses `is_partner_or_admin` + matter membership.

### Routes — `app/routers/documents.py`

```python
@router.get("/documents/{document_id}/file")
def document_file(...) -> StreamingResponse:
    # 1. Look up doc; 403 if no access.
    # 2. storage_service.fetch_document_file(storage_key) returns bytes or
    #    streams from R2.
    # 3. Return as application/pdf with Content-Disposition: inline.

@router.get("/documents/{document_id}/comments", response_model=list[DocumentCommentResponse])
@router.post("/documents/{document_id}/comments", response_model=DocumentCommentResponse, status_code=201)
@router.delete("/documents/comments/{comment_id}")
```

### Storage service addition

```python
def fetch_document_file(storage_key: str) -> bytes:
    """Read a document file from R2 (or local disk fallback)."""
```

For R2: use boto3 `get_object` with the existing client setup; stream the body. For local fallback: read from disk.

Concern: streaming binary through FastAPI is straightforward but we should set sensible Cache-Control headers (private, no-cache) so a shared computer doesn't expose someone else's PDFs from browser cache.

## Frontend changes

### Files touched

- `frontend/src/lib/api.ts`:
  - `getDocumentFileUrl(documentId)` — builds the URL with the auth bearer. For an iframe we can't add headers, so the URL needs a short-lived signed token OR we proxy via the same-origin backend (preferred — the cookie/Authorization header carries through if same-origin).
  - `listDocumentComments(documentId)`, `createDocumentComment(documentId, content)`, `deleteDocumentComment(commentId)`.
- `frontend/src/types/workspace.ts` — `DocumentComment` type.
- `frontend/src/components/DocumentsPanel.tsx`:
  - Add `selectedDocumentId` state. Clicking a row sets it.
  - Render `<DocumentDrawer documentId={selectedDocumentId} onClose={...} />` when set.
- New `frontend/src/components/DocumentDrawer.tsx`:
  - Header: filename, status pill, close button.
  - Body: iframe `src="/documents/${id}/file"`. Height fills the drawer.
  - Footer: comments thread:
    - One `useQuery(['document-comments', id])`.
    - Each comment row: avatar + author name + relative timestamp + content (markdown). Author/partner sees a delete affordance on hover.
    - At the bottom: a textarea + post button. Optimistic insert on submit.

### Auth on the iframe

The simplest correct path: serve `/documents/{id}/file` from the same origin as the SPA, and have the route accept a `?token=...` query param as an alternative to the Authorization header. The frontend builds the iframe URL with `?token=${localStorage.getItem('token')}`. The token is the same JWT we already use — short-lived, scoped to the user. We accept it from the query only for this one route so we don't undermine the rest of the API.

Alternative if we want to be cleaner later: backend issues a one-shot signed URL per request.

### Comment UX

- Markdown rendering via the existing `MarkdownContent` component.
- Submit on Cmd/Ctrl+Enter; plain Enter inserts a newline.
- Show "Posting…" then optimistic replace.
- Empty state: a friendly "No comments yet — be the first" line in the empty thread.

## Verification

1. Upload a PDF, click it → drawer opens, PDF renders, no console errors.
2. Open the same PDF from another browser as a teammate on the same matter → same view.
3. Open as a user *not* on the matter → 403 on the `/file` and `/comments` endpoints. Drawer shows an "Access denied" message.
4. Post a comment, refresh → comment persists, shows author + timestamp.
5. Delete your own comment as the author → gone. Delete someone else's as a partner-on-matter → gone. As a non-partner non-author → 403.
6. DOCX upload → click → drawer shows "Preview not available" with a download CTA.

## Out of scope (later)

- Highlight-anchored comments ("comment on this clause"). Needs `react-pdf` and a coordinate model.
- @mentions and notifications.
- Edit a comment after posting.
- Threaded replies.
- Versioned PDFs (different drafts of the same document).
