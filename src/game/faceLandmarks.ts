import { FaceLandmarker } from '@mediapipe/tasks-vision'
import { MOUNT_LANDMARKS } from './faceAlign'
import { getVisionFileset } from './vision'

const LANDMARK_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// FaceMesh outer-lip indices: corners, top of upper lip, bottom of lower lip.
const LIP_LEFT = 61
const LIP_RIGHT = 291
const LIP_TOP = 0
const LIP_BOTTOM = 17

/** Mouth ellipse in normalized texture coords — same shape as MOUNT_LANDMARKS.mouth. */
export type MouthBox = { cx: number; cy: number; rx: number; ry: number }

let landmarkerPromise: Promise<FaceLandmarker> | null = null

function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await getVisionFileset()
      return FaceLandmarker.createFromModelPath(vision, LANDMARK_MODEL)
    })()
  }
  return landmarkerPromise
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

/** Composite on grey so transparent texture corners don't confuse the detector. */
function flatten(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0)
  return c
}

const cache = new Map<string, Promise<MouthBox>>()

/**
 * Where the lips really are on this face texture. Falls back to the fixed
 * red guide when detection is unavailable (offline) or finds no face.
 */
export function getMouthBox(textureUrl: string): Promise<MouthBox> {
  let hit = cache.get(textureUrl)
  if (!hit) {
    hit = detectMouth(textureUrl).catch(() => null).then((m) => m ?? MOUNT_LANDMARKS.mouth)
    cache.set(textureUrl, hit)
  }
  return hit
}

async function detectMouth(textureUrl: string): Promise<MouthBox | null> {
  const [landmarker, img] = await Promise.all([getLandmarker(), loadImage(textureUrl)])
  const lm = landmarker.detect(flatten(img)).faceLandmarks[0]
  if (!lm) return null
  const l = lm[LIP_LEFT]
  const r = lm[LIP_RIGHT]
  const t = lm[LIP_TOP]
  const b = lm[LIP_BOTTOM]
  if (!l || !r || !t || !b) return null

  const guide = MOUNT_LANDMARKS.mouth
  const width = Math.hypot(r.x - l.x, r.y - l.y)
  return {
    cx: (l.x + r.x) / 2,
    cy: (t.y + b.y) / 2,
    // Slightly larger than the lips so the broken-mouth art fully covers them.
    rx: Math.max(guide.rx * 0.6, (width / 2) * 1.15),
    ry: Math.max(guide.ry * 0.6, ((b.y - t.y) / 2) * 1.15),
  }
}
