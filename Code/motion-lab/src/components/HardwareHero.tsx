import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { emgPalette } from '../emgPalette';

export type HardwareFocus = 'overview' | 'esp32' | 'ads1298' | 'imu' | 'emg';

type Props = {
  focus: HardwareFocus;
  onFocusChange: (next: HardwareFocus) => void;
  replayToken: number;
  fallbackMessage: string;
  stageLabel: string;
};

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mm = 0.073;
const INITIAL_VIEW = { yaw: 0.16, pitch: 0.49 };

function roundedShape(width: number, height: number, radius: number) {
  const s = new THREE.Shape();
  const a = width / 2;
  const b = height / 2;
  const r = Math.min(radius, a * 0.9, b * 0.9);
  s.moveTo(-a + r, -b);
  s.lineTo(a - r, -b);
  s.quadraticCurveTo(a, -b, a, -b + r);
  s.lineTo(a, b - r);
  s.quadraticCurveTo(a, b, a - r, b);
  s.lineTo(-a + r, b);
  s.quadraticCurveTo(-a, b, -a, b - r);
  s.lineTo(-a, -b + r);
  s.quadraticCurveTo(-a, -b, -a + r, -b);
  return s;
}

function createCanvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

function buildPartsLibrary() {
  const mat = (color: number, roughness = 0.46, metalness = 0, map: THREE.Texture | null = null) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, map });

  const foamTex = createCanvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#f2f2f1';
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 1; y < 128; y += 3) {
      for (let x = 1; x < 128; x += 3) {
        const shade = 200 + (x * 37 + y * 53 + x * y) % 48;
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });

  return {
    fiberglass: mat(0xc09763, 0.71),
    darkBoard: mat(0x242a2c, 0.48),
    rfBoard: mat(0x1a2624, 0.56),
    adsBoard: mat(0x16424c, 0.36, 0.04),   // Precision biomedical dark-teal solder mask
    imuBoard: mat(0x2e3548, 0.38, 0.06),   // Matte titanium-slate IMU breakout mask
    gold: mat(0xe2b862, 0.28, 0.62),
    tin: mat(0xc6c9cc, 0.30, 0.55),
    steelLip: mat(0xdadcd8, 0.22, 0.68),
    chip: mat(0x1a1b1e, 0.64),
    plug: mat(0x232529, 0.58),
    socketPlastic: mat(0x1e2024, 0.62),
    gunmetal: mat(0x555a60, 0.42, 0.48),
    wire: mat(0x4a4e56, 0.54),
    hole: mat(0x101114, 0.93),
    ceramic: mat(0xa98762, 0.60),
    carbon: mat(0x363638, 0.72),
    led: mat(0xd4ae68, 0.34),
    gel: mat(0xacaca7, 0.62),
    foam: mat(0xd4d5d2, 0.88, 0, foamTex),
    silverCap: mat(0xd3d6dc, 0.24, 0.72),
  };
}

type Parts = ReturnType<typeof buildPartsLibrary>;

function addMesh(group: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3, shadow = true) {
  const item = new THREE.Mesh(geometry, material);
  item.position.copy(position);
  item.castShadow = shadow;
  item.receiveShadow = true;
  group.add(item);
  return item;
}

function addRounded(
  group: THREE.Object3D, width: number, depth: number, radius: number, height: number,
  material: THREE.Material, x: number, y: number, z: number, holes: [number, number, number][] = [],
) {
  const shape = roundedShape(width, depth, radius);
  for (const [hx, hz, size] of holes) {
    const cutout = new THREE.Path();
    cutout.absarc(hx, -hz, size, 0, Math.PI * 2, true);
    shape.holes.push(cutout);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true, bevelSize: 0.013, bevelThickness: 0.01,
    bevelSegments: 2, curveSegments: 10,
  });
  geometry.rotateX(-Math.PI / 2);
  return addMesh(group, geometry, material, v(x, y, z));
}

function addBox(group: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
  return addMesh(group, new THREE.BoxGeometry(w, h, d), material, v(x, y, z));
}

function addCylinder(group: THREE.Object3D, radius: number, height: number, material: THREE.Material, x: number, y: number, z: number, segments = 44) {
  return addMesh(group, new THREE.CylinderGeometry(radius, radius, height, segments), material, v(x, y, z));
}

function addRing(group: THREE.Object3D, radius: number, tube: number, material: THREE.Material, x: number, y: number, z: number) {
  const item = addMesh(group, new THREE.TorusGeometry(radius, tube, 10, 44), material, v(x, y, z));
  item.rotation.x = Math.PI / 2;
  return item;
}

function addWire(group: THREE.Object3D, points: THREE.Vector3[], radius: number, material: THREE.Material) {
  const route = new THREE.CatmullRomCurve3(points);
  return addMesh(group, new THREE.TubeGeometry(route, 44, radius, 8, false), material, v());
}

function addPrintSurface(group: THREE.Object3D, width: number, depth: number, y: number, map: THREE.Texture) {
  const face = addMesh(
    group,
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
    v(0, y, 0),
    false,
  );
  face.rotation.x = -Math.PI / 2;
  return face;
}

function repeatParts(group: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, positions: [number, number, number][]) {
  const batch = new THREE.InstancedMesh(geometry, material, positions.length);
  const matrix = new THREE.Matrix4();
  positions.forEach(([x, y, z], index) => batch.setMatrixAt(index, matrix.makeTranslation(x, y, z)));
  batch.receiveShadow = true;
  batch.castShadow = true;
  group.add(batch);
}

function addSmd(group: THREE.Object3D, parts: Parts, x: number, z: number, length: number, width: number, y: number, bodyMat: THREE.Material, rotation = 0) {
  const item = new THREE.Group();
  item.position.set(x, y, z);
  item.rotation.y = rotation;
  group.add(item);
  const height = bodyMat === parts.ceramic ? 0.042 : 0.030;
  addBox(item, length * 0.70, height, width, bodyMat, 0, height / 2, 0);
  for (const side of [-1, 1]) {
    addBox(item, length * 0.18, height * 1.04, width * 1.02, parts.tin, side * length * 0.405, height / 2, 0);
  }
}

