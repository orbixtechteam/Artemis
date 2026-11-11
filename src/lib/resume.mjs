// Continuing an answer that failed part way (network drop, provider error): the work already done (tool calls with
// results) is kept and the run picks up from it, instead of starting the whole answer again. Pure: scripts/test-resume.js.

export const CONTINUE_NOTE = '[Artemis: the previous attempt was interrupted by a connection or provider error. Continue from where you stopped: the steps above already ran and their results are real. Do not repeat finished steps.]';

/** True when a failed assistant message has finished tool work worth keeping. */
export function canResume(m) {
  return !!m && m.role === 'assistant' && !!m.error && (m.steps || []).some((s) => (s.toolCalls || []).some((t) => t.result != null && t.status !== 'cancelled' && t.status !== 'running'));
}

/** The message to continue: the error cleared, unfinished tool calls dropped, empty trailing steps removed, and a fresh step
 *  for the new output. `sent` is the part that goes back to the model (without the fresh step). */
export function resumeMessage(m) {
  const steps = (m.steps || []).map((s) => ({ ...s, toolCalls: (s.toolCalls || []).filter((t) => t.result != null && t.status !== 'cancelled' && t.status !== 'running') }))
    .filter((s) => (s.text && s.text.trim()) || s.toolCalls.length || (s.files && s.files.length));
  const { error, ...rest } = m;
  const sent = { ...rest, steps };
  return { sent, kept: { ...sent, resumedAt: Date.now(), steps: [...steps, { text: '', toolCalls: [] }] } };
}
