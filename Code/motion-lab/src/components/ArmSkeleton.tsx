import { ContactShadows, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackSide, BufferAttribute, BufferGeometry, DoubleSide, type Group, type MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three';
import { emgPalette } from '../emgPalette';
import type { BaChannel } from '../baSignal';
import type { ActivationReader } from '../pose/activation';
import type { PoseSource } from '../pose/PoseSource';
import type { PoseClock } from '../pose/poseClock';
import { armDimensions as dimensions, imuTimeOffsetMs } from '../pose/poseConfig';
import { jointAngles, type JointAngles } from '../pose/jointAngles';
import { add, applyCalibration, jointPositions, neutralPose, normalizeQuat, rotate, sideSign, toThreeQuaternion, toThreeVector, type Calibration, type Vec3 } from '../pose/poseMath';
import type { PoseView } from './PosePanel';

export type AngleKey = 'abduction' | 'flexion' | 'elbow' | 'trunkTilt';

type SceneProps = {
  source: PoseSource;
  calibration: Calibration;
  clock: PoseClock;
  view: PoseView;
  orbit: boolean;
  muscle: BaChannel | null;
  focusAngle?: AngleKey | null;
  activation: ActivationReader;
  presentation?: boolean;
  angleShortLabels?: Record<AngleKey, string>;
};

const limbColor = '#E7E9EE';
const accent = '#3F4756';
const amber = '#D97706';
const forearmLength = dimensions.upperArm * dimensions.forearmRatio;
const arcSegments = 28;
const angleScale = Math.PI / 180;

const ANGLE_COLORS: Record<AngleKey, string> = {
  abduction: '#2B8CBE',
  flexion:   '#009E73',
  elbow:     '#7E57C2',
  trunkTilt: '#D95F02',
};

function CameraRig({ view, calibration, side, orbit, presentation }: Pick<SceneProps, 'view' | 'calibration' | 'orbit' | 'presentation'> & { side: PoseSource['side'] }) {
  const { camera, size, invalidate } = useThree();
  const target = useMemo(() => toThreeVector(rotate(calibration.heading, [.19, 0, .03])), [calibration]);
  useEffect(() => {
    const offset: Vec3 = presentation ? [2.4, sideSign(side) * 2.3, 1.35]
      : view === 'front' ? [3.3, 0, .19] : view === 'side' ? [0, sideSign(side) * 3.3, .26] : [.0001, 0, 3.2];
    const up: Vec3 = view === 'top' ? toThreeVector(rotate(calibration.heading, [1, 0, 0])) : [0, 1, 0];
    camera.up.set(...up);
    camera.position.set(...add(target, toThreeVector(rotate(calibration.heading, offset))));
    camera.lookAt(...target);
    if (camera instanceof OrthographicCamera) {
      camera.zoom = Math.max(1, Math.min(size.width / 1.88, size.height / 1.28));
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, size.width, size.height, view, calibration, side, target, invalidate, orbit, presentation]);
  return orbit ? <OrbitControls target={target} enablePan={false} enableDamping={false}
    minZoom={45} maxZoom={500} enableRotate /> : null;
}

function Joint({ radius = dimensions.jointRadius }: { radius?: number }) {
  return <mesh castShadow><sphereGeometry args={[radius, 20, 12]} />
    <meshStandardMaterial color="#CFD5E0" roughness={.52} metalness={.08} /></mesh>;
}

function Bone({ length, radius }: { length: number; radius: number }) {
  return <mesh position={[0, -length / 2, 0]} castShadow receiveShadow>
    <capsuleGeometry args={[radius, Math.max(.01, length - 2 * radius), 8, 16]} />
    <meshStandardMaterial color={limbColor} roughness={.56} metalness={.05} />
  </mesh>;
}

function Muscle({ channel, shape, length, hovered, activation, clock }: {
  channel: BaChannel; shape: Vec3; length: number; hovered: boolean; activation: ActivationReader; clock: PoseClock;
}) {
  const region = useRef<Group>(null);
  const surface = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    if (!region.current || !surface.current) return;
    const value = activation(channel, clock.current().timeMs);
    region.current.visible = hovered || (value !== null && value > .015);
    surface.current.emissiveIntensity = value === null ? 0 : value * .88;
    surface.current.color.set(value !== null && value > .015 ? '#F2E6D7' : limbColor);
  });
  return <group ref={region} position={shape} visible={false}>
    <mesh>
      <capsuleGeometry args={[.031, length, 5, 10]} />
      <meshStandardMaterial ref={surface} color={limbColor} emissive={amber} emissiveIntensity={0} roughness={.66} />
    </mesh>
    {hovered && <mesh scale={[1.14, 1.045, 1.14]}>
      <capsuleGeometry args={[.031, length, 5, 10]} />
      <meshBasicMaterial color={emgPalette[channel].raw} side={BackSide} />
    </mesh>}
  </group>;
}

function createSectorGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(arcSegments * 6 * 3), 3));
  return geometry;
}

function createRayGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
  return geometry;
}

/**
 * Writes a 3D planar sector between unit vectors `dirA` and `dirB` around origin (0,0,0).
 */
function writeVectorArc(
  geometry: BufferGeometry,
  dirA: Vector3,
  dirB: Vector3,
  radius: number,
  thickness: number,
  outMid: Vector3,
) {
  const attr = geometry.getAttribute('position');
  const inside = thickness > 0 ? Math.max(0, radius - thickness) : 0;
  const dotVal = Math.max(-0.9995, Math.min(0.9995, dirA.dot(dirB)));
  const totalAngle = Math.acos(dotVal);

  // Orthonormal tangent in the plane from dirA toward dirB
  const tangent = dirB.clone().addScaledVector(dirA, -dotVal);
  if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
  else tangent.normalize();

  const sample = (theta: number, r: number, target: Vector3) =>
    target.copy(dirA).multiplyScalar(Math.cos(theta) * r).addScaledVector(tangent, Math.sin(theta) * r);

  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  const p3 = new Vector3();

  for (let i = 0; i < arcSegments; i++) {
    const a = (totalAngle * i) / arcSegments;
    const b = (totalAngle * (i + 1)) / arcSegments;
    sample(a, inside, p0);
    sample(a, radius, p1);
    sample(b, radius, p2);
    sample(b, inside, p3);
    const o = i * 6;
    attr.setXYZ(o, p0.x, p0.y, p0.z);
    attr.setXYZ(o + 1, p1.x, p1.y, p1.z);
    attr.setXYZ(o + 2, p2.x, p2.y, p2.z);
    attr.setXYZ(o + 3, p0.x, p0.y, p0.z);
    attr.setXYZ(o + 4, p2.x, p2.y, p2.z);
    attr.setXYZ(o + 5, p3.x, p3.y, p3.z);
  }
  attr.needsUpdate = true;
  sample(totalAngle * 0.55, radius + 0.068, outMid);
}

function writeRay(geometry: BufferGeometry, dir: Vector3, length: number) {
  const attr = geometry.getAttribute('position');
  attr.setXYZ(0, 0, 0, 0);
  attr.setXYZ(1, dir.x * length, dir.y * length, dir.z * length);
  attr.needsUpdate = true;
}

/**
 * Renders all 4 clinical IMU joint angles (Shoulder Abduction, Shoulder Flexion,
 * Elbow Flexion, Trunk Tilt) directly in 3D space with color-coded arcs and tags.
 */
