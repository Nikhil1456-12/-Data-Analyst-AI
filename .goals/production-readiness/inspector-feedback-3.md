# Inspector verdict — iteration 3

## Verdict

**FAIL**

The Builder improved the stream cleaning call site and added several smoke tests, but the implementation is not yet production-ready. The required commands mostly pass, including a clean production audit, but the critical parser-boundary and upload-error requirements are still not met. The test additions also contain a misleading nested test structure and do not exercise the required real failure paths.

## Quality gates run

- `npm test`: **PASS** — 14 tests.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS** — Vite production build. The client install reports five dev/development audit vulnerabilities; this does not affect the root `npm audit --omit=dev` result.
- `npm audit --omit=dev`: **PASS** — 0 vulnerabilities.
- `git diff --check`: **PASS**.

## Acceptance-criteria review

1. **JWT route protection — PASS for the registered API inventory.** Protected route groups continue to use the mandatory behavior supplied by `optionalAuth`; health and authentication remain public.
2. **SQL validation — PASS for the inspected cleaning execution paths.** `validateQueryForMode()` now routes clean SSE requests through `validateCleaningSQL`, and the JSON cleaning route does the same. The exact-target checks reject the tested multi-table update, `DELETE ... USING`, and another-table mutation. This should remain covered by route-level tests.
3. **Uploads — FAIL.** CSV row/column limits are checked while streaming and JSON array rows are streamed, but Excel still calls `readXlsxFile(filePath)` and materializes the entire worksheet in `sheetData` before the row limit is enforced. PDF still reads the complete file and parses the complete LLM-produced array (`dataArr`) before checking its row limit. The byte pre-check is not a row/column parser boundary and cannot prevent a small, highly-row-dense workbook/PDF from creating an oversized structure. Multer cleanup also only removes `req.files`; when Multer fails after writing one or more files, the callback does not receive a reliable list of all disk-written files, so the new cleanup path is not proven to remove partial files. The test merely calls the cleanup helper directly rather than inducing a Multer parser/filter/limit error.
4. **Dependencies/audit — PASS for the root production dependency tree.** `xlsx` is absent and `npm audit --omit=dev` exits successfully with zero vulnerabilities. The build's client install still reports development vulnerabilities, but the requested production audit is clean.
5. **Automated tests — FAIL.** The replacement test is declared inside the `test('replacement is opt-in...')` callback, after asynchronous server setup, rather than as a normal top-level test. Node reports it as a nested subtest, but this structure is not a meaningful endpoint/import test arrangement and the HTTP upload assertion never exercises a successful multipart request. The cleanup test calls `cleanupUploadedFiles` directly and does not trigger a Multer error after a file has been written. The SSE test only exercises the early missing-table branch; it does not force a real post-header processing failure (for example, an LLM/database error) and does not verify the catch path. Parser tests only use an oversized byte fixture, so they do not demonstrate bounded Excel/PDF row materialization.
6. **Quality gates — PASS for the commands, but the test-quality requirement remains unmet.**
7. **Compatibility/scope — PASS with the blocking gaps above.** No whitespace errors or unrelated worktree changes were found.

## Blocking findings

### 1. Excel/PDF limits remain post-materialization — High

**File:** `services/fileUpload.js`

`parseExcel()` invokes `readXlsxFile()` before iterating rows and rejecting at `MAX_ROWS`. `parsePDF()` invokes `pdfParse`, then `parsePDFTableToJSON`, and only afterward checks `dataArr.length`. A file under `MAX_PARSER_BYTES` can still produce an oversized in-memory worksheet or LLM result. Implement parser-level bounded behavior (or a defensible pre-materialization bound that actually limits rows/columns), and add tests using oversized row/column content rather than only a byte-over-limit fixture.

### 2. Multer parser failures are not demonstrated to clean partial files — High

**File:** `routes/upload.js`

The `parseUploads` callback calls `cleanupUploadedFiles(req.files || [])`, but Multer errors happen before the route handler and can leave disk-storage files that are not exposed through `req.files`. A real `LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, or file-filter rejection after an accepted file must be induced in a test, and cleanup must track/remove every file written during that invocation. The error response should also be verified.

### 3. Replacement and SSE tests are not meaningful enough — Medium

**File:** `test/upload-and-sse.test.js`

The database replacement check is useful at a low level, but the endpoint-level conflict/explicit replacement behavior is not exercised. The “SSE error” request fails before authentication and only tests missing `activeTable`; it does not exercise an actual processing error after headers are sent. Move the tests to top-level test cases and stub the relevant dependencies so both the 409/replace HTTP behavior and SSE catch/error delivery are observed.

## Required iteration 4

- Bound Excel and PDF parsing before oversized row structures are materialized, with tests that prove row/column overflow is rejected.
- Track and remove all disk files created when Multer rejects a request, and test a genuine partial-upload parser/filter/limit failure.
- Add meaningful top-level integration tests for same-name conflict and explicit replacement, plus an authenticated SSE request that reaches and reports a real post-header error.
- Re-run all quality gates and preserve the clean production audit.

FAIL
