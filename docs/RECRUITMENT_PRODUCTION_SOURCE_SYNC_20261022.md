# Recruitment application source sync — 22 October 2026

The active SaleMaX production release was inspected before changing the
applicant error copy. `/opt/salemax/current` resolved to
`/opt/salemax/releases/recruitment-customer-guidance-5ab3315-20261022` on
`carsqatar-prod-01`. The application page, submission script, error helper,
and public error handler in this branch were checked against production. The
page, helper, and error handler differed from remote `main` and were synced
from production; the submission script already matched. The synced pre-change
hashes were:

| File | Production SHA-256 before this source change |
| --- | --- |
| `client/public/recruitment-application.html` | `3a00c3bc81c0c4aa6216011b212250f19211445db6460228b11623faf7549ff1` |
| `client/public/recruitment-application.js` | `5d97540e46bed62c8e6d396e4d7983521f9a11a01ba88c293fcf30ae9995e78f` |
| `client/public/recruitment-application-errors.js` | `2cedfbb1fdd2b894542f1b08b331ad9f5ac48a38045494974edd7158936c3db0` |
| `modules/platform/recruitment-public-errors.js` | `52f8698655a2e8275eff6e2c828675955abaeb1b956b8669ae047f083c5ef373` |

The source change keeps these live validation and upload behaviors. Routine
validation errors give direct instructions; technical failures use calm,
customer-friendly guidance followed by a short bilingual cause explanation and
the exact safe cause code in brackets. Untrusted server messages and applicant
details remain hidden. The error helper's cache key is advanced independently;
the unchanged form script keeps its existing key. This is a source
synchronization and wording change only. No production files, application
records, CVs, database schema, or services were changed. At inspection, the
production filesystem had 848 MB free (99% used), so a runtime release was
deferred pending safe capacity.
