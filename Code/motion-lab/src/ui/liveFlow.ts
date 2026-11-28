export type Transport = 'usb' | 'ble';
export type Health = 'dual' | 'emg-only' | 'imu-only' | 'offline';
export type DemoError = 'busy' | 'permission' | 'meta' | 'empty' | 'crc' | 'ble' | 'bandwidth';
export type Stream = 'emg' | 'imu';
export type Stage = 'idle' | 'connecting' | 'preview' | 'calibrating' | 'recording'
  | 'reconnecting' | 'stopping' | 'review' | 'error';

export type Gap = { stream: Stream; from: number; to: number | null };
export type UiTrial = {
  number: number; start: number; duration: number; transport: Transport;
  calibrated: boolean; initialHealth: Health; markers: number[]; gaps: Gap[];
};
export type LiveFlow = {
  stage: Stage; transport: Transport; health: Health; connectedAt: number | null;
  opening: boolean; calibrated: boolean; calibrationAt: number | null; calibrationNote: 'stationary' | 'motion' | 'interrupted' | null;
  droppedAt: number | null; confirm: 'emg' | 'imu' | null; error: DemoError | null;
  draft: UiTrial | null; summary: UiTrial | null; next: number;
};

export const calibrationMs = 3000;
export function initialLiveFlow(next = 1): LiveFlow {
  return {
    stage: 'idle', transport: 'usb', health: 'offline', connectedAt: null, opening: false,
    calibrated: false, calibrationAt: null, calibrationNote: null, droppedAt: null, confirm: null,
    error: null, draft: null, summary: null, next,
  };
}
export const streamAvailable = (health: Health, stream: Stream) => health === 'dual' || health === stream + '-only';
const streams = ['emg', 'imu'] as const;

function updateGaps(existing: Gap[], health: Health, at: number): Gap[] {
  let gaps = existing;
  for (const stream of streams) {
    const open = gaps.find((gap) => gap.stream === stream && gap.to === null);
    if (!streamAvailable(health, stream) && !open) gaps = [...gaps, { stream, from: at, to: null }];
    if (streamAvailable(health, stream) && open) gaps = gaps.map((gap) => gap === open ? { ...gap, to: at } : gap);
  }
  return gaps;
}
function start(state: LiveFlow, now: number): LiveFlow {
  return { ...state, stage: 'recording', confirm: null, summary: null, next: state.next + 1,
    draft: { number: state.next, start: now, duration: 0, transport: state.transport, calibrated: state.calibrated,
      initialHealth: state.health, markers: [], gaps: updateGaps([], state.health, 0) } };
}
function resetLink(state: LiveFlow): LiveFlow {
  return { ...initialLiveFlow(state.next), transport: state.transport, summary: state.summary };
}

export type LiveAction =
  | { type: 'restore-number'; next: number }
  | { type: 'transport'; value: Transport } | { type: 'health'; value: Health; now: number }
  | { type: 'error'; value: NonNullable<LiveFlow['error']> }
  | { type: 'connect' | 'choose' | 'cancel' | 'disconnect' | 'retry' | 'new' | 'discard' | 'saved' }
  | { type: 'connected' | 'calibrate' | 'cancel-calibration' | 'finish-calibration' | 'motion' |
    'start' | 'accept' | 'end' | 'mark'; now: number }
  | { type: 'dismiss-confirm' };

