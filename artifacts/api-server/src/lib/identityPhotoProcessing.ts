import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";

const runtimeRequire = createRequire(typeof __filename === "string" ? __filename : import.meta.url);

export const MAX_IDENTITY_BYTES = 8 * 1024 * 1024;
export const IDENTITY_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_PIXELS = 20_000_000;
export class IdentityDocumentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validateIdentityBytes(bytes: Buffer, declaredType: string) {
  if (!bytes.length || bytes.length > MAX_IDENTITY_BYTES) throw new IdentityDocumentError(400, "Choose a photograph no larger than 8 MB.");
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const heif = bytes.toString("ascii", 4, 8) === "ftyp" &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(bytes.toString("ascii", 8, Math.min(64, bytes.length)));
  const matches = (declaredType === "image/jpeg" && jpeg) || (declaredType === "image/png" && png) ||
    (declaredType === "image/webp" && webp) || (["image/heic", "image/heif"].includes(declaredType) && heif);
  if (!matches) throw new IdentityDocumentError(400, "The file is not a supported photograph or does not match its type. Choose a JPEG, PNG, WebP, HEIC or HEIF image.");
  if (heif) {
    // Reject excessive HEIF image extents BEFORE the WASM decoder allocates
    // pixels. A bounded worker/timeout is a second layer, not the size check.
    let at = 0, found = 0, totalPixels = 0;
    while ((at = bytes.indexOf("ispe", at)) !== -1) {
      if (at >= 4 && at + 16 <= bytes.length && bytes.readUInt32BE(at - 4) >= 20) {
        const width = bytes.readUInt32BE(at + 8), height = bytes.readUInt32BE(at + 12);
        const pixels = width * height;
        if (!width || !height || pixels > MAX_PIXELS) throw new IdentityDocumentError(400, "This photo is too large to process safely. Retake at a lower resolution or choose a smaller JPEG.");
        totalPixels += pixels;
        if (totalPixels > MAX_PIXELS * 4) throw new IdentityDocumentError(400, "Choose a single smaller photograph.");
        found++;
      }
      at += 4;
    }
    if (!found) throw new IdentityDocumentError(400, "This HEIC/HEIF format could not be validated. Export it as JPEG and try again.");
  }
}

const workerSource = `
const {parentPort,workerData}=require('node:worker_threads');
const sharp=require(workerData.sharpPath);
(async()=>{
  let bytes=Buffer.from(workerData.bytes);
  if (workerData.heif) bytes=await require(workerData.heicPath)({buffer:bytes,format:'JPEG',quality:0.95});
  const image=sharp(bytes,{limitInputPixels:20000000,failOn:'warning',animated:false});
  const info=await image.metadata();
  if(!info.width||!info.height||(info.pages||1)>1||info.width*info.height>20000000) throw Error('Unsupported image');
  return image.rotate().resize(2400,2400,{fit:'inside',withoutEnlargement:true}).toColorspace('srgb').jpeg({quality:92}).toBuffer();
})().then(bytes=>parentPort.postMessage({ok:true,bytes}),()=>parentPort.postMessage({ok:false}));
`;

export async function normalizeIdentityPhoto(bytes: Buffer, contentType: string): Promise<Buffer> {
  validateIdentityBytes(bytes, contentType);
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true, workerData: {
        bytes, heif: ["image/heic", "image/heif"].includes(contentType),
        sharpPath: runtimeRequire.resolve("sharp"), heicPath: runtimeRequire.resolve("heic-convert"),
      },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const finish = (result?: Uint8Array) => {
      if (settled) return;
      settled = true; clearTimeout(timer); void worker.terminate();
      result ? resolve(Buffer.from(result)) :
        reject(new IdentityDocumentError(400, "This photograph could not be processed safely. Retake it or choose a smaller JPEG/PNG image and retry."));
    };
    const timer = setTimeout(() => finish(), 25_000);
    worker.once("message", result => finish(result.ok ? result.bytes : undefined));
    worker.once("error", () => finish());
    worker.once("exit", () => finish());
  });
}
