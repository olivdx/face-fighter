import { LANDMARK_V, MOUNT_LANDMARKS, OVAL } from './faceAlign'
import { getMouthBox, type MouthBox } from './faceLandmarks'

const MOUTH_SRC = '/mount.png'
const MOUTH_SRC_FALLBACK = '/mount.jpg'

export type BruiseZoneId =
  | 'leftCheek'
  | 'rightCheek'
  | 'leftEye'
  | 'rightEye'
  | 'forehead'

export type BruiseStamp = {
  cx: number
  cy: number
  rx: number
  ry: number
  rotation: number
  alpha: number
  /** Stable seed for procedural bruise shape / mottle. */
  seed: number
  zone: BruiseZoneId
}

type MouthOverlay = {
  canvas: HTMLCanvasElement
  /** Opaque mouth art bounds inside canvas (no checkerboard). */
  box: { x: number; y: number; w: number; h: number }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read mouth overlay image'))
    img.src = url
  })
}

function isBackdrop(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max - min < 35 && max > 140
}

/** Key out checkerboard / grey backdrop everywhere (not only border flood-fill). */
function removeGlobalBackdrop(ctx: CanvasRenderingContext2D) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const id = ctx.getImageData(0, 0, w, h)
  const px = id.data
  for (let i = 0; i < w * h; i++) {
    const p = i * 4
    const r = px[p] ?? 0
    const g = px[p + 1] ?? 0
    const b = px[p + 2] ?? 0
    if (isBackdrop(r, g, b)) px[p + 3] = 0
  }
  ctx.putImageData(id, 0, 0)
}

/** Key out black matting fringe baked into mount.png edges. */
function removeBlackFringe(ctx: CanvasRenderingContext2D) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const id = ctx.getImageData(0, 0, w, h)
  const px = id.data
  for (let i = 0; i < w * h; i++) {
    const p = i * 4
    const r = px[p] ?? 0
    const g = px[p + 1] ?? 0
    const b = px[p + 2] ?? 0
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max < 75) {
      px[p + 3] = 0
    } else if (max < 105 && max - min < 30) {
      px[p + 3] = 0
    }
  }
  ctx.putImageData(id, 0, 0)
}

type Blob = { x: number; y: number; w: number; h: number; area: number }

/** Largest opaque connected region — mouth art, not checkerboard islands. */
function findMainMouthBlob(ctx: CanvasRenderingContext2D): Blob | null {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const id = ctx.getImageData(0, 0, w, h)
  const px = id.data
  const seen = new Uint8Array(w * h)
  const blobs: Blob[] = []

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (seen[i] || (px[i * 4 + 3] ?? 0) < 40) continue

      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let area = 0
      const stack = [i]
      seen[i] = 1

      while (stack.length > 0) {
        const cur = stack.pop()
        if (cur === undefined) break
        area++
        const cx = cur % w
        const cy = (cur / w) | 0
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy

        if (cx > 0 && !seen[cur - 1] && (px[(cur - 1) * 4 + 3] ?? 0) >= 40) {
          seen[cur - 1] = 1
          stack.push(cur - 1)
        }
        if (cx < w - 1 && !seen[cur + 1] && (px[(cur + 1) * 4 + 3] ?? 0) >= 40) {
          seen[cur + 1] = 1
          stack.push(cur + 1)
        }
        if (cy > 0 && !seen[cur - w] && (px[(cur - w) * 4 + 3] ?? 0) >= 40) {
          seen[cur - w] = 1
          stack.push(cur - w)
        }
        if (cy < h - 1 && !seen[cur + w] && (px[(cur + w) * 4 + 3] ?? 0) >= 40) {
          seen[cur + w] = 1
          stack.push(cur + w)
        }
      }

      if (area > 80) {
        blobs.push({
          x: minX,
          y: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          area,
        })
      }
    }
  }

  if (blobs.length === 0) return null
  // Prefer the largest blob; tie-break toward lower image (mouth art sits low in mount strips).
  return blobs.reduce((best, b) => {
    if (b.area > best.area * 1.15) return b
    if (best.area > b.area * 1.15) return best
    return b.y > best.y ? b : best
  })
}

function imageToMouthOverlay(img: HTMLImageElement): MouthOverlay {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, 0, 0)
  removeGlobalBackdrop(ctx)
  removeBlackFringe(ctx)

  const blob = findMainMouthBlob(ctx)
  if (!blob) throw new Error('Could not isolate mouth from overlay image')

  return { canvas, box: blob }
}

