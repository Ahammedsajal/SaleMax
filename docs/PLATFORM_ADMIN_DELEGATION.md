# Delegated platform administration contract

The platform hierarchy extends the existing SaleMaX administrator routes and `/admin?page=manage-users`; it does not create a second customer application or customer login.

- `super_admin`: owner-only, MFA-verified platform identity. Can manage platform Admin/Staff invitations, see every user and aggregate, assign portfolios, change any customer account, and create an audited support session.
- `platform_admin`: sees/updates users assigned to its portfolio plus users it creates. May work with existing plans, categories and business contracts within that portfolio. Cannot manage platform access, see another Admin's account list/stats, reset customer passwords, or impersonate customers.
- `staff`: explicit delegated permissions. The portfolio is inherited from `reports_to_identity_id`; without a manager, the staff identity can only use accounts explicitly assigned to it. Staff cannot manage platform access or impersonate customers.

The migration does not claim legacy customers for any Admin. Missing and null portfolio owners are Super Admin-private. Reassignment is owner-only and audited. Customer listing, profile changes, plan reads/previews/assignment, dashboard joins, business-contract reads/previews/provisioning and legacy account operations enforce portfolio access server-side. Customer contact forms with no customer owner key are not visible to delegated roles. Password reset and support session creation are owner-only; support session creation is audited and bounded to a required reason.

Owner API additions use the existing platform access router:

- `GET /api/admin/platform-access/portfolios` returns active Admin identity IDs, labels, per-Admin customer counts and the private/unassigned count.
- `PUT /api/admin/platform-access/portfolios/{userId}` takes `{ "managedByIdentityId": "<identity-id>" }` or `null` to keep the user private. It responds with the user ID and effective owner identity ID.
- `GET /api/admin/get_dashboard_for_user` includes `portfolioStats` for Super Admin only. Admin receives scoped customer/order metrics and `portfolioStats: null`.

Every mutation requires the legacy bearer plus canonical platform session, same-origin request and CSRF token. Setup invites are copy-link only, expire in 72 hours, and retain token hashes. The Super Admin has sole authority to create Admin/Staff accounts. Existing account user credentials and the `/user/login` route remain separate.

## Rollout behavior

1. Back up the production database and record the current release/image.
2. Apply the additive migration and verify enum, indexes, foreign keys and owner identity links.
3. Deploy the existing application release with `SALEMAX_PLATFORM_ENABLED=true` only after confirming the owner link; MFA remains required by the current gate.
4. Verify Super Admin's user list includes all production accounts; verify an Admin's list and dashboard are empty until customers are assigned.
5. Assign only owner-approved accounts in Manage Users. Existing customers not assigned remain private to Super Admin.
6. Test cross-portfolio denial, Admin-created customer ownership, staff inheritance, customer password-reset denial, and Super Admin-only audited support access.
7. Roll back application code using the prior release if required. Do not reverse the migration or remove portfolio data during rollback.
