// Builds Cricketer.glb for the Unity cricket game from Quaternius CC0 packs:
//   - the Universal Base Characters male body (skinned), its body mesh split into kit regions by dominant bone
//     (Skin, Shirt, Trousers, Shoes) so Unity can colour the kit per team with plain materials,
//   - a decimated LOD1 copy of the body for distant players,
//   - a subset of Universal Animation Library 1 + 2 clips (rotations only, plus the pelvis's translation re-based on
//     this body's rest height), finger channels dropped.
// usage: node build_cricketer.mjs <ubc male .gltf> <ual1 .glb> <ual2 .glb> <out.glb> <skin out .jpg>
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, simplify, weld, resample } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'fs'

const [ubcPath, ual1Path, ual2Path, outPath, skinOut] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(ubcPath)
const root = doc.getRoot()
const buffer = root.listBuffers()[0]

const REGION_OF = (name) => {
  if (/^(Head|neck_01)$/.test(name)) return 'Skin'
  if (/^(hand_|index_|middle_|ring_|pinky_|thumb_|lowerarm_)/.test(name)) return 'Skin'
  if (/^(spine_|clavicle_|upperarm_)/.test(name)) return 'Shirt'
  if (/^(pelvis|thigh_|calf_)/.test(name)) return 'Trousers'
  if (/^(foot_|ball_)/.test(name)) return 'Shoes'
  return 'Shirt'
}

// ---- materials: skin keeps a downscaled base colour; kit regions are flat (tinted in Unity)
const bodyNode = root.listNodes().find((n) => n.getName() === 'SuperHero_Male')
const bodyMesh = bodyNode.getMesh()
const skin = bodyNode.getSkin()
const jointNames = skin.listJoints().map((j) => j.getName())
const srcPrim = bodyMesh.listPrimitives()[0]
const srcMat = srcPrim.getMaterial()
const baseTex = srcMat.getBaseColorTexture()

// Downscale the skin texture to 1024 JPG, written next to the glb for Unity to import (and compress).
const skinJpg = await sharp(Buffer.from(baseTex.getImage())).resize(1024, 1024).jpeg({ quality: 82 }).toBuffer()
fs.writeFileSync(skinOut, skinJpg)

const mats = {}
for (const r of ['Skin', 'Shirt', 'Trousers', 'Shoes']) {
  const m = doc.createMaterial('Cricketer_' + r).setRoughnessFactor(0.8).setMetallicFactor(0)
  // Skin's texture is imported separately in Unity (CricketerSkin*.jpg) so it gets compressed.
  m.setBaseColorFactor({ Skin: [1, 1, 1, 1], Shirt: [0.9, 0.9, 0.91, 1], Trousers: [0.88, 0.88, 0.9, 1], Shoes: [0.95, 0.95, 0.95, 1] }[r])
  mats[r] = m
}

// ---- split the body primitive by region
const idx = srcPrim.getIndices().getArray()
const J = srcPrim.getAttribute('JOINTS_0').getArray()
const W = srcPrim.getAttribute('WEIGHTS_0').getArray()
const vcount = srcPrim.getAttribute('POSITION').getCount()
const vregion = new Array(vcount)
for (let v = 0; v < vcount; v++) {
  let best = 0
  for (let k = 1; k < 4; k++) if (W[v * 4 + k] > W[v * 4 + best]) best = k
  vregion[v] = REGION_OF(jointNames[J[v * 4 + best]])
}
const tris = { Skin: [], Shirt: [], Trousers: [], Shoes: [] }
for (let t = 0; t < idx.length; t += 3) {
  const rs = [vregion[idx[t]], vregion[idx[t + 1]], vregion[idx[t + 2]]]
  const r = rs[0] === rs[1] || rs[0] === rs[2] ? rs[0] : rs[1] === rs[2] ? rs[1] : rs[0]
  tris[r].push(idx[t], idx[t + 1], idx[t + 2])
}
bodyMesh.removePrimitive(srcPrim)
for (const [r, list] of Object.entries(tris)) {
  if (!list.length) continue
  const p = doc.createPrimitive().setMaterial(mats[r])
  for (const sem of srcPrim.listSemantics()) p.setAttribute(sem, srcPrim.getAttribute(sem))
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buffer))
  bodyMesh.addPrimitive(p)
  console.log('region', r, list.length / 3, 'tris')
}
bodyMesh.setName('CricketerBody')
bodyNode.setName('Body_LOD0')