/** Built-in broken-teeth art when mount.png / mount.jpg are missing. */
function createProceduralMouthOverlay(): MouthOverlay {
  const w = 220
  const h = 90
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  ctx.clearRect(0, 0, w, h)

  // Dark lip cavity
  ctx.fillStyle = '#3a1510'
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.42, w * 0.42, h * 0.34, 0, 0, Math.PI * 2)
  ctx.fill()

  // Gums
  ctx.fillStyle = '#c44a3a'
  ctx.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.18)

  // Broken teeth
  ctx.fillStyle = '#fff4df'
  ctx.strokeStyle = '#121212'
  ctx.lineWidth = 2
  const toothW = w * 0.09
  const toothH = h * 0.34
  for (let i = 0; i < 6; i++) {
    const tx = w * 0.22 + i * (toothW + 4)
    const skew = i % 2 === 0 ? 0 : 4
    ctx.save()
    ctx.translate(tx + toothW / 2, h * 0.52 + skew)
    ctx.rotate(((i - 2.5) * 4 * Math.PI) / 180)
    ctx.fillRect(-toothW / 2, -toothH / 2, toothW, toothH)
    ctx.strokeRect(-toothW / 2, -toothH / 2, toothW, toothH)
    ctx.restore()
  }

  const blob = findMainMouthBlob(ctx)
  if (!blob) throw new Error('Procedural mouth overlay failed')

  return { canvas, box: blob }
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return (h ^ (h >>> 16)) / 4294967296
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let v = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    v += amp * valueNoise(x * freq, y * freq, seed + o * 131)
    amp *= 0.52
    freq *= 2.05
  }
  return v
}

type BruiseZoneDef = {
  cx: number
  cy: number
  spreadX: number
  spreadY: number
  rx: number
  ry: number
  rotBias: number
}

const BRUISE_ZONES: Record<BruiseZoneId, BruiseZoneDef> = {
  leftCheek: {
    cx: OVAL.cx - 0.52 * OVAL.rx,
    cy: OVAL.cy + 0.06 * OVAL.ry,
    spreadX: 0.07 * OVAL.rx,
    spreadY: 0.055 * OVAL.ry,
    rx: 0.3 * OVAL.rx,
    ry: 0.24 * OVAL.ry,
    rotBias: -0.22,
  },
  rightCheek: {
    cx: OVAL.cx + 0.52 * OVAL.rx,
    cy: OVAL.cy + 0.06 * OVAL.ry,
    spreadX: 0.07 * OVAL.rx,
    spreadY: 0.055 * OVAL.ry,
    rx: 0.3 * OVAL.rx,
    ry: 0.24 * OVAL.ry,
    rotBias: 0.22,
  },
  leftEye: {
    cx: MOUNT_LANDMARKS.leftEye.cx,
    cy: MOUNT_LANDMARKS.leftEye.cy + 0.03 * OVAL.ry,
    spreadX: 0.065 * OVAL.rx,
    spreadY: 0.055 * OVAL.ry,
    rx: 0.34 * OVAL.rx,
    ry: 0.28 * OVAL.ry,
    rotBias: -0.18,
  },
  rightEye: {
    cx: MOUNT_LANDMARKS.rightEye.cx,
    cy: MOUNT_LANDMARKS.rightEye.cy + 0.03 * OVAL.ry,
    spreadX: 0.065 * OVAL.rx,
    spreadY: 0.055 * OVAL.ry,
    rx: 0.34 * OVAL.rx,
    ry: 0.28 * OVAL.ry,
    rotBias: 0.18,
  },
  forehead: {
    cx: OVAL.cx,
    cy: OVAL.cy - 0.33 * OVAL.ry,
    spreadX: 0.15 * OVAL.rx,
    spreadY: 0.07 * OVAL.ry,
    rx: 0.3 * OVAL.rx,
    ry: 0.2 * OVAL.ry,
    rotBias: 0,
  },
}

const BRUISE_ZONE_ORDER: BruiseZoneId[] = [
  'leftCheek',
  'rightCheek',
  'leftEye',
  'rightEye',
  'forehead',
]

function bruiseZoneCounts(existing: readonly BruiseStamp[]): Record<BruiseZoneId, number> {
  const counts: Record<BruiseZoneId, number> = {
    leftCheek: 0,
    rightCheek: 0,
    leftEye: 0,
    rightEye: 0,
    forehead: 0,
  }
  for (const b of existing) counts[b.zone]++
  return counts
}