export function liveFlow(state: LiveFlow, action: LiveAction): LiveFlow {
  switch (action.type) {
    case 'restore-number': return action.next > state.next ? { ...state, next: action.next } : state;
    case 'transport': return state.stage === 'idle' ? { ...state, transport: action.value } : state;
    case 'connect': case 'retry':
      return state.stage === 'idle' || state.stage === 'error' ? { ...resetLink(state), stage: 'connecting' } : state;
    case 'choose': return state.stage === 'connecting' ? { ...state, opening: true } : state;
    case 'cancel': return state.stage === 'connecting' ? resetLink(state) : state;
    case 'connected':
      return state.stage === 'connecting' && state.opening
        ? { ...state, stage: 'preview', health: 'dual', connectedAt: action.now, opening: false } : state;
    case 'error': return state.stage === 'connecting'
      ? { ...resetLink(state), stage: 'error', error: action.value } : state;
    case 'disconnect':
      return state.stage === 'preview' ? resetLink(state) : state;
    case 'calibrate':
      return state.stage === 'preview' && state.health === 'dual' && !state.confirm
        ? { ...state, stage: 'calibrating', calibrated: false, calibrationAt: action.now, calibrationNote: 'stationary' } : state;
    case 'cancel-calibration':
      return state.stage === 'calibrating'
        ? { ...state, stage: 'preview', calibrationAt: null, calibrationNote: null } : state;
    case 'motion':
      return state.stage === 'calibrating' ? { ...state, calibrationAt: action.now, calibrationNote: 'motion' } : state;
    case 'finish-calibration':
      return state.stage === 'calibrating' && state.calibrationAt !== null && action.now - state.calibrationAt >= calibrationMs
        ? { ...state, stage: 'preview', calibrationAt: null, calibrationNote: null, calibrated: true } : state;
    case 'start':
      if (state.stage !== 'preview' || state.health === 'offline' || state.confirm) return state;
      return state.health === 'dual' ? start(state, action.now)
        : { ...state, confirm: state.health === 'emg-only' ? 'imu' : 'emg' };
    case 'accept': {
      if (state.stage !== 'preview' || !state.confirm) return state;
      if (state.health === 'offline') return { ...state, confirm: null };
      const missing = state.health === 'emg-only' ? 'imu' : 'emg';
      return state.health === 'dual' || state.confirm === missing
        ? start(state, action.now) : { ...state, confirm: missing };
    }
    case 'dismiss-confirm': return { ...state, confirm: null };
    case 'health': {
      if (!['preview', 'calibrating', 'recording', 'reconnecting'].includes(state.stage)) return state;
      const value = action.value;
      if (state.draft && (state.stage === 'recording' || state.stage === 'reconnecting')) {
        const gaps = updateGaps(state.draft.gaps, value, Math.max(0, action.now - state.draft.start));
        return { ...state, health: value, stage: value === 'offline' ? 'reconnecting' : 'recording',
          droppedAt: value === 'offline' ? state.droppedAt ?? action.now : null, draft: { ...state.draft, gaps } };
      }
      const interrupted = state.stage === 'calibrating' && value !== 'dual';
      return { ...state, health: value, stage: interrupted ? 'preview' : state.stage,
        calibrationAt: interrupted ? null : state.calibrationAt,
        calibrationNote: interrupted ? 'interrupted' : state.calibrationNote };
    }
    case 'mark':
      return state.stage === 'recording' && state.draft
        ? { ...state, draft: { ...state.draft, markers: [...state.draft.markers, action.now - state.draft.start] } } : state;
    case 'end': {
      if ((state.stage !== 'recording' && state.stage !== 'reconnecting') || !state.draft) return state;
      const duration = Math.max(0, action.now - state.draft.start);
      return { ...state, stage: 'stopping', draft: { ...state.draft, duration,
        gaps: state.draft.gaps.map((gap) => gap.to === null ? { ...gap, to: duration } : gap) } };
    }
    case 'saved': return state.stage === 'stopping' && state.draft
      ? { ...state, stage: 'review', summary: state.draft, draft: null } : state;
    case 'new':
      if (state.stage !== 'review') return state;
      return { ...(state.health === 'offline' ? resetLink(state) : { ...state, stage: 'preview' as const, droppedAt: null }), summary: null };
    case 'discard': return state.stage === 'review' ? { ...state, summary: null } : state;
  }
}

export const liveControls = (state: LiveFlow) => ({
  primary: ({ idle: 'connect', connecting: 'cancel', preview: 'start', calibrating: 'cancel-calibration',
    recording: 'end', reconnecting: 'end-save', stopping: 'saving', review: 'new', error: 'retry' } as const)[state.stage],
  disabled: state.stage === 'stopping' || (state.stage === 'preview' && state.health === 'offline'),
  lockNavigation: ['connecting', 'calibrating', 'recording', 'reconnecting', 'stopping'].includes(state.stage),
  canCalibrate: state.stage === 'preview' && state.health === 'dual',
});
