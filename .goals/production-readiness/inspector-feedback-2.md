# Inspector verdict — iteration 2

## Verdict

**FAIL**

The builder fixed the vulnerable production dependency and improved CSV/JSON limit handling, and all requested commands were run. The goal is not yet production-ready: the streaming cleaning endpoint still uses the permissive validator instead of the exact-table cleaning validator, Excel/PDF parsing still materializes unbounded structures before row limits are applied, Multer failures can leave temporary files behind, and the new tests do not exercise the critical replacement/cleanup/SSE paths.

## Quality gates run

- `npm test`: **PASS** — 9 tests.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS** — Vite production build. The client install emitted its own 5-vulnerability dev audit notice, but the build completed.
- `npm audit --omit=dev`: **PASS** — 0 production vulnerabilities.

## Acceptance-criteria review

1. **JWT route protection — PASS for the registered API inventory.** The data, database, query, upload, profile, statistics, forecast, report, and history route handlers use `optionalAuth`, which delegates to mandatory bearer-token verification. Authentication and health remain public. The current tests verify middleware and the upload route's unauthenticated response, though route-wide regression coverage would still be useful.
2. **SQL validation — FAIL.** `validateCleaningSQL` is restrictive for `POST /api/query/clean`, but `GET /api/query/stream?mode=clean` calls `validateGeneratedSQL(..., { allowMutation: true, tableName })` directly. That validator only checks that the requested table name appears somewhere; it does not enforce one exact mutation target. A multi-table mutation or a mutation of another table containing the active table name can therefore pass the streaming cleaning path. This violates the cleaning arbitrary-SQL prohibition.
3. **Uploads — FAIL.** Replacement is opt-in in the normal import path (`replace=true` is required to drop an existing table), but the endpoint-level and database replacement behavior are not meaningfully tested. CSV and JSON now reject while streaming, but `readXlsxFile` first loads the complete workbook into `sheetData` and `parsePDF` first reads the complete file and sends the complete LLM-produced row array through key collection before limits are checked. A file below the byte cap can still create an oversized row structure before rejection. Multer's parser/filter errors occur before the route handler, so its `finally` block never runs; files already written by disk storage can remain when a later file violates limits or has an unsupported extension.
4. **Dependencies/audit — PASS.** The vulnerable `xlsx` package is removed/replaced by `read-excel-file`, and the required production audit exits successfully with zero vulnerabilities.
5. **Automated tests — FAIL.** The nine tests cover auth helpers, SQL smoke cases, CSV/JSON row limits, SSE formatting, and an unauthenticated upload request. They do not test the stream cleaning route, exact replacement conflict/explicit replacement against the import layer, Multer failure cleanup, Excel/PDF bounded parsing, or an actual SSE error response after headers are sent. The existing SQL tests exercise `validateCleaningSQL`, but not the validator actually used by stream cleaning.
6. **Quality gates — PASS.** Test, lint, frontend build, and production audit all completed successfully.
7. **Compatibility/scope — PASS with the above security gaps.** No unrelated worktree changes were present, and no secrets were introduced.

## Blocking findings

### 1. Streaming cleaning bypasses exact-target validation — High

**File:** `routes/query.js`, stream validation branch; `services/sqlSecurity.js`

The stream route allows mutation mode and invokes `validateGeneratedSQL` rather than `validateCleaningSQL`. `validateGeneratedSQL` accepts `UPDATE`/`DELETE` whenever the requested table name occurs anywhere in the statement. Consequently, the SSE cleaning route has a different and weaker security policy than the JSON cleaning route. Route both cleaning paths through the exact-target validator and add regression tests for multi-table `UPDATE`, `DELETE ... USING`, aliases/joins, and another-table mutations.

### 2. Excel and PDF parser limits are post-materialization — High

**File:** `services/fileUpload.js`

`parseExcel` calls `readXlsxFile(filePath)` before iterating and checking `MAX_ROWS`; `parsePDF` reads the entire file and obtains the complete parsed row array before checking column/row limits. The stated resource controls therefore do not bound transient parser memory. Add parser-level bounded behavior (or reject/limit before materialization using supported streaming/row options) and tests that demonstrate early rejection.

### 3. Multer failure cleanup is incomplete — High

**File:** `routes/upload.js`

The cleanup `finally` is inside the handler after `upload.array(...)`. Multer errors (file-size limit, file-count limit, file-filter rejection) prevent that handler from running, while disk storage may already have created files. Add an upload middleware/error path that tracks and removes files on parser failure, and test a failure after at least one file has been written.

### 4. Critical behavior lacks meaningful integration tests — Medium

The replacement test only checks `isReplacementRequested`; it does not prove a same-named table returns 409 without replacement or succeeds when replacement is explicitly requested. The SSE test only checks string formatting, not an authenticated request that reaches an error after SSE headers are emitted. These gaps allowed the stream validator mismatch and cleanup issue to remain undetected.

## Required next iteration

- Use the exact cleaning validator for every cleaning execution path, including SSE.
- Make Excel/PDF parsing bounded at the parser boundary, not only after rows exist.
- Clean temporary files when Multer itself fails.
- Add focused route/import/cleanup/SSE regression tests, then rerun all four quality gates.

FAIL