/**
 * Least-used zone, prioritising eyes → forehead → cheeks (upper-face damage).
 */
function pickBruiseZone(
  side: number,
  _index: number,
  _seed: number,
  existing: readonly BruiseStamp[],
): BruiseZoneId {
  const counts = bruiseZoneCounts(existing)
  const minCount = Math.min(...BRUISE_ZONE_ORDER.map((z) => counts[z]))
  const ties = BRUISE_ZONE_ORDER.filter((z) => counts[z] === minCount)

  const priority: BruiseZoneId[] = [
    side < 0 ? 'leftEye' : 'rightEye',
    side < 0 ? 'rightEye' : 'leftEye',
    'forehead',
    side < 0 ? 'leftCheek' : 'rightCheek',
    side < 0 ? 'rightCheek' : 'leftCheek',
  ]

  for (const z of priority) {
    if (ties.includes(z)) return z
  }
  return ties[0] ?? 'forehead'
}

const BRUISE_ZONE_ALPHA: Record<BruiseZoneId, number> = {
  leftCheek: 1,
  rightCheek: 1,
  leftEye: 1.38,
  rightEye: 1.38,
  forehead: 1.1,
}

/**
 * Random bruise within cheekbone, forehead, or periorbital zones.
 * Punch `side` (−1 left glove, +1 right) nudges tie-breaks toward same-side zones.
 */
export function bruiseStampFromHit(
  side: number,
  index: number,
  existing: readonly BruiseStamp[] = [],
): BruiseStamp {
  const seed = (index * 7919 + side * 104729) | 0
  const zone = pickBruiseZone(side, index, seed, existing)
  const def = BRUISE_ZONES[zone]

  const jx = (hash2(11, 22, seed) - 0.5) * 2 * def.spreadX
  const jy = (hash2(33, 44, seed) - 0.5) * 2 * def.spreadY
  const sizeVar = 0.88 + hash2(55, 66, seed) * 0.24
  const baseAlpha = 0.48 + hash2(index, 12, seed) * 0.32

  return {
    cx: def.cx + jx,
    cy: def.cy + jy,
    rx: def.rx * sizeVar,
    ry: def.ry * (0.9 + hash2(77, 88, seed) * 0.2),
    rotation: def.rotBias + (hash2(99, 10, seed) - 0.5) * 0.35,
    alpha: Math.min(0.88, baseAlpha * BRUISE_ZONE_ALPHA[zone]),
    seed,
    zone,
  }
}

type BruiseBlob = {
  ox: number
  oy: number
  sx: number
  sy: number
  weight: number
}

function bruiseSideForZone(zone: BruiseZoneId): number {
  if (zone.startsWith('left')) return -1
  if (zone.startsWith('right')) return 1
  return 0
}

/** Zone-specific blotches — cheek spill, periorbital ring, forehead smear. */
function bruiseBlobsForStamp(stamp: BruiseStamp): BruiseBlob[] {
  const s = stamp.seed
  const side = bruiseSideForZone(stamp.zone) || (stamp.cx >= OVAL.cx ? 1 : -1)

  if (stamp.zone === 'forehead') {
    return [
      { ox: 0, oy: 0, sx: 1.12, sy: 0.82, weight: 1 },
      {
        ox: (hash2(1, 2, s) - 0.5) * 0.38,
        oy: -0.06 + hash2(3, 4, s) * 0.12,
        sx: 0.58 + hash2(5, 6, s) * 0.2,
        sy: 0.42 + hash2(7, 8, s) * 0.16,
        weight: 0.5 + hash2(9, 10, s) * 0.28,
      },
    ]
  }

  if (stamp.zone === 'leftEye' || stamp.zone === 'rightEye') {
    return [
      { ox: 0, oy: 0, sx: 1.05, sy: 1.02, weight: 1 },
      {
        ox: side * (-0.04 + hash2(1, 2, s) * 0.1),
        oy: 0.34 + hash2(3, 4, s) * 0.12,
        sx: 0.82 + hash2(5, 6, s) * 0.14,
        sy: 0.68 + hash2(7, 8, s) * 0.14,
        weight: 0.92,
      },
      {
        ox: side * (-0.22 + hash2(9, 10, s) * 0.1),
        oy: -0.18 + hash2(11, 12, s) * 0.1,
        sx: 0.58 + hash2(13, 14, s) * 0.14,
        sy: 0.42 + hash2(15, 16, s) * 0.12,
        weight: 0.62,
      },
    ]
  }

  return [
    { ox: 0, oy: 0, sx: 1, sy: 1, weight: 1 },
    {
      ox: side * (-0.2 + hash2(1, 2, s) * 0.1),
      oy: -0.34 + hash2(3, 4, s) * 0.08,
      sx: 0.64 + hash2(5, 6, s) * 0.14,
      sy: 0.52 + hash2(7, 8, s) * 0.12,
      weight: 0.78,
    },
    {
      ox: side * (0.1 + hash2(9, 10, s) * 0.12),
      oy: 0.14 + hash2(11, 12, s) * 0.1,
      sx: 0.42 + hash2(13, 14, s) * 0.12,
      sy: 0.34 + hash2(15, 16, s) * 0.1,
      weight: 0.42 + hash2(17, 18, s) * 0.22,
    },
  ]
}