function FourAngleOverlay({
  clock, source, calibration, focusAngle, labels,
}: {
  clock: PoseClock;
  source: PoseSource;
  calibration: Calibration;
  focusAngle?: AngleKey | null;
  labels: Record<AngleKey, string>;
}) {
  const keys: AngleKey[] = ['abduction', 'flexion', 'elbow', 'trunkTilt'];
  const meshes = useMemo(() => keys.map((key) => ({
    key,
    fill: createSectorGeometry(),
    edge: createSectorGeometry(),
    refRay: createRayGeometry(),
    color: ANGLE_COLORS[key],
  })), []);

  const groupRefs = useRef<Record<AngleKey, Group | null>>({ abduction: null, flexion: null, elbow: null, trunkTilt: null });
  const tagAnchors = useRef<Record<AngleKey, Group | null>>({ abduction: null, flexion: null, elbow: null, trunkTilt: null });
  const tagNodes = useRef<Record<AngleKey, HTMLSpanElement | null>>({ abduction: null, flexion: null, elbow: null, trunkTilt: null });

  useEffect(() => () => {
    meshes.forEach(({ fill, edge, refRay }) => {
      fill.dispose();
      edge.dispose();
      refRay.dispose();
    });
  }, [meshes]);

  const side = sideSign(source.side);
  const tmpA = useMemo(() => new Vector3(), []);
  const tmpB = useMemo(() => new Vector3(), []);
  const tmpMid = useMemo(() => new Vector3(), []);

  useFrame(({ camera }) => {
    const tick = clock.current();
    const frame = source.getFrameAt((tick.timeMs - imuTimeOffsetMs) / 1000);
    const q = applyCalibration(frame.q, calibration.offsets);
    const angles: JointAngles = jointAngles(q, source.side, calibration.heading);
    const positions = jointPositions(q, source.side);
    const zoom = camera instanceof OrthographicCamera ? camera.zoom : 110;
    const stroke = 1.4 / zoom;

    const setArc = (
      key: AngleKey,
      origin: Vec3 | null,
      dirA: Vector3,
      dirB: Vector3,
      value: number | null,
      radius: number,
      meshIdx: number,
      tagShift?: Vector3,
    ) => {
      const grp = groupRefs.current[key];
      const anchor = tagAnchors.current[key];
      const tag = tagNodes.current[key];
      if (!grp || !anchor) return;
      if (value === null || !origin) {
        grp.visible = false;
        return;
      }
      grp.visible = true;
      grp.position.set(origin[0], origin[1], origin[2]);
      const rad = Math.max(0.03, Math.abs(value) * angleScale);
      const bNorm = dirB.clone().normalize();
      const aNorm = dirA.clone().normalize();
      if (aNorm.distanceToSquared(bNorm) < 1e-4) {
        bNorm.copy(aNorm).applyAxisAngle(new Vector3(0, 0, 1), rad);
      }
      writeVectorArc(meshes[meshIdx].fill, aNorm, bNorm, radius, 0, tmpMid);
      writeVectorArc(meshes[meshIdx].edge, aNorm, bNorm, radius, stroke, tmpMid);
      writeRay(meshes[meshIdx].refRay, aNorm, radius * 1.08);
      if (tagShift) tmpMid.add(tagShift);
      anchor.position.copy(tmpMid);
      if (tag) {
        const text = `${labels[key]} ${Math.round(value)}°`;
        if (tag.textContent !== text) tag.textContent = text;
      }
    };

    const shoulderThree = positions.shoulder ? toThreeVector(positions.shoulder) : null;
    const elbowThree = positions.elbow ? toThreeVector(positions.elbow) : null;
    const qTrunk = q.trunk ? normalizeQuat(q.trunk) : null;
    const qUpper = q.upperArm ? normalizeQuat(q.upperArm) : null;
    const qFore = q.forearm ? normalizeQuat(q.forearm) : null;
    const trunkDown = qTrunk ? new Vector3(...toThreeVector(rotate(qTrunk, [0, 0, -1]))).normalize() : new Vector3(0, -1, 0);
    const trunkForward = qTrunk ? new Vector3(...toThreeVector(rotate(qTrunk, [1, 0, 0]))).normalize() : new Vector3(1, 0, 0);
    const trunkLateral = qTrunk ? new Vector3(...toThreeVector(rotate(qTrunk, [0, side, 0]))).normalize() : new Vector3(0, 0, -side);

    // 1. Shoulder Abduction (coronal plane — tag placed laterally outward & higher away from torso)
    if (angles.abduction !== null) {
      const aRad = angles.abduction * angleScale;
      tmpA.copy(trunkDown);
      tmpB.copy(trunkDown).multiplyScalar(Math.cos(aRad)).addScaledVector(trunkLateral, Math.sin(aRad));
      const abdShift = trunkLateral.clone().multiplyScalar(0.32).addScaledVector(trunkDown, -0.19);
      setArc('abduction', shoulderThree, tmpA, tmpB, angles.abduction, 0.21, 0, abdShift);
    } else setArc('abduction', null, tmpA, tmpB, null, 0.21, 0);

    // 2. Shoulder Flexion (sagittal plane — tag placed medially, anteriorly & lower to avoid abduction pill)
    if (angles.flexion !== null) {
      const fRad = angles.flexion * angleScale;
      tmpA.copy(trunkDown);
      tmpB.copy(trunkDown).multiplyScalar(Math.cos(fRad)).addScaledVector(trunkForward, Math.sin(fRad));
      const flexShift = trunkLateral.clone().multiplyScalar(-0.28).addScaledVector(trunkForward, 0.14).addScaledVector(trunkDown, 0.12);
      setArc('flexion', shoulderThree, tmpA, tmpB, angles.flexion, 0.165, 1, flexShift);
    } else setArc('flexion', null, tmpA, tmpB, null, 0.165, 1);

    // 3. Elbow Flexion (between upper-arm distal extension ray and forearm ray at elbow hinge)
    if (angles.elbow !== null && qUpper && qFore) {
      const uVec = new Vector3(...toThreeVector(rotate(qUpper, neutralPose.distal))).normalize();
      const fVec = new Vector3(...toThreeVector(rotate(qFore, neutralPose.distal))).normalize();
      const elbowShift = trunkDown.clone().multiplyScalar(0.15).addScaledVector(trunkLateral, 0.14);
      setArc('elbow', elbowThree, uVec, fVec, angles.elbow, 0.16, 2, elbowShift);
    } else setArc('elbow', null, tmpA, tmpB, null, 0.16, 2);

    // 4. Trunk Tilt (at superior sternum/neck relative to neutral world vertical)
    if (angles.trunkTilt !== null && qTrunk) {
      const worldUp = new Vector3(...toThreeVector(rotate(calibration.heading, [0, 0, 1]))).normalize();
      const trunkUp = new Vector3(...toThreeVector(rotate(qTrunk, [0, 0, 1]))).normalize();
      const neckPos = toThreeVector(rotate(qTrunk, [0, 0, 0.30]));
      const trunkShift = new Vector3(0, -0.02, 0);
      setArc('trunkTilt', neckPos, worldUp, trunkUp, angles.trunkTilt, 0.16, 3, trunkShift);
    } else setArc('trunkTilt', null, tmpA, tmpB, null, 0.16, 3);
  });

  return <>
    {meshes.map(({ key, fill, edge, refRay, color }) => {
      const dimmed = focusAngle != null && focusAngle !== key;
      const highlighted = focusAngle === key;
      return <group key={key} ref={(el) => { groupRefs.current[key] = el; }} visible={false}>
        <lineSegments geometry={refRay} renderOrder={2}>
          <lineBasicMaterial color={color} transparent opacity={dimmed ? 0.18 : 0.48} depthTest={false} />
        </lineSegments>
        <mesh geometry={fill} frustumCulled={false} renderOrder={3}>
          <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.05 : highlighted ? 0.24 : 0.13} side={DoubleSide} depthWrite={false} depthTest={false} />
        </mesh>
        <mesh geometry={edge} frustumCulled={false} renderOrder={4}>
          <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.25 : 0.88} side={DoubleSide} depthWrite={false} depthTest={false} />
        </mesh>
        <group ref={(el) => { tagAnchors.current[key] = el; }}>
          <Html center zIndexRange={[5, 1]}>
            <span
              className={'pose-angle-pill' + (highlighted ? ' is-focused' : dimmed ? ' is-dimmed' : '')}
              style={{ '--angle-color': color } as React.CSSProperties}
              ref={(el) => { tagNodes.current[key] = el; }}
            />
          </Html>
        </group>
      </group>;
    })}
  </>;
}

