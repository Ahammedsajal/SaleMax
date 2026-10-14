# Candidate Applications UI — design QA

**Findings**

No actionable P0, P1, or P2 findings remain in the reviewed desktop state.

**Open Questions**

- Arabic/RTL layout was not reviewed in this pass.
- Create, edit, publish, public submission, and search/date-filter result flows were not submitted against production APIs. The empty-filter Clear control was clicked without changing records.
- Existing navigation shell remains visible around the feature screen as required by the existing SaleMaX workspace.

**Implementation Checklist**

- [x] Put the public form URL on its own row and align all five related actions in an even grid.
- [x] Keep the submitted-applications search, date range, clear/apply controls, table, and pagination compact and scannable.
- [x] Keep the published form title and Open form/Staff capture links opening in a new tab.
- [x] Preserve the existing workspace shell and existing forms/submission behavior.
- [ ] Review the page in Arabic/RTL and exercise create/edit/publish and non-empty search/date filtering with a safe synthetic record.

**Follow-up Polish**

- [P3] Confirm text wrapping and grid balance at narrow mobile widths after the next authenticated mobile review.

## Comparison evidence

- Source visual truth: `/var/folders/95/1rb5xbsn2pv6r74r3y2421j40000gn/T/codex-clipboard-990ed289-2432-43f4-abaf-9d93ae1f123f.png` (1530 × 903 px).
- Implementation screenshot: `/tmp/salemax-candidate-applications-implementation.png` (1920 × 1080 screen capture; browser CSS viewport 1912 × 885 px; device pixel ratio 1; no density normalization). The capture includes browser chrome and the existing SaleMaX navigation shell; the full page content and submitted-applications area remain visible in the same full-view comparison input as the source.
- State: authenticated English Candidate Applications screen, published student registration form, no applicant dialog open, empty name/mobile/email and date filters, existing submissions visible. The screenshot is kept outside Git because the production table contains customer information.
- Focused comparison: not needed; the form action row and filter/table sections are legible in the full-view comparison. Final screenshot shows the URL above five evenly aligned actions, replacing the earlier 4+1 wrapping seen in the first live review.
- Primary checks: browser loaded `/user?page=forms`; the published title target is `_blank`; all five action labels are present; the empty-filter Clear button was clicked; `/healthz` returned HTTP 200; served CSS SHA-256 matched the staged release. No record was submitted or edited.

## Comparison history

- First live visual review showed the public URL and actions competing for one row, with one action wrapping alone. This was a P2 spacing/alignment issue. The action group was separated into a URL row plus an even five-column desktop grid and a two-column small-screen grid. The final browser capture confirms the full action row is aligned with no isolated wrap.
- A later packaging mismatch was caught because the served CSS hash did not match the merged source. The active static image was rebuilt from the reviewed clean clone; the final browser’s computed grid is five columns and its CSS URL uses the layout3 cache key. The final served hash now matches the release.

**Final result:** passed