function sampleBruiseMask(
  lx: number,
  ly: number,
  rx: number,
  ry: number,
  stamp: BruiseStamp,
  blobs: BruiseBlob[],
): { mask: number; dist: number; mottle: number } {
  const seed = stamp.seed
  const nx = lx / rx
  const ny = ly / ry
  let mask = 0
  let bestDist = 2

  for (const blob of blobs) {
    const bnx = (nx - blob.ox) / blob.sx
    const bny = (ny - blob.oy) / blob.sy
    const ellDist = Math.sqrt(bnx * bnx + bny * bny)
    bestDist = Math.min(bestDist, ellDist)

    const warp =
      fbm(bnx * 2.6 + seed * 0.003, bny * 2.6, seed) * 0.4 +
      fbm(bnx * 5.4, bny * 5.4, seed + 41) * 0.16
    const distorted = ellDist + warp - 0.14

    if (distorted > 1.1) continue

    const edgeFade = Math.max(0, 1 - Math.max(0, distorted - 0.38) / 0.72)
    const speckle =
      0.45 +
      fbm(bnx * 7.8 + 3, bny * 7.8 + 1, seed + 77) * 0.4 +
      fbm(bnx * 15, bny * 15, seed + 155) * 0.12
    const core = Math.max(0, 1 - distorted * 1.7)
    const blobMask = edgeFade * speckle * (0.32 + core * 0.68) * blob.weight
    mask = Math.max(mask, blobMask)
    bestDist = Math.min(bestDist, distorted)
  }

  const mottle =
    0.48 +
    fbm(nx * 4.5, ny * 4.5, seed + 300) * 0.36 +
    fbm(nx * 9.5, ny * 9.5, seed + 401) * 0.14

  return { mask, dist: bestDist, mottle }
}

function bruiseTint(
  dist: number,
  mottle: number,
  seed: number,
  zone: BruiseZoneId,
): [number, number, number] {
  const n = fbm(dist * 2.6, mottle * 2.2, seed + 500)
  const t = Math.min(1, dist)
  const isEye = zone === 'leftEye' || zone === 'rightEye'

  if (isEye) {
    if (t < 0.22) return [8 + n * 8, 3 + n * 4, 18 + n * 10]
    if (t < 0.4) return [18 + n * 14, 8 + n * 6, 38 + n * 14]
    if (t < 0.58) return [48 + n * 22, 16 + n * 12, 52 + n * 12]
    if (t < 0.76) return [88 + n * 24, 32 + n * 18, 48 + n * 10]
    return [128 + n * 22, 58 + n * 24, 46 + n * 12]
  }

  if (t < 0.2) return [14 + n * 10, 6 + n * 5, 28 + n * 12]
  if (t < 0.36) return [28 + n * 16, 12 + n * 8, 48 + n * 16]
  if (t < 0.52) return [62 + n * 26, 22 + n * 14, 58 + n * 14]
  if (t < 0.68) return [102 + n * 28, 36 + n * 20, 50 + n * 12]
  if (t < 0.84) return [138 + n * 24, 68 + n * 26, 48 + n * 14]
  return [165 + n * 22, 132 + n * 28, 58 + n * 18]
}

/**
 * Procedural bruise: noise-mottled blotches multiplied into skin (no sprite image).
 */
