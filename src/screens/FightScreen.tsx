import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
  bruiseStampFromHit,
  mouthPivotLocalY,
  renderFightFace,
  type BruiseStamp,
} from '../game/faceDamage'
import type { ProcessedFaceImage } from '../game/faceImage'
import { getMouthBox } from '../game/faceLandmarks'
import { buildFaceMesh, buildSkullMesh } from '../game/fighterHead'
import type { GameNetClient } from '../game/net/client'
import './FightScreen.css'

type FightScreenProps = {
  face: ProcessedFaceImage
  playerFace?: ProcessedFaceImage
  mode?: 'ai' | 'pvp'
  net?: GameNetClient | null
  onBack: () => void
}

const HIT_WORDS = ['POW!', 'BAM!', 'WHAM!', 'CRACK!', 'BOOM!', 'OUCH!']
const BLOCK_WORDS = ['BLOCK!', 'GUARD!', 'NICE!']
const PUNCH_SOUND_POOL = ['/sounds/punch.mp3', '/sounds/punch00.mp3', '/sounds/punch01.mp3']
const OUCH_SOUND_SRC = '/sounds/ouch.mp3'

const BAUHAUS = {
  blue: 0x1040c0,
  red: 0xd02020,
  yellow: 0xf0c020,
}

export function FightScreen({
  face,
  playerFace,
  mode = 'ai',
  net = null,
  onBack,
}: FightScreenProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hpRef = useRef<HTMLDivElement>(null)
  const playerHpRef = useRef<HTMLDivElement>(null)
  const koTitleRef = useRef<HTMLHeadingElement>(null)
  const splashRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const koRef = useRef<HTMLDivElement>(null)
  const portraitRef = useRef<HTMLDivElement>(null)
  const playerPortraitRef = useRef<HTMLDivElement>(null)
  const netRef = useRef(net)
  netRef.current = net

  useEffect(() => {
    if (portraitRef.current) {
      portraitRef.current.style.backgroundImage = `url(${face.previewUrl})`
    }
  }, [face.previewUrl])

  useEffect(() => {
    if (playerPortraitRef.current && playerFace) {
      playerPortraitRef.current.style.backgroundImage = `url(${playerFace.previewUrl})`
    }
  }, [playerFace?.previewUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = wrapRef.current
    if (!canvas || !root) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BAUHAUS.blue)

    const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100)
    camera.position.set(0, 1.55, 5.4)
    camera.lookAt(0, 1.45, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xfff1d6, 1.0)
    key.position.set(2, 4, 3)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fc6ff, 0.5)
    rim.position.set(-3, 1, -3)
    scene.add(rim)

    // Ring floor
    {
      const c = document.createElement('canvas')
      c.width = c.height = 256
      const g = c.getContext('2d')
      if (g) {
        g.fillStyle = '#3a6fd4'
        g.fillRect(0, 0, 256, 256)
        g.strokeStyle = 'rgba(18,18,18,.2)'
        g.lineWidth = 6
        for (let i = 0; i <= 256; i += 64) {
          g.beginPath()
          g.moveTo(i, 0)
          g.lineTo(i, 256)
          g.stroke()
          g.beginPath()
          g.moveTo(0, i)
          g.lineTo(256, i)
          g.stroke()
        }
      }
      const tex = new THREE.CanvasTexture(c)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(4, 4)
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
      )
      floor.rotation.x = -Math.PI / 2
      floor.position.y = -1.2
      scene.add(floor)
    }

    // Ropes + posts
    {
      const ropeMat = new THREE.MeshStandardMaterial({ color: BAUHAUS.red, roughness: 0.5 })
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 16, 8), ropeMat)
        r.rotation.z = Math.PI / 2
        r.position.set(0, -0.4 + i * 0.55, -4.5)
        scene.add(r)
      }
      const postMat = new THREE.MeshStandardMaterial({ color: BAUHAUS.blue, roughness: 0.4 })
      for (const x of [-7.5, 7.5]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 12), postMat)
        p.position.set(x, 0.1, -4.5)
        scene.add(p)
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.26, 14, 12),
          new THREE.MeshStandardMaterial({ color: BAUHAUS.yellow }),
        )
        ball.position.set(x, 1.45, -4.5)
        scene.add(ball)
      }
    }

    const fighter = new THREE.Group()
    const headPivot = new THREE.Group()
    headPivot.position.set(0, 2.25, 0)
    fighter.add(headPivot)
    let headBuilt = false
    let faceMesh: THREE.Mesh | null = null
    let baseFaceTex: THREE.Texture | null = null

    const loader = new THREE.TextureLoader()
    loader.load(face.previewUrl, (tex) => {
      baseFaceTex = tex
      faceMesh = buildFaceMesh(tex)
      headPivot.add(buildSkullMesh(), faceMesh)
      headBuilt = true
    })

    const bruises: BruiseStamp[] = []
    let faceCanvasTex: THREE.CanvasTexture | null = null
    let faceBakeGen = 0

    function applyFaceTexture() {
      const gen = ++faceBakeGen
      void renderFightFace(face.previewUrl, {
        mouthBroken,
        bruises,
      })
        .then((c) => {
          if (gen !== faceBakeGen) return
          if (faceCanvasTex) faceCanvasTex.dispose()
          faceCanvasTex = new THREE.CanvasTexture(c)
          faceCanvasTex.colorSpace = THREE.SRGBColorSpace
          faceCanvasTex.minFilter = THREE.LinearFilter
          if (!faceMesh) return
          const mat = faceMesh.material as THREE.MeshStandardMaterial
          mat.map = faceCanvasTex
          mat.needsUpdate = true
        })
        .catch(() => {
          // Overlay assets missing — keep current texture.
        })
    }

    type AiGloveUserData = {
      rest: THREE.Vector3
      target: THREE.Vector3
      t: number
      active: boolean
      side: number
      hit: boolean
    }

    const aiGloves: THREE.Group[] = []

    // Cartoon body
    {
      const skin = new THREE.MeshStandardMaterial({ color: 0xc89a72, roughness: 0.8 })
      const shirt = new THREE.MeshStandardMaterial({ color: BAUHAUS.red, roughness: 0.7 })
      const gloveM = new THREE.MeshStandardMaterial({ color: BAUHAUS.blue, roughness: 0.45 })
      const cuffM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 1.5, 18), shirt)
      torso.position.y = 0.55
      torso.scale.z = 0.72
      fighter.add(torso)
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.5, 12), skin)
      neck.position.y = 1.4
      fighter.add(neck)
      for (const s of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), shirt)
        sh.position.set(s * 0.62, 1.1, 0)
        fighter.add(sh)
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 1.0, 10), skin)
        arm.position.set(s * 0.85, 0.55, 0.25)
        arm.rotation.z = s * 0.45
        arm.rotation.x = -0.5
        fighter.add(arm)
        const g = new THREE.Group()
        const fist = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), gloveM)
        fist.scale.set(1, 0.92, 1.1)
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.32, 10), cuffM)
        cuff.position.set(0, -0.1, 0.38)
        cuff.rotation.x = 1.1
        g.add(fist, cuff)
        const rest = new THREE.Vector3(s * 1.0, 0.15, 0.62)
        const target = new THREE.Vector3(s * 1.14, 1.38, 2.55)
        g.position.copy(rest)
        g.userData = {
          rest,
          target,
          t: 0,
          active: false,
          side: s,
          hit: false,
        }
        fighter.add(g)
        aiGloves.push(g)
      }
      const belt = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.09, 10, 24),
        new THREE.MeshStandardMaterial({ color: BAUHAUS.yellow }),
      )
      belt.rotation.x = Math.PI / 2
      belt.position.y = -0.18
      belt.scale.z = 0.72
      fighter.add(belt)
      const hips = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.6, 0.8, 18),
        new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 }),
      )
      hips.position.y = -0.55
      hips.scale.z = 0.72
      fighter.add(hips)
    }
    fighter.position.set(0, -0.55, 0)
    scene.add(fighter)

    // Dizzy stars
    const stars: THREE.Sprite[] = []
    {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')
      if (g) {
        g.translate(32, 32)
        g.fillStyle = '#f0c020'
        g.strokeStyle = '#000'
        g.lineWidth = 4
        g.beginPath()
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5
          const r = i % 2 ? 11 : 26
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        }
        g.closePath()
        g.fill()
        g.stroke()
      }
      const st = new THREE.CanvasTexture(c)
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, transparent: true }))
        sp.scale.set(0.4, 0.4, 0.4)
        sp.visible = false
        headPivot.add(sp)
        stars.push(sp)
      }
    }

    // Flying teeth knocked out on hits
    type Tooth = {
      mesh: THREE.Mesh
      vel: THREE.Vector3
      spin: THREE.Vector3
      life: number
    }
    const teeth: Tooth[] = []
    const toothGeo = new THREE.BoxGeometry(0.09, 0.12, 0.06)
    const toothMat = new THREE.MeshStandardMaterial({
      color: 0xfff3da,
      roughness: 0.35,
    })
    // Lips position on the head (texture v = 0.3 → just below pivot center).
    const mouthLocal = new THREE.Vector3(0, mouthPivotLocalY(), 0.75)
    void getMouthBox(face.previewUrl).then((m) => {
      mouthLocal.y = mouthPivotLocalY(m.cy)
    })
    const toothSpawn = new THREE.Vector3()

    function spawnTeeth(side: number, count: number) {
      if (!headBuilt) return
      toothSpawn.copy(mouthLocal).applyMatrix4(headPivot.matrixWorld)
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(toothGeo, toothMat)
        m.position.copy(toothSpawn)
        m.position.x += (Math.random() - 0.5) * 0.25
        m.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2)
        teeth.push({
          mesh: m,
          vel: new THREE.Vector3(
            -side * (0.5 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.8,
            1.4 + Math.random() * 1.2,
            1.2 + Math.random(),
          ),
          spin: new THREE.Vector3(
            Math.random() * 10 - 5,
            Math.random() * 10 - 5,
            Math.random() * 10 - 5,
          ),
          life: 0,
        })
        scene.add(m)
      }
    }

    function clearTeeth() {
      for (const t of teeth) scene.remove(t.mesh)
      teeth.length = 0
    }

    // Player gloves
    type GloveUserData = {
      rest: THREE.Vector3
      t: number
      active: boolean
      side: number
      hit: boolean
    }
    const myGloves: THREE.Group[] = []
    {
      const red = new THREE.MeshStandardMaterial({ color: BAUHAUS.red, roughness: 0.4 })
      const cuff = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
      for (const s of [-1, 1]) {
        const g = new THREE.Group()
        const fist = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), red)
        fist.scale.set(1, 0.9, 1.15)
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 12), cuff)
        c.position.set(0, -0.15, 0.55)
        c.rotation.x = 1.2
        g.add(fist, c)
        const rest = new THREE.Vector3(s * 1.25, 0.25, 3.6)
        g.userData = { rest, t: 0, active: false, side: s, hit: false } satisfies GloveUserData
        g.position.copy(rest)
        scene.add(g)
        myGloves.push(g)
      }
    }

    let hp = 100
    let playerHp = 100
    let ko = false
    let started = false
    let mouthBroken = false
    let guardHeld = false
    let blockGraceUntil = 0
    const BLOCK_GRACE_MS = 60
    let aiCooldown = 2.2
    let aiWindup = false
    const headVel = { x: 0, y: 0, z: 0 }
    let squash = 0
    let shake = 0
    let dizzy = 0

    const hpFill = hpRef.current
    const playerHpFill = playerHpRef.current
    const splash = splashRef.current
    const flash = flashRef.current
    const koPanel = koRef.current
    const koTitle = koTitleRef.current

    const guardPos = [
      new THREE.Vector3(-0.78, 1.18, 2.85),
      new THREE.Vector3(0.78, 1.18, 2.85),
    ]

    function showSplash(txt: string) {
      if (!splash) return
      const span = splash.querySelector('span')
      if (span) span.textContent = txt
      splash.classList.remove('show')
      void splash.offsetWidth
      splash.classList.add('show')
    }

    const punchSounds = PUNCH_SOUND_POOL.map((src) => {
      const audio = new Audio(src)
      audio.preload = 'auto'
      return audio
    })
    const ouchSound = new Audio(OUCH_SOUND_SRC)
    ouchSound.preload = 'auto'

    function playPunchSound() {
      const pick = punchSounds[(Math.random() * punchSounds.length) | 0]
      if (!pick) return
      const clip = pick.cloneNode() as HTMLAudioElement
      clip.volume = 0.72
      void clip.play().catch(() => {})
    }

    function playOuchSound() {
      const clip = ouchSound.cloneNode() as HTMLAudioElement
      clip.volume = 0.78
      void clip.play().catch(() => {})
    }

    const startTimer = window.setTimeout(() => {
      showSplash('FIGHT!')
      started = true
    }, 600)

    function showFightWord(text: string, className = 'fight-pow', xBias = 0) {
      const w = document.createElement('div')
      w.className = className
      w.textContent = text
      w.style.setProperty('--r', `${Math.random() * 30 - 15}deg`)
      w.style.left = `${window.innerWidth / 2 + (Math.random() * 120 - 60) + xBias}px`
      w.style.top = `${window.innerHeight * 0.32 + (Math.random() * 60 - 30)}px`
      wrapRef.current?.appendChild(w)
      window.setTimeout(() => w.remove(), 520)
    }

    /** Gloves / button — follows input immediately. */
    function isGuardUp() {
      return guardHeld
    }

    /** Hit check — tiny grace so a block pressed just before impact still counts. */
    function absorbsHit() {
      return guardHeld || performance.now() < blockGraceUntil
    }

    function updateOpponentHpBar() {
      if (!hpFill) return
      hpFill.style.width = `${hp}%`
      if (hp <= 50) {
        hpFill.style.background = '#f0c020'
      }
      if (hp < 18) {
        hpFill.style.background = '#d02020'
      }
    }

    function applyOpponentHitVisuals(side: number) {
      headVel.y += 0.5 + Math.random() * 0.3
      headVel.x += -side * (0.8 + Math.random() * 0.5)
      headVel.z += 0.35
      squash = 1
      shake = 1
      dizzy = Math.min(1, dizzy + (hp < 35 ? 0.6 : 0.25))
      bruises.push(bruiseStampFromHit(side, bruises.length, bruises))
      const firstMouthBreak = !mouthBroken && hp <= 50
      if (firstMouthBreak) mouthBroken = true
      applyFaceTexture()
      spawnTeeth(side, firstMouthBreak ? 3 : 1 + ((Math.random() * 2) | 0))
      if (flash) {
        flash.style.opacity = '0.55'
        window.setTimeout(() => {
          if (flash) flash.style.opacity = '0'
        }, 60)
      }
      showFightWord(HIT_WORDS[(Math.random() * HIT_WORDS.length) | 0] ?? 'POW!', 'fight-pow', side * 60)
      if (navigator.vibrate) navigator.vibrate(35)
    }

    function applyPeerHitResult(blocked: boolean, peerPlayerHp: number, side: number) {
      hp = peerPlayerHp
      updateOpponentHpBar()
      if (blocked) {
        showFightWord(
          BLOCK_WORDS[(Math.random() * BLOCK_WORDS.length) | 0] ?? 'BLOCK!',
          'fight-pow fight-pow--block',
        )
        shake = 0.35
        if (navigator.vibrate) navigator.vibrate(12)
      } else {
        applyOpponentHitVisuals(side)
      }
      if (hp <= 0) doKO()
    }

    function setBlocking(active: boolean) {
      guardHeld = active
      if (active) blockGraceUntil = 0
      else blockGraceUntil = performance.now() + BLOCK_GRACE_MS
      wrapRef.current?.querySelector('#fight-guard')?.classList.toggle('fight-guard--active', active)
      if (mode === 'pvp') netRef.current?.sendBlock(active)
    }

    function updatePlayerHpBar() {
      if (!playerHpFill) return
      playerHpFill.style.width = `${playerHp}%`
      if (playerHp <= 50) {
        playerHpFill.style.background = '#f0c020'
      }
      if (playerHp < 18) {
        playerHpFill.style.background = '#d02020'
      }
    }

    function landPlayerHit(side: number): boolean {
      if (ko) return false
      if (absorbsHit()) {
        showFightWord(
          BLOCK_WORDS[(Math.random() * BLOCK_WORDS.length) | 0] ?? 'BLOCK!',
          'fight-pow fight-pow--block',
        )
        playerHp = Math.max(0, playerHp - 2)
        updatePlayerHpBar()
        shake = 0.35
        if (navigator.vibrate) navigator.vibrate(12)
        return true
      }

      playerHp = Math.max(0, playerHp - (8 + Math.random() * 6))
      updatePlayerHpBar()
      playOuchSound()
      shake = 1.1
      if (flash) {
        flash.style.background = '#d02020'
        flash.style.opacity = '0.4'
        window.setTimeout(() => {
          if (flash) {
            flash.style.opacity = '0'
            flash.style.background = ''
          }
        }, 80)
      }
      showFightWord('OUCH!', 'fight-pow fight-pow--hurt', -side * 40)
      if (navigator.vibrate) navigator.vibrate(55)
      if (playerHp <= 0) doPlayerKO()
      return false
    }

    function landHit(side: number) {
      if (ko) return
      hp = Math.max(0, hp - (7 + Math.random() * 6))
      updateOpponentHpBar()
      applyOpponentHitVisuals(side)
      if (hp <= 0) doKO()
    }

    function doKO() {
      ko = true
      dizzy = 1
      if (koTitle) koTitle.textContent = 'K.O.!'
      showSplash('K.O.!')
      window.setTimeout(() => koPanel?.classList.add('show'), 900)
    }

    function doPlayerKO() {
      ko = true
      dizzy = 0.5
      if (koTitle) koTitle.textContent = 'DOWN!'
      showSplash('DOWN!')
      window.setTimeout(() => koPanel?.classList.add('show'), 900)
    }

    function tryAiPunch() {
      if (mode === 'pvp') return
      if (ko || !started || aiWindup) return
      const side = Math.random() < 0.5 ? -1 : 1
      const g = aiGloves[side < 0 ? 0 : 1]
      const u = g.userData as AiGloveUserData
      if (u.active) return
      u.active = true
      u.t = 0
      u.hit = false
      aiWindup = true
    }

    function incomingPunch(side: number) {
      if (ko || !started) return
      const g = aiGloves[side < 0 ? 0 : 1]
      const u = g.userData as AiGloveUserData
      if (u.active) return
      u.active = true
      u.t = 0
      u.hit = false
      aiWindup = true
    }

    function rematch() {
      hp = 100
      playerHp = 100
      ko = false
      dizzy = 0
      mouthBroken = false
      guardHeld = false
      blockGraceUntil = 0
      wrapRef.current?.querySelector('#fight-guard')?.classList.remove('fight-guard--active')
      aiCooldown = 2.2
      aiWindup = false
      bruises.length = 0
      faceBakeGen++
      if (faceCanvasTex) {
        faceCanvasTex.dispose()
        faceCanvasTex = null
      }
      if (faceMesh && baseFaceTex) {
        const mat = faceMesh.material as THREE.MeshStandardMaterial
        mat.map = baseFaceTex
        mat.needsUpdate = true
      }
      clearTeeth()
      if (hpFill) {
        hpFill.style.width = '100%'
        hpFill.style.background = '#f0c020'
      }
      if (playerHpFill) {
        playerHpFill.style.width = '100%'
        playerHpFill.style.background = '#1040c0'
      }
      if (koTitle) koTitle.textContent = 'K.O.!'
      aiGloves.forEach((g) => {
        const u = g.userData as AiGloveUserData
        u.active = false
        u.hit = false
        u.t = 0
        g.position.copy(u.rest)
      })
      fighter.rotation.set(0, 0, 0)
      fighter.position.y = -0.55
      koPanel?.classList.remove('show')
      showSplash('ROUND 2!')
    }

    const rematchLocal = rematch
    function rematchOnline() {
      netRef.current?.sendRematch()
      rematchLocal()
    }

    function punch(side: number) {
      if (ko || !started) return
      const g = myGloves[side < 0 ? 0 : 1]
      if (!g || (g.userData as GloveUserData).active) return
      const ud = g.userData as GloveUserData
      ud.active = true
      ud.t = 0
      ud.hit = false
      playPunchSound()
      if (mode === 'pvp') netRef.current?.sendPunch(side as -1 | 1)
    }

    const onPunchLeft = (e: Event) => {
      e.stopPropagation()
      punch(-1)
    }
    const onPunchRight = (e: Event) => {
      e.stopPropagation()
      punch(1)
    }
    const onCanvasDown = (e: PointerEvent) => punch(e.clientX < window.innerWidth / 2 ? -1 : 1)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setBlocking(true)
        return
      }
      if (e.key === 'a' || e.key === 'ArrowLeft') punch(-1)
      if (e.key === 'l' || e.key === 'ArrowRight') punch(1)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setBlocking(false)
    }

    const btnLeft = root.querySelector('#fight-pl')
    const btnRight = root.querySelector('#fight-pr')
    const guardBtn = root.querySelector('#fight-guard') as HTMLButtonElement | null
    const btnRematch = root.querySelector('#fight-rematch')
    const onGuardDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      guardBtn?.setPointerCapture(e.pointerId)
      setBlocking(true)
    }
    const onGuardUp = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (guardBtn?.hasPointerCapture(e.pointerId)) {
        guardBtn.releasePointerCapture(e.pointerId)
      }
      setBlocking(false)
    }
    btnLeft?.addEventListener('pointerdown', onPunchLeft)
    btnRight?.addEventListener('pointerdown', onPunchRight)
    guardBtn?.addEventListener('pointerdown', onGuardDown)
    guardBtn?.addEventListener('pointerup', onGuardUp)
    guardBtn?.addEventListener('pointercancel', onGuardUp)
    guardBtn?.addEventListener('pointerleave', onGuardUp)
    btnRematch?.addEventListener('click', mode === 'pvp' ? rematchOnline : rematch)
    canvas.addEventListener('pointerdown', onCanvasDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)

    const clock = new THREE.Clock()
    let frameId = 0

    function resize() {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', resize)
    resize()

    function animate() {
      frameId = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime

      if (!ko) {
        fighter.rotation.y = Math.sin(t * 1.1) * 0.12
        fighter.position.x = Math.sin(t * 0.8) * 0.25
        fighter.position.y = -0.55 + Math.abs(Math.sin(t * 3)) * 0.05
      } else {
        fighter.rotation.x = Math.min(Math.PI / 2.2, fighter.rotation.x + dt * 2.2)
        fighter.position.y = Math.max(-1.05, fighter.position.y - dt * 0.8)
      }

      if (headBuilt) {
        headPivot.rotation.x += (headVel.y * 0 - headPivot.rotation.x) * dt * 8
        headPivot.rotation.z += (-headVel.x * 0.6 - headPivot.rotation.z) * dt * 10
        headPivot.rotation.y += (headVel.x * 0.9 - headPivot.rotation.y) * dt * 10
        headPivot.position.z = headVel.z * -0.3
        headVel.x *= 1 - dt * 5
        headVel.y *= 1 - dt * 5
        headVel.z *= 1 - dt * 6
        squash = Math.max(0, squash - dt * 4)
        const s = 1 - squash * 0.25
        headPivot.scale.set(1 + squash * 0.18, s, 1 + squash * 0.18)
        if (ko) headPivot.rotation.y += dt * 3
      }

      dizzy = Math.max(0, dizzy - dt * (ko ? 0 : 0.15))
      stars.forEach((sp, i) => {
        sp.visible = dizzy > 0.2
        const a = t * 4 + i * 2.1
        sp.position.set(Math.cos(a) * 0.95, 0.95 + Math.sin(t * 6 + i) * 0.07, Math.sin(a) * 0.6)
      })

      for (let i = teeth.length - 1; i >= 0; i--) {
        const tooth = teeth[i]
        if (!tooth) continue
        tooth.life += dt
        tooth.vel.y -= dt * 4.5
        tooth.mesh.position.addScaledVector(tooth.vel, dt)
        tooth.mesh.rotation.x += tooth.spin.x * dt
        tooth.mesh.rotation.y += tooth.spin.y * dt
        tooth.mesh.rotation.z += tooth.spin.z * dt
        if (tooth.life > 2 || tooth.mesh.position.y < -1.15) {
          scene.remove(tooth.mesh)
          teeth.splice(i, 1)
        }
      }

      if (!ko && started && mode === 'ai') {
        aiCooldown -= dt
        if (aiCooldown <= 0) tryAiPunch()
      }

      const headWorld = new THREE.Vector3()
      myGloves.forEach((g, i) => {
        const u = g.userData as GloveUserData
        if (u.active) {
          u.t += dt * 4.2
          headPivot.getWorldPosition(headWorld)
          const target = headWorld.clone()
          target.z += 0.7
          target.x += u.side * 0.15
          if (u.t < 1) {
            g.position.lerpVectors(u.rest, target, THREE.MathUtils.smoothstep(u.t, 0, 1))
            if (u.t >= 0.92 && !u.hit) {
              u.hit = true
              if (mode !== 'pvp') landHit(u.side)
            }
          } else if (u.t < 2) {
            g.position.lerpVectors(target, u.rest, THREE.MathUtils.smoothstep(u.t - 1, 0, 1))
          } else {
            u.active = false
            u.hit = false
            g.position.copy(u.rest)
          }
        } else {
          const guard = guardPos[i]
          if (isGuardUp()) {
            g.position.lerp(guard, dt * 14)
          } else {
            g.position.lerp(u.rest, dt * 18)
            if (g.position.distanceTo(u.rest) < 0.08) {
              g.position.y = u.rest.y + Math.sin(t * 3 + u.side) * 0.06
            }
          }
        }
      })

      aiGloves.forEach((g) => {
        const u = g.userData as AiGloveUserData
        if (!u.active) return
        u.t += dt * 3.6
        if (u.t < 1) {
          g.position.lerpVectors(u.rest, u.target, THREE.MathUtils.smoothstep(u.t, 0, 1))
          if (u.t >= 0.9 && !u.hit) {
            u.hit = true
            const blocked = landPlayerHit(u.side)
            if (mode === 'pvp') {
              netRef.current?.sendHitResult({
                blocked,
                playerHp,
                side: u.side as -1 | 1,
              })
            }
          }
        } else if (u.t < 2) {
          g.position.lerpVectors(u.target, u.rest, THREE.MathUtils.smoothstep(u.t - 1, 0, 1))
        } else {
          u.active = false
          u.hit = false
          g.position.copy(u.rest)
          aiWindup = false
          aiCooldown = 1.4 + Math.random() * 2.4
        }
      })

      shake = Math.max(0, shake - dt * 4)
      camera.position.x = (Math.random() - 0.5) * shake * 0.15
      camera.position.y = 1.55 + (Math.random() - 0.5) * shake * 0.15

      renderer.render(scene, camera)
    }
    if (mode === 'pvp' && netRef.current) {
      netRef.current.setHandlers({
        onPeerPunch: (side) => incomingPunch(side),
        onPeerHitResult: ({ blocked, playerHp, side }) =>
          applyPeerHitResult(blocked, playerHp, side),
        onPeerRematch: () => rematchLocal(),
        onClose: () => showSplash('DISCONNECTED'),
      })
    }

    animate()

    return () => {
      cancelAnimationFrame(frameId)
      window.clearTimeout(startTimer)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onCanvasDown)
      btnLeft?.removeEventListener('pointerdown', onPunchLeft)
      btnRight?.removeEventListener('pointerdown', onPunchRight)
      guardBtn?.removeEventListener('pointerdown', onGuardDown)
      guardBtn?.removeEventListener('pointerup', onGuardUp)
      guardBtn?.removeEventListener('pointercancel', onGuardUp)
      guardBtn?.removeEventListener('pointerleave', onGuardUp)
      btnRematch?.removeEventListener('click', mode === 'pvp' ? rematchOnline : rematch)
      clearTeeth()
      toothGeo.dispose()
      toothMat.dispose()
      faceCanvasTex?.dispose()
      renderer.dispose()
    }
  }, [face.previewUrl, mode])

  return (
    <div ref={wrapRef} className="fight-screen">
      <canvas ref={canvasRef} className="fight-gl" />

      <div className="fight-hud">
        <div className="fight-hp-row">
          <div ref={portraitRef} className="fight-portrait" />
          <div className="fight-hp-shell">
            <div className="fight-hp-name">{mode === 'pvp' ? 'OPPONENT' : 'OPPONENT'}</div>
            <div className="fight-hp-bar">
              <div ref={hpRef} className="fight-hp-fill" />
            </div>
          </div>
        </div>
        <div className="fight-round">ROUND 1</div>
      </div>

      <div ref={splashRef} className="fight-splash">
        <span>FIGHT!</span>
      </div>
      <div ref={flashRef} className="fight-flash" />

      <p className="fight-hint">
        {mode === 'pvp'
          ? 'LAN PvP — punch: tap or buttons · hold GUARD or Space to block'
          : 'Punch: tap or buttons · hold GUARD (center) or Space to block'}
      </p>

      <div className="fight-controls">
        <button type="button" className="fight-punch" id="fight-pl">
          LEFT
          <br />
          PUNCH
        </button>
        <div className="fight-player-hud">
          {mode === 'pvp' && playerFace && (
            <div ref={playerPortraitRef} className="fight-portrait fight-portrait--player" />
          )}
          <button type="button" className="fight-guard" id="fight-guard">
            GUARD
          </button>
          <div className="fight-hp-name fight-hp-name--player">YOU</div>
          <div className="fight-hp-bar fight-hp-bar--player">
            <div ref={playerHpRef} className="fight-hp-fill fight-hp-fill--player" />
          </div>
        </div>
        <button type="button" className="fight-punch" id="fight-pr">
          RIGHT
          <br />
          PUNCH
        </button>
      </div>

      <div ref={koRef} className="fight-ko">
        <h2 ref={koTitleRef}>K.O.!</h2>
        <button type="button" className="fight-rematch" id="fight-rematch">
          Rematch
        </button>
      </div>

      <button type="button" className="fight-back" onClick={onBack}>
        {mode === 'pvp' ? '← Leave LAN' : '← Re-align face'}
      </button>
    </div>
  )
}
