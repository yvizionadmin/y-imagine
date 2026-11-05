import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Where asset bytes live. With S3_BUCKET set (Railway Bucket, R2 or S3) objects go to that private
// bucket; otherwise to .data/assets on local disk for development. Keys look like `<orgId>/<id>.<ext>`
// and are built by src/lib/storage/assets.ts only.

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** ASSET_DIR moves local storage (tests use their own folder). */
const ROOT = process.env.ASSET_DIR ? path.resolve(process.env.ASSET_DIR) : path.join(process.cwd(), ".data", "assets");

const fileStore: BlobStore = {
  async put(key, bytes) {
    const target = path.join(ROOT, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  },
  get: (key) => readFile(path.join(ROOT, key)),
  delete: (key) => rm(path.join(ROOT, key), { force: true }),
};

function s3Store(bucket: string): BlobStore {
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    // MinIO and some S3-compatible services need path-style URLs.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  return {
    async put(key, bytes, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async get(key) {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await object.Body!.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

let store: BlobStore | null = null;

export function blobStore(): BlobStore {
  store ??= process.env.S3_BUCKET ? s3Store(process.env.S3_BUCKET) : fileStore;
  return store;
}
