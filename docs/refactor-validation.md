# Refactor validation (2026-11-17)

Changes were implemented in an isolated worktree. `feature/production-refactor` captures the pre-existing production source workspace at c0c06ee; PR1–PR4 are separate stacked branches based on that snapshot, rather than mixing previously uncommitted features into each review. Production account JSON, service/timer enablement, nginx and the running Node process were not changed. The latest explicit request separately authorized removal of local OCR: only OCR-exclusive packages, the compatibility hook and the minimal requirements list were changed in the existing runtime.

| Stage | Validation |
| --- | --- |
| Baseline | 53 Node tests |
| PR1 | 59 Node tests; `npm run check`; isolated health/dashboard/login HTML and auth smoke |
| PR2 | 64 Node tests; `npm run check`; 20 independent transaction writers; offline dashboard p95 7.91 ms over 50 requests |
| PR3 | 69 Node + 49 Telegram Python tests; `npm run check`; HTTP/domain line coverage 94.77% |
| PR4 | 73 Node + 51 Telegram Python tests; `npm run check`; HTTP/domain line coverage 94.30% |

The coverage suite uses native `--experimental-test-coverage` across `domain/*.js` and `routes/*.js`. Its final branch coverage is 75.72%; the 80%+ target is met for lines, not branches. Provider protocol tests remain in the default suite. No tests send live Telegram messages or execute live check-ins.

Real `curl` comparisons ran baseline and refactor servers against equivalent synthetic fixtures. Dashboard `id`, `kind`, `title`, `status`, `accountCount` and nested account statuses were preserved. Expected summary changes: website and Telegram mixed success/skipped projects change from `success` to `partial`, agreeing with the existing dashboard. Dynamic timestamps/host URLs were excluded. Fresh isolated RSS was 53,056 KiB before / 53,064 KiB after; this small-fixture measurement is not the memory footprint of the live account set.

Both Docker targets built successfully. The worker image passed all 51 Telegram Python tests without network access. Node-only and Python-capable images passed healthz smoke checks; missing secrets refuse startup. nginx syntax, systemd unit/timer verification and Compose config validation passed. Backup fixture checks confirmed top-level JSON only, mode 600, excluding Telegram session/cache files. Runner `--dry-run` against the existing account directory only listed provider names and did not execute tasks.

The existing Python 3.11 venv dropped from approximately 717 MiB to 258 MiB after removing OCR-only packages; `pip check` and Telegram tests passed. A fresh minimal Telegram venv measured approximately 109 MiB. Removed packages: ddddocrfix 1.5.5, onnxruntime 1.24.4, opencv-python-headless 4.11.0.86, Pillow 12.2.0, numpy 1.26.4, flatbuffers 25.12.19, protobuf 7.34.1, sympy 1.14.0 and mpmath 1.3.0. Packaging remains because wheel requires it. Other legacy dependencies were retained.

Rollback each source PR with `git revert` in reverse dependency order. Stop workers before changing lock implementations; existing account JSON requires no downgrade. A Git revert does not restore uninstalled Python packages. If explicitly restoring the former Python 3.11 OCR stack, reinstall the pinned removed packages above and restore the pre-removal compatibility adapter. Do not reinstall OCR for the current deployment request.

Deployment remains pending: the live admin password is shorter than the new 16-character minimum and must be rotated before the refactored web server is installed. No credentials were generated, printed, committed or replaced by this work. Timer migration is opt-in; see `deploy/README.md`.
