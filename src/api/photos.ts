/**
 * Profile photos.
 *
 * Photos are resized in the browser and stored as a data URI on the document
 * itself, not in Firebase Storage. Storage requires the Blaze billing plan,
 * and a 256px avatar is around 20 KB — small enough to sit in a Firestore
 * document without strain, while removing an entire service from the security
 * surface.
 *
 * If this ever needs to move to Storage or elsewhere, `processProfilePhoto` is
 * the only function that has to change.
 */

/** Longest edge of the stored image, in pixels. */
const TARGET_SIZE = 256

/** Firestore documents cap at 1 MB; stay far below it. */
export const MAX_STORED_BYTES = 90_000

/** Reject absurd uploads before decoding them. */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export class PhotoError extends Error {
  constructor(readonly reason: 'type' | 'size' | 'decode') {
    super(reason)
    this.name = 'PhotoError'
  }
}

/**
 * Read a file the user picked, square-crop it around the centre, scale it to
 * TARGET_SIZE and return a JPEG data URI.
 *
 * Quality steps down until the result fits MAX_STORED_BYTES, so an unusually
 * detailed photo cannot produce an oversized document.
 */
export async function processProfilePhoto(file: File): Promise<string> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new PhotoError('type')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new PhotoError('size')
  }

  const bitmap = await decode(file)

  try {
    const canvas = document.createElement('canvas')
    canvas.width = TARGET_SIZE
    canvas.height = TARGET_SIZE

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('decode')

    // Centre crop: take the largest square the source allows, then scale it.
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE)

    for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (byteLength(dataUrl) <= MAX_STORED_BYTES) return dataUrl
    }

    throw new PhotoError('size')
  } finally {
    bitmap.close?.()
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new PhotoError('decode')
  }
}

/** Size of a string once stored, counting UTF-8 bytes rather than characters. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
