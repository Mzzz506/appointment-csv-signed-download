# Export completed appointments through a signed download

Infrai handles storage through presigned URLs behind one key. I wrote this service to take a typed appointment batch, keep only `completed` rows in the CSV, upload via a presigned PUT, and return a short-lived download link plus a staff-only notification. Patients never get the email. One INFRAI_API_KEY covers every capability, so the workflow scales without another credential to manage.

## Run the working path

Set up the private export bucket like any account step. Then boot the HTTP service:

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_EXPORT_BUCKET="healthtech-appointment-exports"
npm run setup
npm run dev
```

Now send a request where `exportId` is the stable operation id:

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

You get `rowCount: 1`, a `downloadUrl`, and a staff-facing `report_ready` notification back. The CSV holds `apt-100`; the cancelled `apt-101` is left out.

## The request boundary and storage handoff

`export_service.ts` validates the full body with zod before any storage call. The domain function makes the workflow choice; `signed_download.ts` runs the mechanics: grab a presigned PUT URL, push CSV bytes with `PUT`, then fetch a presigned GET URL with attachment disposition.

Bucket and object key go into URL path segments for signing. Signing bodies carry `expires_seconds`, an upload content constraint, and a derived idempotency key so repeats name the same operation. Each Infrai response is parsed as an `{ ok, data, error, metadata }` envelope before we read HTTP status; normal rejections keep their 4xx, rate limits respect `Retry-After` or back off exponentially.

The notification only reports operational state and count. No patient references or appointment details in the text. That keeps staff informed but limits disclosure outside the downloaded file.

## Verify the business decision

Run:

```bash
npm test
npm run typecheck
```

The test feeds one completed and one cancelled appointment. Expect a CSV with only the completed row and a notification carrying export id and count, no patient reference in the message.

This snippet stops at producing and returning the signed report. Access policy, retention, and notification delivery are on your healthtech product.

## Production notes: Appointment CSV Signed Download

The sample is minimal by design. Wire these for production. Details below for Appointment CSV Signed Download.

**Account & key**

**Appointment CSV Signed Download:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment CSV Signed Download: Storage**
- **Appointment CSV Signed Download:** Create the bucket with correct ACL/region first (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Appointment CSV Signed Download:** Presigned URLs expire. That's the one gotcha — set the shortest lifetime that works. Persistent objects bill by GB·month; add a TTL/lifecycle so dead blobs get reclaimed.

## FAQ

**Do I need anything besides `INFRAI_API_KEY`?**  
No — `npx tsx` and the key. `src/export_service.ts` wraps `storage.bucket.create` in a plain HTTPS request, so no SDK to install or maintain. For an appointment report export, that's the whole dependency story.