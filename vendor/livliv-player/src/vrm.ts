// @livliv-dev/player/vrm: a VRM (the open 3D avatar format: VRoid and others) on a BodyPlayer (@livliv-dev/player/body), drawn with
// three.js and @pixiv/three-vrm, which the page installs (optional peer dependencies) and which load only here. The
// shared params become its pose: the head and neck turn and tilt (angleX / Y / Z), the spine sways (bodyX / Z), the
// eyes blink (eyeLOpen / ROpen) and look (eyeBallX / Y), the mouth takes the visemes (mouthOpen with its vowel: aa open,
// ee wide, ou round), the face its expressions (happy with smile; angry, sad, relaxed, surprised); its hair and clothes
// swing by the model's own spring bones. Framed from the head down to the hips, arms down. VRM 1.0 and 0.x, whoever
// exported them; a file is looked through before three.js parses it (checkGlb).
import { projectedAnchor, type AnchorName, type AttachmentAnchor } from './anchors'
import { VrmExpressionPolicy } from '../charadock-vrm-expression-policy'
import type * as T from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Body, BodyExpression, BodyMeta, Pose } from './body'
import { LivLivError, type LivLivErrorCode } from './errors'

const FEELINGS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'] as const
const LABELS: Record<(typeof FEELINGS)[number], Record<string, string>> = {
  happy: { en: 'Happy', zh: '开心', 'zh-Hant': '開心', ja: '喜び' },
  angry: { en: 'Angry', zh: '生气', 'zh-Hant': '生氣', ja: '怒り' },
  sad: { en: 'Sad', zh: '难过', 'zh-Hant': '難過', ja: '悲しい' },
  relaxed: { en: 'Relaxed', zh: '放松', 'zh-Hant': '放鬆', ja: 'リラックス' },
  surprised: { en: 'Surprised', zh: '惊讶', 'zh-Hant': '驚訝', ja: '驚き' },
}
const D = Math.PI / 180

/** what a VRM may hold before it is decoded: a real avatar stays far below these (VRoid: about 27 M pixels) */
export const VRM_LIMITS = { json: 32 * 2 ** 20, textureSide: 8192, texels: 512 * 2 ** 20, vertices: 16 * 2 ** 20 }

export interface VrmBodyOptions {
  framing?: 'bust' | 'head' | 'waist'

  /** given the GLTFLoader before it reads a file: for compressed files, register your decoders here (setDRACOLoader,
   *  setMeshoptDecoder, setKTX2Loader). The player itself ships none */
  configureLoader?: (loader: GLTFLoader) => void
}

/** the terms a VRM's author set (its meta, 1.0 and 0.x said alike, the file's own words in `raw`). A page playing other
 *  people's avatars should show them and keep to them */
export interface VrmTerms extends BodyMeta {
  /** the spec the file follows: '1' or '0' */
  spec: string
  /** who may play the avatar: only its author, people the author licensed, or everyone */
  use: 'author' | 'licensed' | 'everyone' | null
  /** the avatar in commercial work. 1.0 has grades, 0.x only allow and disallow */
  commercial: 'disallow' | 'personal non-profit' | 'personal profit' | 'allow' | 'corporation' | null
  violence: boolean | null
  sexual: boolean | null
  /** passing the file on, and changing it (1.0; null in 0.x, whose terms are in its licence) */
  redistribution: boolean | null
  modification: string | null
  raw: Record<string, unknown>
}

export class VrmBody implements Body {
  readonly format = 'vrm'
  private options: VrmBodyOptions
  /** VRM 0.x stands facing the other way, turned round by three-vrm: rotations about X and Z count the other way round */
  private flip = 1
  /** the file has only one blink, for both eyes */
  private blinkBoth = false
  /** the expressions the file adds to the preset ones: the id it goes by here -> its name in the file */
  private custom = new Map<string, string>()
  private THREE!: typeof T
  private vrm: VRM | null = null
  private scene!: T.Scene
  private camera!: T.PerspectiveCamera
  private renderer: T.WebGLRenderer | null = null
  private gl: WebGL2RenderingContext | null = null
  private bones: Partial<Record<'head' | 'neck' | 'spine' | 'chest', T.Object3D>> = {}
  /** the framing: the world height shown (m), and its center */
  private frame = { height: 1, y: 1 }
  private has = new Set<string>()
  private canvas: HTMLCanvasElement | null = null
  private anchors: Partial<Record<AnchorName, AttachmentAnchor>> = {}
  private headAt = { x: 0.5, y: 0.25 }
  private width = 0.6
  private center={x:0,z:0}
  private frames:Record<string,{height:number,y:number}>={}
  private expressionPolicy:VrmExpressionPolicy|null=null
  private diagnostics:any=null
  private motionEnabled=true
  private focalLengthMm: number | undefined

