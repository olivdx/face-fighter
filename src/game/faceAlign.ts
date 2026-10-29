/** Canonical oval in exported texture / game UV space (normalized 0–1). */
export const OVAL = {
  cx: 0.5,
  cy: 0.46,
  rx: 0.36,
  ry: 0.44,
} as const

/**
 * Vertical offsets from oval center along the faceDepth v-axis (positive = toward chin).
 * Eyes match depthAt eye bumps (v ≈ 0.3). Mouth matches lip relief (v ≈ 0.55–0.8) and
 * anthropometric stomion (~34% of lower face below subnasale, Farkas sn–sto:sto–me 30:70).
 */
export const LANDMARK_V = {
  eye: 0.3,
  mouth: 0.64,
} as const

/** Eye / mouth anchors relative to canonical oval — faceDepth + mount overlay. */
export const MOUNT_LANDMARKS = {
  leftEye: {
    cx: OVAL.cx - 0.42 * OVAL.rx,
    cy: OVAL.cy - LANDMARK_V.eye * OVAL.ry,
    rx: 0.11,
    ry: 0.075,
  },
  rightEye: {
    cx: OVAL.cx + 0.42 * OVAL.rx,
    cy: OVAL.cy - LANDMARK_V.eye * OVAL.ry,
    rx: 0.11,
    ry: 0.075,
  },
  mouth: {
    cx: OVAL.cx,
    cy: OVAL.cy + LANDMARK_V.mouth * OVAL.ry,
    /** Red guide + in-game mouth effect (same size). */
    rx: OVAL.rx * 0.48,
    ry: 0.07,
  },
} as const

export type OvalAlignParams = {
  /** Image pan, −1 … 1 */
  panX: number
  panY: number
  /** Image zoom on top of fit-to-frame, 0.55 … 2.8 */
  zoom: number
  /** Oval frame offset from default center (normalized viewport). */
  ovalPanX: number
  ovalPanY: number
  /** Uniform scale on oval radii, 0.55 … 1.85 */
  ovalScale: number
  /** Oval rotation in radians, −π … π */
  ovalRotation: number
}

export const DEFAULT_OVAL_ALIGN: OvalAlignParams = {
  panX: 0,
  panY: 0,
  zoom: 1,
  ovalPanX: 0,
  ovalPanY: 0,
  ovalScale: 1,
  ovalRotation: 0,
}

export type EffectiveOval = {
  cx: number
  cy: number
  rx: number
  ry: number
  rotation: number
}

export type EffectiveLandmark = {
  cx: number
  cy: number
  rx: number
  ry: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

type Mat2 = { a: number; b: number; c: number; d: number }

function ovalLinear(rot: number, rx: number, ry: number): Mat2 {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { a: c * rx, b: s * rx, c: -s * ry, d: c * ry }
}

function inv2x2(m: Mat2): Mat2 {
  const det = m.a * m.d - m.b * m.c
  if (Math.abs(det) < 1e-8) return { a: 1, b: 0, c: 0, d: 1 }
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det }
}

function mul2x2(m1: Mat2, m2: Mat2): Mat2 {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
  }
}

/** User-adjustable oval frame in viewport pixels. */
export function effectiveOval(align: OvalAlignParams, size: number): EffectiveOval {
  const scale = clamp(align.ovalScale, 0.55, 1.85)
  return {
    cx: size * (OVAL.cx + align.ovalPanX),
    cy: size * (OVAL.cy + align.ovalPanY),
    rx: size * OVAL.rx * scale,
    ry: size * OVAL.ry * scale,
    rotation: align.ovalRotation,
  }
}

/** Eye / mouth guides following the transformed oval frame. */
export function effectiveLandmarks(align: OvalAlignParams, size: number): {
  leftEye: EffectiveLandmark
  rightEye: EffectiveLandmark
  mouth: EffectiveLandmark
} {
  const o = effectiveOval(align, size)
  const scale = clamp(align.ovalScale, 0.55, 1.85)
  const cos = Math.cos(o.rotation)
  const sin = Math.sin(o.rotation)

  function mapLocal(lx: number, ly: number, lrx: number, lry: number): EffectiveLandmark {
    const px = lx * o.rx
    const py = ly * o.ry
    return {
      cx: o.cx + px * cos - py * sin,
      cy: o.cy + px * sin + py * cos,
      rx: size * lrx * scale,
      ry: size * lry * scale,
    }
  }

  return {
    leftEye: mapLocal(-0.42, -LANDMARK_V.eye, MOUNT_LANDMARKS.leftEye.rx, MOUNT_LANDMARKS.leftEye.ry),
    rightEye: mapLocal(0.42, -LANDMARK_V.eye, MOUNT_LANDMARKS.rightEye.rx, MOUNT_LANDMARKS.rightEye.ry),
    mouth: mapLocal(0, LANDMARK_V.mouth, MOUNT_LANDMARKS.mouth.rx, MOUNT_LANDMARKS.mouth.ry),
  }
}