function addSolderedHeaders(group: THREE.Object3D, parts: Parts, positions: [number, number][], pinTopScale = 1) {
  const at = (height: number): [number, number, number][] => positions.map(([x, z]) => [x, height, z]);
  repeatParts(group, new THREE.BoxGeometry(0.048, 0.145, 0.048), parts.gold, at(-0.022));
  repeatParts(group, new THREE.CylinderGeometry(0.040, 0.062, 0.036, 10), parts.tin, at(-0.028));
  repeatParts(group, new THREE.BoxGeometry(0.148, 0.120, 0.162), parts.socketPlastic, at(0.200));
  const pinH = 0.285 * pinTopScale;
  repeatParts(group, new THREE.BoxGeometry(0.046, pinH, 0.046), parts.gold, at(0.260 + pinH / 2));
  const tip = new THREE.CylinderGeometry(0.016, 0.032, 0.042, 4).rotateY(Math.PI / 4);
  repeatParts(group, tip, parts.gold, at(0.260 + pinH + 0.02));
}

function addDupontFemale(group: THREE.Object3D, parts: Parts, x: number, z: number, collarColor?: number) {
  addRounded(group, 0.138, 0.144, 0.014, 0.282, parts.plug, x, 0.312, z, [[0, 0, 0.04]]);
  addRounded(group, 0.124, 0.128, 0.014, 0.024, parts.plug, x, 0.594, z);
  const collarMat = collarColor !== undefined
    ? new THREE.MeshStandardMaterial({ color: collarColor, roughness: 0.48, metalness: 0.04 })
    : parts.wire;
  addRounded(group, 0.088, 0.094, 0.016, 0.056, collarMat, x, 0.616, z);
  return v(x, 0.666, z);
}

function addUsbPort(group: THREE.Object3D, parts: Parts, x: number, z: number) {
  const outer = roundedShape(0.49, 0.158, 0.035);
  const opening = new THREE.Path();
  opening.moveTo(-0.17, -0.045);
  opening.lineTo(0.17, -0.045);
  opening.lineTo(0.185, 0.045);
  opening.lineTo(-0.185, 0.045);
  opening.closePath();
  outer.holes.push(opening);
  const shell = new THREE.ExtrudeGeometry(outer, { depth: 0.33, bevelEnabled: false, curveSegments: 6 });
  addMesh(group, shell, parts.steelLip, v(x, 0.224, z - 0.33));
  addBox(group, 0.32, 0.09, 0.018, parts.hole, x, 0.224, z - 0.195);
  addBox(group, 0.255, 0.024, 0.165, parts.socketPlastic, x, 0.220, z - 0.102);
  for (let i = -2; i <= 2; i++) {
    addBox(group, 0.018, 0.006, 0.10, parts.gold, x + i * 0.036, 0.236, z - 0.088);
  }
}

const CONTROLLER_PINS = [
  ['3V3', '3V3', 'RST', '4', '5', '6', '7', '15', '16', '17', '18', '8', '3', '46', '9', '10', '11', '12', '13', '14', '5V', 'GND'],
  ['GND', 'TX', 'RX', '1', '2', '42', '41', '40', '39', '38', '37', '36', '35', '0', '45', '48', '47', '21', '20', '19', 'GND', 'GND'],
] as const;

const SPI_JUMPERS = [
  { ads: '3V3',  ctrlSide: -1, ctrlPin: 1,  color: 0x8a483a },
  { ads: 'GND',  ctrlSide: 1,  ctrlPin: 1,  color: 0x26292e },
  { ads: 'CS',   ctrlSide: -1, ctrlPin: 15, color: 0x52616e },
  { ads: 'SCLK', ctrlSide: -1, ctrlPin: 16, color: 0x3b6a8c },
  { ads: 'MOSI', ctrlSide: -1, ctrlPin: 17, color: 0x3d7362 },
  { ads: 'MISO', ctrlSide: -1, ctrlPin: 18, color: 0x735b8a },
] as const;

const IMU_BUS_PINS = [
  { label: 'SDA', ctrlSide: 1, ctrlPin: 8,  color: 0x4b6380 },
  { label: 'SCL', ctrlSide: 1, ctrlPin: 9,  color: 0x6b5c7d },
  { label: '3V3', ctrlSide: -1, ctrlPin: 2, color: 0x8a483a },
  { label: 'GND', ctrlSide: 1, ctrlPin: 21, color: 0x26292e },
] as const;

