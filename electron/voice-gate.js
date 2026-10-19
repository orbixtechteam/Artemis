// The decision Sentinel asks for before it acts on a sentence: is this the owner's voice? Combines the lock (what is asked of the voice right now,
// failure counters, lockdown) with the speaker module (the score). Pure of Electron, so scripts/test-speaker.js covers every branch.
//
// verify(wav) resolves to { ok, ... }:
// verify(wav, opts): opts.always (Sentinel): check whenever a voice is enrolled, even if no lock setting asks for it, and refuse a recording too short to judge.
//   opts.phase 'session': the sentence comes inside a conversation that is already open. Another voice is then ignored in silence (no spoken line, no lock,
//   no failed attempt); 'wake' (anything else): the first sentence after the wake phrase, so a stranger who says it is an access attempt.
//   opts.strict (a spoken yes/no to an approval): only the owner's voice counts, never a guest and never a recording that was not checked.
//   ok:true   carry on with the sentence (the owner, or no check is needed). guest:true: another voice, with guest mode on: chat only, nothing is executed.
//   (old line: unlocked:true when this voice just opened the lock screen.
//   ok:false  drop the sentence. `say` is the one fixed line Sentinel speaks (only for a voice that was refused); other reasons stay silent:
//             'locked' (locked and the voice cannot open it), 'lockdown', 'not-enrolled', 'short', 'error', 'mismatch'.

function createVoiceGate({ lock, speaker, log = () => {} }) {
  async function verify(wav, opts = {}) {
    const always = !!opts.always; const strict = !!opts.strict; const inSession = opts.phase === 'session';
    const wasLocked = lock.isLocked();
    if (wasLocked && !lock.wantsVoiceCheck()) return { ok: false, reason: 'locked' }; // locked and voice unlock is off: nothing is done by voice
    if (!lock.wantsVoiceCheck() && !always) return { ok: true, skipped: 'not-needed' };
    if (wasLocked && lock.lockdownLeft() > 0) return { ok: false, reason: 'lockdown' };
    if (!speaker.hasPrint()) return wasLocked ? { ok: false, reason: 'not-enrolled' } : { ok: true, skipped: 'not-enrolled' };
    const r = await speaker.score(wav);
    if (!r.ok) {
      if (r.short) return wasLocked || always ? { ok: false, reason: 'short' } : { ok: true, skipped: 'short' }; // too little speech to tell: not a failed attempt (Sentinel does not act on it)
      log('warn', 'Voice check failed to run: ' + r.error);
      return { ok: false, reason: 'error', error: r.error }; // the owner switched the check on: no answer rather than an unchecked one
    }
    const threshold = lock.getConfig().voiceThreshold;
    if (r.score >= threshold) {
      lock.voiceSuccess();
      if (!wasLocked) return { ok: true, match: true, score: r.score };
      const u = lock.unlockByVoice();
      return u.ok ? { ok: true, match: true, score: r.score, unlocked: true } : { ok: false, reason: 'locked', error: u.error };
    }
    // "Guest mode": a stranger may talk, nothing more. Not counted as a failure, nothing locks, no "Unauthorized access.": the app marks the sentence as a guest's.
    if (!wasLocked && !strict && lock.getConfig().strangerChatOnly && !lock.getConfig().voiceOnly) {
      log('info', `Voice not recognised (score ${r.score.toFixed(2)}, needs ${threshold}): guest, chat only`);
      return { ok: true, guest: true, match: false, score: r.score };
    }
    // Another voice inside an open conversation (people talking nearby, the TV): ignored in silence. Only the first sentence after the wake phrase is an attempt.
    if (!wasLocked && inSession) {
      log('info', `Voice not recognised inside a conversation (score ${r.score.toFixed(2)}, needs ${threshold}): ignored`);
      return { ok: false, match: false, reason: 'mismatch', score: r.score };
    }
    const lockdown = lock.recordFailure('voice');
    // "Lock when another voice is heard": the first stranger locks the app at once (not waiting for the lockdown count)
    const locked = !wasLocked && !lockdown && lock.getConfig().lockOnStranger ? lock.lock('voice').ok : false;
    log('warn', `Voice not recognised (score ${r.score.toFixed(2)}, needs ${threshold})${lockdown ? ': lockdown' : locked ? ': locked' : ''}`);
    return { ok: false, match: false, reason: 'mismatch', score: r.score, say: 'Unauthorized access.', ...(lockdown ? { lockdown } : {}), ...(locked ? { locked: true } : {}) };
  }

  /** Settings → Security "Test my voice": the score against the owner's print, nothing is counted. */
  async function test(wav) {
    const r = await speaker.score(wav);
    if (!r.ok) return { ok: false, error: r.notEnrolled ? 'No voice is enrolled yet.' : r.short ? 'Too short. Say a whole sentence.' : r.error };
    const threshold = lock.getConfig().voiceThreshold;
    return { ok: true, score: Math.round(r.score * 100) / 100, threshold, match: r.score >= threshold };
  }
  return { verify, test };
}

module.exports = { createVoiceGate };
