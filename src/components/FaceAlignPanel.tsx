import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  DEFAULT_OVAL_ALIGN,
  MOUNT_LANDMARKS,
  OVAL,
  clampOvalAlign,
  drawAlignedImage,
  drawOvalDim,
  type OvalAlignParams,
} from '../game/faceAlign'
import './FaceAlignPanel.css'

type FaceAlignPanelProps = {
  originalUrl: string
  align: OvalAlignParams
  faceDetected: boolean
  onAlignChange: (align: OvalAlignParams) => void
  onRedetect: () => void
  busy: boolean
}

type DragMode = 'move' | 'scale' | 'rotate'

type DragState = {
  mode: DragMode
  startNormX: number
  startNormY: number
  startDist: number
  startAngle: number
  snapshot: OvalAlignParams
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

function pointerToNorm(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()?.inverse()
  if (!ctm) return { x: OVAL.cx, y: OVAL.cy }
  const svgPt = pt.matrixTransform(ctm)
  return { x: svgPt.x / 100, y: svgPt.y / 100 }
}

function ovalGroupTransform(align: OvalAlignParams) {
  const cx = (OVAL.cx + align.ovalPanX) * 100
  const cy = (OVAL.cy + align.ovalPanY) * 100
  const deg = (align.ovalRotation * 180) / Math.PI
  const originX = OVAL.cx * 100
  const originY = OVAL.cy * 100
  return `translate(${cx} ${cy}) rotate(${deg}) scale(${align.ovalScale}) translate(${-originX} ${-originY})`
}

export function FaceAlignPanel({
  originalUrl,
  align,
  faceDetected,
  onAlignChange,
  onRedetect,
  busy,
}: FaceAlignPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const viewportSizeRef = useRef(0)
  const dragRef = useRef<DragState | null>(null)

  const alignRef = useRef(align)
  alignRef.current = align

  const paintViewport = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    const size = viewportSizeRef.current
    if (!canvas || !img || size <= 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    drawAlignedImage(ctx, img, size, alignRef.current)
    drawOvalDim(ctx, size, alignRef.current)
  }, [])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const syncSize = () => {
      const next = el.clientWidth
      if (next === viewportSizeRef.current) return
      viewportSizeRef.current = next
      paintViewport()
    }

    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [paintViewport])

  useEffect(() => {
    let cancelled = false
    imgRef.current = null
    void loadImage(originalUrl)
      .then((img) => {
        if (cancelled) return
        imgRef.current = img
        paintViewport()
      })
      .catch(() => {
        if (!cancelled) imgRef.current = null
      })
    return () => {
      cancelled = true
    }
  }, [originalUrl, paintViewport])

  useEffect(() => {
    paintViewport()
  }, [align, paintViewport])

  const frameCenter = useCallback((a: OvalAlignParams) => ({
    x: OVAL.cx + a.ovalPanX,
    y: OVAL.cy + a.ovalPanY,
  }), [])

  const snapshotAlign = useCallback((a: OvalAlignParams): OvalAlignParams => {
    return clampOvalAlign({ ...DEFAULT_OVAL_ALIGN, ...a })
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (busy) return
      e.preventDefault()
      e.stopPropagation()
      const svg = svgRef.current
      const viewport = viewportRef.current
      if (!svg || !viewport) return
      viewport.setPointerCapture(e.pointerId)
      const snap = snapshotAlign(align)
      const norm = pointerToNorm(svg, e.clientX, e.clientY)
      const center = frameCenter(snap)
      const dx = norm.x - center.x
      const dy = norm.y - center.y
      dragRef.current = {
        mode,
        startNormX: norm.x,
        startNormY: norm.y,
        startDist: Math.hypot(dx, dy) || 0.01,
        startAngle: Math.atan2(dy, dx),
        snapshot: snap,
      }
    },
    [align, busy, frameCenter, snapshotAlign],
  )

  const onViewportPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      const svg = svgRef.current
      if (!drag || !svg) return

      const norm = pointerToNorm(svg, e.clientX, e.clientY)
      const snap = drag.snapshot

      if (drag.mode === 'move') {
        const dx = norm.x - drag.startNormX
        const dy = norm.y - drag.startNormY
        onAlignChange(
          clampOvalAlign({
            ...snap,
            ovalPanX: snap.ovalPanX + dx,
            ovalPanY: snap.ovalPanY + dy,
          }),
        )
        return
      }

      const center = frameCenter(snap)
      const dx = norm.x - center.x
      const dy = norm.y - center.y

      if (drag.mode === 'scale') {
        const dist = Math.hypot(dx, dy) || 0.01
        const ratio = dist / drag.startDist
        onAlignChange(
          clampOvalAlign({
            ...snap,
            ovalScale: snap.ovalScale * ratio,
          }),
        )
        return
      }

      if (drag.mode === 'rotate') {
        const angle = Math.atan2(dy, dx)
        onAlignChange(
          clampOvalAlign({
            ...snap,
            ovalRotation: snap.ovalRotation + angle - drag.startAngle,
          }),
        )
      }
    },
    [frameCenter, onAlignChange],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const viewport = viewportRef.current
    if (viewport?.hasPointerCapture(e.pointerId)) {
      viewport.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
  }, [])

  return (
    <div className="align-panel">
      <div
        ref={viewportRef}
        className="align-viewport"
        onPointerMove={onViewportPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} className="align-canvas" aria-hidden />

        <svg
          ref={svgRef}
          className="align-oval-svg"
          viewBox="0 0 100 100"
          aria-hidden
        >
          <g transform={ovalGroupTransform(align)}>
            <ellipse
              cx={OVAL.cx * 100}
              cy={OVAL.cy * 100}
              rx={OVAL.rx * 100}
              ry={OVAL.ry * 100}
              className="align-oval-stroke align-oval-hit"
              onPointerDown={(e) => onPointerDown(e, 'move')}
            />
            <ellipse
              cx={MOUNT_LANDMARKS.leftEye.cx * 100}
              cy={MOUNT_LANDMARKS.leftEye.cy * 100}
              rx={MOUNT_LANDMARKS.leftEye.rx * 100}
              ry={MOUNT_LANDMARKS.leftEye.ry * 100}
              className="align-eye-guide"
              pointerEvents="none"
            />
            <ellipse
              cx={MOUNT_LANDMARKS.rightEye.cx * 100}
              cy={MOUNT_LANDMARKS.rightEye.cy * 100}
              rx={MOUNT_LANDMARKS.rightEye.rx * 100}
              ry={MOUNT_LANDMARKS.rightEye.ry * 100}
              className="align-eye-guide"
              pointerEvents="none"
            />
            <ellipse
              cx={MOUNT_LANDMARKS.mouth.cx * 100}
              cy={MOUNT_LANDMARKS.mouth.cy * 100}
              rx={MOUNT_LANDMARKS.mouth.rx * 100}
              ry={MOUNT_LANDMARKS.mouth.ry * 100}
              className="align-mouth-guide"
              pointerEvents="none"
            />
            <circle
              cx={OVAL.cx * 100}
              cy={(OVAL.cy - OVAL.ry) * 100}
              r={2.2}
              className="align-handle align-handle-rotate"
              onPointerDown={(e) => onPointerDown(e, 'rotate')}
            />
            <circle
              cx={(OVAL.cx + OVAL.rx) * 100}
              cy={OVAL.cy * 100}
              r={2.2}
              className="align-handle align-handle-scale"
              onPointerDown={(e) => onPointerDown(e, 'scale')}
            />
          </g>
        </svg>
      </div>

      <p className="align-status">
        {faceDetected
          ? 'Fit eyes in blue guides. Lips should fill the red oval snugly.'
          : 'Move, scale, and rotate the yellow frame. Lips snug in the red oval.'}
      </p>

      <label className="align-control">
        <span>Photo zoom</span>
        <input
          type="range"
          min={0.55}
          max={2.8}
          step={0.01}
          value={align.zoom}
          disabled={busy}
          onChange={(e) => onAlignChange({ ...align, zoom: Number(e.target.value) })}
        />
      </label>

      <label className="align-control">
        <span>Frame size</span>
        <input
          type="range"
          min={0.55}
          max={1.85}
          step={0.01}
          value={align.ovalScale}
          disabled={busy}
          onChange={(e) => onAlignChange({ ...align, ovalScale: Number(e.target.value) })}
        />
      </label>

      <label className="align-control">
        <span>Frame rotate</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round((align.ovalRotation * 180) / Math.PI)}
          disabled={busy}
          onChange={(e) =>
            onAlignChange({
              ...align,
              ovalRotation: (Number(e.target.value) * Math.PI) / 180,
            })
          }
        />
      </label>

      <button
        type="button"
        className="btn btn-blue align-redetect"
        disabled={busy}
        onClick={onRedetect}
      >
        {busy ? 'Aligning…' : 'Auto-fit frame to face'}
      </button>
      <button
        type="button"
        className="btn btn-secondary align-redetect"
        disabled={busy}
        onClick={() => onAlignChange(DEFAULT_OVAL_ALIGN)}
      >
        Reset frame (pre-fitted image)
      </button>
    </div>
  )
}
