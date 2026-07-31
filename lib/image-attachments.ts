export const MAX_ATTACHED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHED_IMAGES = 10;

export interface Base64ImageAttachment {
  type: "image";
  data: string;
  mimeType: string;
}

function base64Value(code: number): number | null {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return null;
}

function isImageMimeType(value: string): boolean {
  return /^image\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(value);
}

/** Returns the decoded size only for canonical, padded base64 without whitespace. */
export function getBase64DecodedByteLength(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const dataEnd = data.length - padding;
  let lastValue: number | null = null;
  for (let index = 0; index < dataEnd; index += 1) {
    const value = base64Value(data.charCodeAt(index));
    if (value === null) return null;
    lastValue = value;
  }
  for (let index = dataEnd; index < data.length; index += 1) {
    if (data[index] !== "=") return null;
  }
  // Padding consumes low-order bits that must be zero in canonical base64.
  if ((padding === 2 && (lastValue as number) % 16 !== 0) || (padding === 1 && (lastValue as number) % 4 !== 0)) {
    return null;
  }
  return (data.length / 4) * 3 - padding;
}

export function isBase64ImageWithinLimits(value: unknown): value is Base64ImageAttachment {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<Base64ImageAttachment>;
  if (
    image.type !== "image"
    || typeof image.data !== "string"
    || typeof image.mimeType !== "string"
    || !isImageMimeType(image.mimeType)
  ) {
    return false;
  }
  const bytes = getBase64DecodedByteLength(image.data);
  return bytes !== null && bytes <= MAX_ATTACHED_IMAGE_BYTES;
}

/** Return an API-safe error for prompt, steering, and follow-up image arrays. */
export function validateAgentImages(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "images must be an array";
  if (value.length > MAX_ATTACHED_IMAGES) {
    return `A message can include at most ${MAX_ATTACHED_IMAGES} images`;
  }
  for (const image of value) {
    if (!isBase64ImageWithinLimits(image)) {
      return `Each image must be valid base64 image data with an image MIME type and be ${MAX_ATTACHED_IMAGE_BYTES / (1024 * 1024)}MB or smaller`;
    }
  }
  return null;
}
