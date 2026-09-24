# Goal: Production-readiness roadmap

## User Request

Analyse the project, rate it, and do the recommended roadmap.

## Refined Goal

Implement the full production-readiness roadmap for the Data Analyst AI application. Harden authentication, authorization, SQL execution, uploads, dependency safety, and runtime resource controls; add maintainable tests and working quality gates; and improve reliability where practical without changing the product's core user experience. Production data and database routes must require JWT authentication, same-named uploads must be rejected unless replacement is explicit, and the completed work must be validated by tests, lint, frontend build, and dependency audit.

## Acceptance Criteria

- [ ] Protected data-access, mutation, upload, history, database, and administration routes require valid JWT authentication; only health and authentication endpoints remain public.
- [ ] LLM-generated SQL is validated server-side for single-statement execution, read-only versus mutation intent, system-table protection, and safe identifier/table usage; cleaning operations cannot execute arbitrary SQL.
- [ ] Uploads enforce resource and file validation limits, reliably clean temporary files on success and failure, and reject same-named table replacement unless an explicit replace option is supplied.
- [ ] Vulnerable dependencies are upgraded or replaced where feasible, and any unavoidable audit residual is documented with rationale and mitigation.
- [ ] Automated tests cover authentication, SQL validation, upload cleanup/replacement, and critical API behavior, including SSE error behavior where applicable.
- [ ] Root linting works, targeted tests pass, the frontend production build passes, and the production dependency audit is run successfully.
- [ ] Changes preserve existing supported product behavior, use repository conventions, and do not introduce secrets or unrelated modifications.

## Scope Boundaries

**In scope:**
- Backend security and correctness hardening.
- Dependency updates or safe replacements.
- Upload and generated-code resource controls.
- Test infrastructure and targeted unit/integration coverage.
- Lint/build/audit quality gates and directly related documentation.
- Practical reliability improvements that fit the existing architecture.

**Out of scope:**
- Replacing the application's database, LLM provider, or frontend framework.
- Full multi-tenant redesign, distributed job infrastructure, or a complete production observability platform.
- New product features unrelated to security, correctness, testing, or reliability.
- Destructive changes to existing user data.

## Applicable Project Conventions

**Quality gate command:**
- `npm run lint`
- `npm run build`
- targeted test command added by the implementation
- `npm audit --omit=dev`

**Commit convention:**
- No repository convention was found; use conventional commits with the goal-skill `[B]`/`[I]` role markers.
- Assisted-by trailer required: `Assisted-by: OpenAI:GPT-5.6 Luna` for Builder and `Assisted-by: OpenAI:GPT-5.6 Sol` for Inspector.

**Guidelines:**
- No AGENTS.md, CONSTITUTION.md, `.agents/guidelines`, or `.github/guidelines` files found.

**Rules:**
- Preserve unrelated worktree changes.
- Prefer precise, tested changes and explicit error handling.
