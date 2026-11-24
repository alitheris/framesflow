// Project model — facade over the shared v3 model (shared/model.mjs) so every server
// module keeps importing from one place while the browser uses the exact same code.
export {
  newProject, migrateProject, defaultClip, checkClip, projectFrames, voiceClip,
  sortedTrack, clipEnd, srcSpanMs, summarize, propAt, evalKeys,
  TRACKS, GRADES, KEYFRAMABLE,
  TRANSITION_IDS as TRANSITIONS, TRANSITIONS as TRANSITION_DEFS, transitionById,
  EFFECTS, EFFECT_IDS, effectById, defaultEffectParams,
  TEXT_ANIMS_IN, TEXT_ANIMS_OUT, TEXT_FONTS, TEXT_KINDS, TEXT_POSITIONS, defaultTextStyle,
  AUDIO_FX, FORMATS, FPS_OPTIONS,
  msToFrame, frameToMs, uid, clamp,
} from '../shared/model.mjs';