function paintBruise(
  ctx: CanvasRenderingContext2D,
  stamp: BruiseStamp,
  size: number,
) {
  const cx = stamp.cx * size
  const cy = stamp.cy * size
  const rx = stamp.rx * size
  const ry = stamp.ry * size
  if (rx < 2 || ry < 2) return

  const cos = Math.cos(stamp.rotation)
  const sin = Math.sin(stamp.rotation)
  const strength = stamp.alpha
  const blobs = bruiseBlobsForStamp(stamp)
  const pad = Math.ceil(Math.max(rx, ry) * 0.22)
  const x0 = Math.max(0, Math.floor(cx - rx - pad))
  const y0 = Math.max(0, Math.floor(cy - ry - pad))
  const x1 = Math.min(ctx.canvas.width, Math.ceil(cx + rx + pad))
  const y1 = Math.min(ctx.canvas.height, Math.ceil(cy + ry + pad))
  const regionW = x1 - x0
  const regionH = y1 - y0
  if (regionW <= 0 || regionH <= 0) return

  const skin = ctx.getImageData(x0, y0, regionW, regionH)
  const skinPx = skin.data

  for (let py = 0; py < regionH; py++) {
    for (let px = 0; px < regionW; px++) {
      const wx = x0 + px - cx
      const wy = y0 + py - cy
      const lx = wx * cos + wy * sin
      const ly = -wx * sin + wy * cos

      const { mask, dist, mottle } = sampleBruiseMask(lx, ly, rx, ry, stamp, blobs)
      if (mask < 0.02) continue

      const pi = (py * regionW + px) * 4
      const skinR = skinPx[pi] ?? 0
      const skinG = skinPx[pi + 1] ?? 0
      const skinB = skinPx[pi + 2] ?? 0

      const isEye = stamp.zone === 'leftEye' || stamp.zone === 'rightEye'
      const [tintR, tintG, tintB] = bruiseTint(dist, mottle, stamp.seed, stamp.zone)
      let mulR = (skinR * tintR) / 255
      let mulG = (skinG * tintG) / 255
      let mulB = (skinB * tintB) / 255

      const coreDark = Math.max(0, 1 - dist * 2.2)
      if (coreDark > 0) {
        const darkAmt = isEye ? 0.26 : 0.16
        const k = 1 - coreDark * darkAmt
        mulR *= k
        mulG *= k
        mulB *= k
      }

      const blendCap = isEye ? 0.84 : 0.72
      const blendBoost = isEye ? 0.2 : 0.16
      const blend = Math.min(
        blendCap,
        mask * strength * (0.82 + (1 - Math.min(1, dist)) * blendBoost),
      )
      skinPx[pi] = Math.round(skinR + (mulR - skinR) * blend)
      skinPx[pi + 1] = Math.round(skinG + (mulG - skinG) * blend)
      skinPx[pi + 2] = Math.round(skinB + (mulB - skinB) * blend)
    }
  }

  ctx.putImageData(skin, x0, y0)
}

function meanOpaqueColor(data: Uint8ClampedArray): {
  r: number
  g: number
  b: number
  n: number
} {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  // Sample every other pixel; skip transparency, deep shadow and blown highlights.
  for (let i = 0; i < data.length; i += 8) {
    if ((data[i + 3] ?? 0) < 200) continue
    const pr = data[i] ?? 0
    const pg = data[i + 1] ?? 0
    const pb = data[i + 2] ?? 0
    const max = Math.max(pr, pg, pb)
    if (max < 30 || max > 240) continue
    r += pr
    g += pg
    b += pb
    n++
  }
  return n > 0 ? { r: r / n, g: g / n, b: b / n, n } : { r: 0, g: 0, b: 0, n: 0 }
}

/**
 * Tint the mouth overlay toward the skin it will cover: per-channel gain from
 * the mean of the covered face region vs the overlay's own mean, so the stock
 * lips inherit the player's skin tone and exposure. Teeth (bright, low
 * saturation) take a reduced correction so they stay whitish instead of being
 * dyed skin-colored. Returns a box-cropped canvas ready to draw.
 */
