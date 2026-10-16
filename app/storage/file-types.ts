// Accepted media types and server-side signature (magic byte) detection. Pure and dependency-free; the client may
// import it for the file picker's accept list, but the server NEVER trusts the browser's filename, extension or
// declared MIME type: the signature of the stored bytes decides.

export interface MediaType {
  mime: string;
  ext: string;
}

export const MEDIA_TYPES: readonly MediaType[] = [
  { mime: "image/jpeg", ext: "jpg" },
  { mime: "image/png", ext: "png" },
  { mime: "image/webp", ext: "webp" },
  { mime: "video/mp4", ext: "mp4" },
];

/** How many leading bytes are needed to recognise every accepted signature. */
export const SIGNATURE_BYTES = 32;

export const isAllowedMime = (mime: string) => MEDIA_TYPES.some((t) => t.mime === mime);
export const extensionFor = (mime: string) => MEDIA_TYPES.find((t) => t.mime === mime)?.ext ?? null;

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
// ISO base media "ftyp" major brands that are MP4 video. QuickTime ("qt  ") and others are deliberately not accepted.
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V "]);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The media type the bytes actually are, or null when they match no accepted signature. */
export function detectMime(head: Uint8Array): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && PNG.every((v, i) => head[i] === v)) return "image/png";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp" && MP4_BRANDS.has(ascii(head, 8, 12))) return "video/mp4";
  return null;
}

/** A name that is safe to show and to put in a Content-Disposition header. Never used for storage keys. */
export function sanitizeFilename(name: string, fallback = "media"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const unsafe = /[\u0000-\u001f\u007f"<>:|?*]/g;
  const cleaned = base.replace(unsafe, "").replace(/\s+/g, " ").trim();
  const bounded = cleaned.replace(/^\.+/, "").slice(0, 200).trim();
  return bounded || fallback;
}