const defaultShortLabels: Record<AngleKey, string> = {
  abduction: '外展',
  flexion: '屈曲',
  elbow: '肘角',
  trunkTilt: '躯干',
};

function Skeleton({ source, calibration, clock, muscle, focusAngle, activation, presentation, angleShortLabels }: Omit<SceneProps, 'view' | 'orbit'>) {
  const trunk = useRef<Group>(null);
  const upper = useRef<Group>(null);
  const lower = useRef<Group>(null);
  const side = sideSign(source.side);
  const shoulderLocal = toThreeVector([0, side * dimensions.shoulderLateral, dimensions.shoulderHeight]);

  useFrame(({ gl }) => {
    const tick = clock.current();
    const frame = source.getFrameAt((tick.timeMs - imuTimeOffsetMs) / 1000);
    const q = applyCalibration(frame.q, calibration.offsets);
    const { shoulder, elbow } = jointPositions(q, source.side);
    if (trunk.current) {
      trunk.current.visible = !!q.trunk;
      if (q.trunk) trunk.current.quaternion.set(...toThreeQuaternion(q.trunk));
    }
    if (upper.current) {
      upper.current.visible = Boolean(shoulder && q.upperArm);
      if (shoulder && q.upperArm) {
        upper.current.position.set(...toThreeVector(shoulder));
        upper.current.quaternion.set(...toThreeQuaternion(q.upperArm));
      }
    }
    if (lower.current) {
      lower.current.visible = Boolean(elbow && q.forearm);
      if (elbow && q.forearm) {
        lower.current.position.set(...toThreeVector(elbow));
        lower.current.quaternion.set(...toThreeQuaternion(q.forearm));
      }
    }
    gl.domElement.dataset.poseMs = String(tick.timeMs);
    gl.domElement.dataset.armSide = source.side;
    const n = Number(gl.domElement.dataset.poseRenderCount || 0);
    gl.domElement.dataset.poseRenderCount = String(n + 1);
  });

  const region = (channel: BaChannel, shape: Vec3, length: number) =>
    <Muscle channel={channel} shape={shape} length={length} hovered={muscle === channel} activation={activation} clock={clock} />;

  return <>
    <group ref={trunk}>
      <mesh castShadow receiveShadow scale={[dimensions.trunkDepth, dimensions.trunkHeight, dimensions.trunkWidth]}>
        <capsuleGeometry args={[.49, .21, 10, 20]} />
        <meshStandardMaterial color="#F6F7FA" roughness={.62} metalness={.03} />
      </mesh>
      <group position={shoulderLocal}>
        <Joint />
        <Html position={[.02, .14, -side * .075]} center zIndexRange={[4, 1]}>
          <span className="pose-side-tag">{source.side === 'left' ? 'L' : 'R'}</span>
        </Html>
        {region('AD', [.075, -.024, 0], .075)}
        {region('MD', [.021, -.027, -side * .072], .085)}
      </group>
    </group>
    <group ref={upper}>
      <Bone length={dimensions.upperArm} radius={dimensions.upperRadius} />
      {region('BB', [.068, -.22, 0], .17)}
      {region('TB', [-.067, -.23, 0], .17)}
      <group position={[0, -dimensions.upperArm, 0]}><Joint radius={.067} /></group>
    </group>
    <group ref={lower}>
      <Bone length={forearmLength} radius={dimensions.forearmRadius} />
      {region('FCR', [.055, -.17, 0], .135)}
      {region('ECR', [-.052, -.175, 0], .135)}
      <group position={[0, -forearmLength, 0]}><Joint radius={.052} /></group>
    </group>
    {!presentation && <FourAngleOverlay
      clock={clock}
      source={source}
      calibration={calibration}
      focusAngle={focusAngle}
      labels={angleShortLabels ?? defaultShortLabels}
    />}
  </>;
}