// Eyebrows: flat dark material instead of the 2K hair texture.
const browNode = root.listNodes().find((n) => n.getName() === 'Eyebrows')
const browMat = doc.createMaterial('Cricketer_Brows').setBaseColorFactor([0.08, 0.06, 0.05, 1]).setRoughnessFactor(0.9)
for (const p of browNode.getMesh().listPrimitives()) p.setMaterial(browMat)
// Eyes: keep their small texture, drop the normal map.
for (const m of root.listMaterials()) {
  m.setNormalTexture(null)
  m.setMetallicRoughnessTexture(null)
  m.setOcclusionTexture(null)
}

// ---- LOD1: a decimated copy of the body, same skin
const lodMesh = doc.createMesh('CricketerBodyLOD1')
for (const p of bodyMesh.listPrimitives()) lodMesh.addPrimitive(p.clone())
const lodNode = doc.createNode('Body_LOD1').setMesh(lodMesh).setSkin(skin)
bodyNode.getParentNode()?.addChild(lodNode) ?? root.listScenes()[0].addChild(lodNode)
// Primitives need their own index buffers before simplifying.
await MeshoptSimplifier.ready
for (const p of lodMesh.listPrimitives()) {
  const pos = p.getAttribute('POSITION').getArray()
  const src = new Uint32Array(p.getIndices().getArray())
  const [outIdx] = MeshoptSimplifier.simplify(src, pos, 3, Math.floor(src.length * 0.3 / 3) * 3, 0.02, ['LockBorder'])
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(outIdx).setBuffer(buffer))
  console.log('LOD1', p.getMaterial()?.getName(), src.length / 3, '->', outIdx.length / 3, 'tris')
}

// ---- animations
const nodes = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]))
const pelvisRest = nodes['pelvis'].getTranslation()
const keep = {
  [ual1Path]: ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'PickUp_Table', 'Roll', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Dance_Loop', 'Idle_Talking_Loop', 'Hit_Chest'],
  [ual2Path]: ['OverhandThrow', 'Slide_Start', 'Slide_Loop', 'Slide_Exit', 'Idle_FoldArms_Loop', 'LayToIdle', 'Yes', 'Idle_No_Loop'],
}
const copyAcc = (a) => doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()).setBuffer(buffer).setNormalized(a.getNormalized())
for (const [path, names] of Object.entries(keep)) {
  const src = await io.read(path)
  const srcNodes = Object.fromEntries(src.getRoot().listNodes().map((n) => [n.getName(), n]))
  const srcPelvisRest = srcNodes['pelvis'].getTranslation()
  for (const anim of src.getRoot().listAnimations()) {
    if (!names.includes(anim.getName())) continue
    const out = doc.createAnimation(anim.getName())
    let n = 0
    for (const ch of anim.listChannels()) {
      const name = ch.getTargetNode()?.getName()
      const target = nodes[name]
      if (!target) continue
      const tp = ch.getTargetPath()
      if (tp === 'scale') continue
      if (/^(index|middle|ring|pinky|thumb)_/.test(name) || /leaf/.test(name)) continue
      if (tp === 'translation' && name !== 'pelvis') continue
      const s = ch.getSampler()
      let output = copyAcc(s.getOutput())
      if (tp === 'translation') {
        const arr = output.getArray()
        for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) arr[i + k] += pelvisRest[k] - srcPelvisRest[k]
        output.setArray(arr)
      }
      const sampler = doc.createAnimationSampler().setInput(copyAcc(s.getInput())).setOutput(output).setInterpolation(s.getInterpolation())
      out.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(tp).setSampler(sampler))
      n++
    }
    console.log('anim', anim.getName(), n, 'channels')
  }
}

await doc.transform(resample({ tolerance: 1e-4 }), prune())
// Drop the original textures that nothing uses any more.
for (const t of root.listTextures()) if (!t.listParents().some((p) => p !== root)) t.dispose()
await io.write(outPath, doc)
console.log('written', outPath, fs.statSync(outPath).size)