  constructor(options: VrmBodyOptions = {}) { this.options = options }

  attach(canvas: HTMLCanvasElement) {
    // the attributes render() gives three.js, which then finds this same context
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true })
    if (!gl) throw new LivLivError('no-webgl', 'LivLiv: a VRM needs WebGL2: this browser has none, or this canvas already draws in 2D (a PNGTuber)')
    this.gl = gl
    if (gl.isContextLost()) throw new LivLivError('context-lost', 'LivLiv: this canvas has lost its WebGL context: use a new canvas')
  }

  context() { return this.gl }

  async load(files: Map<string, Blob>) {
    const entry = [...files].find(([n]) => /\.(vrm|glb)$/i.test(n))
    if (!entry) throw new LivLivError('missing-file', 'LivLiv: no .vrm file among the files')
    await checkGlb(entry[1], entry[0], !this.options.configureLoader)
    const [THREE, { GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
      import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('@pixiv/three-vrm')]).catch((e) => {
      throw new LivLivError('unreachable', `LivLiv: could not load three or @pixiv/three-vrm, which a VRM needs: are they installed, and can this page reach them? (${(e as Error).message})`)
    })
    this.THREE = THREE
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    this.options.configureLoader?.(loader)
    const url = URL.createObjectURL(entry[1])
    let gltf
    try {
      gltf = await loader.loadAsync(url)
    } catch (e) {
      throw new LivLivError('not-a-model', `LivLiv: ${entry[0]} is not a VRM this player can read (${(e as Error).message})`, { cause: e })
    } finally {
      URL.revokeObjectURL(url)
    }
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) {
      VRMUtils.deepDispose(gltf.scene)
      throw new LivLivError('not-a-model', `LivLiv: ${entry[0]} is a glTF without VRM data (exported as plain glTF? VRM exporters write a .vrm)`)
    }
    let meshes = 0
    vrm.scene.traverse((o) => { if ((o as T.Mesh).isMesh) meshes++ })
    if (!meshes) {
      VRMUtils.deepDispose(gltf.scene)
      throw new LivLivError('invalid', `LivLiv: ${entry[0]} has a skeleton but no mesh, so there is nothing to draw (export the armature together with its meshes)`)
    }
    // the new character, apart from the one shown (a failed load leaves that on the canvas): it takes over at the end
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)  // VRM 0.x faces the other way
    vrm.scene.traverse((o) => { o.frustumCulled = false })
    const h = vrm.humanoid
    const flip = vrm.meta?.metaVersion === '0' ? -1 : 1
    const bones: typeof this.bones = {}
    for (const b of ['head', 'neck', 'spine', 'chest'] as const) bones[b] = h.getNormalizedBoneNode(b) ?? undefined
    // arms down from the T pose, a little forward
    const lu = h.getNormalizedBoneNode('leftUpperArm'), ru = h.getNormalizedBoneNode('rightUpperArm')
    if (lu) lu.rotation.set(0, 0, -1.2 * flip)
    if (ru) ru.rotation.set(0, 0, 1.2 * flip)
    const ll = h.getNormalizedBoneNode('leftLowerArm'), rl = h.getNormalizedBoneNode('rightLowerArm')
    if (ll) ll.rotation.set(0, -0.25, 0)
    if (rl) rl.rotation.set(0, 0.25, 0)
    if (vrm.lookAt) vrm.lookAt.autoUpdate = false
    vrm.update(0)

    const scene = new THREE.Scene()
    scene.add(vrm.scene)
    const light = new THREE.DirectionalLight(0xffffff, Math.PI)
    light.position.set(1, 1, 1).normalize()
    scene.add(light, new THREE.AmbientLight(0xffffff, 0.6))
    // the head's top to the hips: what a LivLiv character's canvas shows of a person
    // in the model's own units, whatever they are (an exporter's unit can make a character 170 long), and its own shape
    // (a head as big as the rest of it)
    const at = (b: 'head' | 'hips' | 'chest' | 'leftUpperArm' | 'rightUpperArm') => { const v = new THREE.Vector3(); h.getNormalizedBoneNode(b)?.getWorldPosition(v); return v }
    const head = at('head'), hips = at('hips'), torso = Math.max(1e-3, head.y - hips.y)
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const crown = Number.isFinite(box.max.y) ? box.max.y : head.y
    const top = Math.max(head.y + torso / 3, crown + torso / 20), bottom = hips.y
    const shoulders = at('leftUpperArm').distanceTo(at('rightUpperArm'))
    const has = new Set((vrm.expressionManager?.expressions ?? []).map((e) => e.expressionName))
    const meta = vrm.meta as { name?: string; title?: string } | undefined
    const expressions: BodyExpression[] = FEELINGS.filter((f) => f !== 'happy' && has.has(f)).map((f) => ({ id: f, label: LABELS[f].en, labels: LABELS[f] }))
    if (has.has('happy')) expressions.unshift({ id: 'happy', label: LABELS.happy.en, labels: LABELS.happy })
    // what the file adds of its own, under the name it gives; a feeling 0.x has no preset for (VRoid's Surprised) by our id
    const custom = new Map<string, string>()
    for (const n of Object.keys(vrm.expressionManager?.customExpressionMap ?? {})) {
      const lower = n.toLowerCase(), id = (FEELINGS as readonly string[]).includes(lower) ? lower : n
      custom.set(id, n)
      if (!expressions.some((x) => x.id === id)) expressions.push(id === lower && id in LABELS ? { id, label: LABELS[id as keyof typeof LABELS].en, labels: LABELS[id as keyof typeof LABELS] } : { id, label: n })
    }
    // an exporter's placeholder is no name ("undefined": VRM Add-on for Blender, until it is filled in)
    const given = (meta?.name || meta?.title || '').trim()
    const name = (given && given !== 'undefined' ? given : entry[0].replace(/\.(vrm|glb)$/i, '')).slice(0, 200)

    const old = this.vrm
    this.vrm = vrm
    this.anchors = {}
    this.scene = scene
    this.bones = bones
    this.has = has
    this.custom = custom
    this.blinkBoth = has.has('blink') && !(has.has('blinkLeft') && has.has('blinkRight'))
    this.flip = flip
    const chest=h.getNormalizedBoneNode('chest')?at('chest'):hips.clone().lerp(head,.55)
    const bustBottom=Math.max(hips.y+torso*.3,chest.y-torso*.12)
    const make=(low:number)=>({height:Math.max(1e-3,top-low),y:(top+low)/2})
    this.frames={waist:make(bottom),bust:make(bustBottom),head:make(head.y-torso*.22)}
    this.frame=this.frames[this.options.framing||'waist']
    this.center={x:head.x,z:head.z}
    this.width=Math.max(shoulders*1.25,this.frame.height*.65)
    this.expressionPolicy=vrm.expressionManager?new VrmExpressionPolicy(vrm.expressionManager):null
    this.camera = new THREE.PerspectiveCamera(20, 2 / 3, this.frame.height / 100, this.frame.height * 100)
    this.place(2 / 3)  // render() gives it the canvas's aspect
    if (old) VRMUtils.deepDispose(old.scene)
    return { name, expressions, meta: vrmTerms(vrm.meta as unknown as Record<string, unknown>) }
  }

  /** the camera where the framing fits the canvas's aspect */
  private place(aspect: number) {
    const c = this.camera, half = this.frame.height / 2
    // Use the 24 mm height of a 36 × 24 mm frame. Crop width with the canvas aspect,
    // and move the camera so the same area fits at the focus plane for every lens.
    const halfAngle = this.focalLengthMm === undefined ? 10 * D : Math.atan(12 / this.focalLengthMm)
    const dist = Math.max(half, this.width / 2 / aspect) / Math.tan(halfAngle)
    c.fov = 2 * halfAngle / D
    c.aspect = aspect
    c.far = Math.max(this.frame.height * 100, dist + this.frame.height * 4)
    c.position.set(this.center.x, this.frame.y, this.center.z+dist)
    c.lookAt(this.center.x, this.frame.y, this.center.z)
    c.updateProjectionMatrix()
  }

  render(canvas: HTMLCanvasElement, { params: P, move, expr }: Pose, w: number, h: number, dt: number) {
    const THREE = this.THREE, vrm = this.vrm
    if (!vrm) return
    if (!this.renderer || this.canvas !== canvas) {
      this.renderer?.dispose()
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true })
      this.renderer.setClearColor(0x000000, 0)
      this.canvas = canvas
    }
    if (canvas.width !== w || canvas.height !== h) this.renderer.setSize(w, h, false)
    if (this.camera.aspect !== w / h) this.place(w / h)  // a new character's camera, on a canvas already this size too
    const b = this.bones, s = this.flip
    // the head turns most, the neck some (yaw: to the screen's right; pitch: up; roll: its top to the screen's right, as a
    // Player's does). The neck is optional in VRM: without one the head takes it all
    const hk = b.neck ? 0.65 : 1
    b.neck?.rotation.set(-s * P.angleY * D * 0.35, P.angleX * D * 0.35, -s * P.angleZ * D * 0.35)
    b.head?.rotation.set(-s * P.angleY * D * hk, P.angleX * D * hk, -s * P.angleZ * D * hk)
    b.spine?.rotation.set(0, P.bodyX * D * 0.8, -s * P.bodyZ * D * 0.8)
    b.chest?.rotation.set(-s * (P.breath - 0.5) * 0.02, 0, 0)
    vrm.scene.position.set(move.x*this.frame.height*.5+this.center.x*(1-move.s), move.y*this.frame.height+this.frame.y*(1-move.s),this.center.z*(1-move.s))
    vrm.scene.scale.setScalar(move.s)
    const em = vrm.expressionManager
    if (em) {
      const set = (n: string, v: number) => { if (this.has.has(n)) em.setValue(n, Math.max(0, Math.min(1, v))) }
      if (this.blinkBoth) set('blink', 1 - Math.max(P.eyeLOpen, P.eyeROpen))
      else { set('blinkLeft', 1 - P.eyeLOpen); set('blinkRight', 1 - P.eyeROpen) }
      const o = P.mouthOpen, v = P.vowel
      // wide and round: the file's ee and ou, or else its ih and oh
      set('aa', o * (1 - Math.abs(v) * 0.6)); set(this.has.has('ee') ? 'ee' : 'ih', o * Math.max(0, v) * 0.7); set(this.has.has('ou') ? 'ou' : 'oh', o * Math.max(0, -v) * 0.7)
      const wanted={...expr};for(const [id,name] of this.custom)if(expr[id])wanted[name]=expr[id]
      this.diagnostics=this.expressionPolicy?.apply(P,wanted,dt)||null

    }
    // three-vrm's pitch is positive looking down
    if (vrm.lookAt) { vrm.lookAt.yaw = P.eyeBallX * 25; vrm.lookAt.pitch = -P.eyeBallY * 15 }
    vrm.update(this.motionEnabled?dt:0)
    this.renderer.render(this.scene, this.camera)
    // where the head is now, for the pointer
    const p = new THREE.Vector3()
    b.head?.getWorldPosition(p)
    p.y += 0.06
    p.project(this.camera)
    this.headAt = { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }
    // attachment points: the posed bones, through the same camera
    for (const name of ['head', 'body'] as const) {
      const bone = name === 'head' ? b.head : b.chest ?? b.spine
      if (!bone) { delete this.anchors[name]; continue }
      const point = (x: number): [number, number] => {
        const p = bone.localToWorld(new THREE.Vector3(x, name === 'head' ? this.frame.height * .075 : 0, 0)).project(this.camera)
        return [(p.x + 1) / 2, (1 - p.y) / 2]
      }
      this.anchors[name] = projectedAnchor(point(0), point(this.frame.height * (name === 'head' ? .1 : .2) * s), h / w)
    }
  }

  setMotionEnabled(enabled:boolean){if(this.motionEnabled!==enabled){this.motionEnabled=enabled;if(!enabled)this.vrm?.springBoneManager?.reset();}}
  setFraming(mode: 'bust' | 'head' | 'waist', focalLengthMm?: number) {
    const frame = this.frames[mode]
    if (!frame || (this.frame === frame && this.focalLengthMm === focalLengthMm)) return
    this.frame = frame
    this.focalLengthMm = focalLengthMm
    this.place(this.camera.aspect)
  }
  status() {
   const em=this.vrm?.expressionManager;
   // Read the actual mesh influences through registered binds, independent of
   // exporter-specific morph names (including VRM 0.x).
   const morphMax=(names:string[])=>Math.max(0,...names.flatMap(name=>em?.getExpression(name)?.binds.flatMap((bind:any)=>(bind.primitives||[]).map((mesh:any)=>mesh.morphTargetInfluences?.[bind.index]||0))||[]));
   const mouthMorphMax=morphMax(['aa','ih','ou','ee','oh']),blinkMorphMax=morphMax(['blink','blinkLeft','blinkRight']);
   const camera = this.camera && {
    focalLengthMm: this.focalLengthMm,
    verticalFov: this.camera.fov,
    distance: this.camera.position.z - this.center.z,
   };
   return {framing:this.frame,camera,expressionPolicy:this.diagnostics,expressions:em?Object.fromEntries(em.expressions.map(e=>[e.expressionName,em.getValue(e.expressionName)])):null,head:this.headAt,mouthMorphMax,blinkMorphMax};
  }

  head() { return { ...this.headAt, rx: 0.14, ry: 0.1 } }

  anchor(name: AnchorName) { return this.anchors[name] ? { ...this.anchors[name] } : null }

  dispose() {
    this.anchors = {}
    this.renderer?.dispose(); this.renderer = null; this.canvas = null
    const vrm = this.vrm
    this.vrm = null
    if (vrm) void import('@pixiv/three-vrm').then(({ VRMUtils }) => VRMUtils.deepDispose(vrm.scene))
  }
}

