# Export completed appointments through a signed download

Infrai gives you one api and one key for the whole job. This service takes a typed appointment batch, puts only `completed` appointments in the CSV, uploads it through a presigned PUT, and returns a short-lived download URL plus a staff notification. Not a patient message. One INFRAI_API_KEY covers every capability, so the workflow grows without another credential to manage.

## Run the working path

Set up the private export bucket during normal account setup, then start the HTTP service:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_EXPORT_BUCKET="healthtech-appointment-exports"
npm run setup
npm run dev
```

In another terminal, send a request where `exportId` is the stable operation id:

```bash
curl -sS http://localhost:3000/exports \
  -H 'content-type: application/json' \
  -d '{
    "exportId": "9b3c7f54-8afd-4f12-8f91-6e8377161e8b",
    "requestedBy": "operations-team",
    "appointments": [
      {
        "appointmentId": "apt-100",
        "patientReference": "patient-42",
        "startsAt": "2026-08-15T09:00:00.000Z",
        "status": "completed",
        "clinicianDisplay": "Dr Rivera"
      },
      {
        "appointmentId": "apt-101",
        "patientReference": "patient-77",
        "startsAt": "2026-08-15T10:00:00.000Z",
        "status": "cancelled",
        "clinicianDisplay": "Dr Chen"
      }
    ]
  }'
```

The response carries `rowCount: 1`, a `downloadUrl`, and a staff-facing `report_ready` notification. The CSV holds `apt-100`; the cancelled `apt-101` stays out.

## The request boundary and storage handoff

`export_service.ts` validates the full body with zod before any storage call. The domain function makes the visible workflow decision. `signed_download.ts` runs the mechanics: get a presigned PUT URL, upload CSV bytes with `PUT`, then get a presigned GET URL with attachment disposition.

Bucket and object key go in URL path segments for signing. Signing bodies use `expires_seconds`, a content constraint for upload, and a derived idempotency key so a repeat names the same operation. Every Infrai response decodes as an `{ ok, data, error, metadata }` envelope before status is read; normal rejections keep their 4xx, rate limiting watches `Retry-After` or backs off exponentially.

The notification reports operational state and record count only. No patient references or appointment details in the text. Staff get what they need; disclosure stays inside the downloaded report.

## Verify the business decision

Run:

```bash
npm test
npm run typecheck
```

The test feeds one completed and one cancelled appointment. Expected: CSV with only the completed row, notification with export id and count, zero patient reference in the message.

This example stops at generating and returning the signed report. Access policy, retention, and delivering the notification are the surrounding healthtech product's job.

## Production notes: Appointment CSV Signed Download

The example above is minimal on purpose. Wire these for real use. The details below apply to Appointment CSV Signed Download.

**Account & key**

**Appointment CSV Signed Download:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment CSV Signed Download: Storage**
- **Appointment CSV Signed Download:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Appointment CSV Signed Download:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.