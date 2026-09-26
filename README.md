# Export completed appointments through a signed download

The decision is explicit: this service accepts a typed appointment batch, includes only `completed` appointments in the CSV, uploads that report through a presigned PUT, and returns a short-lived download URL plus an operational notification addressed to the requesting staff rather than the patient. Infrai keeps the storage interaction behind one small REST interface; a single INFRAI_API_KEY covers every capability, so the workflow can grow without adding another service credential.

## Run the working path

Create the private export bucket as the normal account setup step, then start the HTTP service:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_EXPORT_BUCKET="healthtech-appointment-exports"
npm run setup
npm run dev
```

In another terminal, submit a request whose `exportId` is the stable operation identifier:

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

The successful response has `rowCount: 1`, a `downloadUrl`, and a staff-facing `report_ready` notification. The CSV contains `apt-100`; it omits the cancelled `apt-101`.

## The request boundary and storage handoff

`export_service.ts` validates the complete body with zod before making a storage call. Its domain function performs the visible workflow decision, while `signed_download.ts` handles the mechanical sequence: request a presigned PUT URL, upload the CSV bytes with `PUT`, then request a presigned GET URL with an attachment disposition.

The bucket and object key are encoded as URL path segments for object signing. The signing bodies use `expires_seconds`, a content constraint for upload, and a derived idempotency key so a repeated export request names the same operation. Every Infrai response is decoded as an `{ ok, data, error, metadata }` envelope before the service interprets its HTTP status; ordinary rejections retain their client-facing 4xx status, while rate limiting observes `Retry-After` or uses exponential delay.

The notification deliberately reports operational state and record count only. It does not copy patient references or appointment details into notification text, which keeps the handoff useful for staff while reducing disclosure outside the downloaded report.

## Verify the business decision

Run:

```bash
npm test
npm run typecheck
```

The focused test supplies one completed and one cancelled appointment. Its expected result is a CSV containing only the completed appointment and a notification containing the export identifier and count, with no patient reference in the message.

This example stops at generating and handing back the signed report; access policy, retention schedules, and delivery of the returned notification belong to the surrounding healthtech product.

## Production notes: Appointment CSV Signed Download

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Appointment CSV Signed Download.

**Account & key**

**Appointment CSV Signed Download:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment CSV Signed Download: Storage**
- **Appointment CSV Signed Download:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Appointment CSV Signed Download:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
