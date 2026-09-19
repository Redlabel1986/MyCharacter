/**
 * Nebel des Krieges und Dunkelheit der 3D-Buehne.
 *
 * Aus `useBattle3DScene.ts` herausgeloest, weil der Shader-Teil fuer sich
 * steht und die Szene sonst unuebersichtlich wuerde. Bekommt den bereits
 * geladenen `three`-Namensraum herein, statt ihn ein zweites Mal zu
 * importieren.
 *
 * Drei Schichten, eine gemeinsame Maske:
 *   1. Bodenabdunklung — legt die Sicht multiplikativ auf Karte und Objekte.
 *      Weil die Maske das Mauer-Clipping schon enthaelt, sieht das aus wie
 *      harte Schlagschatten, kostet aber keine einzige Schattenkarte.
 *   2. Nebelbank — ein Gitter, dessen Scheitelpunkte nach Maskenwert
 *      angehoben werden. Man sieht von der Seite in sie hinein.
 *   3. Bodenschwaden — duenner, tief liegender Dunst mit eigener Drift.
 *
 * Die Maske stammt aus denselben Sichtpolygonen wie die 2D-Masken. Damit ist
 * konstruktiv ausgeschlossen, dass die 3D-Ansicht mehr verraet als die 2D-
 * Ansicht.
 */
import {
  buildFogGridFromCells,
  smoothFogGrid,
  fogMaskRGBA,
  light3dFor,
} from '~~/shared/battle-3d'

type ThreeNs = typeof import('three')

export interface FogInput {
  enabled: boolean
  cols: number
  rows: number
  visibleCells: Array<[number, number]>
  memoryCells: Array<[number, number]>
  blackoutCells: Array<[number, number]>
  /** Tageszeit — bestimmt Nebelfarbe und Staerke der Bodenabdunklung. */
  timeOfDay: string
  /** Braucht die Tageszeit eine Sichtmaske (Nacht)? */
  nightMask: boolean
  /** Der DM sieht Verdecktes abgeschwaecht statt undurchdringlich. */
  isDm: boolean
}

export interface FogLayer {
  setInput(input: FogInput): void
  setMistEnabled(on: boolean): void
  setReducedMotion(on: boolean): void
  /** Wird pro Frame mit der Laufzeit in Sekunden gerufen. */
  update(tSec: number): void
  dispose(): void
}

/**
 * Breite der Boeschung in Zellen. Wirkt AUSSCHLIESSLICH auf die Hoehe der
 * Nebelbank (Kanal R der Maske). Deckkraft und Bodenabdunklung lesen den
 * harten Kanal G — sonst waere die Boeschung ein Informationsleck.
 */
const SLOPE_CELLS = 2.5
/** Hoehe der Nebelbank in Zellen. */
const BANK_HEIGHT = 2.2
/** Hoechste Gitterfeinheit je Achse — daraus ergibt sich die Dreieckszahl. */
const MAX_SEGMENTS = 160

/**
 * Wertrauschen mit drei Oktaven. Bewusst per Hash statt per Textur: eine
 * Rauschtextur waere ein weiterer Ladevorgang und ein weiterer Speicherposten
 * fuer etwas, das sechs Zeilen GLSL erledigen.
 */