function colorMatchedMouth(
  overlay: MouthOverlay,
  faceCtx: CanvasRenderingContext2D,
  dest: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = overlay.box.w
  out.height = overlay.box.h
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas unavailable')
  octx.drawImage(
    overlay.canvas,
    overlay.box.x,
    overlay.box.y,
    overlay.box.w,
    overlay.box.h,
    0,
    0,
    overlay.box.w,
    overlay.box.h,
  )

  const x0 = Math.max(0, Math.floor(dest.x))
  const y0 = Math.max(0, Math.floor(dest.y))
  const x1 = Math.min(faceCtx.canvas.width, Math.ceil(dest.x + dest.w))
  const y1 = Math.min(faceCtx.canvas.height, Math.ceil(dest.y + dest.h))
  if (x1 - x0 < 8 || y1 - y0 < 8) return out

  const target = meanOpaqueColor(
    faceCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data,
  )
  const id = octx.getImageData(0, 0, out.width, out.height)
  const source = meanOpaqueColor(id.data)
  if (target.n < 40 || source.n < 40) return out

  const clampGain = (v: number) => Math.max(0.45, Math.min(1.8, v))
  const gr = clampGain(target.r / Math.max(1, source.r))
  const gg = clampGain(target.g / Math.max(1, source.g))
  const gb = clampGain(target.b / Math.max(1, source.b))

  const px = id.data
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] ?? 0) === 0) continue
    const r = px[i] ?? 0
    const g = px[i + 1] ?? 0
    const b = px[i + 2] ?? 0
    const max = Math.max(r, g, b)
    const sat = max > 0 ? (max - Math.min(r, g, b)) / max : 0
    const w = max > 170 && sat < 0.22 ? 0.55 : 0.92
    px[i] = Math.min(255, Math.round(r * (1 + (gr - 1) * w)))
    px[i + 1] = Math.min(255, Math.round(g * (1 + (gg - 1) * w)))
    px[i + 2] = Math.min(255, Math.round(b * (1 + (gb - 1) * w)))
  }
  octx.putImageData(id, 0, 0)
  return out
}

let overlayPromise: Promise<MouthOverlay> | null = null

function getMouthOverlay(): Promise<MouthOverlay> {
  if (!overlayPromise) {
    overlayPromise = loadImage(MOUTH_SRC)
      .then(imageToMouthOverlay)
      .catch(() => loadImage(MOUTH_SRC_FALLBACK).then(imageToMouthOverlay))
      .catch(() => createProceduralMouthOverlay())
  }
  return overlayPromise
}

export type FightFaceOptions = {
  mouthBroken?: boolean
  bruises?: BruiseStamp[]
}

/** Compose face texture with bruises and optional broken mouth. */
export async function renderFightFace(
  previewUrl: string,
  options: FightFaceOptions = {},
): Promise<HTMLCanvasElement> {
  const mouthBroken = options.mouthBroken ?? false
  const bruises = options.bruises ?? []

  const loaders: Promise<unknown>[] = [loadImage(previewUrl)]
  if (mouthBroken) loaders.push(getMouthOverlay(), getMouthBox(previewUrl))

  const results = await Promise.all(loaders)
  const faceImg = results[0] as HTMLImageElement
  const mouthOverlay = mouthBroken ? (results[1] as MouthOverlay) : null
  const mouth = mouthBroken ? (results[2] as MouthBox) : MOUNT_LANDMARKS.mouth

  const size = faceImg.naturalWidth
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(faceImg, 0, 0, size, size)

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(
    size * OVAL.cx,
    size * OVAL.cy,
    size * OVAL.rx,
    size * OVAL.ry,
    0,
    0,
    Math.PI * 2,
  )
  ctx.clip()

  for (const stamp of bruises) {
    paintBruise(ctx, stamp, size)
  }

  if (mouthBroken && mouthOverlay) {
    const mouthCx = size * mouth.cx
    const mouthCy = size * mouth.cy
    const destW = size * mouth.rx * 2
    const destH = size * mouth.ry * 2
    const destX = mouthCx - destW / 2
    const destY = mouthCy - destH / 2
    // Sample the skin being covered BEFORE the overlay goes on top.
    const matched = colorMatchedMouth(mouthOverlay, ctx, {
      x: destX,
      y: destY,
      w: destW,
      h: destH,
    })
    ctx.drawImage(
      matched,
      0,
      0,
      mouthOverlay.box.w,
      mouthOverlay.box.h,
      destX,
      destY,
      destW,
      destH,
    )
  }

  ctx.restore()
  return canvas
}

/** Paste broken-mouth art exactly over the red lip guide on the face texture. */
export async function renderDamagedFace(previewUrl: string): Promise<HTMLCanvasElement> {
  return renderFightFace(previewUrl, { mouthBroken: true })
}

/** Mouth center in normalized texture coords (for 3D tuning). */
export const MOUTH_TEXTURE_CY = OVAL.cy + LANDMARK_V.mouth * OVAL.ry

/** Head-pivot Y for flying teeth — tuned to MOUTH_TEXTURE_CY, or a detected mouth cy. */
export function mouthPivotLocalY(textureCy = MOUTH_TEXTURE_CY): number {
  return (0.5 - textureCy) * 0.735 - 0.232
}
