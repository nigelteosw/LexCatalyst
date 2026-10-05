# LexCatalyst — Developer Brief

Oct 5, 2026 · @lauren

## What we are building

LexCatalyst is a writing assistant that works wherever lawyers draft, in the way Grammarly does, and surfaces a law firm's own past work to junior lawyers while they draft. It answers "what has our team done before?" at the moment the question arises, and checks the draft against the supervising partner's style guide.

The users are trainees and junior associates (roughly 0–4 years' call). The buyers are law firms, so security and confidentiality decide whether we get in the door.

Three features, in build priority:

1. **Precedent** — while editing a clause, show how the firm has drafted the same clause before. Example: an option period in an option contract; show the number of days used in past deals, with the source deal for each.
2. **Research** — while writing a memo, surface relevant cases and the applicable legal tests from the firm's past memos and research notes, plus sample work to model from.
3. **Review** — check the document against the partner's style guide; auto-fix mechanical issues and suggest everything else.

The product's edge is grounding in the firm's own documents, not general legal AI. Every design decision should protect that: accurate retrieval, visible sources, and strict access control.

## Non-negotiables

These rules apply to every feature. A build that breaks one of them is not shippable, however good the suggestions are.

1. **Permission-aware retrieval.** A user only ever sees content from documents they are already allowed to open in the firm's document management system (DMS). Permissions are checked at query time, not only at ingestion.
2. **Ethical walls.** Matters behind an information barrier never appear in suggestions for users on the wrong side of it, not even as a snippet, a count or a "similar matter exists" hint.
3. **Redact confidential client data.** Client and counterparty names, individuals' personal data, addresses, ID and account numbers, deal values, project code names and other identifying details are replaced with placeholders (e.g. \[CLIENT\], \[COUNTERPARTY\], \[AMOUNT\]) at two points: before any text leaves our system for the LLM provider, and before a precedent from another matter is shown to a user. Users see the clause's wording and terms, not whose deal it was, unless they are on that matter. Redaction is tested against a labelled test set, and a missed identifier is a release blocker.
4. **Provenance on every suggestion.** Each suggestion shows its source: document title, matter (or anonymised matter reference), date and author, with a click-through to the original for users allowed to open it. No source, no suggestion.
5. **Suggest, don't overwrite.** Nothing changes in the user's document without an explicit accept. Substantive text is only ever suggested; mechanical style fixes may be applied in one click but must stay reversible (as a tracked change or suggestion where the editor supports it, otherwise a single undo step).
6. **No training on client data.** Firm documents are used for retrieval only. They must not be used to train or fine-tune any shared model, and the LLM provider must contractually guarantee zero data retention.
7. **Full audit log.** Log who queried what, which documents were returned and what was accepted. Firms will ask for this.

## Architecture

One backend serves thin clients in every editor, as Grammarly does. The clients only capture text and show suggestions; all retrieval, permission checks and model calls happen server-side.

&#91;embedded content: LexCatalyst architecture · editors, API, three services, data layer\]

- **Clients.** A browser extension covers web editors (Google Docs, Outlook web, Gmail). Word desktop needs an Office add-in, because an extension cannot reach a desktop app. A web app handles search, style profiles and admin.
- **API.** Every request is authenticated through the firm's SSO and passes the permission and ethical-wall check before any retrieval.
- **Services.** Precedent and Research are retrieval-first: search the index, then use the LLM only to rank, summarise and extract. Review runs mechanical rules as code and uses the LLM for judgement rules.
- **Suggested stack** (developer's call): TypeScript for the clients; Python or Node for the API; Postgres with pgvector, or a managed vector store, for the index.

## Feature 1: Precedent

When the user places the cursor in a clause (or selects text), the sidebar shows how the firm has drafted that clause before.

**User story.** A junior is fixing the option period in an option contract and doesn't know what is usual. The sidebar shows past option periods from the firm's deals (e.g. 14, 21 and 30 days), how often each was used, and the deal each came from.

**How it should work**

1. Detect the clause: take the paragraph or selection, classify its clause type (option period, governing law, limitation of liability, termination, etc.).
2. Retrieve: search the clause library for the same clause type, using hybrid search (keyword + vector) and filtered by the user's permissions.
3. Extract key terms: where the clause has a variable (days, amounts, percentages, jurisdictions), extract it into a structured field so values can be compared.
4. Show context, not just the latest value: deal type, governing law, which side the firm acted for, and whether the text is a first draft or the final signed version.
5. Let the user insert a past clause or a value in one click, as a tracked change or suggestion where the editor supports it.

**Acceptance criteria**

- [ ] Results appear in under 3 seconds for a single clause.
- [ ] Each result shows source document, date, matter reference and a link to open it.
- [ ] Where the clause has a numeric term, a range and frequency are shown (not only the most recent value).
- [ ] Signed/executed versions are labelled and ranked above drafts.
- [ ] Inserting a result is reversible: a tracked change or suggestion where supported, otherwise one undo step.
- [ ] No result is ever returned from a document the user cannot open in the DMS.
- [ ] Results from other matters show placeholders, never client or party names; inserting one inserts the placeholders for the user to fill.

## Feature 2: Research

While the user writes a memo, the sidebar surfaces relevant authorities, the legal tests they establish, and past memos on the same issue.

**User story.** A junior is drafting a memo on whether a contract term is a penalty. The sidebar shows past firm memos on penalty clauses, the cases they relied on, the test as the firm has previously stated it, and one or two memos to model the structure on.

**How it should work**

1. Read the memo's heading, question presented and current paragraph to work out the legal issue.
2. Search past memos, research notes and opinions (permission-filtered) for the same issue.
3. Extract from those memos: case names and citations, the test or elements stated, and the jurisdiction.
4. Present three groups: **Tests** (the elements, quoted from the source memo with a link), **Cases** (citation + one-line proposition + which memo cited it) and **Sample work** (the closest past memos).
5. Show the date of each source memo prominently, and flag that authorities must be checked for currency.

**Acceptance criteria**

- [ ] Every case and test shown is traceable to a specific passage in a firm document; the model never adds a case that is not in the source.
- [ ] Citations are extracted verbatim, not regenerated by the model.
- [ ] Source memo date and jurisdiction appear on every result.
- [ ] A visible "check currency before relying" notice appears on authorities older than a set threshold (configurable, default 2 years).
- [ ] Results respect the same permissions and ethical walls as Feature 1.

**Do not build in v1:** live case law lookup from external databases. That needs licensed APIs (e.g. LawNet, Westlaw, Lexis) and is a later integration.

## Feature 3: Review

The assistant checks the draft against the supervising partner's style guide and underlines issues inline, Grammarly-style, with a fix on hover.

**User story.** A partner wants "shall" not "will" for obligations, Oxford commas, defined terms in bold on first use, and citations in a set format. The junior selects that partner's profile, and LexCatalyst flags every deviation before the draft goes up.

**How it should work**

1. **Style profiles.** Each partner (or team, or client) has a profile. A profile is built by uploading the partner's style guide and, optionally, a few documents they consider good examples. The admin can edit the extracted rules.
2. **Rule types.** Split rules into two classes and treat them differently:
   - *Mechanical* (deterministic, auto-fixable): spelling variant (British/US), defined-term capitalisation and consistency, numbering, date and currency format, citation format, banned words.
   - *Judgement* (suggest only, with a reason): tone, sentence length, plain-English rewrites, structure of a memo.
3. **Checks.** Run mechanical rules as code (regex and parsers) wherever possible; use the LLM only for judgement rules. This keeps results fast, consistent and cheap.
4. **Defined terms.** Track every defined term in the document; flag terms used before definition, defined but never used, or used inconsistently.
5. **Output.** Inline underline + sidebar list, grouped by severity, with "fix all mechanical issues" as one reversible action.

**Acceptance criteria**

- [ ] A profile can be created from an uploaded style guide in under 5 minutes, and its rules are editable.
- [ ] Mechanical issues are flagged with zero false positives on a test set of 20 sample documents.
- [ ] Judgement suggestions always state which rule they come from.
- [ ] The user can switch profiles per document.
- [ ] Nothing is applied without an explicit accept.

## Data model and ingestion

Retrieval quality decides whether lawyers trust the product, so ingestion is where most of the engineering effort should go.

**Pipeline**

1. **Connect** to the firm's document sources (DMS such as iManage or NetDocuments, SharePoint, Google Drive). For the MVP, a manual upload of a curated folder is fine.
2. **Parse** .docx and PDF, keeping structure: headings, clause numbers, defined terms, tables.
3. **Chunk by legal unit**, not by fixed token count: one chunk per clause in contracts, one per section in memos.
4. **Enrich** each chunk with metadata: clause type, extracted variables (days, amounts, jurisdictions), document type, draft vs executed, matter reference, date, author, cited cases.
5. **Redact.** Detect confidential entities with named-entity recognition plus firm-specific lists (client and party names from the firm's matter or conflicts system). Store a redacted copy of each chunk alongside the original. Keep the placeholder-to-original mapping in a separate, encrypted store, scoped to the matter. Keep legally meaningful terms (e.g. number of days, governing law) unredacted, since they are the point of a precedent; make amounts configurable per firm.
6. **Embed and index** the redacted text for hybrid search (vector + keyword/BM25), so the index itself holds no client identifiers.
7. **Sync permissions** from the source system (who can open each document, which matters are walled) and re-sync on a schedule.

**Core entities**

| Entity | Key fields |
| --- | --- |
| Document | id, source, title, doc type, matter ref, date, author, status (draft / executed), ACL |
| Chunk | id, document id, clause type or section, original text (encrypted), redacted text, embedding, extracted variables |
| Redaction map | matter ref, placeholder, original value (encrypted), entity type |
| Authority | citation (verbatim), jurisdiction, proposition, source chunk id |
| Style profile | owner (partner / team / client), rules list, example documents |
| Style rule | id, class (mechanical / judgement), description, check (code or prompt) |
| Audit event | user, timestamp, query, documents returned, suggestion accepted (y/n) |

Every suggestion the UI shows must resolve back to a Chunk and its Document. That link is what makes provenance possible.

## Security and compliance

Firms will run a security review before any pilot. Build these in from the start; retrofitting them is far harder.

- **Data residency.** Host in the firm's region (Singapore for local firms). Offer single-tenant or private-cloud deployment for larger firms.
- **Encryption** in transit (TLS 1.2+) and at rest; per-firm encryption keys if possible.
- **Tenant isolation.** One firm's data can never be retrieved for another firm. Separate indexes per tenant, not just a filter.
- **Authentication** via the firm's SSO (Microsoft Entra ID / Google Workspace), with SCIM for user provisioning.
- **LLM provider terms.** Zero data retention and no training on inputs, confirmed in writing.
- **The extension itself.** A browser extension that reads page content is a sensitive permission. Limit it to the editor domains the firm approves, and never send text off-device unless the user has LexCatalyst switched on for that document.
- **Data protection law.** Design for Singapore's PDPA as a baseline; expect firms to ask about GDPR where they have EU clients.
- **Certifications (later).** SOC 2 Type II and ISO 27001 are what firm IT teams typically ask for; plan the controls now even if certification comes after the MVP.

## Build order

Build one surface and one feature end to end before widening. Each phase ends with a gate that must pass before the next starts.

1. **Foundation** — ingestion of a curated document set, hybrid search, permission filtering, audit log, a plain web app to test queries.
   - *Gate:* searching the test set returns correct clauses with sources, and a restricted user cannot see restricted documents.
2. **Precedent in one editor** — the Precedent feature in the browser extension on Google Docs (or a Word add-in, if the pilot firm drafts in Word; see open questions).
   - *Gate:* 3–5 junior lawyers use it on real-style drafting tasks and rate suggestions useful more often than not.
3. **Review** — style profiles and mechanical checks first, judgement suggestions second.
   - *Gate:* mechanical checks pass the 20-document test set.
4. **Research** — memo issue detection, authority extraction, sample-work suggestions.
   - *Gate:* every case shown traces to a source passage; no invented citations in testing.
5. **More surfaces** — add the remaining editors (Word add-in, Outlook, the other browser editors) on the same backend.
6. **Firm readiness** — SSO, DMS connectors, tenant isolation hardening, admin console, security documentation for pilots.

## Open questions

- [ ] Which editor do target users draft in most? Most firms draft in Word desktop, which a browser extension cannot reach; that decides whether the first surface is the extension or a Word add-in.
- [ ] Do we have a pilot firm, and which DMS does it use?
- [ ] Where does the MVP's test data come from? We need realistic but non-confidential contracts and memos (public precedents, anonymised samples, or synthetic documents).
- [ ] Redaction: which entity types must every firm redact, which are configurable, and does the pilot firm want a human to spot-check redactions before documents go live?
- [ ] Which LLM provider, and can we get zero-retention terms in writing?
- [ ] Hosting: our cloud (multi-tenant) for the MVP, with single-tenant later — agreed?
- [ ] What is already built at lexcatalyst.pages.dev, and what can be reused?
- [ ] Pricing model (per seat vs per firm) — affects how usage and tenants are tracked.
