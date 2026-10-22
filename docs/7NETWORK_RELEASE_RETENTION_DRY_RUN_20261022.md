# Production release retention dry run — 22 October 2026

This is a review artifact only. It does not authorize deletion and no production artifact has been removed.

## Locked inventory

- Inventory time: 2026-10-22 10:37:37 UTC.
- Source baseline: operations branch 7network/operations-domain-scale-20261022, commit c075b5f340f12edb6bfcb8e51b052e8b0b53986d.
- Host: carsqatar-prod-01; active release: /opt/salemax/releases/follow-up-message-4f7ed6d-20261022.
- The full inventory, metadata scan, and inode-link analysis ran synchronously under /opt/salemax/shared/with-production-lock.sh; active release resolution happened after acquiring the lock.
- Root filesystem: 97% used, 1,953,760 KiB available. There are 579 release directories and 415 rollback snapshots. The scan read 1,500 small rollback metadata files and found zero scan errors.
- A release was protected if it was active, among the six newest verified paths (active plus five preceding), mentioned by any DEPLOYMENT.md rollback reference, mentioned by snapshot metadata, or mounted by a running container. The scan found 332 ledger release references, 385 snapshot release references, and zero mounts to a non-active release.
- The 112 distinct salemax-app image objects are all referenced by the tracked deployment ledger, rollback snapshots, or running containers. No image is proposed for removal.
- There were 131 initial unreferenced release directories. The audit excluded 11 containing a private runtime directory, 9 containing symlinks, and one additional symlink target (20 exclusions total; the target overlaps the symlink set). The nine symlinked legacy chatbot directories and their target remain protected.
- The remaining 111 candidates have no private/runtime directories or data-file types checked, no symlinks or special files, no files larger than 50 MiB, no Docker mounts, and no open process file descriptors. Their only file under client/public/media is salemax-logo.png: one identical platform-owned file per candidate (SHA-256 47b3bd11ddb8f20f302427e66414dd9a646a984beb84e296affc12fb75fa9ed6). The current release's logo and 7Network brand assets are outside this candidate set and remain untouched.
- Inode link counts show an estimated 2,781,704,192 bytes (2.59 GiB) would be released by removing the candidate directories. This is an estimate; filesystem state can change. At the observed free space, that would leave about 4.45 GiB free and around 91% used, still above the critical percentage and 5 GiB warning thresholds.
- Candidate allowlist SHA-256 (sorted basenames, one newline per name): 03fe31fb636c3fac33d73c690a4fb6837a356d62c19b6ae2987be07912083b67.

## Proposed release directories

