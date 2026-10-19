// Tests for the pure parts of Sentinel mode: wake word matching, speech start/end detection, WAV encoding.
const assert = require('assert');
(async () => {
  const c = await import('../src/lib/sentinel-core.mjs');
  // wake phrase
  assert(c.hasWake('wake up')); assert(c.hasWake('hey wake up')); assert(c.hasWake('Wake-up!')); assert(!c.hasWake('hello there')); assert(!c.hasWake('wake')); assert(!c.hasWake(''));
  assert(JSON.parse(c.GRAMMAR).includes('[unk]')); assert(JSON.parse(c.GRAMMAR).includes('wake up'));
  // transcript check: only a recording that really starts with the phrase is accepted
  assert.strictEqual(c.afterWake('Wake up, what time is it'), 'what time is it');
  assert.strictEqual(c.afterWake('Hey wake up what time is it'), 'what time is it');
  assert.strictEqual(c.afterWake('Wake up, what is the weather today?'), 'what is the weather today?');
  assert.strictEqual(c.afterWake('Wakeup ask me something'), 'ask me something');
  assert.strictEqual(c.afterWake('Weyk ap, hello'), 'hello');
  assert.strictEqual(c.afterWake('Wake up'), '');
  assert.strictEqual(c.afterWake('Weak up, new chat'), 'new chat');           // weak spelling, first words
  assert.strictEqual(c.afterWake('so anyway the plan is to wake up early'), null); // later in a sentence: ignored
  assert.strictEqual(c.afterWake('Artemis, what time is it'), null);               // the old name no longer works
  assert.strictEqual(c.afterWake('I wake up at seven every day and go to work'), null);
  assert.strictEqual(c.afterWake('wake'), null);
  assert.strictEqual(c.afterWake(''), null);
  assert.strictEqual(c.stripWake('Wake up, what is the weather today?'), 'what is the weather today?');
  assert.strictEqual(c.stripWake('Hey wake up what time is it'), 'what time is it');
  assert.strictEqual(c.stripWake('Wake up'), '');
  assert.strictEqual(c.stripWake('what time is it'), 'what time is it');
  assert.strictEqual(c.stripWake('I wake up early'), 'I wake up early');
  assert(c.looksLikeNoise('Thank you.')); assert(c.looksLikeNoise('...')); assert(!c.looksLikeNoise('what is the weather today'));
  assert(c.hasBarge('stop')); assert(c.hasBarge('okay stop')); assert(c.hasBarge('wake up')); assert(!c.hasBarge('hello there')); assert(!c.hasBarge(''));
  assert(JSON.parse(c.BARGE_GRAMMAR).includes('stop'));
  assert.strictEqual(c.speakable('Hello 😀 there! 👍🏽 Ready 🇦🇿 to go ❤️'), 'Hello there! Ready to go');
  // segmenter: 1s silence, 1s tone, 2s silence -> ends by silence
  const mk = (ms, amp) => { const n = Math.round(c.RATE * ms / 1000); const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = amp * Math.sin(i / 8) * (amp ? 1 : 0); return f; };
  const run = (parts, opt) => { const s = new c.Segmenter(opt); let r = null; for (const p of parts) for (let i = 0; i < p.length; i += 4096) { r = s.feed(p.subarray(i, i + 4096)); if (r) return { r, s }; } return { r, s }; };
  let o = run([mk(1000, 0.002), mk(1000, 0.3), mk(2500, 0.002)]);
  assert.strictEqual(o.r && o.r.reason, 'silence'); assert(o.s.hasSpeech);
  o = run([mk(9000, 0.002)], { noSpeechMs: 3000 });
  assert.strictEqual(o.r.reason, 'nospeech'); assert(!o.s.hasSpeech);
  o = run([mk(300, 0.3), mk(2500, 0.001)]);
  assert.strictEqual(o.r.reason, 'silence'); assert(o.s.hasSpeech);
  o = run([mk(100, 0.3), mk(2500, 0.001)]);
  assert(!o.s.hasSpeech, 'a click is not speech');
  { // typing: 2 s of short key clicks (15 ms loud every 120 ms) is not speech, even though it is loud in every ~250 ms chunk
    const typing = []; for (let k = 0; k < 16; k++) typing.push(mk(15, 0.4), mk(105, 0.001));
    o = run([...typing, mk(2500, 0.001)]);
    assert(!o.s.hasSpeech, 'typing is not speech'); }
  assert(c.looksLikeNoise('So.')); assert(c.looksLikeNoise('Hm')); assert(!c.looksLikeNoise('so what now'));
  // noisy room: constant noise at 0.02 never counts as speech
  o = run([mk(4000, 0.02)], { noSpeechMs: 3000, noise: 0.014 });
  assert.strictEqual(o.r.reason, 'nospeech');
  assert(c.trackNoise(0.01, 0.002) < 0.01 && c.trackNoise(0.01, 0.1) > 0.01 && c.trackNoise(0.01, 0.1) < 0.012);
  // ring buffer keeps ~600ms
  const ring = new c.Ring(600); for (let i = 0; i < 20; i++) ring.push(mk(256, 0.1));
  const kept = c.concat(ring.take()).length; assert(kept >= 9600 && kept <= 9600 + 4096, 'ring ' + kept);
  // wav
  const w = c.encodeWav(mk(500, 0.5)); const dv = new DataView(w.buffer);
  assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.strictEqual(dv.getUint32(24, true), 16000); assert.strictEqual(dv.getUint32(40, true), 16000 / 2 * 2);
  // spoken part
  // reading while the reply is still being written
  { const st = { consumed: 0, spoken: 0, n: 0 }; let full = ''; const feed = (t, f) => { full += t; return c.takePieces(full, st, !!f); };
    assert.deepStrictEqual(feed('Hello the'), []);
    assert.deepStrictEqual(feed('re. How are'), ['Hello there.']); // the first piece is short, so the voice starts at once
    assert.deepStrictEqual(feed(' you today? I am fine. Version 3.'), []); // later pieces merge short sentences; "3." may become "3.5"
    assert.deepStrictEqual(feed('5 is out.\n\n```js\nconst a'), []);
    assert.deepStrictEqual(feed(' = 1;\n```\nDone now'), ['How are you today? I am fine. Version 3.5 is out.']); // code is not read
    assert.deepStrictEqual(feed('', true), ['Done now']); }
  { const st = { consumed: 0, spoken: 0, n: 0 }; const long = 'This is one more sentence for the test. '.repeat(60);
    const a = c.takePieces(long, st, true, 900); assert(a.join(' ').length <= 1000 && a.join(' ').length >= 800, 'spoken text is capped'); assert.deepStrictEqual(c.takePieces(long, st, true), []); }
  assert.deepStrictEqual(c.spokenPart('Short.'), { text: 'Short.', cut: false });
  const long = ('This is a sentence. ').repeat(200); const sp = c.spokenPart(long, 900);
  assert(sp.cut && sp.text.length <= 900 && sp.text.endsWith('.'));
  // widget view: the last exchange, tool activity, images, approvals, markdown-lite
  { const v = await import('../src/lib/sentinel-view.mjs');
    const chat = { title: 'Weather', artifacts: { a1: { title: 'Chart', type: 'html' } }, messages: [
      { role: 'user', content: 'old question' }, { role: 'assistant', steps: [{ text: 'old answer', toolCalls: [] }] },
      { role: 'user', content: 'what is the weather' },
      { role: 'assistant', steps: [
        { text: '<think>hmm</think>It is **sunny**.', toolCalls: [{ id: 't1', name: 'web_search', args: '{"query":"weather Baku"}', status: 'done' }], media: [{ kind: 'image', path: '/x/img.png', prompt: 'sun' }], artifactRefs: ['a1'] },
        { text: '', toolCalls: [{ id: 't2', name: 'write_file', args: { path: '/p/notes.txt' }, status: 'awaiting', summary: 'Write notes.txt' }, { id: 't3', name: 'computer', args: {}, status: 'done', image: 'data:image/png;base64,AAAA' }] }] }] };
    const w = v.widgetView(chat);
    assert.strictEqual(w.heard, 'what is the weather'); assert.strictEqual(w.answer, 'It is **sunny**.'); assert.strictEqual(w.title, 'Weather');
    assert.strictEqual(w.activity, 'Writing notes.txt…'); assert.deepStrictEqual(w.approval, { id: 't2', title: 'Writing notes.txt', summary: 'Write notes.txt' });
    assert.strictEqual(w.images.length, 2); assert.strictEqual(w.images[0].path, '/x/img.png'); assert.strictEqual(w.images[1].type, 'src');
    assert.deepStrictEqual(w.artifacts, [{ id: 'a1', title: 'Chart', type: 'html', language: '', versions: 0, rev: '0:0' }]); assert.strictEqual(w.running, true);
    // the mini chat: every message as a bubble, tools collapsed into labels, artifacts and files as cards
    assert.strictEqual(w.messages.length, 4);
    assert.deepStrictEqual(w.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
    assert.strictEqual(w.messages[0].text, 'old question'); assert.strictEqual(w.messages[1].text, 'old answer');
    const last = w.messages[3];
    assert.strictEqual(last.text, 'It is **sunny**.'); assert.strictEqual(last.running, true);
    assert.deepStrictEqual(last.tools.map((t) => [t.label, t.status]), [['Searching the web for “weather Baku”', 'done'], ['Writing notes.txt', 'awaiting'], ['Using your computer', 'done']]);
    assert.deepStrictEqual(last.images.map((i) => i.type), ['media', 'src']); // the screenshot only on the last answer
    assert.deepStrictEqual(last.artifacts.map((a) => a.id), ['a1']);
    assert.deepStrictEqual(last.files, []); // write_file is still waiting for approval: not a file yet
    assert.strictEqual(v.chatMessages(chat, { max: 2 }).length, 2);
    assert.strictEqual(v.chatMessages(chat, { max: 2 })[0].text, 'what is the weather');
    assert.deepStrictEqual(v.chatMessages(null), []);
    // earlier answers keep media but drop big screenshots
    const two = { messages: [chat.messages[3], { role: 'user', content: 'next' }, { role: 'assistant', steps: [{ text: 'ok' }] }] };
    assert.deepStrictEqual(v.chatMessages(two)[0].images.map((i) => i.type), ['media']);
    // artifact cards: rev changes with every new version and while the latest grows
    const ac = { artifacts: { x: { title: 'Page', type: 'html', versions: ['<p>1</p>'] } } };
    const r1 = v.artifactCard(ac, 'x').rev; ac.artifacts.x.versions.push('<p>2</p>!'); const r2 = v.artifactCard(ac, 'x').rev;
    assert.notStrictEqual(r1, r2); assert.strictEqual(v.artifactCard(ac, 'x').versions, 2); assert.strictEqual(v.artifactCard(ac, 'nope'), null);
    // file cards: project files the agent wrote, Files library writes, attachments; once each, only when done
    const fm = { role: 'assistant', steps: [{ toolCalls: [
      { name: 'write_file', args: { path: 'out/report.md' }, status: 'done' }, { name: 'edit_file', args: '{"path":"out/report.md"}', status: 'done' },
      { name: 'library_write', args: { path: 'notes/plan.txt' }, status: 'done' }, { name: 'write_spreadsheet', args: { path: 'x.xlsx' }, status: 'error' },
      { name: 'read_file', args: { path: 'in.txt' }, status: 'done' }] }] };
    assert.deepStrictEqual(v.filesOf(fm), [{ kind: 'project', path: 'out/report.md', name: 'report.md' }, { kind: 'library', path: 'notes/plan.txt', name: 'plan.txt' }]);
    assert.deepStrictEqual(v.filesOf({ role: 'user', content: 'see', attachments: [{ name: 'a.pdf', path: '/lib/a.pdf', lib: 'a.pdf' }, { name: 'b.png', path: '/tmp/b.png' }, { name: 'bad', kind: 'error' }] }),
      [{ kind: 'library', path: 'a.pdf', name: 'a.pdf' }, { kind: 'path', path: '/tmp/b.png', name: 'b.png' }]);
    assert.deepStrictEqual(v.chatMessages({ messages: [fm] })[0].files.map((f) => f.name), ['report.md', 'plan.txt']);
    assert.deepStrictEqual(v.widgetView({ messages: [{ role: 'user', content: 'go' }, fm] }).files.map((f) => f.kind), ['project', 'library']);
    assert.strictEqual(v.widgetView(chat, { maxShot: 10 }).images.length, 1); // big screenshots are not sent
    assert.strictEqual(v.widgetView(null).answer, ''); assert.strictEqual(v.widgetView({ messages: [{ role: 'user', content: 'hi' }] }).heard, 'hi');
    assert.strictEqual(v.activityOf({ name: 'web_search', args: { query: 'x' } }), 'Searching the web for “x”…');
    assert.strictEqual(v.activityOf({ name: 'web_fetch', args: { url: 'https://www.example.com/a' } }), 'Reading example.com…');
    assert.strictEqual(v.activityOf({ name: 'mcp__github__list_issues', args: {} }), 'Using github (list issues)…');
    const long = Array.from({ length: 200 }, (_, i) => 'Paragraph ' + i + ' ' + 'x'.repeat(40)).join('\n\n');
    const tail = v.tailText(long, 1000); assert.ok(tail.length <= 1001 && tail.startsWith('…Paragraph') && tail.endsWith('x'));
    assert.deepStrictEqual(v.mdBlocks('# Title\nsome text\nmore\n\n- one\n2. two\n```js\ncode()\n```\n> quote').map((b) => b.type), ['h', 'p', 'li', 'li', 'code', 'q']);
    assert.strictEqual(v.mdBlocks('a\nb')[0].text, 'a b');
    assert.deepStrictEqual(v.mdInline('a **b** `c` *d* [e](http://x)'), [{ t: 'a ' }, { t: 'b', b: true }, { t: ' ' }, { t: 'c', code: true }, { t: ' ' }, { t: 'd', i: true }, { t: ' e' }]); }
  // widget window sizing: grows away from the screen edge it is near, and stays on screen
  { const { fitBounds, placeAt, sizeFor } = require('../electron/sentinel-widget.js');
    const big = { x: 0, y: 25, width: 2560, height: 1415 }, small = { x: 0, y: 25, width: 1280, height: 775 };
    assert.deepStrictEqual(sizeFor('compact', 'M', 120, big), { width: 300, height: 120 }); // the pill follows its content
    assert.deepStrictEqual(sizeFor('compact', 'L', 9000, big), { width: 300, height: 380 });
    assert.deepStrictEqual(sizeFor('compact', 'M', 0, big), { width: 300, height: 48 });
    assert.deepStrictEqual(sizeFor('expanded', 'M', 50, big), { width: 590, height: 425 }); // the chat has a fixed size
    assert.deepStrictEqual(sizeFor(true, 'S', 50, big), { width: 480, height: 360 });
    assert.deepStrictEqual(sizeFor('expanded', 'nope', 50, big), { width: 590, height: 425 });
    assert.deepStrictEqual(sizeFor('viewer', 'M', 50, big), { width: 720, height: 640 }); // the viewer is bigger
    const vs = sizeFor('viewer', 'M', 50, small); assert.ok(vs.width <= 1280 * 0.6 && vs.width >= 420 && vs.height <= 775 * 0.8, JSON.stringify(vs)); // at most 60% of a small screen
    const vl = sizeFor('viewer', 'L', 50, small); assert.ok(vl.width > vs.width && vl.width <= 1280 * 0.85 && vl.height <= 775 * 0.9);
    const vb = sizeFor('viewer', 'L', 50, big); assert.deepStrictEqual(vb, { width: 960, height: 820 });
    // a viewer opened from the pill at the bottom right grows up and left, and stays on the screen
    const g = fitBounds({ x: 1130, y: 840, width: 300, height: 48 }, sizeFor('viewer', 'M', 0, { x: 0, y: 25, width: 1440, height: 875 }), { x: 0, y: 25, width: 1440, height: 875 });
    assert.ok(g.x + g.width <= 1440 - 4 && g.y >= 25 && g.y + g.height === 888 && g.width <= 864, JSON.stringify(g));
    const wa = { x: 0, y: 25, width: 1440, height: 875 };
    assert.deepStrictEqual(fitBounds({ x: 570, y: 37, width: 300, height: 48 }, { width: 420, height: 400 }, wa), { x: 510, y: 37, width: 420, height: 400 }); // top centre: grows down, centred
    assert.deepStrictEqual(fitBounds({ x: 1130, y: 840, width: 300, height: 48 }, { width: 420, height: 400 }, wa), { x: 1010, y: 488, width: 420, height: 400 }); // bottom right: grows up and left
    assert.deepStrictEqual(fitBounds({ x: 10, y: 300, width: 300, height: 48 }, { width: 420, height: 300 }, wa), { x: 10, y: 300, width: 420, height: 300 }); // left: keeps its left edge
    assert.deepStrictEqual(fitBounds({ x: 1010, y: 488, width: 420, height: 400 }, { width: 300, height: 48 }, wa), { x: 1130, y: 840, width: 300, height: 48 }); // and shrinks back to the same spot
    const off = fitBounds({ x: 1400, y: 880, width: 300, height: 48 }, { width: 420, height: 2000 }, wa); assert.ok(off.x + off.width <= 1440 && off.y >= 25 && off.height <= 875);
    assert.deepStrictEqual(placeAt({ x: 500, y: 100, width: 300, height: 48 }, 'left', wa), { x: 12, y: 100, width: 300, height: 48 });
    assert.deepStrictEqual(placeAt({ x: 500, y: 100, width: 300, height: 48 }, 'right', wa), { x: 1128, y: 100, width: 300, height: 48 }); }
  console.log('sentinel tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
