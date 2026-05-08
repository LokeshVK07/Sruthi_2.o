# `.release/` — release-state metadata

This folder is committed and tracks **which Cloudflare D1 slot is currently
serving production traffic**. The CI workflow at
`.github/workflows/background-refresh.yml` reads `active-slot.json` to decide
which slot to refresh into next, and updates it after a successful deploy.

## active-slot.json

```json
{
  "active": "primary",
  "inactive": "secondary",
  "updated_at": "<iso8601 timestamp of last successful promote>",
  "deployment_id": "<github actions run id of the last deploy>"
}
```

- `active` — slot label whose D1 database the live Worker is currently bound
  to. Maps to the env var `CLOUDFLARE_D1_<UPPER>_DATABASE_ID`.
- `inactive` — the opposite slot label; the next refresh writes here first.

The labels (`primary` / `secondary`) are arbitrary — they're just keys into
the secret/var map. Two D1 databases is all that's needed; the workflow
swaps which one is "live" by deploying the Worker with the matching D1
binding.

## How a refresh promotes

1. Workflow reads this file → `active=primary, inactive=secondary`.
2. Refresh and import land in `secondary` (the inactive D1).
3. Validation gates pass.
4. Worker deploys with binding → secondary's database id.
5. Workflow runs `prepare_release.py --promote`, which writes:
   `active=secondary, inactive=primary, updated_at=now`.
6. The updated file is committed back to `main` by the workflow itself.

If any step before #5 fails, the file is left untouched and the live Worker
keeps serving from the old slot. The "broken" inactive slot just gets
overwritten on the next refresh.
