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
  erodeOpenArea,
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
/**
 * Breite der Abdunklungs-Boeschung in Zellen. Kleiner als die der Bank: sie
 * frisst in den SICHTBAREN Bereich hinein, und zu viel davon naehme dem
 * Spieler Sicht, die ihm zusteht.
 */
const DARK_SLOPE_CELLS = 1.2
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
  // Drei Oktaven, die unterschiedlich schnell und in verschiedene Richtungen
  // ziehen. Wuerden sie gleich driften, schoebe sich eine Tapete ueber die
  // Karte statt zu wabern.
  v += 0.55 * vnoise(p * 1.0 + vec2(t * 0.16, t * 0.09));
  v += 0.30 * vnoise(p * 2.3 - vec2(t * 0.24, t * 0.13));
  v += 0.15 * vnoise(p * 4.7 + vec2(t * 0.11, -t * 0.21));
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
  const uFogNear = { value: new THREE.Color(0xdfe5ea) }
  const uFogFar = { value: new THREE.Color(0xfbfdff) }
  const uDark = { value: new THREE.Color(0xdfe5ea) }
  // Anfangs 0: solange `setInput` nicht gelaufen ist, ist der Schleier
  // vollstaendig durchsichtig. Die Deckkraft ist das einzige, was ueber
  // Sichtbarkeit entscheidet — nie die Farbe.
  const uDarkAmount = { value: 0 }
  const uBankHeight = { value: BANK_HEIGHT }
  const uNoiseScale = { value: 0.35 }
  const uMaxAlpha = { value: 0.88 }

  // --- 1. Bodenabdunklung ------------------------------------------------
  /*
   * Der flache Schleier unter der Bank. Er schliesst die Flaeche, die man von
   * oben sieht; die Bank allein waere von steil oben nur eine duenne Haut.
   *
   * Entscheidend ist die Konstruktion, nicht die Farbe: die Sichtbarkeit
   * haengt AUSSCHLIESSLICH an der Deckkraft aus der Maske. Ueber aufgedecktem
   * Boden ist die 0, das Fragment faellt weg, die Karte liegt frei — egal wie
   * hell der Nebel eingefaerbt ist.
   *
   * Vorher stand hier eine Ebene mit Multiply-Blending, die WEISS ausgab, wo
   * nichts verdeckt werden sollte, und sich darauf verliess, dass das Blending
   * sie unsichtbar macht. Griff das nicht, lag opakes Weiss ueber dem gesamten
   * Brett — auch ueber den aufgedeckten Feldern. Deshalb entscheidet jetzt das
   * Alpha und nicht die Farbe.
   */
  const darkGeo = new THREE.PlaneGeometry(cols, rows)
  darkGeo.rotateX(-Math.PI / 2)
  const darkMat = new THREE.ShaderMaterial({
    uniforms: { uMask, uDark, uDarkAmount, uTime, uNoiseScale },
    transparent: true,
    depthWrite: false,
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
      uniform vec3 uDark;
      uniform float uDarkAmount;
      uniform float uTime;
      uniform float uNoiseScale;
      varying vec2 vUv;
      varying vec3 vLocal;
      ${NOISE_GLSL}
      void main() {
        // Kanal B: die nach INNEN erodierte Maske. Sie hat eine weiche Kante
        // (keine Rasterzellen-Treppe) und ist dabei nachweislich nie
        // durchlaessiger als die harte Sichtgrenze in G.
        float m = texture2D(uMask, vUv).b;
        float a = m * uDarkAmount;
        if (a < 0.004) discard;
        // Dasselbe Rauschen wie in der Bank, damit der Schleier mit ihr
        // gemeinsam atmet statt als glatte Flaeche darunter zu liegen.
        float n = fbm(vLocal.xz * uNoiseScale * 0.85 + vec2(uTime * 0.05, -uTime * 0.07), uTime);
        a *= mix(0.78, 1.0, n);
        gl_FragColor = vec4(uDark, clamp(a, 0.0, 1.0));
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
    uniforms: { uMask, uTime, uFogNear, uFogFar, uBankHeight, uNoiseScale, uMaxAlpha },
    // Beidseitig, damit man auch von innen in die Bank hineinsieht, wenn die
    // Kamera flach steht.
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform float uBankHeight;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFog;
      varying float vHeight;
      varying vec3 vLocal;
      void main() {
        vUv = uv;
        // R = geboescht. Die Bank nimmt sie fuer HOEHE UND DECKKRAFT: sie ist
        // blickdichter Dunst, der nichts vom Boden preisgibt — wie weich ihre
        // Kante ausfranst, verraet also nichts. Ueber aufgedecktem Boden ist
        // R gleich 0, dort faellt die Bank also restlos weg.
        float m = texture2D(uMask, uv).r;
        vFog = m;
        vec3 p = position;

        // Das eigentliche Wabern: die Oberflaeche der Bank hebt und senkt
        // sich in langsamen, gegenlaeufigen Wellen. Ohne das bliebe der Nebel
        // eine Decke mit driftender Zeichnung — Bewegung entsteht erst, wenn
        // sich die Silhouette veraendert.
        float wobble =
          0.16 * sin(p.x * 0.31 + uTime * 0.55) * cos(p.z * 0.27 - uTime * 0.41) +
          0.09 * sin(p.z * 0.63 + uTime * 0.83) +
          0.06 * cos(p.x * 0.91 - uTime * 1.07);
        p.y += m * uBankHeight * (1.0 + wobble);

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
      uniform float uMaxAlpha;
      varying vec2 vUv;
      varying float vFog;
      varying float vHeight;
      varying vec3 vLocal;
      ${NOISE_GLSL}
      void main() {
        // Ueber aufgedecktem Boden ist die Maske 0 — hier faellt die Bank weg,
        // und die Karte liegt frei. Das ist die einzige Stelle, an der das
        // entschieden wird.
        if (vFog < 0.04) discard;
        float n = fbm(vLocal.xz * uNoiseScale, uTime);
        // Hoehennebel: unten dichter, oben ausfransend.
        float hk = clamp(vHeight / max(uBankHeight, 0.001), 0.0, 1.0);
        vec3 col = mix(uFogNear, uFogFar, hk);
        // Weiche Flanke ueber die ganze Boeschungsbreite — genau das, was die
        // Treppenkante verhindert.
        float a = smoothstep(0.02, 0.8, vFog);
        // Kraeftiges Rauschen: die Schwaden sollen sichtbar dichter und
        // duenner werden, nicht nur leicht marmoriert sein.
        a *= mix(0.42, 1.12, n);
        // Oben duenner werden lassen, sonst steht dort eine harte Deckflaeche.
        a *= mix(1.0, 0.3, hk * hk);
        gl_FragColor = vec4(col, clamp(a * uMaxAlpha, 0.0, 1.0));
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
        float m = texture2D(uMask, vUv).r;
        // Streng an den Nebel gekoppelt — kein Grundschleier. Sonst legte
        // sich Dunst auch ueber die sichtbaren Bereiche und truebte genau
        // die Karte, die man sehen will.
        if (m < 0.04) discard;
        // Andere Driftrichtung und -geschwindigkeit als die Bank, sonst wirkt
        // es wie eine Tapete, die sich mitschiebt.
        float n = fbm(vLocal.xz * uNoiseScale * 0.7 - vec2(uTime * 0.13, uTime * 0.06), uTime * 0.6);
        float a = m * 0.3 * smoothstep(0.2, 0.8, n);
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
    // Die Abdunklung boescht NACH INNEN: so bekommt auch sie eine weiche
    // Kante, ohne je eine vernebelte Zelle aufzuhellen. Ohne das steht dort
    // eine Treppe aus Rasterzellen.
    const darkening = erodeOpenArea(grid, DARK_SLOPE_CELLS)
    const tex = ensureMask(c, r)
    // flipY: eine DataTexture wendet die Eigenschaft nicht an, die Karten-
    // textur (ein Bild) schon. Ohne die Umkehr laege der Nebel spiegelbildlich.
    const rgba = fogMaskRGBA(sloped, grid, darkening, true)
    ;(tex.image.data as Uint8Array).set(rgba)
    tex.needsUpdate = true
    uMask.value = tex

    // Der DM soll sehen, was er verwaltet. In der 2D-Ansicht liegt sein
    // Nebel bei 22 % Deckkraft, der des Spielers bei 78 % — dieselbe
    // Groessenordnung gilt hier, sonst sieht der DM in 3D weniger als in 2D.
    uDark.value.setHex(light.fogNear)
    uDarkAmount.value = input.isDm ? 0.24 : light.fogVeil
    uMaxAlpha.value = input.isDm ? 0.3 : 0.85
    // Fuer den DM eine flachere Bank: sie soll andeuten, nicht verdecken.
    uBankHeight.value = input.isDm ? BANK_HEIGHT * 0.5 : BANK_HEIGHT

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
