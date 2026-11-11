const assert = require('assert');
(async () => {
  const { createFollowModel, NEAR_PX } = await import('../src/lib/follow-model.mjs');
  let t = 0; const now = () => t;
  const at = (top, height = 2000, client = 500) => ({ top, height, client });

  // content growth while following never unpins (no reader intent)
  let f = createFollowModel({ now });
  f.wrote(1500); f.scrolled(at(1500)); assert.strictEqual(f.following, true);
  f.scrolled(at(1300, 2000)); assert.strictEqual(f.following, true, 'clamp/shrink is not reader movement');

  // wheel up unpins immediately, growth afterwards does not re-pin
  f = createFollowModel({ now });
  f.intent(true); assert.strictEqual(f.following, false);
  t += 10; f.scrolled(at(1400)); t += 10; f.settled(at(1400, 2600)); assert.strictEqual(f.following, false);

  // the small-gesture bug: wheel up by a few px near the end, content grows, settle -> still reading
  f = createFollowModel({ now });
  f.wrote(1500); f.scrolled(at(1500));
  t += 5; f.intent(true); t += 5; f.scrolled(at(1497)); assert.strictEqual(f.following, false);
  t += 100; f.settled(at(1497, 2100)); assert.strictEqual(f.following, false, 'growth must not erase a small upward gesture');

  // scrolling back down to the end pins again
  t += 5; f.intent(false); t += 5; f.scrolled(at(1600, 2100)); assert.strictEqual(f.following, true);

  // settling near (not exactly at) the end pins too
  f = createFollowModel({ now, following: false });
  t += 5; f.intent(false); t += 5; f.scrolled(at(1500 - NEAR_PX + 2)); t += 50; f.settled(at(1500 - NEAR_PX + 2)); assert.strictEqual(f.following, true);

  // a scroll long after any gesture is layout, not the reader
  f = createFollowModel({ now, following: false });
  f.wrote(800); t += 5000; f.scrolled(at(1500)); f.settled(at(1500)); assert.strictEqual(f.following, false);

  // callers can force following (send / chat switch)
  f.following = true; assert.strictEqual(f.following, true);
  // the controller and the shared ref: a wheel-up must stay unpinned (the bug: the old `true` in the ref re-pinned it)
  const { createFollowController } = await import('../src/lib/follow-model.mjs');
  const stick = { current: true };
  const c = createFollowController(stick, { now });
  assert.strictEqual(c.gesture(true), false); assert.strictEqual(stick.current, false);
  assert.strictEqual(c.following(), false, 'no re-pin after a wheel-up');
  t += 10; c.scroll(at(1200)); t += 20; c.settle(at(1200, 2600)); assert.strictEqual(c.following(), false, 'streaming growth keeps the reader where they are');
  stick.current = true; assert.strictEqual(c.following(), true, 'a caller (send, chat switch) can force following');
  assert.strictEqual(c.gesture(true), false); assert.strictEqual(c.following(), false);
  console.log('stick tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