function addEsp32S3(group: THREE.Group, parts: Parts) {
  const pcb = new THREE.Group();
  pcb.position.set(-4.55, 0.14, -0.55);
  pcb.rotation.set(0.04, -Math.PI / 2 + 0.05, -0.025);
  group.add(pcb);

  const width = 25.4 * mm;
  const depth = 62.74 * mm;
  const pitch = 2.54 * mm;
  const first = depth / 2 - (8 * mm + 21 * pitch);
  const headerX = width / 2 - 1.27 * mm;
  const holes: [number, number, number][] = [];
  const headerXY: [number, number][] = [];
  for (const side of [-1, 1] as const) {
    CONTROLLER_PINS[(side + 1) / 2].forEach((_, index) => {
      const z = first + index * pitch;
      holes.push([side * headerX, z, 0.036]);
      headerXY.push([side * headerX, z]);
    });
  }

  addRounded(pcb, width, depth, 0.068, 0.108, parts.fiberglass, 0, 0, 0, holes);
  addRounded(pcb, width, depth, 0.068, 0.018, parts.darkBoard, 0, 0.108, 0, holes);
  addRounded(pcb, width, depth, 0.068, 0.012, parts.darkBoard, 0, -0.015, 0, holes);
  addSolderedHeaders(pcb, parts, headerXY);

  const spiTerminals = new Map<string, THREE.Vector3>();
  SPI_JUMPERS.forEach(({ ads, ctrlSide, ctrlPin, color }) => {
    spiTerminals.set(ads, addDupontFemale(pcb, parts, ctrlSide * headerX, first + (ctrlPin - 1) * pitch, color));
  });
  const imuTerminals = new Map<string, THREE.Vector3>();
  IMU_BUS_PINS.forEach(({ label, ctrlSide, ctrlPin, color }) => {
    imuTerminals.set(label, addDupontFemale(pcb, parts, ctrlSide * headerX, first + (ctrlPin - 1) * pitch, color));
  });

  // ESP32-S3 WROOM-1 RF module + metallic shield
  const moduleZ = -1.43;
  addRounded(pcb, 1.27, 1.88, 0.036, 0.054, parts.rfBoard, 0, 0.138, moduleZ);
  addRounded(pcb, 1.13, 1.20, 0.038, 0.074, parts.steelLip, 0, 0.198, moduleZ + 0.266);
  const castellations: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 14; i++) castellations.push([side * 0.625, 0.148, -1.91 + i * 0.084]);
    addUsbPort(pcb, parts, side * 0.486, depth / 2 + 0.023);
    addRounded(pcb, 0.205, 0.180, 0.014, 0.044, parts.tin, side * 0.568, 0.138, 1.62);
    addCylinder(pcb, 0.055, 0.031, parts.chip, side * 0.568, 0.196, 1.62, 24);
  }
  for (let i = 0; i < 10; i++) castellations.push([-0.39 + i * 0.086, 0.147, moduleZ + 0.929]);
  repeatParts(pcb, new THREE.BoxGeometry(0.050, 0.028, 0.040), parts.gold, castellations);

  // USB-UART bridge IC + pins
  addRounded(pcb, 0.415, 0.435, 0.025, 0.066, parts.chip, 0.225, 0.144, 1.02);
  const uartFeet: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    for (const sign of [-1, 1]) {
      uartFeet.push([0.231 + sign * 0.216, 0.151, 0.851 + i * 0.055]);
      uartFeet.push([0.063 + i * 0.055, 0.151, 1.021 + sign * 0.230]);
    }
  }
  repeatParts(pcb, new THREE.BoxGeometry(0.031, 0.018, 0.030), parts.tin, uartFeet);
  addSmd(pcb, parts, -0.38, 0.687, 0.219, 0.131, 0.142, parts.chip, Math.PI / 2);

  // Dense SMD passive network
  const passives: [number, number, number, number, number][] = [
    [-0.45, -0.348, 0.118, 0, 0], [-0.29, -0.34, 0.107, 1, 0], [-0.15, -0.34, 0.101, 0, 0],
    [0.04, -0.355, 0.112, 1, 0], [0.20, -0.353, 0.106, 0, 0], [0.337, -0.351, 0.113, 1, 0],
    [-0.53, 0.048, 0.111, 0, 1], [-0.377, 0.04, 0.151, 1, 1], [-0.184, 0.05, 0.103, 0, 0],
    [0.063, 0.07, 0.093, 1, 1], [0.244, 0.092, 0.109, 0, 0], [0.417, 0.105, 0.142, 1, 1],
    [-0.53, 0.302, 0.110, 1, 0], [-0.355, 0.336, 0.14, 0, 1], [-0.185, 0.336, 0.108, 1, 0],
    [0.282, 0.356, 0.15, 1, 1], [0.52, 0.333, 0.115, 0, 1], [-0.547, 0.873, 0.144, 1, 0],
    [-0.391, 0.92, 0.114, 1, 1], [-0.245, 0.972, 0.101, 0, 1], [-0.041, 1.241, 0.124, 0, 1],
    [0.566, 1.154, 0.11, 0, 1], [0.545, 1.33, 0.11, 1, 0], [-0.30, 1.33, 0.114, 1, 1],
    [-0.177, 1.505, 0.113, 0, 0], [0.141, 1.505, 0.10, 0, 0], [-0.082, 1.709, 0.102, 1, 0],
  ];
  for (const [x, z, len, cap, turned] of passives) {
    addSmd(pcb, parts, x, z, len, len * 0.58, 0.140, cap ? parts.ceramic : parts.carbon, turned * Math.PI / 2);
  }
  addSmd(pcb, parts, 0.507, -0.152, 0.108, 0.077, 0.143, parts.led);
  addRounded(pcb, 0.128, 0.110, 0.024, 0.038, parts.foam, -0.050, 0.147, 0.496);

  // Silkscreen + PCB copper antenna
  const layout = createCanvasTexture(768, 1896, (ctx) => {
    const X = (x: number) => (x / width + 0.5) * 768;
    const Z = (z: number) => (z / depth + 0.5) * 1896;
    ctx.strokeStyle = '#9a7e52';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(X(-0.44), Z(-2.19));
    ctx.lineTo(X(0.41), Z(-2.19));
    ctx.lineTo(X(0.41), Z(-2.05));
    ctx.lineTo(X(0.22), Z(-2.05));
    ctx.lineTo(X(0.22), Z(-2.24));
    ctx.lineTo(X(-0.03), Z(-2.24));
    ctx.lineTo(X(-0.03), Z(-2.05));
    ctx.lineTo(X(-0.24), Z(-2.05));
    ctx.lineTo(X(-0.24), Z(-1.87));
    ctx.stroke();

    for (let i = 0; i < 19; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -0.64 + i * 0.117;
      const turn = 0.19 + (i % 6) * 0.066;
      const viaZ = z + 0.11 + (i % 4) * 0.028;
      ctx.strokeStyle = i % 3 ? '#3b4441' : '#4a5146';
      ctx.lineWidth = i % 4 === 0 ? 6 : 3.5;
      ctx.beginPath();
      ctx.moveTo(X(side * 0.617), Z(z));
      ctx.lineTo(X(side * (turn + 0.11)), Z(z));
      ctx.lineTo(X(side * turn), Z(viaZ));
      ctx.lineTo(X(side * (turn - 0.063)), Z(viaZ));
      ctx.stroke();
      ctx.fillStyle = '#7c7b5f';
      ctx.beginPath();
      ctx.arc(X(side * (turn - 0.063)), Z(viaZ), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = 'bold 23px Arial';
    ctx.textBaseline = 'middle';
    CONTROLLER_PINS.forEach((labels, row) => {
      ctx.textAlign = row ? 'right' : 'left';
      const x = X((row ? 1 : -1) * (headerX - 0.095));
      labels.forEach((label, pin) => {
        ctx.fillStyle = '#c4cac6';
        ctx.fillText(label, x, Z(first + pin * pitch));
      });
    });
    ctx.fillStyle = '#dce0dc';
    ctx.textAlign = 'center';
    ctx.font = 'bold 21px Arial';
    ctx.fillText('BOOT', X(-0.56), Z(1.45));
    ctx.fillText('EN', X(0.57), Z(1.45));
    ctx.fillText('UART', X(-0.486), Z(1.98));
    ctx.fillText('USB', X(0.486), Z(1.98));
  });
  addPrintSurface(pcb, width, depth, 0.138, layout);

  const shield = createCanvasTexture(512, 544, (ctx) => {
    for (let i = 0; i < 544; i += 3) {
      ctx.fillStyle = i % 9 ? 'rgba(105,111,116,.07)' : 'rgba(255,255,255,.22)';
      ctx.fillRect(0, i, 512, 1);
    }
    ctx.fillStyle = '#52575a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px Arial';
    ctx.fillText('ESP32-S3', 256, 250);
    ctx.font = '26px Arial';
    ctx.fillText('WROOM-1', 256, 292);
    ctx.font = '20px Arial';
    ctx.fillText('N16R8', 256, 350);
  });
  const silk = addMesh(
    pcb,
    new THREE.PlaneGeometry(1.10, 1.18),
    new THREE.MeshBasicMaterial({ map: shield, transparent: true, depthWrite: false }),
    v(0, 0.285, moduleZ + 0.266),
    false,
  );
  silk.rotation.x = -Math.PI / 2;

  return { pcb, spiTerminals, imuTerminals };
}

const EMG_CHANNELS = [
  { code: 'BB',  hex: emgPalette.BB.raw },
  { code: 'TB',  hex: emgPalette.TB.raw },
  { code: 'AD',  hex: emgPalette.AD.raw },
  { code: 'MD',  hex: emgPalette.MD.raw },
  { code: 'FCR', hex: emgPalette.FCR.raw },
  { code: 'ECR', hex: emgPalette.ECR.raw },
] as const;

function addAds1298(group: THREE.Group, parts: Parts) {
  const pcb = new THREE.Group();
  pcb.position.set(-0.28, 0.18, -0.32);
  pcb.rotation.set(0.06, -0.07, -0.04);
  group.add(pcb);

  const width = 42 * mm;
  const depth = 36 * mm;
  const pitch = 2.54 * mm;
  const mountInsetX = width / 2 - 2.6 * mm;
  const mountInsetZ = depth / 2 - 2.6 * mm;

  const holes: [number, number, number][] = [
    [-mountInsetX, -mountInsetZ, 1.45 * mm],
    [mountInsetX, -mountInsetZ, 1.45 * mm],
    [-mountInsetX, mountInsetZ, 1.45 * mm],
    [mountInsetX, mountInsetZ, 1.45 * mm],
  ];

  // Left edge: 6-pin SPI/Power header to ESP32-S3
  const spiHeaderX = -width / 2 + 2.6 * mm;
  const spiPins = ['3V3', 'GND', 'CS', 'SCLK', 'MOSI', 'MISO'] as const;
  const spiStartZ = -((spiPins.length - 1) * pitch) / 2;
  const headerXY: [number, number][] = [];
  const spiTerminals = new Map<string, THREE.Vector3>();

  spiPins.forEach((name, index) => {
    const z = spiStartZ + index * pitch;
    holes.push([spiHeaderX, z, 0.036]);
    headerXY.push([spiHeaderX, z]);
    const j = SPI_JUMPERS.find((row) => row.ads === name);
    spiTerminals.set(name, addDupontFemale(pcb, parts, spiHeaderX, z, j?.color));
  });

  // Right edge: 2-row 2.54mm EMG input headers (6 channels IN+ / IN- + REF)
  const emgHeaderX = width / 2 - 3.0 * mm;
  const emgHeaderX2 = emgHeaderX - pitch;
  const emgStartZ = -((EMG_CHANNELS.length - 1) * pitch) / 2;
  const emgTerminals: { code: string; color: number; point: THREE.Vector3 }[] = [];

  EMG_CHANNELS.forEach((ch, index) => {
    const z = emgStartZ + index * pitch;
    holes.push([emgHeaderX, z, 0.036]);
    holes.push([emgHeaderX2, z, 0.036]);
    headerXY.push([emgHeaderX, z]);
    headerXY.push([emgHeaderX2, z]);
    const colorNum = parseInt(ch.hex.slice(1), 16);
    const point = addDupontFemale(pcb, parts, emgHeaderX, z, colorNum);
    emgTerminals.push({ code: ch.code, color: colorNum, point });
  });

  addRounded(pcb, width, depth, 0.06, 0.112, parts.fiberglass, 0, 0, 0, holes);
  addRounded(pcb, width, depth, 0.06, 0.017, parts.adsBoard, 0, 0.112, 0, holes);
  addRounded(pcb, width, depth, 0.06, 0.013, parts.adsBoard, 0, -0.015, 0, holes);

  // Gold mounting hole rings
  for (const [hx, hz, r] of holes.slice(0, 4)) {
    addRing(pcb, r * 1.24, r * 0.28, parts.gold, hx, 0.141, hz);
  }
  addSolderedHeaders(pcb, parts, headerXY);

  // TQFP-64 ADS1298 centerpiece IC (10mm x 10mm) + 64 gull-wing leads
  const icSize = 10.2 * mm;
  addRounded(pcb, icSize, icSize, 0.028, 0.072, parts.chip, -0.08, 0.145, 0.02);
  addCylinder(pcb, 0.025, 0.006, parts.gunmetal, -0.08 - icSize * 0.34, 0.228, 0.02 - icSize * 0.34, 16);

  const tqfpPins: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const offset = -icSize * 0.42 + (i / 15) * (icSize * 0.84);
    for (const sign of [-1, 1]) {
      tqfpPins.push([-0.08 + sign * (icSize / 2 + 0.032), 0.156, 0.02 + offset]);
      tqfpPins.push([-0.08 + offset, 0.156, 0.02 + sign * (icSize / 2 + 0.032)]);
    }
  }
  repeatParts(pcb, new THREE.BoxGeometry(0.034, 0.020, 0.020), parts.tin, tqfpPins);

  const icLabel = createCanvasTexture(320, 320, (ctx) => {
    ctx.fillStyle = '#c8ccc8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('ADS1298', 160, 146);
    ctx.font = '24px Arial';
    ctx.fillText('24-BIT AFE', 160, 184);
    ctx.font = '18px Arial';
    ctx.fillStyle = '#9aa1a2';
    ctx.fillText('8-CH EMG', 160, 214);
  });
  const icPrint = addMesh(
    pcb,
    new THREE.PlaneGeometry(icSize * 0.88, icSize * 0.88),
    new THREE.MeshBasicMaterial({ map: icLabel, transparent: true, depthWrite: false }),
    v(-0.08, 0.229, 0.02),
    false,
  );
  icPrint.rotation.x = -Math.PI / 2;

  // 2.048 MHz crystal canister + power regulator + anti-aliasing RC banks
  addRounded(pcb, 0.32, 0.19, 0.03, 0.068, parts.silverCap, -0.78, 0.145, -0.68);
  addRounded(pcb, 0.28, 0.22, 0.02, 0.062, parts.chip, -0.78, 0.145, 0.72);
  for (let i = 0; i < 6; i++) {
    const z = emgStartZ + i * pitch;
    addSmd(pcb, parts, 0.56, z, 0.13, 0.072, 0.143, parts.carbon, 0);
    addSmd(pcb, parts, 0.74, z, 0.13, 0.076, 0.143, parts.ceramic, Math.PI / 2);
  }
  // Decoupling capacitors around ADS1298
  const caps: [number, number, number][] = [
    [-0.56, -0.46, 0], [-0.56, -0.26, 0], [-0.56, 0.36, 0], [-0.56, 0.56, 0],
    [-0.28, -0.74, Math.PI / 2], [0.02, -0.74, Math.PI / 2], [0.28, -0.74, Math.PI / 2],
    [-0.24, 0.78, Math.PI / 2], [0.06, 0.78, Math.PI / 2], [0.32, 0.78, Math.PI / 2],
  ];
  caps.forEach(([x, z, rot]) => addSmd(pcb, parts, x, z, 0.135, 0.082, 0.143, parts.ceramic, rot));
  addSmd(pcb, parts, -1.04, -0.84, 0.11, 0.076, 0.144, parts.led);

  // ADS1298 PCB traces & silkscreen
  const silk = createCanvasTexture(1024, 896, (ctx) => {
    const X = (x: number) => (x / width + 0.5) * 1024;
    const Z = (z: number) => (z / depth + 0.5) * 896;

    // Differential trace pairs from ADS1298 to 6-channel EMG header
    ctx.strokeStyle = '#246472';
    ctx.lineWidth = 4;
    EMG_CHANNELS.forEach((_, idx) => {
      const z = emgStartZ + idx * pitch;
      ctx.beginPath();
      ctx.moveTo(X(0.32), Z(z * 0.72));
      ctx.lineTo(X(0.56), Z(z));
      ctx.lineTo(X(emgHeaderX), Z(z));
      ctx.stroke();
    });
    // SPI bus traces
    spiPins.forEach((_, idx) => {
      const z = spiStartZ + idx * pitch;
      ctx.beginPath();
      ctx.moveTo(X(spiHeaderX), Z(z));
      ctx.lineTo(X(-0.92), Z(z));
      ctx.lineTo(X(-0.52), Z(z * 0.72));
      ctx.stroke();
    });

    ctx.fillStyle = '#e7f2f3';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px Arial';
    ctx.fillText('ADS1298 AFE', X(-1.05), Z(-1.05));
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = '#b9d6da';
    ctx.fillText('6-CH EMG · 2.54mm', X(0.18), Z(-1.05));

    ctx.font = 'bold 21px Arial';
    ctx.textAlign = 'left';
    spiPins.forEach((name, idx) => {
      ctx.fillStyle = '#e0eeef';
      ctx.fillText(name, X(spiHeaderX + 0.16), Z(spiStartZ + idx * pitch));
    });
    ctx.textAlign = 'right';
    EMG_CHANNELS.forEach((ch, idx) => {
      ctx.fillStyle = '#e0eeef';
      ctx.fillText(ch.code, X(emgHeaderX2 - 0.16), Z(emgStartZ + idx * pitch));
    });
  });
  addPrintSurface(pcb, width, depth, 0.141, silk);

  return { pcb, spiTerminals, emgTerminals };
}