/** the VRM's meta in one shape, whichever spec wrote it */
export function vrmTerms(m: Record<string, unknown> | undefined): VrmTerms | undefined {
  if (!m) return undefined
  const text = (v: unknown) => (typeof v === 'string' && v.trim() && v !== 'undefined' ? v.trim() : undefined)
  const yes = (v: unknown) => (typeof v === 'boolean' ? v : v === 'Allow' ? true : v === 'Disallow' ? false : null)
  if (m.metaVersion === '0') {
    const url = text(m.otherLicenseUrl), id = text(m.licenseName)
    return {
      spec: '0', author: text(m.author) ? { name: text(m.author)! } : null, license: id || url ? { id, url } : null,
      use: m.allowedUserName === 'Everyone' ? 'everyone' : m.allowedUserName === 'ExplicitlyLicensedPerson' ? 'licensed' : m.allowedUserName === 'OnlyAuthor' ? 'author' : null,
      commercial: m.commercialUssageName === 'Allow' ? 'allow' : m.commercialUssageName === 'Disallow' ? 'disallow' : null,
      violence: yes(m.violentUssageName), sexual: yes(m.sexualUssageName), redistribution: null, modification: null, raw: m,
    }
  }
  const authors = (Array.isArray(m.authors) ? m.authors : []).map(text).filter(Boolean)
  const url = text(m.licenseUrl)
  return {
    spec: '1', author: authors.length ? { name: authors.join(', ') } : null, license: url ? { url } : null,
    use: m.avatarPermission === 'everyone' ? 'everyone' : m.avatarPermission === 'onlySeparatelyLicensedPerson' ? 'licensed' : m.avatarPermission === 'onlyAuthor' ? 'author' : null,
    commercial: m.commercialUsage === 'corporation' ? 'corporation' : m.commercialUsage === 'personalProfit' ? 'personal profit' : m.commercialUsage === 'personalNonProfit' ? 'personal non-profit' : null,
    violence: yes(m.allowExcessivelyViolentUsage), sexual: yes(m.allowExcessivelySexualUsage), redistribution: yes(m.allowRedistribution),
    modification: text(m.modification) ?? null, raw: m,
  }
}

