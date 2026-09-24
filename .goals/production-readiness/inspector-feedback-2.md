# Inspector verdict — iteration 2

## Verdict

**FAIL**

Commit `adcd2bb` fixes the cleaning-SQL scope bypass, replaces the vulnerable direct `xlsx` dependency, and leaves the requested lint, test, build, and production audit commands green. The implementation still does not satisfy the upload resource-control and test-coverage acceptance criteria.

## Quality gates run

- `npm test`: **PASS** (9 tests)
- `npm run lint`: **PASS**
- `npm run build`: **PASS** (Vite production build)
- `npm audit --omit=dev`: **PASS** (`found 0 vulnerabilities`)

## Acceptance-criteria review

1. **JWT route protection — satisfied for the current route inventory.** Registered data routes use `optionalAuth`, whose implementation rejects missing or invalid bearer tokens. Health and authentication endpoints remain public. The upload test now verifies a missing token receives `401`.
2. **SQL validation — substantially fixed and satisfied for the reviewed bypasses.** `validateCleaningSQL` requires an exact leading `UPDATE <requested table> SET` or `DELETE FROM <requested table>` form and rejects joins, `USING`, subqueries, `SELECT`, and `UNION`. The added regression tests cover multi-table targets and the principal scope-bypass forms.
3. **Uploads — fail.** CSV and JSON now stop streaming at the row limit, and parser byte/column checks exist. However, `parseExcel` calls `readXlsxFile(filePath)` before checking `MAX_ROWS`; the complete workbook is materialized in `sheetData`, so a workbook over the row limit can consume memory before rejection. PDF parsing similarly obtains the complete model-produced row array before applying the row limit. In addition, cleanup is only in the route handler's `finally`: Multer errors such as `LIMIT_FILE_SIZE`, too many files, or a rejected file type occur before the handler runs, so any files already written by Multer are not covered by that cleanup path.
4. **Dependencies/audit — satisfied for the executed production audit.** The direct `xlsx` dependency is removed and `npm audit --omit=dev` exits successfully with zero vulnerabilities. The README still describes the old unavoidable `xlsx` residual and should be corrected in the implementation iteration because it now contradicts the dependency state.
5. **Tests — fail/incomplete.** The new tests provide useful parser-limit and helper smoke coverage, but they do not exercise bounded Excel materialization, PDF row bounds, temporary-file deletion on processing or Multer failure, same-name replacement conflict versus explicit replacement against the database, or the actual SSE route's failing-query path. `formatSSE` serialization alone does not prove end-to-end SSE error delivery.
6. **Quality gates — satisfied.** All four required commands passed.
7. **Compatibility/scope — no unrelated regression observed in the reviewed diff.**

## Blocking findings

### 1. Excel row limits are enforced after full workbook materialization

**File:** `E:\Projects\-Data-Analyst-AI\services\fileUpload.js:91`

**Severity:** High

`readXlsxFile(filePath)` returns the entire worksheet before the loop checks `MAX_ROWS`. The later `rows.length >= MAX_ROWS` guard therefore limits database/import work but does not bound parser memory. A valid workbook within the byte limit but containing more than 100,000 rows can be fully allocated before the request is rejected, violating the requirement that upload limits be enforced before dangerous materialization.

**Suggested fix:** Use a workbook reader that supports bounded/streaming row iteration, or reject/limit rows during workbook parsing before retaining the full sheet. Add a test that demonstrates an oversized workbook is rejected at the parser boundary without retaining all rows.

### 2. Upload cleanup does not cover Multer failures

**File:** `E:\Projects\-Data-Analyst-AI\routes\upload.js:31-59`

**Severity:** High

The `try/finally` begins only after `upload.array('files', 20)` succeeds. Multer can create temporary files and then call `next(err)` for a file-size, file-count, or file-filter error; in those cases the async handler and its `finally` block are skipped. The global error handler only sends a response and does not remove `req.files` or otherwise clean the upload directory. Thus the claimed reliable cleanup is limited to handler-level success/failure, not all upload failures.

**Suggested fix:** Add an upload-specific error middleware that cleans files recorded by Multer before returning the error, or move cleanup into a wrapper that covers both Multer and processing errors. Test at least one Multer failure after a prior file has been written.

## Test-quality gap

The route/upload/SSE additions still do not verify the critical behavior requested by the goal. In particular, the tests are not end-to-end for replacement conflict, cleanup, or SSE failure delivery, and there is no Excel/PDF bounded-materialization test. These gaps mean the two blocking behaviors above can remain undetected while the suite is green.