function DemandFrames({ clock, onLoss }: { clock: PoseClock; onLoss: () => void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    let visible = true;
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); onLoss(); };
    canvas.addEventListener('webglcontextlost', lost);
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) invalidate();
    });
    visibility.observe(canvas);
    const unsubscribe = clock.subscribe(() => { if (visible) invalidate(); });
    return () => {
      unsubscribe();
      visibility.disconnect();
      canvas.removeEventListener('webglcontextlost', lost);
    };
  }, [clock, gl, invalidate, onLoss]);
  return null;
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default memo(function ArmSkeleton({ message, fallbackImage, ...props }: SceneProps & { message: string; fallbackImage?: ReactNode }) {
  const [lost, setLost] = useState(false);
  const handleLoss = useCallback(() => setLost(true), []);
  const fallback = fallbackImage
    ? <>{fallbackImage}<span className="motion-scene-error" role="status">{message}</span></>
    : <div className="pose-empty well--empty pose-canvas-fallback" role="status">{message}</div>;
  const deskPosition = toThreeVector(rotate(props.calibration.heading, [.63, 0, props.calibration.deskZ]));
  if (lost) return fallback;

  return <CanvasBoundary fallback={fallback}>
    <Canvas style={{ position: 'absolute', inset: 0 }} frameloop="demand" dpr={[1, 2]} gl={{ alpha: true, antialias: true }} shadows
      orthographic camera={{ position: [3, 1, 0], near: .01, far: 20 }}
      onCreated={({ gl }) => gl.setClearColor('#FFFFFF', 0)}>
      <CameraRig {...props} side={props.source.side} />
      <DemandFrames clock={props.clock} onLoss={handleLoss} />
      <hemisphereLight args={['#FFFFFF', '#E5E8EE', 1.52]} />
      <directionalLight color="#FFFFFF" position={[3, 4, -3]} intensity={1.95} castShadow
        shadow-mapSize={[512, 512]} shadow-bias={-.0005} shadow-radius={3} />
      <directionalLight color="#CBD5E1" position={[-2, 1, 3]} intensity={.38} />
      <ContactShadows position={[.15, -.57, 0]} color="#64748B" opacity={.22} blur={2.9} scale={2.5} far={1} resolution={128} frames={1} />
      <group position={deskPosition} quaternion={toThreeQuaternion(props.calibration.heading)}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[.9, 1.29]} />
          <meshBasicMaterial color={accent} transparent opacity={.05} side={DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[-.448, 0, 0]}>
          <boxGeometry args={[.005, .005, 1.29]} />
          <meshBasicMaterial color={accent} transparent opacity={.14} />
        </mesh>
      </group>
      <Skeleton {...props} />
    </Canvas>
  </CanvasBoundary>;
});