function addImuModules(group: THREE.Group, parts: Parts) {
  const imuGroup = new THREE.Group();
  group.add(imuGroup);

  const specs = [
    { id: 'IMU-1', role: 'TRUNK',     pos: v(-3.15, 0.14, 1.98), rot: [0.05, 0.16, -0.02] as const },
    { id: 'IMU-2', role: 'UPPER ARM', pos: v(-1.28, 0.14, 2.22), rot: [0.04, 0.04, -0.03] as const },
    { id: 'IMU-3', role: 'FOREARM',   pos: v(0.58, 0.14, 2.02),  rot: [0.05, -0.14, -0.02] as const },
  ];

  const width = 17.5 * mm;
  const depth = 13.5 * mm;
  const pitch = 2.54 * mm;
  const busAnchors: THREE.Vector3[] = [];

  specs.forEach(({ id, role, pos, rot }) => {
    const pcb = new THREE.Group();
    pcb.position.copy(pos);
    pcb.rotation.set(rot[0], rot[1], rot[2]);
    imuGroup.add(pcb);

    const headerZ = -depth / 2 + 1.8 * mm;
    const holes: [number, number, number][] = [
      [-width / 2 + 1.8 * mm, depth / 2 - 1.8 * mm, 1.0 * mm],
      [width / 2 - 1.8 * mm, depth / 2 - 1.8 * mm, 1.0 * mm],
    ];
    const headerXY: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const x = -1.5 * pitch + i * pitch;
      holes.push([x, headerZ, 0.034]);
      headerXY.push([x, headerZ]);
    }

    addRounded(pcb, width, depth, 0.042, 0.095, parts.fiberglass, 0, 0, 0, holes);
    addRounded(pcb, width, depth, 0.042, 0.015, parts.imuBoard, 0, 0.095, 0, holes);
    addRounded(pcb, width, depth, 0.042, 0.011, parts.imuBoard, 0, -0.012, 0, holes);
    for (const [hx, hz, r] of holes.slice(0, 2)) {
      addRing(pcb, r * 1.25, r * 0.28, parts.gold, hx, 0.122, hz);
    }
    addSolderedHeaders(pcb, parts, headerXY, 0.82);

    // 4-pin female DuPont plug block on the IMU
    const plugColors = [0x8a483a, 0x26292e, 0x4b6380, 0x6b5c7d];
    const outlets: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      outlets.push(addDupontFemale(pcb, parts, -1.5 * pitch + i * pitch, headerZ, plugColors[i]));
    }
    busAnchors.push(outlets[1].clone().add(outlets[2]).multiplyScalar(0.5));

    // Compact QFN-24 6-axis/9-axis IMU chip + passives
    addRounded(pcb, 0.24, 0.24, 0.014, 0.042, parts.chip, 0, 0.122, 0.10);
    addSmd(pcb, parts, -0.34, 0.06, 0.105, 0.062, 0.122, parts.ceramic, 0);
    addSmd(pcb, parts, 0.34, 0.06, 0.105, 0.062, 0.122, parts.ceramic, 0);
    addSmd(pcb, parts, 0.34, 0.24, 0.095, 0.056, 0.122, parts.carbon, Math.PI / 2);
    addSmd(pcb, parts, -0.36, 0.25, 0.09, 0.06, 0.123, parts.led);

    const imuSilk = createCanvasTexture(384, 300, (ctx) => {
      ctx.fillStyle = '#e5e9f2';
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px Arial';
      ctx.fillText(id, 192, 118);
      ctx.font = 'bold 21px Arial';
      ctx.fillStyle = '#aeb7c9';
      ctx.fillText(role, 192, 246);
      // Tiny axis arrow mark
      ctx.strokeStyle = '#9aa6bd';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(64, 210); ctx.lineTo(106, 210);
      ctx.moveTo(64, 210); ctx.lineTo(64, 172);
      ctx.stroke();
    });
    addPrintSurface(pcb, width, depth, 0.122, imuSilk);
    pcb.userData.outlet = outlets;
  });

  return { imuGroup, pcbs: imuGroup.children as THREE.Group[] };
}

