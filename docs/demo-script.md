# LexCatalyst — Demo Script

Story: **seniors teach without extra work, and juniors learn without fear.** A senior redlines a
junior's draft, and the junior's private mentor, Birdie, turns those comments into lessons.

Runtime: about 8 minutes. Everything runs from **one browser window** using demo user switching.

> Steps marked 🆕 depend on the Birdie lessons / OpenRouter / demo-mode work in
> `docs/superpowers/specs/2026-10-01-birdie-mentor-lessons-design.md`. Every other step uses UI
> that exists today.

---

## Cast

| who | account | role |
|---|---|---|
| **You** | your Google login (must be in `ADMIN_EMAILS`) | Partner, presenter |
| **Sarah Chen** | seeded demo user | Senior associate, the reviewer |
| **Jane Pereira** | seeded demo user | Year-1 associate, the junior |
| **Marcus Webb** | seeded demo user | Background colleague (makes wellbeing trends visible) |

Matter: **Meridian Capital — Share Purchase** (`DEMO-MERIDIAN-001`).

---

## Preflight (T-30 min)

Run once on the machine or environment you'll present from.

1. **Environment** (`backend/.env`, or the Railway variables):
   - `DEMO_MODE=true` 🆕
   - `ADMIN_EMAILS` includes your Google email
   - `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` (embeddings), and the R2 credentials are set
   - `FIELD_ENCRYPTION_KEY` is set (it encrypts client names and OpenRouter keys)
2. **Start**:
   ```sh
   docker compose up -d
   cd backend && source .venv/bin/activate && make migrate && make dev
   cd frontend && bun run dev
   ```
3. **Sign in once** with Google, so your user row exists.
4. **Seed** 🆕: run `make seed-demo PRESENTER=you@example.com` from `backend/`, or use
   Settings → Development & Testing → **Load demo data**.
   The summary should show 3 documents, 5 KB entries, 5 tickets, 2 review rounds (4 annotations),
   288 survey responses (3 people × 6 weeks × 16 questions), 4 memories and 3 wiki pages. Any
   `documents_failed` or `kb_failed` above 0 means R2 or OpenAI isn't configured.
5. **Wait about a minute for document processing.** Switch to Jane → Documents, and check all
   three show **ready**. If one shows **failed**, rerun the seed.
6. **Dry run of the risky calls**:
   - As Jane, ask Chat one question and confirm a citation appears.
   - Optionally, save an OpenRouter key in Settings → Birdie model 🆕 and ask Birdie "hi".
7. **Reset**: run the seed again, so Birdie's round-1 lessons distil live on stage instead of
   already being stored.
8. Browser: zoom 110–125%, close other tabs, collapse the dev tools, and turn notifications off.

---

## The run

### 1. The problem (you, Partner, ~1 min)

- Land on **Home**. Say: *"Juniors are scared to ask 'stupid' questions. Seniors have no time to
  mentor, and every review is extra work. LexCatalyst makes the review itself the mentoring."*
- Open **Workboard** in the sidebar. Show Sarah→Jane tickets across columns, including one in
  **Review**.
- Open **Wellbeing**, then **Question trends**. Point out Jane's dip and recovery. Say:
  *"Anonymised team wellbeing, so partners can triage workload before burnout."*

### 2. The junior's day (switch to Jane, ~2 min)

- Sidebar footer → **Switch user** → **Jane Pereira** 🆕. The top bar reads
  *"Demo · viewing as Jane Pereira"*.
- Open **Chat** and pick the matter **Meridian Capital** in the matter selector. Ask:
  > What does the indemnity clause in the Meridian NDA cap liability at?
  - Point at the **citation** to the NDA. Say: *"Grounded in her own matter documents, and it can't
    see other matters."*
- Open **Knowledge Bank**. Show the firm playbook entry *Indemnity caps*. Say: *"Firm knowledge,
  scoped and PII-checked."*

### 3. Learning from the senior's review (Jane + Birdie, ~2 min) — the core moment

- Click **Birdie** in the sidebar to open the floating mentor.
- It opens on **Review** 🆕, because Jane has new feedback. A round group shows
  *Meridian NDA · Sarah Chen · Returned*.
  - Under **Lessons**, *"Distilling lessons…"* turns into 2–4 lesson cards. Say: *"Sarah didn't
    write these lessons. She just reviewed the draft, the way she always does."*
  - Under **Comments**, show the uncapped-indemnity comment: quote, suggested wording, Sarah's note.
- Click **Explain this** on that comment 🆕. Birdie switches to **Ask** and explains why it matters
  and what to do next time.
- Type a follow-up a junior would never ask a partner:
  > Is it normal that I missed this? I don't want Sarah to think I'm careless.
  - Say: *"Birdie is private to Jane. Nothing she asks here is shown to her supervisors."*

### 4. The senior's side: no extra work (switch to Sarah, ~2 min)

- **Switch user** → **Sarah Chen**.
- **Workboard** → open the **Review** ticket *SPA extract — indemnities* → **Open review**.
- Redline live:
  1. Select the sentence about the indemnity basket. In the toolbar click **Suggest…**, enter the
     replacement wording, and in *"Why this change?"* type:
     > Baskets should be tipping, not deductible — firm playbook position.

     Save it.
  2. Select the governing-law clause, then **Suggest…** → replacement *"English law"* → note
     *"Client is UK-incorporated; we never accept NY law on a UK target."* Save it.
  3. In the annotation rail, mark one of them **Needs rework**. *(Return for rework stays
     disabled until at least one annotation is marked Needs rework.)*
- Click **Return for rework**. Say: *"That's all Sarah did: a normal review."*

### 5. The loop closes (switch to Jane, ~1 min)

- **Switch user** → **Jane Pereira** → open **Birdie**.
- **Review** now shows the new *SPA extract* round on top, and its lessons distil live 🆕.
- Ask Birdie:
  > Why did Sarah change the governing law?
  - Birdie answers from Sarah's note, because recent reviewer feedback is in its context.

### 6. Close (you, ~30 s)

- **Switch back** in the top bar to return to your account.
- **Settings → Birdie model** 🆕: *"Each lawyer can bring their own OpenRouter key and model for
  Birdie. Without one, it falls back to the firm default."*
- Closing line: *"Every review a senior already does becomes mentoring, and juniors get a mentor
  they're not afraid to ask."*

---

## If something breaks

| symptom | recovery |
|---|---|
| Chat has no citations | Documents may still be processing. Check Documents shows **ready**, or use the NDA question again in 30 s |
| "Distilling lessons…" errors | Click **Retry**. The raw **Comments** still tell the story, so carry on with **Explain this** |
| Birdie says the OpenRouter key was rejected | Settings → Birdie model → **Remove key** (falls back to DeepSeek) |
| **Return for rework** is disabled | Mark an annotation **Needs rework** in the rail first |
| Switch user missing | `DEMO_MODE` is off, or you're not in `ADMIN_EMAILS`. Fix the env and restart the backend |
| Anything else mid-demo | **Switch back**, rerun the seed (Settings → **Load demo data**), and restart from step 2 |
