import { infrai } from "./signed_download.js";

const bucket = process.env.INFRAI_EXPORT_BUCKET ?? "healthtech-appointment-exports";
await infrai.storage.bucket.create(bucket);
console.log(`Created export bucket: ${bucket}`);