function addEmgSnapPad(group: THREE.Object3D, parts: Parts, position: THREE.Vector3, rotation: [number, number, number], colorHex: string, code: string) {
  const pad = new THREE.Group();
  pad.position.copy(position);
  pad.rotation.set(...rotation);
  group.add(pad);

  // Ag/AgCl foam pad + gel layer
  addCylinder(pad, 0.44, 0.022, parts.gel, 0, 0.004, 0);
  addCylinder(pad, 0.49, 0.042, parts.foam, 0, 0.036, 0);
  addRing(pad, 0.475, 0.011, parts.foam, 0, 0.056, 0);
  // Stainless-steel male stud base + female snap-button housing (母扣)
  addCylinder(pad, 0.14, 0.022, parts.tin, 0, 0.068, 0);
  addCylinder(pad, 0.088, 0.038, parts.steelLip, 0, 0.095, 0);

  const housingColor = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.48, metalness: 0.06 });
  const accentRing = new THREE.MeshStandardMaterial({ color: parseInt(colorHex.slice(1), 16), roughness: 0.42, metalness: 0.04 });
  addRounded(pad, 0.42, 0.25, 0.11, 0.084, housingColor, -0.092, 0.114, 0);
  // Color-coded channel band on the snap button strain relief
  addRounded(pad, 0.095, 0.19, 0.032, 0.068, accentRing, -0.31, 0.122, 0);

  const tag = createCanvasTexture(128, 96, (ctx) => {
    ctx.fillStyle = '#eef1f6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 42px Arial';
    ctx.fillText(code, 64, 48);
  });
  const print = addMesh(
    pad,
    new THREE.PlaneGeometry(0.24, 0.18),
    new THREE.MeshBasicMaterial({ map: tag, transparent: true, depthWrite: false }),
    v(-0.07, 0.209, 0),
    false,
  );
  print.rotation.x = -Math.PI / 2;

  return { pad, outlet: v(-0.365, 0.158, 0) };
}

