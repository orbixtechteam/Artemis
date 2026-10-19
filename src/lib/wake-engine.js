// The openWakeWord engine as Sentinel uses it: the microphone chunks go to the main process (electron/wakeword.js), which says when the trained phrase was heard.
// Sentinel keeps feeding it in every state (so the stream has no gaps) but only acts on a hit while it waits for the wake phrase.
const api = window.api;

const MAX_IN_FLIGHT = 4; // chunks are 256 ms; if the engine falls behind, new ones are dropped instead of piling up

export function createOwwEngine({ model, threshold, onHit }) {
  let closed = false; let busy = 0;
  return {
    /** Loads the models. Rejects with a message the user can read. */
    async start() {
      const r = await api.wakewordStart({ model, threshold });
      if (!r || !r.ok) throw new Error((r && r.error) || 'The wake word engine could not start.');
    },
    /** chunk: Float32Array of mono 16 kHz audio. */
    feed(chunk) {
      if (closed || busy >= MAX_IN_FLIGHT) return;
      busy++;
      api.wakewordFeed(new Float32Array(chunk).buffer)
        .then((r) => { if (!closed && r && r.hit) onHit(r.score); })
        .catch(() => {})
        .finally(() => { busy--; });
    },
    stop() { closed = true; try { api.wakewordStop(); } catch {} }
  };
}