const COMPRESSED: Record<string, string> = { KHR_draco_mesh_compression: 'Draco', EXT_meshopt_compression: 'Meshopt', KHR_texture_basisu: 'KTX2' }

/** a .vrm looked through before three.js sees it, as any file from anyone: a GLB, no outside files (it would make the page
 *  fetch them), its compression one the page can decode, and images and meshes within VRM_LIMITS, read from the file's
 *  headers before anything is decoded */
export async function checkGlb(file: Blob, name: string, noDecoders: boolean) {
  const bad = (why: string, code: LivLivErrorCode = 'invalid'): never => { throw new LivLivError(code, `LivLiv: ${name} ${why}`) }
  const head = new DataView(await file.slice(0, 20).arrayBuffer())
  if (head.byteLength < 20 || head.getUint32(0, true) !== 0x46546c67) bad('is not a VRM: it should begin as a binary glTF does', 'not-a-model')
  if (head.getUint32(4, true) !== 2) bad(`is a glTF of version ${head.getUint32(4, true)}, and VRM uses 2`, 'not-a-model')
  const jsonLen = head.getUint32(12, true)
  if (head.getUint32(16, true) !== 0x4e4f534a) bad('is damaged (no JSON where a binary glTF has it)')
  if (jsonLen > VRM_LIMITS.json) bad(`is not one this player reads: its JSON has ${jsonLen} bytes, more than ${VRM_LIMITS.json}`, 'too-large')
  if (20 + jsonLen > file.size) bad('is damaged or cut short')
  let gltf: { buffers?: { uri?: string }[]; images?: { uri?: string; bufferView?: number }[]; bufferViews?: { byteOffset?: number; byteLength?: number }[]
    accessors?: { count?: number }[]; meshes?: { primitives?: { attributes?: { POSITION?: number } }[] }[]; extensionsUsed?: string[] }
  try { gltf = JSON.parse(await file.slice(20, 20 + jsonLen).text()) } catch { return bad('is damaged (its JSON does not parse)') }
  for (const o of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
    if (o?.uri && !o.uri.startsWith('data:')) bad(`names a file outside itself (${String(o.uri).slice(0, 80)}), and a .vrm has to hold everything it needs`)
  }
  if (noDecoders) {
    for (const [ext, what] of Object.entries(COMPRESSED)) {
      if (gltf.extensionsUsed?.includes(ext)) bad(`is compressed with ${what}, and this page has no decoder for that. Export it uncompressed, or pass VrmBody a configureLoader`, 'missing-feature')
    }
  }
  const positions = new Set<number>()
  for (const m of gltf.meshes ?? []) for (const p of m?.primitives ?? []) if (typeof p?.attributes?.POSITION === 'number') positions.add(p.attributes.POSITION)
  let vertices = 0
  for (const i of positions) vertices += gltf.accessors?.[i]?.count ?? 0
  if (vertices > VRM_LIMITS.vertices) bad(`has ${vertices} vertices, more than ${VRM_LIMITS.vertices}`, 'too-large')
  // where the binary chunk starts, and each picture's size from its first bytes
  const binary = 20 + jsonLen + 8
  let texels = 0
  for (const im of gltf.images ?? []) {
    const bv = typeof im?.bufferView === 'number' ? gltf.bufferViews?.[im.bufferView] : undefined
    if (!bv) continue
    const size = await pictureSize(file.slice(binary + (bv.byteOffset ?? 0), binary + (bv.byteOffset ?? 0) + (bv.byteLength ?? 0)))
    if (!size) continue
    if (size[0] > VRM_LIMITS.textureSide || size[1] > VRM_LIMITS.textureSide || (texels += size[0] * size[1]) > VRM_LIMITS.texels) {
      bad(`has pictures too large for this player (${size[0]} x ${size[1]}; ${VRM_LIMITS.textureSide} px a side and ${VRM_LIMITS.texels} pixels in all at most)`, 'too-large')
    }
  }
}

/** width and height from the start of a PNG or a JPEG (other kinds: unknown, left to the browser) */
async function pictureSize(b: Blob): Promise<[number, number] | null> {
  const d = new DataView(await b.slice(0, 64 * 1024).arrayBuffer())
  if (d.byteLength >= 24 && d.getUint32(0) === 0x89504e47) return [d.getUint32(16), d.getUint32(20)]
  if (d.byteLength < 4 || d.getUint16(0) !== 0xffd8) return null
  for (let i = 2; i + 9 < d.byteLength;) {
    if (d.getUint8(i) !== 0xff) { i++; continue }
    const m = d.getUint8(i + 1)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [d.getUint16(i + 7), d.getUint16(i + 5)]
    i += 2 + d.getUint16(i + 2)
  }
  return null
}