- /opt/salemax/releases/all-updates-20261005-ce7461e
- /opt/salemax/releases/applications-mobile-cards-654cea5-20261008
- /opt/salemax/releases/applications-responsive-70ff03e-20261008
- /opt/salemax/releases/applications-sidebar-compact-eef36ca-20261008
- /opt/salemax/releases/applications-sidebar-desktop-fallback-f9a41ba-20261008
- /opt/salemax/releases/applications-sidebar-fallback-320f3db-20261008
- /opt/salemax/releases/applications-sidebar-responsive-e88eea7-20261008
- /opt/salemax/releases/asterisk-router-next-20261006-43ee69a
- /opt/salemax/releases/asterisk-telephony-20261005-7575152
- /opt/salemax/releases/bot-empty-test-list-c0c9b62-20261012
- /opt/salemax/releases/candidate-apps-responsive-1bf7e2a-20261008
- /opt/salemax/releases/candidate-apps-responsive-64384f8-20261008
- /opt/salemax/releases/candidate-layout-4045dc1-20261008
- /opt/salemax/releases/chatbot-chat-scope-fix-20261004
- /opt/salemax/releases/chatbot-faq-library-3ba9cc2-20261012
- /opt/salemax/releases/chatbot-guided-copy-editable-20261004
- /opt/salemax/releases/chatbot-guided-course-detail-20261004
- /opt/salemax/releases/chatbot-guided-domain-20261004
- /opt/salemax/releases/chatbot-guided-domain-ui-20261004
- /opt/salemax/releases/chatbot-inbox-controls-20261004
- /opt/salemax/releases/chatbot-model-picker-505130f
- /opt/salemax/releases/chatbot-number-assignment-40615a9
- /opt/salemax/releases/chatbot-number-assignment-nav-4495535
- /opt/salemax/releases/chatbot-rtl-overlay-20261005
- /opt/salemax/releases/chatbot-structured-faq-20261005
- /opt/salemax/releases/course-editor-scroll-20261004
- /opt/salemax/releases/course-editor-scroll-drafts-20261004
- /opt/salemax/releases/course-media-modal-20261004
- /opt/salemax/releases/course-media-modal-notices-20261004
- /opt/salemax/releases/course-media-modal-responsive-20261004
- /opt/salemax/releases/course-optional-publish-20261005
- /opt/salemax/releases/course-outline-fix-20261004
- /opt/salemax/releases/course-prereq-ltr-39e44fc-20261008
- /opt/salemax/releases/course-prerequisites-edit-2c7f44f-20261008
- /opt/salemax/releases/finance-policy-881f527-20261008
- /opt/salemax/releases/finance-policy-setup-46cec77-20261008
- /opt/salemax/releases/finance-queue-collation-e9d7ba5-20261008
- /opt/salemax/releases/finance-receipt-6ea45a0-20261008
- /opt/salemax/releases/form-concurrency-63db2a4-20261009
- /opt/salemax/releases/forms-consent-07931-20261008
- /opt/salemax/releases/forms-consent-3e05883-20261008
- /opt/salemax/releases/forms-sidebar-rtl-185563a-20261008
- /opt/salemax/releases/guided-bot-111a711-20261009
- /opt/salemax/releases/guided-bot-8460085-20261009
- /opt/salemax/releases/guided-bot-dd1d4e7-20261009
- /opt/salemax/releases/guided-wording-7db1cad-20261011
- /opt/salemax/releases/guided-wording-c706bf5-20261011
- /opt/salemax/releases/human-welcome-027f25a-20261011
- /opt/salemax/releases/hybrid-mobile-cards-3e33dd5-20261012
- /opt/salemax/releases/inbox-bot-header-af5aa2e
- /opt/salemax/releases/inbox-bot-header-e26a5f0
- /opt/salemax/releases/inbox-bot-header-flow-0e66fad
- /opt/salemax/releases/inbox-bot-picker-copy2-138769f-20261012
- /opt/salemax/releases/installment-reminders-8bef604-20261008
- /opt/salemax/releases/invoice-pdf-generator-8d92118
- /opt/salemax/releases/lead-attribution-history-5a2a27f-20261008
- /opt/salemax/releases/lead-chain-1a06888
- /opt/salemax/releases/lead-reports-label-20261004
- /opt/salemax/releases/manage-users-responsive-20261004
- /opt/salemax/releases/optional-features-layout-20261004
- /opt/salemax/releases/optional-integrations-df424af
- /opt/salemax/releases/pbx-sidebar-layout-2b71ee9-20261007
- /opt/salemax/releases/pbx-sidebar-row-0243cae-20261007
- /opt/salemax/releases/pipeline-contact-match-74d3e70-20261008
- /opt/salemax/releases/private-web-config-a351bdd-20261008
- /opt/salemax/releases/public-form-attribution-51d63a-20261008
- /opt/salemax/releases/public-form-retry-e8d78c5-20261008
- /opt/salemax/releases/report-delivery-ad436c0-20261008
- /opt/salemax/releases/report-worker-ef8b0f2-20261008
- /opt/salemax/releases/sale-policy-3a4d6b6-20261008
- /opt/salemax/releases/sale-readiness-816fac0-20261008
- /opt/salemax/releases/shared-inbox-354cda8-20261009
- /opt/salemax/releases/shared-queues-20261006-7ee4726
- /opt/salemax/releases/sidebar-f312b03
- /opt/salemax/releases/staff-app-lead-match-f1699e1
- /opt/salemax/releases/student-registration-bd2f5c9-20261009
- /opt/salemax/releases/students-20261004
- /opt/salemax/releases/task-chat-0feffe0
- /opt/salemax/releases/task-chat-form-reset-d0808f9-20261008
- /opt/salemax/releases/task-detail-mobile-871fd14-20261008
- /opt/salemax/releases/tasks-business-session-7be54a6
- /opt/salemax/releases/tasks-session-654ee36
- /opt/salemax/releases/tasks-session-race-730c1f7
- /opt/salemax/releases/tasks-stale-login-ba99886
- /opt/salemax/releases/tasks-workspace-5702c40
- /opt/salemax/releases/team-roles-e00a458
- /opt/salemax/releases/tenant-gateway-outbound-760687b-20261008
- /opt/salemax/releases/tenant-gateway-routing-de86100
- /opt/salemax/releases/tenant-gateway-routing-f59f75d
- /opt/salemax/releases/tenant-pbx-admin-20261006-97e1a47
- /opt/salemax/releases/tenant-pbx-layout-20261006-44defbb
- /opt/salemax/releases/tenant-pbx-nav-20261006-48ef522
- /opt/salemax/releases/tenant-pbx-nav-anchor-20261006-e3b18a4
- /opt/salemax/releases/training-center-profile-invoice-7f2ac77
- /opt/salemax/releases/training-document-branding-a6605b
- /opt/salemax/releases/training-document-branding-form-label-41fbd4a
- /opt/salemax/releases/training-document-branding-legacy-invoices-a392c47
- /opt/salemax/releases/training-document-form-header-c64d7c7
- /opt/salemax/releases/training-finance-1a5dcec
- /opt/salemax/releases/training-finance-d42d46f
- /opt/salemax/releases/training-finance-f27c652
- /opt/salemax/releases/training-lead-dc8b792
- /opt/salemax/releases/training-lead-report-replies-e6cb803
- /opt/salemax/releases/training-profile-procatalyst-20261004
- /opt/salemax/releases/training-profile-procatalyst-fix-import-20261004
- /opt/salemax/releases/training-qatar-date-eligibility-33f7c83-20261008
- /opt/salemax/releases/training-receivables-export-6fb97f2
- /opt/salemax/releases/training-registration-33524dc
- /opt/salemax/releases/training-registration-copy-126d67a
- /opt/salemax/releases/training-registration-meta-1f015cd
- /opt/salemax/releases/training-tasks-abf92937

