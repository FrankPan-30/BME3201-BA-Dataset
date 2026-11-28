import type { Lang } from '../text';

const en = {
  pose: 'IMU pose', waveform: 'Waveform', poseView: 'Pose', replay: 'Replay', live: 'Live',
  front: 'Front', side: 'Side', top: 'Top', rotate: 'Orbit', cameraViews: 'Camera view', panelView: 'Signal display',
  noData: 'No IMU data in this record', waiting: 'Waiting for IMU packets', calNeeded: 'Waiting for calibration',
  mock: 'Demo pose', demo: 'Synthetic preview', estimate: 'Pose illustration · estimated angles',
  abduction: 'Shoulder abduction', flexion: 'Shoulder flexion', elbow: 'Elbow flexion', trunkTilt: 'Trunk tilt',
  trunkForward: 'Forward', trunkLateral: 'Lateral', trunk: 'Trunk', upperArm: 'Upper arm', forearm: 'Forearm',
  ok: 'Signal OK', lost: 'Packet loss', missing: 'Unavailable', abnormal: 'Calibration warning',
  left: 'Left', right: 'Right', limbSide: 'Demo arm side', renderError: '3D rendering unavailable',
  importImu: 'Import IMU', detach: 'Detach IMU', imported: 'Local IMU record', importError: 'Invalid or mismatched IMU record',
  recordReplay: 'Offline replay', liveMode: 'Live IMU', connect: 'Open live file', disconnect: 'Disconnect',
  badPacket: 'Invalid packet skipped', connected: 'Watching live file', disconnected: 'Disconnected', liveError: 'Unable to read the live IMU file',
  pickerUnavailable: 'Live file picker unavailable', onlineNoEmg: 'Live source does not supply EMG',
  poseFile: 'Live quaternion stream',
};

const zh: typeof en = {
  pose: '姿态 · IMU', waveform: '波形', poseView: '姿态', replay: '回放', live: '实时',
  front: '正面', side: '侧面', top: '俯视', rotate: '自由旋转', cameraViews: '视角', panelView: '信号视图',
  noData: '此记录无 IMU 数据', waiting: '等待 IMU 数据包', calNeeded: '等待标定',
  mock: '演示姿态', demo: '合成示例', estimate: '姿态示意 · 角度为估计值',
  abduction: '肩外展', flexion: '肩屈曲', elbow: '肘屈曲', trunkTilt: '躯干倾斜',
  trunkForward: '前倾', trunkLateral: '侧倾', trunk: '躯干', upperArm: '上臂', forearm: '前臂',
  ok: '连接正常', lost: '丢包', missing: '未提供', abnormal: '标定异常',
  left: '左侧', right: '右侧', limbSide: '示例手臂侧别', renderError: '3D 无法渲染',
  importImu: '导入 IMU', detach: '移除 IMU', imported: '本地 IMU 记录', importError: 'IMU 记录无效或试次不匹配',
  recordReplay: '离线回放', liveMode: '实时 IMU', connect: '打开实时文件', disconnect: '断开',
  badPacket: '已跳过格式错误的数据包', connected: '正在读取实时文件', disconnected: '已断开', liveError: '无法读取实时 IMU 文件',
  pickerUnavailable: '实时文件选择器不可用', onlineNoEmg: '实时来源未提供肌电',
  poseFile: '实时四元数流',
};
export const poseLabels = (language: Lang) => language === 'zh' ? zh : en;
export type PoseLabels = typeof en;
