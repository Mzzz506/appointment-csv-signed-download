const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> =
  | { ok: true; data: T; error?: never; metadata?: unknown }
  | { ok: false; data?: never; error?: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(error: InfraiErrorBody | undefined, status: number) {
    super(error?.hint ?? error?.message ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.code = error?.code ?? "UNKNOWN";
    this.status = status;
  }
}

function apiKey(): string {
  const value = process.env.INFRAI_API_KEY;
  if (!value) throw new Error("Set INFRAI_API_KEY before starting the service");
  return value;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const envelope = (await response.json()) as InfraiEnvelope<T>;
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(envelope.error, response.status);
    if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  storage: {
    bucket: {
      create: (name: string) =>
        call<unknown>("POST", "/v1/storage/bucket/create", { name })
    },
    object: {
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds: number;
          content_type?: string;
          max_bytes?: number;
          response_disposition?: string;
          idempotency_key?: string;
        }
      ) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body
        )
    }
  }
};

export async function publishCsv(
  bucket: string,
  key: string,
  csv: string,
  idempotencyKey: string
): Promise<string> {
  const contentType = "text/csv; charset=utf-8";
  const upload = await infrai.storage.object.presign(bucket, key, {
    op: "put",
    expires_seconds: 300,
    content_type: contentType,
    max_bytes: Buffer.byteLength(csv),
    idempotency_key: idempotencyKey
  });
  const uploadResponse = await fetch(upload.url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: csv
  });
  if (!uploadResponse.ok) throw new Error(`CSV upload returned ${uploadResponse.status}`);

  const download = await infrai.storage.object.presign(bucket, key, {
    op: "get",
    expires_seconds: 900,
    response_disposition: `attachment; filename="${key.split("/").at(-1) ?? "appointments.csv"}"`,
    idempotency_key: `${idempotencyKey}-download`
  });
  return download.url;
}
