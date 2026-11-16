// Y'SMARA — villages. Ashbend (on the Kneeling One's shoulder) and Kell (on stilts in the shallows).
import * as THREE from 'three';
import { STRUCTURES } from './structures.js';
import { woodTextures, stoneTextures, glowTexture } from './textures.js';
import { terrainHeight, WORLD } from './world.js';
import { makeRng, rngRange, TAU, lerp } from '../core/math.js';
import { mergeGeometries } from './flora.js';

export function buildVillages(preset) {
  const group = new THREE.Group();
  group.name = 'villages';
  const wood = woodTextures();
  const stone = stoneTextures();
  const woodTiled = (set, scale) => {
    const c = (t) => (t ? (() => { const x = t.clone(); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(scale, scale); x.needsUpdate = true; return x; })() : null);
    return { map: c(set.map), normalMap: c(set.normalMap) };
  };
  // Decks are ~14 m across: 0.55 tiles/m gives planks a believable 1.8 m span.
  const woodDeck = woodTiled(wood, 0.55);
  const woodFine = woodTiled(wood, 2.2);
  const stoneFine = woodTiled(stone, 1.1);
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodDeck.map, normalMap: woodDeck.normalMap, color: 0x9a8567, roughness: 0.88, metalness: 0.04,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    map: woodFine.map, normalMap: woodFine.normalMap, color: 0x5a5548, roughness: 0.96,
  });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7856, roughness: 1 });
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stoneFine.map, normalMap: stoneFine.normalMap, color: 0x8d887c, roughness: 0.95,
  });
  const glowTex = glowTexture();
  const fireMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xffa040, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const fires = [];

  for (const key of ['ashbend', 'kell']) {
    const V = STRUCTURES[key];
    const baseY = V.y;
    const root = new THREE.Group();
    root.name = key;

    // ---- DECKS: planked discs/ellipses with visible joists beneath
    for (const d of V.decks) {
      const rx = d.shape === 'circle' ? d.r : d.rx;
      const rz = d.shape === 'circle' ? d.r : d.rz;
      const deckGeo = new THREE.CylinderGeometry(rx, rx * 0.97, 0.5, Math.max(14, Math.floor(rx * 2.2)), 2);
      const deck = new THREE.Mesh(deckGeo, woodMat);
      deck.scale.z = rz / rx;
      deck.position.set(d.x, d.y - 0.25, d.z);
      deck.receiveShadow = preset.shadows;
      deck.castShadow = preset.shadows;
      root.add(deck);

      // joists around the rim
      const joistCount = Math.floor(rx * 1.6) + 6;
      const joistGeo = [];
      for (let i = 0; i < joistCount; i++) {
        const a = (i / joistCount) * TAU;
        const jg = new THREE.BoxGeometry(0.34, 0.55, 1.5);
        jg.translate(Math.cos(a) * (rx - 0.3), 0, Math.sin(a) * (rz - 0.3));
        joistGeo.push(jg);
      }
      const joists = new THREE.Mesh(mergeGeometries(joistGeo), woodMat);
      joists.position.set(d.x, d.y - 0.62, d.z);
      root.add(joists);

      // support posts down to the ground (long for Ashbend — it's on a titan's back)
      const groundY = key === 'kell' ? Math.max(terrainHeight(d.x, d.z), -1.2) : 30;
      const postH = Math.max(0.6, d.y - 0.6 - groundY);
      if (postH > 1.2) {
        const postGeos = [];
        const n = Math.max(4, Math.floor(rx * 0.6));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + 0.3;
          const px = Math.cos(a) * rx * 0.72, pz = Math.sin(a) * rz * 0.72;
          const pg = new THREE.CylinderGeometry(0.16, 0.22, postH, 6);
          pg.translate(px, -postH / 2, pz);
          postGeos.push(pg);
        }
        const posts = new THREE.Mesh(mergeGeometries(postGeos), woodMat);
        posts.position.set(d.x, d.y - 0.55, d.z);
        posts.castShadow = preset.shadows;
        root.add(posts);
      }
    }

    // ---- ROPE RAILINGS around deck edges
    for (const w of V.walls || []) {
      if (w.shape !== 'circle') continue;
      const posts = [];
      const segs = 30;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * TAU;
        const px = w.x + Math.cos(a) * w.r, pz = w.z + Math.sin(a) * w.r;
        if (w.gateAt && Math.hypot(px - w.gateAt.x, pz - w.gateAt.z) < (w.gateWidth || 4) * 0.5) continue;
        posts.push({ x: px, z: pz, a });
      }
      const pGeos = [];
      for (const p of posts) {
        const pg = new THREE.CylinderGeometry(0.075, 0.09, 1.15, 5);
        pg.translate(p.x, baseY + 0.58, p.z);
        pGeos.push(pg);
      }
      if (pGeos.length) {
        const pm = new THREE.Mesh(mergeGeometries(pGeos), woodMat);
        pm.castShadow = preset.shadows;
        root.add(pm);
      }
      // rope: sagging line segments between posts
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i], b = posts[i + 1];
        if (Math.hypot(a.x - b.x, a.z - b.z) > w.r * 0.8) continue;
        const mid = new THREE.Vector3((a.x + b.x) / 2, baseY + 0.86, (a.z + b.z) / 2);
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(a.x, baseY + 1.08, a.z), mid, new THREE.Vector3(b.x, baseY + 1.08, b.z));
        const tube = new THREE.TubeGeometry(curve, 5, 0.035, 4, false);
        root.add(new THREE.Mesh(tube, ropeMat));
      }
    }

    // ---- HUTS: sculpted roundhouses with thatch roofs and doorframes
    for (const hut of V.huts) {
      const h = new THREE.Group();
      h.position.set(hut.x, baseY, hut.z);
      h.rotation.y = hut.rot;
      const wallH = hut.h * 0.62;

      // walls: 10-gon drum, slightly battered
      const wallGeo = new THREE.CylinderGeometry(hut.r * 0.96, hut.r * 1.06, wallH, 10, 3, true);
      const wall = new THREE.Mesh(wallGeo, woodMat);
      wall.position.y = wallH / 2;
      wall.castShadow = preset.shadows;
      wall.receiveShadow = preset.shadows;
      h.add(wall);

      // thatch roof: cone with a sculpted, uneven rim
      const roofGeo = new THREE.ConeGeometry(hut.r * 1.42, hut.h * 0.62, 11, 3);
      const rp = roofGeo.attributes.position;
      const rng = makeRng(Math.floor(hut.x * 17 + hut.z * 3));
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
        const d = 1 + (rng() - 0.5) * 0.09;
        rp.setXYZ(i, x * d, y, z * d);
      }
      roofGeo.computeVertexNormals();
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = wallH + hut.h * 0.30;
      roof.castShadow = preset.shadows;
      h.add(roof);

      // door frame + warm interior glow
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.8, 0.16), new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 1 }));
      door.position.set(0, 0.9, hut.r * 0.98);
      h.add(door);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffb066, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.position.set(0, 1.15, hut.r * 1.02);
      glow.scale.setScalar(1.5);
      h.add(glow);
      // window glow on two sides
      for (const a of [0.9, -1.1]) {
        const wg = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xffc27a, transparent: true, opacity: 0.36,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        wg.position.set(Math.sin(a) * hut.r * 1.0, 1.5, Math.cos(a) * hut.r * 1.0);
        wg.scale.setScalar(1.0);
        h.add(wg);
      }
      root.add(h);
    }

    // ---- Senn's hall (Ashbend only): open-sided longhouse
    if (V.hall) {
      const hl = new THREE.Group();
      hl.position.set(V.hall.x, baseY, V.hall.z);
      hl.rotation.y = V.hall.rot;
      const { w, d, h } = V.hall;
      // pillars
      const pg = [];
      for (const px of [-w / 2, w / 2]) for (const pz of [-d / 2, d / 2]) {
        const p = new THREE.CylinderGeometry(0.22, 0.28, h, 7);
        p.translate(px, h / 2, pz);
        pg.push(p);
      }
      for (const pz of [-d / 2, d / 2]) {
        const p = new THREE.CylinderGeometry(0.16, 0.2, h, 6);
        p.translate(0, h / 2, pz);
        pg.push(p);
      }
      const pillars = new THREE.Mesh(mergeGeometries(pg), woodMat);
      pillars.castShadow = preset.shadows;
      hl.add(pillars);
      // roof: two slopes
      for (const s of [-1, 1]) {
        const slope = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 0.22, d * 0.62), roofMat);
        slope.position.set(0, h + 0.9, s * d * 0.26);
        slope.rotation.x = s * 0.5;
        slope.castShadow = preset.shadows;
        hl.add(slope);
      }
      // back wall of woven reeds
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.9, 0.16), woodMat);
      back.position.set(0, h * 0.45, -d / 2);
      hl.add(back);
      // the bell of Ashbend hangs inside the hall (visual; logic bell is a shrine)
      const bellGeo = new THREE.LatheGeometry((() => {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push(new THREE.Vector2(0.25 + Math.sin(t * Math.PI * 0.9) * 0.85 + t * 0.1, -t * 1.8));
        }
        return pts;
      })(), 20);
      const bell = new THREE.Mesh(bellGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.38, metalness: 0.85 }));
      bell.position.set(0, h + 0.4, 0);
      hl.add(bell);
      root.add(hl);
    }

    // ---- BRAZIERS: stone bowl + embers + real light for the nearest few
    for (const b of V.braziers || []) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.4, 0.55, 10), stoneMat);
      bowl.position.set(b.x, baseY + 0.9, b.z);
      bowl.castShadow = preset.shadows;
      root.add(bowl);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 6), stoneMat);
      stand.position.set(b.x, baseY + 0.45, b.z);
      root.add(stand);
      const fire = new THREE.Sprite(fireMat.clone());
      fire.position.set(b.x, baseY + 1.25, b.z);
      fire.scale.setScalar(2.6);
      fires.push(fire);
      root.add(fire);
      if (preset.quality === 'ultra' || preset.quality === 'high') {
        const light = new THREE.PointLight(0xff9a45, 2.6, 18, 2.0);
        light.position.set(b.x, baseY + 1.4, b.z);
        root.add(light);
      }
    }
    group.add(root);
  }

  group.userData.fires = fires;
  group.userData.update = (t) => {
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      f.material.opacity = 0.7 + Math.sin(t * 5.2 + i * 1.7) * 0.18 + Math.sin(t * 11.3 + i) * 0.08;
      f.scale.setScalar(2.4 + Math.sin(t * 4.1 + i * 2.2) * 0.24);
    }
  };
  return group;
}