function buildMotionLabHardware(scene: THREE.Scene) {
  const parts = buildPartsLibrary();
  const kit = new THREE.Group();
  scene.add(kit);

  const esp = addEsp32S3(kit, parts);
  const ads = addAds1298(kit, parts);
  const imus = addImuModules(kit, parts);

  const emgGroup = new THREE.Group();
  kit.add(emgGroup);

  // 6 EMG Ag/AgCl snap-button pads fanned cleanly in 2 sleek rows on the right
  const padLayouts: { pos: THREE.Vector3; rot: [number, number, number] }[] = [
    { pos: v(3.85, 0.07, -1.92), rot: [-0.05, -0.22, 0.04] }, // BB
    { pos: v(5.15, 0.06, -1.20), rot: [-0.02, -0.14, 0.03] }, // TB
    { pos: v(4.02, 0.06, -0.44), rot: [0.02, -0.05, 0.02] },  // AD
    { pos: v(5.32, 0.06,  0.34), rot: [0.03,  0.08, -0.02] }, // MD
    { pos: v(4.08, 0.06,  1.10), rot: [0.05,  0.16, -0.03] }, // FCR
    { pos: v(5.08, 0.07,  1.86), rot: [0.06,  0.24, -0.04] }, // ECR
  ];

  const pads = EMG_CHANNELS.map((ch, idx) =>
    addEmgSnapPad(emgGroup, parts, padLayouts[idx].pos, padLayouts[idx].rot, ch.hex, ch.code),
  );

  kit.updateMatrixWorld(true);

  // 1. SPI + Power jumper harness: ESP32-S3 <-> ADS1298
  SPI_JUMPERS.forEach(({ ads: key, color }, idx) => {
    const srcLocal = ads.spiTerminals.get(key);
    const dstLocal = esp.spiTerminals.get(key);
    if (!srcLocal || !dstLocal) return;
    const source = ads.pcb.localToWorld(srcLocal.clone());
    const target = esp.pcb.localToWorld(dstLocal.clone());
    const archY = 0.86 + (idx % 3) * 0.09;
    const mid1 = source.clone().lerp(target, 0.34).setY(archY);
    const mid2 = source.clone().lerp(target, 0.68).setY(archY - 0.03);
    addWire(
      kit,
      [source, source.clone().add(v(-0.06, 0.14, 0)), mid1, mid2, target.clone().add(v(0.06, 0.14, 0)), target],
      0.019,
      new THREE.MeshStandardMaterial({ color, roughness: 0.56 }),
    );
  });

  // 2. I2C / Power daisy-chain harness: ESP32-S3 -> IMU-1 -> IMU-2 -> IMU-3
  const busColors = [0x8a483a, 0x26292e, 0x4b6380, 0x6b5c7d];
  const espBusKeys = ['3V3', 'GND', 'SDA', 'SCL'] as const;
  espBusKeys.forEach((key, lane) => {
    const startLocal = esp.imuTerminals.get(key);
    if (!startLocal) return;
    const start = esp.pcb.localToWorld(startLocal.clone());
    const imu1Outlets = imus.pcbs[0].userData.outlet as THREE.Vector3[];
    const imu1Pt = imus.pcbs[0].localToWorld(imu1Outlets[lane].clone());
    const wireMat = new THREE.MeshStandardMaterial({ color: busColors[lane], roughness: 0.58 });
    const mid = start.clone().lerp(imu1Pt, 0.5);
    mid.y = 0.62 + lane * 0.035;
    mid.z += 0.28;
    addWire(kit, [start, start.clone().add(v(0, 0.11, 0.08)), mid, imu1Pt.clone().add(v(0, 0.12, -0.06)), imu1Pt], 0.0155, wireMat);

    // Daisy-chain IMU-1 -> IMU-2 -> IMU-3
    for (let i = 0; i < 2; i++) {
      const aOut = imus.pcbs[i].userData.outlet as THREE.Vector3[];
      const bOut = imus.pcbs[i + 1].userData.outlet as THREE.Vector3[];
      const pA = imus.pcbs[i].localToWorld(aOut[lane].clone());
      const pB = imus.pcbs[i + 1].localToWorld(bOut[lane].clone());
      const m = pA.clone().lerp(pB, 0.5);
      m.y = 0.34 + lane * 0.022;
      m.z -= 0.18 + lane * 0.035;
      addWire(kit, [pA, pA.clone().add(v(0.04, 0.10, -0.08)), m, pB.clone().add(v(-0.04, 0.10, -0.08)), pB], 0.014, wireMat);
    }
  });

  // 3. 6-Channel EMG 2.54mm DuPont -> Cable Comb -> Female Snap-Button Electrode Leads
  const combX = 2.02;
  const comb = addRounded(emgGroup, 0.24, 1.34, 0.045, 0.10, parts.plug, combX, 0.08, -0.10);
  comb.rotation.y = 0.06;

  ads.emgTerminals.forEach(({ color, point }, idx) => {
    const start = ads.pcb.localToWorld(point.clone());
    const end = pads[idx].pad.localToWorld(pads[idx].outlet.clone());
    const combZ = -0.58 + idx * 0.195;
    const combPt = v(combX, 0.135, combZ);
    const preComb = v(start.x + 0.45, 0.52 - idx * 0.015, start.z + (combZ - start.z) * 0.35);
    const postComb = v(combX + 0.65, 0.145, combZ + (end.z - combZ) * 0.42);
    const prePad = end.clone().add(v(-0.42, 0.05, 0));

    // Sleek dark-graphite lead cable with subtle channel tint
    const cableColor = new THREE.Color(0x3a3e47).lerp(new THREE.Color(color), 0.28);
    const cableMat = new THREE.MeshStandardMaterial({ color: cableColor, roughness: 0.55 });
    addWire(
      emgGroup,
      [start, start.clone().add(v(0.08, 0.16, 0)), preComb, combPt, postComb, prePad, end],
      0.0185,
      cableMat,
    );
  });

  // Center entire assembly cleanly above studio floor
  const bounds = new THREE.Box3().setFromObject(kit);
  const center = bounds.getCenter(v());
  kit.position.set(-center.x, 0.012 - bounds.min.y, -center.z);
  kit.updateMatrixWorld(true);

  return {
    kit,
    groups: {
      esp32: esp.pcb,
      ads1298: ads.pcb,
      imu: imus.imuGroup,
      emg: emgGroup,
    },
    shadowSpots: [
      { pos: esp.pcb.getWorldPosition(v()), w: 5.2, d: 2.5, opacity: 0.36 },
      { pos: ads.pcb.getWorldPosition(v()), w: 3.9, d: 3.4, opacity: 0.38 },
      ...imus.pcbs.map((p) => ({ pos: p.getWorldPosition(v()), w: 1.9, d: 1.6, opacity: 0.34 })),
      ...pads.map(({ pad }) => ({ pos: pad.getWorldPosition(v()), w: 1.45, d: 1.45, opacity: 0.38 })),
    ],
  };
}

function addStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const studio = createCanvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#383b42';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#e8eaef';
    ctx.fillRect(42, 38, 128, 72);
    ctx.fillStyle = '#b9bec9';
    ctx.fillRect(268, 30, 112, 52);
    ctx.fillStyle = '#c4c7ce';
    ctx.fillRect(394, 68, 66, 70);
    ctx.fillStyle = '#7c808a';
    ctx.fillRect(0, 132, 512, 124);
  });
  studio.mapping = THREE.EquirectangularReflectionMapping;
  const generator = new THREE.PMREMGenerator(renderer);
  scene.environment = generator.fromEquirectangular(studio).texture;
  scene.environmentIntensity = 0.78;
  studio.dispose();
  generator.dispose();
}

function addStudioLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7c8088, 2.35));
  const key = new THREE.DirectionalLight(0xfffefd, 2.95);
  key.position.set(-3.5, 8.2, 4.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.025;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.camera.far = 24;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xe6eeff, 1.35);
  fill.position.set(4.5, 2.5, -5.0);
  scene.add(fill);

  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.ShadowMaterial({ opacity: 0.055 }),
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);
}

function addContactShadows(kit: THREE.Group, spots: { pos: THREE.Vector3; w: number; d: number; opacity: number }[]) {
  const falloff = createCanvasTexture(96, 96, (ctx) => {
    const grad = ctx.createRadialGradient(48, 48, 2, 48, 48, 46);
    grad.addColorStop(0, 'rgba(18,22,30,.42)');
    grad.addColorStop(0.48, 'rgba(18,22,30,.22)');
    grad.addColorStop(1, 'rgba(18,22,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 96, 96);
  });
  spots.forEach(({ pos, w, d, opacity }) => {
    const item = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: falloff, transparent: true, opacity, depthWrite: false }),
    );
    item.rotation.x = -Math.PI / 2;
    item.position.copy(kit.worldToLocal(v(pos.x + 0.07, 0.003, pos.z - 0.02)));
    kit.add(item);
  });
}