const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, float t) {
  float v = 0.0;
  v += 0.55 * vnoise(p * 1.0 + vec2(t * 0.06, t * 0.03));
  v += 0.30 * vnoise(p * 2.3 - vec2(t * 0.09, t * 0.05));
  v += 0.15 * vnoise(p * 4.7 + vec2(t * 0.04, -t * 0.08));
  return v;
}
`

export function createFogLayer(
  THREE: ThreeNs,
  scene: import('three').Scene,
  opts: { cols: number; rows: number; onNeedsRender: () => void },
): FogLayer {
  const { cols, rows, onNeedsRender } = opts

  // --- Maskentextur ------------------------------------------------------
  let maskTex: import('three').DataTexture | null = null
  let maskCols = 0
  let maskRows = 0

  const ensureMask = (c: number, r: number) => {
    if (maskTex && maskCols === c && maskRows === r) return maskTex
    maskTex?.dispose()
    maskCols = c
    maskRows = r
    const tex = new THREE.DataTexture(new Uint8Array(c * r * 4), c, r, THREE.RGBAFormat)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    maskTex = tex
    return tex
  }

  // --- Gemeinsame Uniforms ----------------------------------------------
  const uMask = { value: null as import('three').Texture | null }
  const uTime = { value: 0 }
  const uFogNear = { value: new THREE.Color(0xdcdfe2) }
  const uFogFar = { value: new THREE.Color(0xf4f6f8) }
  const uDark = { value: new THREE.Color(0x222833) }
  const uDarkAmount = { value: 0 }
  const uBankHeight = { value: BANK_HEIGHT }
  const uNoiseScale = { value: 0.35 }

  // --- 1. Bodenabdunklung ------------------------------------------------
  // Eine eigene Ebene mit Multiply-Blending statt eines Eingriffs in das
  // Standardmaterial der Karte: ein misslungener Shader-Patch am eingebauten
  // Material wuerde die Karte schwarz rendern, und das faellt erst am
  // Bildschirm auf. Diese Ebene kann hoechstens unsichtbar bleiben.
  const darkGeo = new THREE.PlaneGeometry(cols, rows)
  darkGeo.rotateX(-Math.PI / 2)
  const darkMat = new THREE.ShaderMaterial({
    uniforms: { uMask, uDark, uDarkAmount },
    transparent: true,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform vec3 uDark;
      uniform float uDarkAmount;
      varying vec2 vUv;
      void main() {
        // Kanal G: die HARTE Maske. Niemals R — die Boeschung wuerde Zellen
        // aufhellen, die der Spieler nicht sehen darf.
        float m = texture2D(uMask, vUv).g;
        vec3 c = mix(vec3(1.0), uDark, m * uDarkAmount);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  const darkMesh = new THREE.Mesh(darkGeo, darkMat)
  // Ueber Karte (0) und Objekten (0.005), unter den Figuren.
  darkMesh.position.y = 0.012
  darkMesh.renderOrder = 2
  darkMesh.visible = false
  darkMesh.raycast = () => {}
  scene.add(darkMesh)

  // --- 2. Nebelbank ------------------------------------------------------
  const segX = Math.min(MAX_SEGMENTS, Math.max(8, cols * 2))
  const segY = Math.min(MAX_SEGMENTS, Math.max(8, rows * 2))
  // Geometrie schon flach drehen statt das Mesh: danach ist lokales +Y auch
  // Welt-Oben, und der Vertex-Shader kann direkt auf position.y schieben.
  const bankGeo = new THREE.PlaneGeometry(cols, rows, segX, segY)
  bankGeo.rotateX(-Math.PI / 2)

  const bankMat = new THREE.ShaderMaterial({
    uniforms: { uMask, uTime, uFogNear, uFogFar, uBankHeight, uNoiseScale },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform float uBankHeight;
      varying vec2 vUv;
      varying float vFog;
      varying float vHeight;
      varying vec3 vLocal;
      void main() {
        vUv = uv;
        // R = geboescht: gibt der Bank ihre weiche Flanke statt einer Treppe.
        // G = hart: entscheidet ueber die Deckkraft im Fragment-Programm.
        vec2 m = texture2D(uMask, uv).rg;
        vFog = m.g;
        vec3 p = position;
        p.y += m.r * uBankHeight;
        vHeight = p.y;
        vLocal = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogNear;
      uniform vec3 uFogFar;
      uniform float uBankHeight;
      uniform float uNoiseScale;
      varying vec2 vUv;
      varying float vFog;
      varying float vHeight;
      varying vec3 vLocal;
      ${NOISE_GLSL}
      void main() {
        if (vFog < 0.06) discard;
        float n = fbm(vLocal.xz * uNoiseScale, uTime);
        // Hoehennebel: unten dichter und dunkler, oben ausfransend.
        float hk = clamp(vHeight / max(uBankHeight, 0.001), 0.0, 1.0);
        vec3 col = mix(uFogNear, uFogFar, hk);
        float a = smoothstep(0.12, 0.72, vFog);
        a *= mix(0.72, 1.0, n);
        a *= mix(1.0, 0.82, hk);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
  })
  const bankMesh = new THREE.Mesh(bankGeo, bankMat)
  bankMesh.position.y = 0.02
  bankMesh.renderOrder = 3
  bankMesh.visible = false
  bankMesh.raycast = () => {}
  scene.add(bankMesh)

  // --- 3. Bodenschwaden --------------------------------------------------
  const mistGeo = new THREE.PlaneGeometry(cols, rows, 1, 1)
  mistGeo.rotateX(-Math.PI / 2)
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { uMask, uTime, uFogNear, uNoiseScale },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocal;
      void main() {
        vUv = uv;
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform float uTime;
      uniform vec3 uFogNear;
      uniform float uNoiseScale;
      varying vec2 vUv;
      varying vec3 vLocal;
      ${NOISE_GLSL}
      void main() {
        float m = texture2D(uMask, vUv).g;
        // Andere Driftrichtung als die Bank, sonst wirkt es wie eine Tapete.
        float n = fbm(vLocal.xz * uNoiseScale * 0.7 - vec2(uTime * 0.05, uTime * 0.02), uTime * 0.6);
        float a = (0.05 + m * 0.2) * smoothstep(0.25, 0.85, n);
        if (a < 0.005) discard;
        gl_FragColor = vec4(uFogNear, a);
      }
    `,
  })
  const mistMesh = new THREE.Mesh(mistGeo, mistMat)
  mistMesh.position.y = 0.08
  mistMesh.renderOrder = 4
  mistMesh.visible = false
  mistMesh.raycast = () => {}
  scene.add(mistMesh)

  // --- Zustand -----------------------------------------------------------
  let mistEnabled = true
  let reducedMotion = false
  let active = false

  const setInput = (input: FogInput) => {
    const light = light3dFor(input.timeOfDay)
    uFogNear.value.setHex(light.fogNear)
    uFogFar.value.setHex(light.fogFar)

    // Die Schichten arbeiten nur, wenn Fog of War laeuft ODER die Tageszeit
    // eine Sichtmaske verlangt (Nacht). Sonst ist die Karte frei.
    active = input.enabled || input.nightMask
    if (!active) {
      darkMesh.visible = false
      bankMesh.visible = false
      mistMesh.visible = false
      onNeedsRender()
      return
    }

    const c = Math.max(1, input.cols)
    const r = Math.max(1, input.rows)
    const grid = buildFogGridFromCells(
      c,
      r,
      input.visibleCells,
      input.memoryCells,
      input.blackoutCells,
    )
    const sloped = smoothFogGrid(grid, SLOPE_CELLS)
    const tex = ensureMask(c, r)
    // flipY: eine DataTexture wendet die Eigenschaft nicht an, die Karten-
    // textur (ein Bild) schon. Ohne die Umkehr laege der Nebel spiegelbildlich.
    const rgba = fogMaskRGBA(sloped, grid, true)
    ;(tex.image.data as Uint8Array).set(rgba)
    tex.needsUpdate = true
    uMask.value = tex

    // Der DM soll sehen, was er verwaltet — fuer ihn ist alles nur angedeutet.
    uDark.value.setHex(light.groundColor)
    uDarkAmount.value = input.isDm ? 0.35 : 1 - light.groundDark
    const bankOpacity = input.isDm ? 0.45 : 1
    bankMat.uniforms.uBankHeight!.value = BANK_HEIGHT * bankOpacity

    darkMesh.visible = true
    bankMesh.visible = true
    mistMesh.visible = mistEnabled
    onNeedsRender()
  }

  const setMistEnabled = (on: boolean) => {
    mistEnabled = on
    mistMesh.visible = on && active
    onNeedsRender()
  }

  const setReducedMotion = (on: boolean) => {
    reducedMotion = on
    onNeedsRender()
  }

  const update = (tSec: number) => {
    if (reducedMotion) return
    uTime.value = tSec
  }

  const dispose = () => {
    for (const m of [darkMesh, bankMesh, mistMesh]) {
      scene.remove(m)
      m.geometry.dispose()
      ;(m.material as import('three').Material).dispose()
    }
    maskTex?.dispose()
    maskTex = null
  }

  return { setInput, setMistEnabled, setReducedMotion, update, dispose }
}