/** Image draw rect in viewport pixels (square side = viewportSize). */
export function imageDrawRect(
  imgWidth: number,
  imgHeight: number,
  viewportSize: number,
  align: OvalAlignParams,
) {
  const zoom = clamp(align.zoom, 0.55, 2.8)
  const fit = Math.min(viewportSize / imgWidth, viewportSize / imgHeight) * zoom
  const drawW = imgWidth * fit
  const drawH = imgHeight * fit
  const left = viewportSize / 2 - drawW / 2 + align.panX * viewportSize * 0.42
  const top = viewportSize / 2 - drawH / 2 + align.panY * viewportSize * 0.42
  return { left, top, drawW, drawH, fit }
}

/** Draw the aligned photo — same math as the on-screen alignment viewport. */
export function drawAlignedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  viewportSize: number,
  align: OvalAlignParams,
) {
  const { left, top, drawW, drawH } = imageDrawRect(
    img.width,
    img.height,
    viewportSize,
    align,
  )
  ctx.drawImage(img, left, top, drawW, drawH)
}

/** Dim everything outside the transformed oval frame. */
export function drawOvalDim(
  ctx: CanvasRenderingContext2D,
  viewportSize: number,
  align: OvalAlignParams,
) {
  const o = effectiveOval(align, viewportSize)
  ctx.save()
  ctx.fillStyle = 'rgba(18, 18, 18, 0.55)'
  ctx.beginPath()
  ctx.rect(0, 0, viewportSize, viewportSize)
  ctx.ellipse(o.cx, o.cy, o.rx, o.ry, o.rotation, 0, Math.PI * 2)
  ctx.fill('evenodd')
  ctx.restore()
}

/**
 * Render square portrait: remap the user oval frame onto the canonical game oval.
 */
export function renderOvalPortrait(
  img: HTMLImageElement,
  align: OvalAlignParams,
  outSize = 512,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = outSize
  canvas.height = outSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  const vp = document.createElement('canvas')
  vp.width = outSize
  vp.height = outSize
  const vpCtx = vp.getContext('2d')
  if (!vpCtx) throw new Error('Canvas unavailable')
  drawAlignedImage(vpCtx, img, outSize, align)

  const user = effectiveOval(align, outSize)
  const canon = effectiveOval(DEFAULT_OVAL_ALIGN, outSize)

  const userL = ovalLinear(user.rotation, user.rx, user.ry)
  const canonL = ovalLinear(canon.rotation, canon.rx, canon.ry)
  const A = mul2x2(canonL, inv2x2(userL))

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(canon.cx, canon.cy, canon.rx, canon.ry, canon.rotation, 0, Math.PI * 2)
  ctx.clip()

  const e = canon.cx - (A.a * user.cx + A.c * user.cy)
  const f = canon.cy - (A.b * user.cx + A.d * user.cy)
  ctx.setTransform(A.a, A.b, A.c, A.d, e, f)
  ctx.drawImage(vp, 0, 0, outSize, outSize)
  ctx.restore()

  return canvas
}

/**
 * Fit a detected face: zoom + pan the photo so the face fills the default oval,
 * then let the oval frame absorb whatever zoom/pan limits could not reach.
 */
export function alignFromFaceBox(
  imgWidth: number,
  imgHeight: number,
  box: { originX: number; originY: number; width: number; height: number },
): OvalAlignParams {
  const viewport = 512
  const panRange = viewport * 0.42
  const faceCx = box.originX + box.width / 2
  const faceCy = box.originY + box.height / 2 - box.height * 0.06

  const baseFit = Math.min(viewport / imgWidth, viewport / imgHeight)
  const targetFaceH = (viewport * OVAL.ry * 2) / 1.12
  const zoom = clamp(targetFaceH / (box.height * baseFit), 0.55, 2.8)
  const fit = baseFit * zoom
  const drawW = imgWidth * fit
  const drawH = imgHeight * fit

  // Pan so the face center lands on the default oval center.
  const panX = clamp(
    (viewport * OVAL.cx - (viewport / 2 - drawW / 2 + faceCx * fit)) / panRange,
    -1,
    1,
  )
  const panY = clamp(
    (viewport * OVAL.cy - (viewport / 2 - drawH / 2 + faceCy * fit)) / panRange,
    -1,
    1,
  )

  const faceVpX = viewport / 2 - drawW / 2 + panX * panRange + faceCx * fit
  const faceVpY = viewport / 2 - drawH / 2 + panY * panRange + faceCy * fit
  const ovalScale = clamp(
    (box.height * fit * 1.12) / (viewport * OVAL.ry * 2),
    0.55,
    1.85,
  )

  return {
    panX,
    panY,
    zoom,
    ovalPanX: clamp(faceVpX / viewport - OVAL.cx, -0.35, 0.35),
    ovalPanY: clamp(faceVpY / viewport - OVAL.cy, -0.35, 0.35),
    ovalScale,
    ovalRotation: 0,
  }
}

export function clampOvalAlign(align: OvalAlignParams): OvalAlignParams {
  return {
    panX: clamp(align.panX, -1, 1),
    panY: clamp(align.panY, -1, 1),
    zoom: clamp(align.zoom, 0.55, 2.8),
    ovalPanX: clamp(align.ovalPanX ?? 0, -0.35, 0.35),
    ovalPanY: clamp(align.ovalPanY ?? 0, -0.35, 0.35),
    ovalScale: clamp(align.ovalScale ?? 1, 0.55, 1.85),
    ovalRotation: clamp(align.ovalRotation ?? 0, -Math.PI, Math.PI),
  }
}
