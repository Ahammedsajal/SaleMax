# SaleMaX existing application upgrade

Read docs/SALEMAX_TRAINING_CENTER_IMPLEMENTATION_PLAN.md and docs/IMPLEMENTATION_STATUS.md before continuing implementation. The full 42-ticket upgrade and production/Git deliverables remain the objective.

## Required integration scope

- Upgrade this existing project. Reuse its admin/user panels, backend and working features. Do not create a replacement project, recreate the shell, introduce another CRM/login, or build a duplicate plan catalogue.
- Start plan integration in the existing Manage Plans screen at /admin?page=manage-plans, including its current list/create/edit actions, commercial fields and IDs. Extend the existing plan APIs through compatible adapters to the tested versioned services.
- Upgrade Manage Users at /admin?page=manage-users and its existing plan-assignment flow for categories, ownership and assigned limits. Preserve historical assignments through reviewed mappings.
- Preserve /admin and /admin/login for platform administration, /user and /user/login for business users, and existing agent entry points. Business login must not show an administration switch. Owner/staff capabilities belong to the current admin panel.
- Extend existing inbox, QR/Meta, flows, chatbot, templates, campaigns, pipeline, phonebook and agent tasks. Add Courses, Finance, Reports and Forms screens only where functionality is missing, inside the existing business panel.
- Missing original frontend inputs do not authorize rebuilding the application. Recover relevant inputs where available; otherwise extend maintained existing modules/hooks and record the affected component limitation. Do not patch minified application logic manually.
- Standalone workspace/login/plan test pages are development artifacts, not the delivery destination. Reuse useful services and controls; do not continue developing another panel. Isolated tests do not prove existing-screen integration.

## Evidence and publication

- A module is complete only when its existing screen preserves old functionality and performs the added workflow through authenticated APIs, with permission/error-state and English/Arabic verification.
- Keep account/customer data, credentials, sessions, local runtime files, backups and test secrets outside Git. Commit intended files and push verified increments to the requested repository.
- Retain meaningful database/concurrency tests and use disposable synthetic data for verification. Record remaining legacy adoption, provider, finance, load/restore and release gates honestly; never redefine the full goal around a smaller passing increment.
