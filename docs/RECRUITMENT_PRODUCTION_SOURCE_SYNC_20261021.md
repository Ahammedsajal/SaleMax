# Recruitment application source sync — 21 October 2026

The production application at `crm.salemax.qa` already serves the improved recruitment submit guidance. A read-only check confirmed `/opt/salemax/current` resolves to `/opt/salemax/releases/recruitment-customer-guidance-5ab3315-20261022` on `carsqatar-prod-01`.

The clean source branch was behind the active release in two public source files. They were copied from the active release into this existing source tree and verified by SHA-256:

- `client/public/recruitment-application-errors.js`: `2cedfbb1fdd2b894542f1b08b331ad9f5ac48a38045494974edd7158936c3db0`
- `client/public/recruitment-application.html`: `3a00c3bc81c0c4aa6216011b212250f19211445db6460228b11623faf7549ff1`
- `client/public/recruitment-application.js` already matched production: `5d97540e46bed62c8e6d396e4d7983521f9a11a01ba88c293fcf30ae9995e78f`

The update keeps field-validation messages direct, gives CV size/type failures actionable guidance, and gives technical failures a general customer message with a bracketed, human-readable safe cause code in English and Arabic. It does not expose database messages, paths or applicant data. The form's script cache key now matches the live release.

The focused recruitment error and 7Network branding tests pass. This is a source catch-up only: production was not changed and no candidate, database, or provider state was touched. The root filesystem had 848 MB free (99% used), so no production deployment was attempted. This check covers the recruitment form paths only; it does not claim full parity between this branch and the entire production release or reconcile the dirty primary checkout.
