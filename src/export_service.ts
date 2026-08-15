import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiError, publishCsv } from "./signed_download.js";

const appointmentSchema = z.object({
  appointmentId: z.string().min(1),
  patientReference: z.string().min(1),
  startsAt: z.string().datetime(),
  status: z.enum(["scheduled", "completed", "cancelled"]),
  clinicianDisplay: z.string().min(1)
});

export const exportRequestSchema = z.object({
  exportId: z.string().uuid(),
  requestedBy: z.string().min(1),
  appointments: z.array(appointmentSchema).min(1)
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function completedAppointmentsCsv(input: ExportRequest): string {
  const header = ["appointment_id", "patient_reference", "starts_at", "clinician"];
  const rows = input.appointments
    .filter((appointment) => appointment.status === "completed")
    .map((appointment) => [
      appointment.appointmentId,
      appointment.patientReference,
      appointment.startsAt,
      appointment.clinicianDisplay
    ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function operationalNotification(exportId: string, rowCount: number) {
  return {
    category: "report_ready" as const,
    audience: "requesting_staff" as const,
    message: `Appointment export ${exportId} is ready with ${rowCount} completed records.`
  };
}

export async function runExport(input: ExportRequest) {
  const csv = completedAppointmentsCsv(input);
  const rowCount = input.appointments.filter((item) => item.status === "completed").length;
  const bucket = process.env.INFRAI_EXPORT_BUCKET ?? "healthtech-appointment-exports";
  const key = `appointment-exports/${input.exportId}.csv`;
  const idempotencyKey = createHash("sha256")
    .update(`${input.exportId}:${input.requestedBy}`)
    .digest("hex");
  const downloadUrl = await publishCsv(bucket, key, csv, idempotencyKey);
  return {
    exportId: input.exportId,
    rowCount,
    downloadUrl,
    notification: operationalNotification(input.exportId, rowCount)
  };
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

if (process.env.NODE_ENV !== "test") {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/exports") {
      send(response, 404, { error: "Route not found" });
      return;
    }
    try {
      const input = exportRequestSchema.parse(await readJson(request));
      send(response, 201, await runExport(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        send(response, 400, { error: "Invalid export request", issues: error.issues });
      } else if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        send(response, status, { error: error.message, code: error.code });
      } else {
        send(response, 500, { error: "Export could not be created", requestId: randomUUID() });
      }
    }
  });
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Export service listening on http://localhost:${port}`));
}
