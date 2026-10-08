# Test walkthrough

A checklist for verifying Birdie lessons, the personal OpenRouter key and demo mode in the running
app. Each step says what to do and what you should see. For the stage run, use
[`demo-script.md`](demo-script.md) instead.

## 0. Setup

```sh
docker compose up -d
cd backend && source .venv/bin/activate && make migrate
DEMO_MODE=true make dev            # terminal 1
cd frontend && bun run dev         # terminal 2 → http://localhost:5173
```

- Sign in with Google as your admin account (it must be in `ADMIN_EMAILS`).
- Settings → Development & Testing → **Load demo data** → confirm. Wait about a minute, then check
  Documents shows three files as **ready** (switch to Jane first, see 1).

| Step | Expect |
|---|---|
| Load demo data | A message like "Demo data loaded: 3 documents, 5 KB entries, 5 tickets, 2 review rounds" |
| Message mentions failures | R2 or OpenAI isn't configured. Fix `.env` and reload the data |

---

## 1. Demo mode: switching users

| # | Do | Expect |
|---|---|---|
| 1.1 | Look at the sidebar footer | A **Demo · switch user** picker above your name |
| 1.2 | Pick **Jane Pereira (Associate)** | Lands on Home. A yellow bar reads "Demo · viewing as Jane Pereira (associate) · Switch back" |
| 1.3 | Open the picker again | Contains Marcus, Sarah and **Back to my account**, not Jane |
| 1.4 | Pick **Sarah Chen**, then **Back to my account** | Bar disappears; you're yourself again; nothing from Sarah's view lingers |
| 1.5 | Switch to Jane, click **Switch back** in the bar | Same as 1.4 |
| 1.6 | Switch to Jane, then reload the page | Still Jane, bar still shown |
| 1.7 | As Jane, open Settings | No "Development & Testing" section (Jane isn't an admin) |
| 1.8 | Log out while switched, then sign in again | You're your own account, with no bar |

---

## 2. Birdie lessons (as Jane)

Switch to **Jane Pereira**, then open **Birdie** from the sidebar.

| # | Do | Expect |
|---|---|---|
| 2.1 | Open Birdie right after loading demo data | Opens on **Review** (not Ask), with a green dot on the tab |
| 2.2 | Look at the Review tab | One group: **Meridian NDA.pdf**, "Reviewed by Sarah Chen · date" |
| 2.3 | Watch the **Lessons** section on first open | "Distilling lessons…" for a few seconds, then 3–4 blue lesson cards (indemnity cap, governing law, defined terms, plain English). Not shown if lessons were stored in an earlier run: reload the demo data to see it again |
| 2.4 | Look at **Comments** | 4 cards, each with the quoted text, "Suggested: …" where present, Sarah's note and "Page 1" |
| 2.5 | Click **Explain this** on the indemnity comment | Switches to **Ask** and sends a message starting "Explain this feedback from my reviewer on…". Birdie streams an explanation |
| 2.6 | Switch to Review and back to Ask | The conversation is still there |
| 2.7 | Ask: "Why did Sarah change the governing law?" | Answer cites the English-law position and the firm playbook |
| 2.8 | Close Birdie, open it again | Review tab shows lessons straight away; no green dot |
| 2.9 | Reload the page, open Birdie | Same lessons; they are not regenerated |

### Privacy checks

| # | Do | Expect |
|---|---|---|
| 2.10 | Switch to **Sarah Chen**, open Birdie → Review | Empty state: "Feedback from your reviewers will appear here after a review is returned." plus the starter cards. Sarah wrote the comments; they aren't *her* feedback |
| 2.11 | Switch to **Marcus Webb**, open Birdie → Review | Same empty state |

---

## 3. Review loop (Sarah redlines, Jane learns)

| # | Do | Expect |
|---|---|---|
| 3.1 | As **Sarah**: Workboard → ticket **SPA extract — indemnities** (in the Review column) → **Open review** | The SPA PDF opens with the annotation rail |
| 3.2 | Select the basket sentence ("…the Basket Amount shall be deducted from any claim"), click **Suggest…**, enter replacement wording and a reason, **Save** | A suggestion appears on the page and in the rail |
| 3.3 | Select the governing-law clause, **Suggest…** → "England and Wales" with a note, **Save** | Second annotation appears |
| 3.4 | Try **Return for rework** | Disabled, with a tooltip: mark at least one annotation as "Needs rework" |
| 3.5 | Mark one annotation **Needs rework**, then click **Return for rework** | Round returns; ticket moves out of Review |
| 3.6 | Switch to **Jane**, open Birdie | Review tab now has **two** groups, the SPA extract on top. Its lessons distil live |
| 3.7 | Ask Birdie: "Why did Sarah change the basket?" | Answer reflects Sarah's note |
| 3.8 | Open the NDA round as Sarah (Workboard → "Revise Meridian NDA…") | The four seeded highlights sit on the right text, not floating elsewhere |

---

## 4. OpenRouter key and tiers (Settings → Models)

Use any user; Jane is fine.

| # | Do | Expect |
|---|---|---|
| 4.1 | Open the section with no key | "Add your OpenRouter key" (or "Using demo key" in demo mode). Save is disabled |
| 4.2 | Type `abc` in the key field | "That key looks too short." Save stays disabled |
| 4.3 | Enter a fake key (`sk-or-test-key-1234`) and **Save** | "Birdie settings saved." Status line: "…using your OpenRouter key (…1234) with anthropic/claude-sonnet-5.5". The field clears |
| 4.4 | Ask Birdie anything | Error: "Your OpenRouter key was rejected or ran out of credit — check Settings." No silent fall back to another key |
| 4.5 | Set the model to `openai/gpt-4o-mini` and **Save** | Status line shows the new model |
| 4.6 | Reload Settings | Key never shown, only the last four characters |
| 4.7 | **Remove key** | Back to the firm default; Birdie answers again |
| 4.8 | With a real OpenRouter key, save it and ask Birdie | Streams an answer from your chosen model |

---

## 5. Everything else still works

Quick regression pass as Jane, with the Meridian matter selected:

| # | Do | Expect |
|---|---|---|
| 5.1 | Chat: "What are the key risks in the Meridian NDA?" | Streams an answer with citations to the NDA |
| 5.2 | Documents | NDA, SPA extract and Disclosure letter, all **ready** |
| 5.3 | Knowledge Bank | 5 entries (style guide, three playbooks, one Meridian note) |
| 5.4 | Workboard | 5 tickets across Pending, In progress, Review and Done |
| 5.6 | Home → Memory | Jane's four memories |
| 5.7 | Home → Lex-Wiki | Three linked pages and a graph |

---

## 6. Guardrails

| # | Do | Expect |
|---|---|---|
| 6.1 | Restart the backend **without** `DEMO_MODE` and reload | No switch-user picker; no "Load demo data" button |
| 6.2 | `curl -i -X POST http://127.0.0.1:8000/demo/seed` (no token) | 401 |
| 6.3 | Same call as a signed-in non-admin | 404 |
| 6.4 | Load demo data twice | Same counts both times; no duplicates (1 matter, 3 documents, 5 KB entries) |

---

## If something looks wrong

| Symptom | Likely cause |
|---|---|
| Switch-user picker missing | `DEMO_MODE` not set on the backend, or you aren't in `ADMIN_EMAILS` |
| Review tab empty for Jane | Demo data not loaded, or you're not actually switched into Jane |
| "Distilling lessons…" ends in an error | OpenRouter key missing or the call failed. **Retry** appears; raw comments still show |
| Documents stuck on **processing** | The backend isn't running (the worker is embedded in it), or OpenAI/R2 keys are missing |
| Chat has no citations | Documents not **ready** yet, or no matter selected |
