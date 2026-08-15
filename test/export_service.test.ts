import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
const { completedAppointmentsCsv, exportRequestSchema, operationalNotification } =
  await import("../src/export_service.js");

test("exports only completed appointments and keeps the notification patient-safe", () => {
  const input = exportRequestSchema.parse({
    exportId: "9b3c7f54-8afd-4f12-8f91-6e8377161e8b",
    requestedBy: "operations-team",
    appointments: [
      {
        appointmentId: "apt-100",
        patientReference: "patient-42",
        startsAt: "2026-08-15T09:00:00.000Z",
        status: "completed",
        clinicianDisplay: "Dr Rivera"
      },
      {
        appointmentId: "apt-101",
        patientReference: "patient-77",
        startsAt: "2026-08-15T10:00:00.000Z",
        status: "cancelled",
        clinicianDisplay: "Dr Chen"
      }
    ]
  });

  const csv = completedAppointmentsCsv(input);
  assert.match(csv, /apt-100/);
  assert.doesNotMatch(csv, /apt-101/);
  assert.deepEqual(operationalNotification(input.exportId, 1), {
    category: "report_ready",
    audience: "requesting_staff",
    message: `Appointment export ${input.exportId} is ready with 1 completed records.`
  });
});
