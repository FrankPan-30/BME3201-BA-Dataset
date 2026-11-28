import type { BaRecord } from './ba';

export const baRecords: readonly BaRecord[] = [
  {
    "id": "ST09-BA-paretic-01",
    "method": "ba-kinematic-v1.0",
    "originMs": -504,
    "endMs": 9792,
    "phaseBlob": "6882a0ea5bb51eb5dcd2f9ec059bf5c8fab47432",
    "trialBlob": "08428a6d4bd1545c34ba29ed31e3261b3a20eab0",
    "signalId": "ba-st09-01",
    "phases": [
      {
        "code": "REST",
        "startMs": -504,
        "endMs": 0,
        "status": "auto",
        "startSource": "pre_event_quiet_wrist_and_ball",
        "endSource": "pre_event_quiet_wrist_and_ball",
        "notes": ""
      },
      {
        "code": "REACH",
        "startMs": 0,
        "endMs": 3864,
        "status": "auto",
        "startSource": "Events.Start",
        "endSource": "ball_rise_15mm_8mm_104ms",
        "notes": ""
      },
      {
        "code": "LIFT_TRANSFER",
        "startMs": 3864,
        "endMs": 6504,
        "status": "auto",
        "startSource": "ball_rise_15mm_8mm_104ms",
        "endSource": "final_elevated_ball_200ms",
        "notes": ""
      },
      {
        "code": "RETURN",
        "startMs": 6640,
        "endMs": 9792,
        "status": "auto",
        "startSource": "hand_away_wrist_home_200ms",
        "endSource": "Events.End",
        "notes": ""
      }
    ]
  },
  {
    "id": "ST02-BA-paretic-05",
    "method": "ba-kinematic-v1.0",
    "originMs": -504,
    "endMs": 9624,
    "phaseBlob": "6882a0ea5bb51eb5dcd2f9ec059bf5c8fab47432",
    "trialBlob": "08428a6d4bd1545c34ba29ed31e3261b3a20eab0",
    "signalId": null,
    "phases": [
      {
        "code": "REST",
        "startMs": -504,
        "endMs": 0,
        "status": "auto",
        "startSource": "pre_event_quiet_wrist_and_ball",
        "endSource": "pre_event_quiet_wrist_and_ball",
        "notes": ""
      },
      {
        "code": "REACH",
        "startMs": 0,
        "endMs": 3016,
        "status": "auto",
        "startSource": "Events.Start",
        "endSource": "ball_rise_15mm_8mm_104ms",
        "notes": ""
      },
      {
        "code": "LIFT_TRANSFER",
        "startMs": 3016,
        "endMs": 6224,
        "status": "review",
        "startSource": "ball_rise_15mm_8mm_104ms",
        "endSource": "final_elevated_ball_200ms",
        "notes": "ball_tracking_gap_after_placement"
      },
      {
        "code": "RETURN",
        "startMs": null,
        "endMs": 9624,
        "status": "unresolved",
        "startSource": "no_sustained_hand_away_and_wrist_home",
        "endSource": "Events.End",
        "notes": "no_sustained_hand_away_and_wrist_home|tracking_gap_during_return_search"
      }
    ]
  }
];

export const baRepository = 'https://github.com/FrankPan-30/BME3201-BA-Dataset';
export const baDataCitation = 'Lucchetti et al., Scientific Data (2025), DOI 10.1038/s41597-025-06174-3. CC BY 4.0.';