export default memo(function HardwareHero({ focus, onFocusChange, replayToken, fallbackMessage, stageLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const controlRef = useRef<{ setFocus: (f: HardwareFocus) => void; replay: () => void } | null>(null);
  const onFocusRef = useRef(onFocusChange);
  onFocusRef.current = onFocusChange;

  useEffect(() => {
    const stage = containerRef.current;
    if (!stage) return;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
    if (!context) {
      setFailed(true);
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 70);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0xf4f5f7, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;

    addStudioEnvironment(renderer, scene);
    addStudioLighting(scene);

    const hardware = buildMotionLabHardware(scene);
    addContactShadows(hardware.kit, hardware.shadowSpots);
    renderer.shadowMap.needsUpdate = true;

    const kitBox = new THREE.Box3().setFromObject(hardware.kit);
    const corners = [kitBox.min.x, kitBox.max.x].flatMap((x) =>
      [kitBox.min.y, kitBox.max.y].flatMap((y) => [kitBox.min.z, kitBox.max.z].map((z) => v(x, y, z))),
    );

    const groupEntries: [Exclude<HardwareFocus, 'overview'>, THREE.Box3][] = [
      ['esp32', new THREE.Box3().setFromObject(hardware.groups.esp32)],
      ['ads1298', new THREE.Box3().setFromObject(hardware.groups.ads1298)],
      ['imu', new THREE.Box3().setFromObject(hardware.groups.imu)],
      ['emg', new THREE.Box3().setFromObject(hardware.groups.emg)],
    ];

    stage.prepend(canvas);

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const currentView = { ...INITIAL_VIEW };
    const goalView = { ...INITIAL_VIEW };
    const overviewTarget = v(0, 0.42, 0);
    const currentTarget = overviewTarget.clone();
    const goalTarget = overviewTarget.clone();
    let currentFocus: HardwareFocus = 'overview';
    let currentDist = 15.2;
    let goalDist = 15.2;
    let animFrame = 0;
    const backward = v();
    const right = v();
    const up = v();
    const relative = v();
    const verticalFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.94;
    const ray = new THREE.Raycaster();

    function computeGoalDistance(f: HardwareFocus) {
      if (f === 'overview') return Math.max(12.2, 28.5 / camera.aspect);
      const map: Record<Exclude<HardwareFocus, 'overview'>, number> = {
        esp32: 8.6,
        ads1298: 7.6,
        imu: 8.4,
        emg: 9.8,
      };
      const base = map[f];
      return Math.max(base, (base * 1.25) / camera.aspect);
    }

    function renderFrame() {
      const sinYaw = Math.sin(currentView.yaw);
      const cosYaw = Math.cos(currentView.yaw);
      const cosPitch = Math.cos(currentView.pitch);
      backward.set(sinYaw * cosPitch, Math.sin(currentView.pitch), cosYaw * cosPitch);
      let fitted = currentDist;
      if (currentFocus === 'overview') {
        right.set(cosYaw, 0, -sinYaw);
        up.crossVectors(backward, right);
        for (const corner of corners) {
          relative.copy(corner).sub(currentTarget);
          const horizontal = Math.abs(relative.dot(right)) / (camera.aspect * verticalFov);
          const vertical = Math.abs(relative.dot(up)) / verticalFov;
          fitted = Math.max(fitted, relative.dot(backward) + Math.max(horizontal, vertical));
        }
      }
      camera.position.copy(currentTarget).addScaledVector(backward, fitted);
      camera.lookAt(currentTarget);
      renderer.render(scene, camera);
    }

    function scheduleMotion() {
      if (animFrame) return;
      const step = () => {
        animFrame = 0;
        const alpha = reducedMotion.matches ? 1 : 0.14;
        currentView.yaw += (goalView.yaw - currentView.yaw) * alpha;
        currentView.pitch += (goalView.pitch - currentView.pitch) * alpha;
        currentDist += (goalDist - currentDist) * alpha;
        currentTarget.lerp(goalTarget, alpha);
        renderFrame();
        const settled =
          Math.abs(goalView.yaw - currentView.yaw) < 0.0008 &&
          Math.abs(goalView.pitch - currentView.pitch) < 0.0008 &&
          Math.abs(goalDist - currentDist) < 0.01 &&
          currentTarget.distanceTo(goalTarget) < 0.006;
        if (!settled) animFrame = requestAnimationFrame(step);
      };
      animFrame = requestAnimationFrame(step);
    }

    function applyFocus(next: HardwareFocus) {
      currentFocus = next;
      if (next === 'overview') {
        goalTarget.copy(overviewTarget);
        goalView.yaw = INITIAL_VIEW.yaw;
        goalView.pitch = INITIAL_VIEW.pitch;
      } else {
        const entry = groupEntries.find(([id]) => id === next);
        if (entry) entry[1].getCenter(goalTarget);
        goalView.pitch = next === 'imu' ? 0.66 : 0.72;
        goalView.yaw = next === 'esp32' ? 0.22 : next === 'ads1298' ? 0.10 : next === 'imu' ? 0.04 : -0.14;
      }
      goalDist = computeGoalDistance(next);
      scheduleMotion();
    }

    function playIntro() {
      currentFocus = 'overview';
      goalTarget.copy(overviewTarget);
      currentTarget.copy(overviewTarget);
      goalView.yaw = INITIAL_VIEW.yaw;
      goalView.pitch = INITIAL_VIEW.pitch;
      goalDist = computeGoalDistance('overview');
      if (reducedMotion.matches) {
        currentView.yaw = goalView.yaw;
        currentView.pitch = goalView.pitch;
        currentDist = goalDist;
        renderFrame();
        return;
      }
      currentView.yaw = INITIAL_VIEW.yaw - 0.26;
      currentView.pitch = INITIAL_VIEW.pitch + 0.08;
      currentDist = goalDist * 1.09;
      scheduleMotion();
    }

    function resize() {
      const { width, height } = stage!.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      camera.aspect = width / height;
      goalDist = computeGoalDistance(currentFocus);
      currentDist = goalDist;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderFrame();
    }

    controlRef.current = { setFocus: applyFocus, replay: playIntro };

    // Drag to orbit with smooth spring inertia
    let drag: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || !event.isPrimary) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: goalView.yaw, pitch: goalView.pitch };
      canvas.setPointerCapture(event.pointerId);
      setOrbiting(true);
    }
    function onPointerMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      goalView.yaw = drag.yaw - dx * 0.007;
      goalView.pitch = THREE.MathUtils.clamp(drag.pitch + dy * 0.004, 0.14, 0.90);
      scheduleMotion();
    }
    function onPointerUp(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      setOrbiting(false);
    }
    function onDoubleClick(event: MouseEvent) {
      const bounds = canvas.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          1 - ((event.clientY - bounds.top) / bounds.height) * 2,
        ),
        camera,
      );
      const hit = groupEntries.find(([, box]) => ray.ray.intersectsBox(box));
      const next: HardwareFocus = hit ? (currentFocus === hit[0] ? 'overview' : hit[0]) : 'overview';
      onFocusRef.current(next);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') { goalView.yaw -= 0.18; scheduleMotion(); }
      else if (event.key === 'ArrowRight') { goalView.yaw += 0.18; scheduleMotion(); }
      else if (event.key === 'Home') { onFocusRef.current('overview'); }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    stage.addEventListener('keydown', onKeyDown);

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    playIntro();

    return () => {
      cancelAnimationFrame(animFrame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      stage.removeEventListener('keydown', onKeyDown);
      controlRef.current = null;
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    controlRef.current?.setFocus(focus);
  }, [focus]);

  useEffect(() => {
    if (replayToken > 0) controlRef.current?.replay();
  }, [replayToken]);

  return <div ref={containerRef} className={'motion-home-stage' + (orbiting ? ' is-orbiting' : '')}
    tabIndex={0} aria-label={stageLabel}>
    {failed && <span className="motion-scene-error" role="status">{fallbackMessage}</span>}
  </div>;
});
