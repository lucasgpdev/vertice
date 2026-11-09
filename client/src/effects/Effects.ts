import * as THREE from 'three';

/**
 * Efeitos visuais com pooling (nenhuma alocação por disparo):
 * traçantes, clarão de boca, marcas de impacto e faíscas.
 * Discretos para não atrapalhar a visibilidade competitiva.
 */

const makeFlashTexture = (): THREE.Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,250,230,1)');
  grd.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  grd.addColorStop(0.6, 'rgba(255,120,20,0.25)');
  grd.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // pétalas
  g.globalCompositeOperation = 'lighter';
  g.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.fillStyle = 'rgba(255,190,80,0.35)';
    g.beginPath();
    g.ellipse(0, -30, 6, 30, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const makeDecalTexture = (): THREE.Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(5,5,5,0.95)');
  grd.addColorStop(0.3, 'rgba(20,18,16,0.85)');
  grd.addColorStop(0.55, 'rgba(40,36,32,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

interface Tracer {
  line: THREE.Line;
  life: number;
}
interface Flash {
  sprite: THREE.Sprite;
  life: number;
}
interface Decal {
  mesh: THREE.Mesh;
  life: number;
}
interface SparkBurst {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
}

export class Effects {
  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly decals: Decal[] = [];
  private readonly sparks: SparkBurst[] = [];
  private tracerI = 0;
  private flashI = 0;
  private decalI = 0;
  private sparkI = 0;
  private readonly flashTex = makeFlashTexture();
  private readonly decalTex = makeDecalTexture();
  private readonly decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
  private readonly root = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  /** Luz única do clarão de boca (reaproveitada). */
  readonly muzzleLight = new THREE.PointLight(0xffb45a, 0, 7, 2);

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.root);
    this.root.add(this.muzzleLight);

    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats.push(tracerMat);
    for (let i = 0; i < 32; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      this.root.add(line);
      this.tracers.push({ line, life: 0 });
    }
    for (let i = 0; i < 12; i++) {
      const m = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const sprite = new THREE.Sprite(m);
      sprite.visible = false;
      this.root.add(sprite);
      this.flashes.push({ sprite, life: 0 });
    }
    for (let i = 0; i < 96; i++) {
      const m = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      const mesh = new THREE.Mesh(this.decalGeo, m);
      mesh.visible = false;
      mesh.matrixAutoUpdate = true;
      this.root.add(mesh);
      this.decals.push({ mesh, life: 0 });
    }
    for (let i = 0; i < 12; i++) {
      const n = 10;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const m = new THREE.PointsMaterial({ color: 0xffc070, size: 0.035, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const points = new THREE.Points(g, m);
      points.visible = false;
      points.frustumCulled = false;
      this.root.add(points);
      this.sparks.push({ points, vel: new Float32Array(n * 3), life: 0 });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers[this.tracerI++ % this.tracers.length]!;
    const p = t.line.geometry.attributes.position as THREE.BufferAttribute;
    // Começa um pouco à frente da boca para não cobrir a mira.
    const dir = new THREE.Vector3().subVectors(to, from);
    const start = from.clone().addScaledVector(dir, Math.min(0.15, 1.5 / Math.max(1, dir.length())));
    p.setXYZ(0, start.x, start.y, start.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    t.line.visible = true;
    t.life = 1;
  }

  flash(at: THREE.Vector3, scale = 0.35, light = true): void {
    const f = this.flashes[this.flashI++ % this.flashes.length]!;
    f.sprite.position.copy(at);
    f.sprite.scale.setScalar(scale * (0.85 + Math.random() * 0.3));
    (f.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = 1;
    if (light) {
      this.muzzleLight.position.copy(at);
      this.muzzleLight.intensity = 6;
    }
  }

  impact(at: THREE.Vector3, normal: THREE.Vector3): void {
    const d = this.decals[this.decalI++ % this.decals.length]!;
    d.mesh.position.copy(at).addScaledVector(normal, 0.004);
    d.mesh.lookAt(at.clone().add(normal));
    d.mesh.rotateZ(Math.random() * Math.PI);
    d.mesh.scale.setScalar(0.7 + Math.random() * 0.5);
    (d.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    d.mesh.visible = true;
    d.life = 1;

    const s = this.sparks[this.sparkI++ % this.sparks.length]!;
    const pos = s.points.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, at.x, at.y, at.z);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2).add(normal.clone().multiplyScalar(2.5));
      s.vel[i * 3] = v.x;
      s.vel[i * 3 + 1] = v.y;
      s.vel[i * 3 + 2] = v.z;
    }
    pos.needsUpdate = true;
    s.points.visible = true;
    s.life = 1;
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (!t.line.visible) continue;
      t.life -= dt / 0.07;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life) * 0.6;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.life -= dt / 0.05;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, f.life);
      if (f.life <= 0) f.sprite.visible = false;
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 120);
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.life -= dt / 12;
      if (d.life < 0.25) (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, d.life / 0.25);
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const s of this.sparks) {
      if (!s.points.visible) continue;
      s.life -= dt / 0.3;
      const pos = s.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        s.vel[i * 3 + 1]! -= 9.8 * dt;
        pos.setXYZ(i, pos.getX(i) + s.vel[i * 3]! * dt, pos.getY(i) + s.vel[i * 3 + 1]! * dt, pos.getZ(i) + s.vel[i * 3 + 2]! * dt);
      }
      pos.needsUpdate = true;
      (s.points.material as THREE.PointsMaterial).opacity = Math.max(0, s.life);
      if (s.life <= 0) s.points.visible = false;
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.decalGeo) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.decalGeo.dispose();
    this.flashTex.dispose();
    this.decalTex.dispose();
    this.mats.forEach((m) => m.dispose());
  }
}