## Excluded directories

The excluded releases remain on production. Private/runtime data or symlink references made them ineligible for this dry run:

- /opt/salemax/releases/bot-capture-forms-76e3c5b-20261020 — private-runtime
- /opt/salemax/releases/chatbot-active-edit-20261005 — symlink
- /opt/salemax/releases/chatbot-dark-theme-20261005 — symlink
- /opt/salemax/releases/chatbot-domain-pack-contract-20261005 — symlink
- /opt/salemax/releases/chatbot-evening-greeting-20261005 — symlink
- /opt/salemax/releases/chatbot-guided-details-20261005 — symlink
- /opt/salemax/releases/chatbot-guided-edit-24bf0a0 — symlink; symlink-target
- /opt/salemax/releases/chatbot-localized-course-facts-20261005 — symlink
- /opt/salemax/releases/chatbot-provider-handoff-20261005 — symlink
- /opt/salemax/releases/chatbot-theme-detection-20261005 — symlink
- /opt/salemax/releases/finance-direct-document-delivery-16dd5d9-20261013 — private-runtime
- /opt/salemax/releases/finance-invoice-workflow-5fe09ac-20261013 — private-runtime
- /opt/salemax/releases/keyword-routing-validation-20261016 — private-runtime
- /opt/salemax/releases/opening-keyword-routing-7f54772-20261016 — private-runtime
- /opt/salemax/releases/opening-keyword-routing-b19b295-20261016 — private-runtime
- /opt/salemax/releases/recruitment-founder-d782381-20261020 — private-runtime
- /opt/salemax/releases/team-access-layout-33ce802-20261016 — private-runtime
- /opt/salemax/releases/team-access-manager-05993d4-20261018 — private-runtime
- /opt/salemax/releases/team-access-manager-16216a5-20261018 — private-runtime
- /opt/salemax/releases/unified-module-access-1e5e281-20261016 — private-runtime

## Approval and execution conditions

Removing these release directories is irreversible and bypasses Trash. No deletion, image removal, cache prune, volume action, migration, or service change has occurred. If approved, the operator must rerun the entire reference and content scan inside one continuous shared-lock process immediately before deletion, confirm the allowlist hash is unchanged, confirm the active release and services are unchanged, and remove only these exact paths. Any changed reference, path, file type, mount, process handle, or hash cancels the cleanup. The protected exclusions, all images, all rollback snapshots, current release, volumes, logs, and customer data stay outside the allowlist.
