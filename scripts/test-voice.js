// Tests for reading aloud: how a reply is cut into pieces for the voice, and the streamed PCM decoding.
const assert = require('assert');
(async () => {
  const c = await import('../src/lib/sentinel-core.mjs');
  const pcm = await import('../src/lib/pcm.mjs');
  const fresh = () => ({ consumed: 0, spoken: 0, n: 0 });

  // the first piece is emitted at the first clause mark, before the sentence is finished
  { const st = fresh();
    assert.deepStrictEqual(c.takePieces('The capital of France is Paris, which is', st), ['The capital of France is Paris,']);
    assert.deepStrictEqual(c.takePieces('The capital of France is Paris, which is a lovely city. It has', st), []); // later pieces: whole sentences
    assert.deepStrictEqual(c.takePieces('The capital of France is Paris, which is a lovely city. It has', st, true), ['which is a lovely city. It has']); }
  // a too-short clause ("Sure,") does not start a piece on its own
  assert.deepStrictEqual(c.takePieces('Sure, I can', fresh()), []);
  // no punctuation yet: about eight words start the voice
  assert.deepStrictEqual(c.takePieces('one two three four five six seven eightword nine', fresh()), ['one two three four five six seven eightword']);
  assert.deepStrictEqual(c.takePieces('one two three four', fresh()), []);
  // a dash is a clause mark
  assert.deepStrictEqual(c.takePieces('This is the answer— and more follows', fresh()), ['This is the answer—']);

  // numbers, abbreviations and initials do not end a sentence
  { const st = fresh(); const t = 'Version 3.5 is out now. More';
    assert.deepStrictEqual(c.takePieces('Version 3.', st), []);
    assert.deepStrictEqual(c.takePieces(t, st), ['Version 3.5 is out now.']); }
  assert.deepStrictEqual(c.chunkText('Dr. Smith met J. K. Rowling at noon today. Then they left.').slice(0, 1), ['Dr. Smith met J. K. Rowling at noon today.']);
  assert.deepStrictEqual(c.chunkText('Use fruit e.g. apples and pears in the pie. Bake it for an hour or so until golden.'), ['Use fruit e.g. apples and pears in the pie.', 'Bake it for an hour or so until golden.']);
  assert(!c.chunkText('It costs 1,250.75 dollars in total for everyone.').some((p) => /^\d/.test(p)), 'no cut inside a number');

  // links: the text is read, not the address; a link still being written is held back
  assert.strictEqual(c.speakable('See [the docs](https://example.com/a.b?c=1) now.'), 'See the docs now.');
  assert.strictEqual(c.speakable('Go to https://example.com/x.html today.'), 'Go to link today.');
  { const st = fresh();
    assert.deepStrictEqual(c.takePieces('Read this carefully, see [the do', st), ['Read this carefully,']);
    assert.deepStrictEqual(c.takePieces('Read this carefully, see [the docs](https://exa', st), []);
    assert.deepStrictEqual(c.takePieces('Read this carefully, see [the docs](https://example.com/x) for the whole story here. ', st, true), ['see the docs for the whole story here.']); }

  // code blocks are skipped, also while they are still being written; markdown symbols and emoji are dropped
  assert.strictEqual(c.speakable('Run this:\n```bash\nrm -rf /tmp/x\n```\nThen **restart** it 🎉.'), 'Run this: Then restart it.');
  assert.strictEqual(c.speakable('## Steps\n1. Open it\n2. Close it\n- `npm test`'), 'Steps. Open it. Close it. npm test');
  assert.strictEqual(c.speakable('| a | b |\n|---|:---:|\n| 1 | 2 |'), 'a b. 1 2');
  { const st = fresh();
    assert.deepStrictEqual(c.takePieces('Here is the code, look:\n```js\nconst a = 1, b', st), ['Here is the code,']);
    assert.deepStrictEqual(c.takePieces('Here is the code, look:\n```js\nconst a = 1, b = 2;\n```\nThat was all of it for today, really.', st, true), ['look: That was all of it for today, really.']); }

  // long sentences are cut at a clause mark before 250 characters
  { const long = ('This part goes on, ').repeat(30) + 'end.';
    const ps = c.chunkText(long);
    assert(ps.length > 2 && ps.every((p) => p.length <= 250), 'pieces are capped');
    { // the whole answer is read: the last sentence too, no length limit; with an explicit limit the cut is announced
      const long = ('This sentence is about the expanding universe and its age. ').repeat(25) + 'Like, how do you ever know?';
      const all = c.takePieces(long, { consumed: 0, spoken: 0, n: 0 }, true);
      assert(all[all.length - 1].endsWith('Like, how do you ever know?'), 'last sentence read');
      const cut = c.takePieces(long, { consumed: 0, spoken: 0, n: 0 }, true, 400);
      assert.strictEqual(cut[cut.length - 1], 'The rest is in the chat.');
      assert(c.chunkText(('A long sentence that keeps going for a while here. ').repeat(200)).join(' ').length > 9000, 'no length limit'); }
    { // thinking is never read aloud
      assert.strictEqual(c.speakable('<think>plan the answer</think>Hello there.'), 'Hello there.');
      assert.strictEqual(c.speakable('first I reason about it</think>The answer is 4.'), 'The answer is 4.');
      assert.strictEqual(c.speakable('Okay. <thinking>still going'), 'Okay.'); }
    assert(ps.slice(0, -1).every((p) => p.endsWith(',')), 'cut at commas'); }
  // short sentences after the first piece are merged
  assert.deepStrictEqual(c.chunkText('Hello there, friend. Yes. No. Maybe so. Fine then, it is all good here.'), ['Hello there,', 'friend. Yes. No. Maybe so. Fine then, it is all good here.']);

  // emotion tags: never read, a tagged sentence is its own piece (and keeps its tag for the speaker), the text before a tag is complete
  { const e = await import('../src/lib/tts-emotion.mjs');
    assert.strictEqual(c.speakable('[soft] I am here. [warm] Glad you asked.'), 'I am here. Glad you asked.');
    assert.strictEqual(c.speakable('Okay [sad] that is hard.'), 'Okay that is hard.');
    assert.strictEqual(c.speakable('[warm] Hi.', { tags: true }), '[warm] Hi.');
    assert.deepStrictEqual(c.chunkText('Let me look at that for you right now. [soft] I am here. The rest is plain and goes on for a while. Fine.'),
      ['Let me look at that for you right now.', '[soft] I am here.', 'The rest is plain and goes on for a while. Fine.']);
    assert.deepStrictEqual(c.chunkText('[Excited] We did it! And that is all.'), ['[excited] We did it!', 'And that is all.']);
    assert.deepStrictEqual(c.chunkText('Short one. Two. [warm] So glad.').map((x) => e.parseTag(x).emotion), ['', '', 'warm']);
    assert.deepStrictEqual(c.chunkText('- [warm] First item\n- Second item'), ['[warm] First item.', 'Second item']);
    { const st = fresh(); // streaming: a tag that is still being written is held back, then cuts the piece before it
      assert.deepStrictEqual(c.takePieces('The answer is simple, really. Here [wa', st), ['The answer is simple,']);
      assert.deepStrictEqual(c.takePieces('The answer is simple, really. Here [warm', st), []);
      assert.deepStrictEqual(c.takePieces('The answer is simple, really. [warm] I am glad', st), ['really.']);
      assert.deepStrictEqual(c.takePieces('The answer is simple, really. [warm] I am glad you asked. Next', st), ['[warm] I am glad you asked.']);
      assert.deepStrictEqual(c.takePieces('The answer is simple, really. [warm] I am glad you asked. Next part.', st, true), ['Next part.']); }
    for (const p of c.chunkText('[warm] Hi there. [soft] Bye now.')) assert(!/\[(warm|soft)\]/.test(c.speakable(e.parseTag(p).text)), 'never read aloud');
    assert.strictEqual(c.chunkText('Use `[warm]` in code:\n```\n[sad] x\n```\nDone.').join(' ').includes('[sad]'), false); }

  // natural pacing: the pause after a piece depends on how it ends, randomized by ±25%; off adds nothing
  { const P = await import('../src/lib/tts-pacing.mjs');
    const mid = () => 0.5; const lo = () => 0; const hi = () => 0.999999;
    assert.strictEqual(P.pacingMode(undefined), 'subtle'); assert.strictEqual(P.pacingMode('off'), 'off'); assert.strictEqual(P.pacingMode('nope'), 'subtle');
    assert.deepStrictEqual(['Done.', 'Really?', 'Wow!', 'Well…', 'So...', 'Wait —', 'Note:', 'First;', 'Sure,', 'and then'].map(P.endingOf),
      ['period', 'question', 'exclaim', 'ellipsis', 'ellipsis', 'ellipsis', 'colon', 'colon', 'comma', '']);
    assert.strictEqual(P.endingOf('He said "yes."'), 'period'); // closing quotes do not hide the ending
    assert.strictEqual(P.pauseAfter('Done.', { mode: 'subtle' }, mid), 260);
    assert.strictEqual(P.pauseAfter('Really?', { mode: 'subtle' }, mid), 360);
    assert.strictEqual(P.pauseAfter('Wow!', { mode: 'subtle' }, mid), 300);
    assert.strictEqual(P.pauseAfter('Well…', { mode: 'subtle' }, mid), 450);
    assert.strictEqual(P.pauseAfter('Note:', { mode: 'subtle' }, mid), 220);
    assert.strictEqual(P.pauseAfter('Sure, I can,', { mode: 'subtle' }, mid), 120);
    assert.strictEqual(P.pauseAfter('Done.', { para: true, mode: 'subtle' }, mid), 650); // a paragraph break wins
    assert.strictEqual(P.pauseAfter('and then', { mode: 'subtle' }, mid), 0);
    assert.strictEqual(P.pauseAfter('Done.', { para: true, mode: 'off' }, mid), 0);
    assert.strictEqual(P.pauseAfter('Done.', { mode: 'expressive' }, mid), 390); // ×1.5
    assert.strictEqual(P.pauseAfter('Done.', { mode: 'subtle' }, lo), 195); // -25%
    assert.strictEqual(P.pauseAfter('Done.', { mode: 'subtle' }, hi), 325); // +25%
    for (let i = 0; i < 200; i++) { const g = P.pauseAfter('Really?', { mode: 'subtle' }); assert(g >= 270 && g <= 450, 'jitter within ±25%: ' + g); }
    assert.strictEqual(P.pauseBefore('warm', 'expressive', mid), 180); assert.strictEqual(P.pauseBefore('warm', 'subtle', mid), 0); assert.strictEqual(P.pauseBefore('', 'expressive', mid), 0);
    assert.strictEqual(P.paceRate(1.1, 'subtle', hi), 1.1); assert.strictEqual(P.paceRate(1, 'off', lo), 1);
    for (let i = 0; i < 200; i++) { const r = P.paceRate(1.25, 'expressive'); assert(r >= 1.25 * 0.97 - 1e-9 && r <= 1.25 * 1.03 + 1e-9 && r >= 1.25 * 0.85 && r <= 1.25 * 1.15, 'speed varies ±3%: ' + r); } }
  // natural pacing: one sentence per piece (short ones under ~25 chars merged), the paragraph flag, the first clause still starts at once
  { const t = 'Sure, I can help you with that today. Is that what you meant by it? Yes. Short. And this one is longer again.\n\nA new paragraph starts here. [warm] Glad you asked.';
    assert.deepStrictEqual(c.chunkPieces(t, { pacing: 'subtle' }), [
      { text: 'Sure, I can help you with that today.', para: false },
      { text: 'Is that what you meant by it?', para: false },
      { text: 'Yes. Short. And this one is longer again.', para: true },
      { text: 'A new paragraph starts here.', para: false },
      { text: '[warm] Glad you asked.', para: false }]);
    // off: exactly the old pieces (strings from chunkText), no paragraph flags
    assert.deepStrictEqual(c.chunkPieces(t, { pacing: 'off' }).map((p) => p.text), c.chunkText(t));
    assert(c.chunkPieces(t).every((p) => !p.para));
    assert.strictEqual(c.chunkText(t).length, 4); // without pacing short sentences are still merged
    // streaming gives the same pieces as the finished text, and the first clause starts the voice early
    const st = { ...fresh(), pacing: 'expressive' }; const got = [];
    for (let i = 1; i <= t.length; i++) got.push(...c.takePieceItems(t.slice(0, i), st, false));
    got.push(...c.takePieceItems(t, st, true));
    assert.deepStrictEqual(got.map((p) => p.text), ['Sure, I can help you with that today.', 'Is that what you meant by it?', 'Yes. Short. And this one is longer again.', 'A new paragraph starts here.', '[warm] Glad you asked.']);
    assert.deepStrictEqual(c.takePieceItems('The capital of France is Paris, which is', { ...fresh(), pacing: 'subtle' }), [{ text: 'The capital of France is Paris,', para: false }]);
    assert(got.every((p) => !p.text.includes('')), 'the paragraph mark is never read');
    assert.deepStrictEqual(c.takePieces('One two three four five six. Seven eight nine ten.\n\nNext', { ...fresh(), pacing: 'subtle' }), ['One two three four five six.', 'Seven eight nine ten.']); // takePieces still returns strings
    assert.strictEqual(c.speakable('One.\n\nTwo.'), 'One. Two.'); // the mark only exists with { paras: true }
    assert(c.THINKING_HINT.includes('Hmm') && c.VOICE_HINT.length > 0); }

  // PCM: 16-bit little-endian to float, chunks of any size (odd byte boundaries)
  { const samples = [0, 1, -1, 32767, -32768, 1234, -4321, 256, -256];
    const bytes = new Uint8Array(samples.length * 2); const dv = new DataView(bytes.buffer);
    samples.forEach((v, i) => dv.setInt16(i * 2, v, true));
    const want = samples.map((v) => v / 32768);
    for (const sizes of [[bytes.length], [1, 1, 1, 15], [3, 3, 3, 3, 3, 3], [5, 0, 7, 6], [17, 1]]) {
      const d = pcm.createPcmDecoder(); const got = []; let o = 0;
      for (const n of sizes) { const f = d.feed(bytes.subarray(o, o + n)); o += n; if (f) got.push(...f); }
      assert.deepStrictEqual(got, want, 'chunks ' + sizes.join(','));
      assert.strictEqual(d.pending, 0);
    }
    // an unaligned view (odd byteOffset) is read correctly too
    const shifted = new Uint8Array(bytes.length + 1); shifted.set(bytes, 1);
    assert.deepStrictEqual([...pcm.createPcmDecoder().feed(shifted.subarray(1))], want);
    // writes into the array it is given (an AudioBuffer channel) instead of making one
    const target = new Float32Array(4); const d = pcm.createPcmDecoder();
    assert.strictEqual(d.feed(bytes.subarray(0, 8), (n) => (assert.strictEqual(n, 4), target)), target);
    assert.strictEqual(pcm.createPcmDecoder().feed(new Uint8Array([7])), null); }
  { const f = pcm.fade(new Float32Array(10).fill(1), 4, 1); assert.strictEqual(f[0], 0); assert(f[3] < 1 && f[4] === 1); }
  assert.strictEqual(pcm.PCM_RATE, 24000);

  // ---- spoken language: detection from text, the reply-language hint, engine routing ----
  const L = await import('../src/lib/lang.mjs');
  const samples = {
    tr: ['Merhaba, bugün nasılsın? Bana yardım edebilir misin?', 'Bu akşam ne yapalım, dışarı çıkalım mı?', 'Hava çok güzel ama biraz soğuk.'],
    az: ['Salam, necəsən? Mənə kömək edə bilərsən?', 'Bu gün hava çox gözəldir, amma bir az soyuqdur.'],
    ru: ['Привет, как дела? Помоги мне, пожалуйста.'],
    uk: ['Привіт, як справи? Що ти робиш сьогодні?'],
    en: ['Hello, how are you today? Can you help me with this?', 'What is the weather like in London?'],
    de: ['Hallo, wie geht es dir heute? Ich brauche bitte Hilfe.', 'Das ist nicht so einfach, aber wir schaffen das.'],
    fr: ['Bonjour, comment ça va? Je voudrais un café, merci.', 'Est-ce que vous pouvez m’aider avec ce problème?'],
    es: ['Hola, ¿cómo estás? Necesito ayuda con esto, por favor.', 'Muchas gracias, pero no es para mí.'],
    ar: ['مرحبا، كيف حالك اليوم؟'], ja: ['こんにちは、元気ですか？'], zh: ['你好，今天天气怎么样？'], ko: ['안녕하세요, 잘 지내세요?']
  };
  for (const [want, list] of Object.entries(samples)) for (const t of list) assert.strictEqual(L.detectTextLang(t), want, `${want}: ${t}`);
  // too short or unclear: no guess (the hint or the setting decides)
  for (const t of ['', 'OK', '12:30', 'Tamam.', '👍']) assert.strictEqual(L.detectTextLang(t), '', JSON.stringify(t));
  // Turkish and Azerbaijani letters survive the text cleaning for the voice
  assert.strictEqual(c.speakable('**Çok güzel!** Iğdır, Şişli ve Ölüdeniz. Mən də gəlirəm.'), 'Çok güzel! Iğdır, Şişli ve Ölüdeniz. Mən də gəlirəm.');
  assert(c.chunkText('Merhaba, ben Artemis. Bugün sana nasıl yardımcı olabilirim? Hava çok güzel.').join(' ').includes('yardımcı olabilirim?'));
  // what speech-to-text servers report
  assert.strictEqual(L.normLang('turkish'), 'tr'); assert.strictEqual(L.normLang('Azerbaijani'), 'az'); assert.strictEqual(L.normLang('tr-TR'), 'tr');
  assert.strictEqual(L.normLang('auto'), ''); assert.strictEqual(L.normLang(''), ''); assert.strictEqual(L.normLang('klingon language'), '');
  // the hidden instruction: only for a known language other than English
  assert.strictEqual(L.replyLangHint('tr'), 'The user spoke Turkish; answer in Turkish.');
  assert.strictEqual(L.replyLangHint('az'), 'The user spoke Azerbaijani; answer in Azerbaijani.');
  assert.strictEqual(L.replyLangHint('en'), ''); assert.strictEqual(L.replyLangHint(''), ''); assert.strictEqual(L.replyLangHint('xx'), '');
  // routing: lang + engine -> { engine, voice }
  const R = (lang, engine, voice = '', voices = {}) => { const r = L.routeVoice({ lang, engine, voice, voices }); return [r.engine, r.voice]; };
  assert.deepStrictEqual(R('en', 'openai', 'am_michael'), ['openai', 'am_michael']);
  assert.deepStrictEqual(R('', 'openai', ''), ['openai', 'af_heart']); // unknown = English, the chosen voice
  assert.deepStrictEqual(R('es', 'openai', 'af_heart'), ['openai', 'ef_dora']);
  assert.deepStrictEqual(R('fr', 'openai', 'af_heart'), ['openai', 'ff_siwis']);
  assert.deepStrictEqual(R('ja', 'openai', 'af_heart'), ['openai', 'jf_alpha']);
  assert.deepStrictEqual(R('es', 'openai', 'em_alex'), ['openai', 'em_alex']); // the chosen voice already speaks it
  assert.deepStrictEqual(R('es', 'openai', 'af_heart', { es: 'em_santa' }), ['openai', 'em_santa']); // set in Voices per language
  assert.deepStrictEqual(R('pt-BR', 'openai', 'af_heart'), ['openai', 'pf_dora']);
  for (const l of ['tr', 'az', 'ru', 'ar', 'de']) assert.deepStrictEqual(R(l, 'openai', 'af_heart'), ['system', ''], 'Kokoro cannot speak ' + l);
  assert.match(L.routeVoice({ lang: 'tr', engine: 'openai' }).reason, /Kokoro has no Turkish voice/);
  assert.deepStrictEqual(R('en', 'chatterbox'), ['chatterbox', '']);
  assert.deepStrictEqual(R('tr', 'chatterbox'), ['system', '']);
  assert.deepStrictEqual(R('es', 'chatterbox'), ['system', '']); // the Chatterbox model is English
  assert.deepStrictEqual(R('en', 'piper'), ['piper', '']); assert.deepStrictEqual(R('de', 'piper'), ['system', '']);
  assert.deepStrictEqual(R('tr', 'system'), ['system', '']); assert.deepStrictEqual(R('en', 'system'), ['system', '']);
  // Sentinel: speech in other scripts is not noise, and the name is found in other languages
  assert(!c.looksLikeNoise('Привет, как дела?') && !c.looksLikeNoise('こんにちは') && !c.looksLikeNoise('Bugün hava nasıl?') && c.looksLikeNoise('uh'));
  assert(L.kokoroVoiceFits('bf_emma', 'en') && !L.kokoroVoiceFits('af_heart', 'es') && !L.kokoroVoiceFits('', 'es'));

  // ---- per-language engine map: lang + map + main engine -> { engine, url, voice } ----
  { const RL = (lang, mainEngine, map = {}, voice = 'af_heart') => { const r = L.routeLang({ lang, main: { engine: mainEngine, voice }, map }); return [r.engine, r.url, r.voice, r.key, r.custom]; };
    // nothing set: the old behaviour (main engine, Kokoro voice map, computer voice for what the engine cannot speak)
    assert.deepStrictEqual(RL('en', 'openai'), ['openai', '', 'af_heart', 'main', false]);
    assert.deepStrictEqual(RL('es', 'openai'), ['openai', '', 'ef_dora', 'main', false]);
    assert.deepStrictEqual(RL('tr', 'openai'), ['system', '', '', 'system', false]);
    assert.deepStrictEqual(RL('az', 'piper'), ['system', '', '', 'system', false]);
    assert.deepStrictEqual(RL('en', 'system'), ['system', '', '', 'system', false]);
    // Turkish via a Piper server: its own address and voice, a per-language server (custom), whatever the main engine is
    const tr = { tr: { engine: 'piper', url: 'http://localhost:5100/', voice: 'tr_TR-dfki-medium' } };
    assert.deepStrictEqual(RL('tr', 'openai', tr), ['piper', 'http://localhost:5100', 'tr_TR-dfki-medium', 'piper|http://localhost:5100', true]);
    assert.deepStrictEqual(RL('tr-TR', 'system', tr), ['piper', 'http://localhost:5100', 'tr_TR-dfki-medium', 'piper|http://localhost:5100', true]);
    assert.deepStrictEqual(RL('tr', 'openai', { tr: { engine: 'piper' } }), ['piper', L.PIPER_LANG_URL, '', 'piper|' + L.PIPER_LANG_URL, true]); // default port 5100
    assert.deepStrictEqual(RL('tr', 'piper', { tr: { engine: 'piper', voice: 'tr_TR-fahrettin-medium' } }), ['piper', '', 'tr_TR-fahrettin-medium', 'main', false]); // the main Piper server
    assert.deepStrictEqual(RL('en', 'openai', tr), ['openai', '', 'af_heart', 'main', false]); // other languages untouched
    // a second Kokoro-compatible server (a Turkish fine-tune): a voice is needed, else the computer voice
    assert.deepStrictEqual(RL('tr', 'openai', { tr: { engine: 'openai', url: 'http://localhost:8881', voice: 'tf_ayla' } }), ['openai', 'http://localhost:8881', 'tf_ayla', 'openai|http://localhost:8881', true]);
    assert.deepStrictEqual(RL('tr', 'openai', { tr: { engine: 'openai', url: 'http://localhost:8881' } })[0], 'system');
    assert.match(L.routeLang({ lang: 'tr', main: { engine: 'openai' }, map: { tr: { engine: 'openai' } } }).reason, /No Kokoro voice is set for Turkish/);
    assert.deepStrictEqual(RL('es', 'piper', { es: { engine: 'openai' } }), ['openai', '', 'ef_dora', 'openai|', true]); // Kokoro for Spanish only
    // computer voice by choice; an invalid address never reaches a server
    assert.deepStrictEqual(RL('es', 'openai', { es: { engine: 'system' } })[0], 'system');
    assert.deepStrictEqual(RL('tr', 'openai', { tr: { engine: 'piper', url: 'file:///etc/passwd' } })[0], 'system');
    assert.deepStrictEqual(RL('tr', 'openai', { tr: { engine: 'piper', voice: '../../x y' } })[2], ''); // a bad voice name is dropped
    assert.deepStrictEqual(RL('tr', 'openai', { tr: { engine: 'chatterbox', url: 'http://localhost:8004', voice: 'clone:ayse.wav' } }), ['chatterbox', 'http://localhost:8004', 'clone:ayse.wav', 'chatterbox|http://localhost:8004', true]);
    // unknown language = the English entry
    assert.deepStrictEqual(RL('', 'openai', { en: { engine: 'piper', url: 'http://localhost:5000' } })[0], 'piper');
    // the older ttsVoices map is read as Default + voice; voiceLangMap wins (also when it clears the voice)
    assert.deepStrictEqual(L.langMapFrom({ ttsVoices: { es: 'em_santa', fr: '' } }), { es: { engine: 'default', url: '', voice: 'em_santa' } });
    assert.deepStrictEqual(RL('es', 'openai', L.langMapFrom({ ttsVoices: { es: 'em_santa' } })), ['openai', '', 'em_santa', 'main', false]);
    assert.deepStrictEqual(L.langMapFrom({ ttsVoices: { es: 'em_santa' }, voiceLangMap: { es: { engine: 'default' }, tr: { engine: 'bogus' } } }), { es: { engine: 'default', url: '', voice: '' }, tr: { engine: 'default', url: '', voice: '' } });
    // one test sentence per language offered in Settings
    for (const [l] of L.VOICE_LANGS.slice(1)) assert(L.VOICE_TEST_SAMPLES[l], 'test sample for ' + l);
    for (const [l, t] of Object.entries(L.VOICE_TEST_SAMPLES)) if (['tr', 'ru', 'de', 'fr', 'es', 'ja', 'zh', 'ar', 'hi', 'ko', 'uk', 'en'].includes(l)) assert.strictEqual(L.detectTextLang(t), l, 'sample detected as ' + l); }

  // ---- Piper client: the older /synthesize server and the official piper.http_server (POST /) ----
  { const http = require('http');
    const { createPiper, normPiperVoices } = require('../electron/piper');
    const WAV = Buffer.from('RIFF....WAVEfmt fake');
    const fake = (routes) => { const seen = []; const srv = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
      const key = req.method + ' ' + req.url; let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
      seen.push({ key, body }); const h = routes[key];
      if (!h) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('Not Found'); return; }
      const [st, payload] = h(body); res.writeHead(st, { 'content-type': Buffer.isBuffer(payload) ? 'audio/wav' : 'application/json' }); res.end(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload)); }); });
      return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) }))); };
    const logs = []; const logger = { info: (_c, m) => logs.push(m), warn: (_c, m) => logs.push(m), error: (_c, m) => logs.push(m) };
    // official server: /synthesize is 404, / answers; the working path is remembered
    const off = await fake({ 'POST /': () => [200, WAV], 'GET /voices': () => [200, { 'tr_TR-dfki-medium': { language: 'tr' }, 'en_US-lessac-medium': {} }] });
    const pp = createPiper({ fetch, logger });
    let r = await pp.speak(off.base, { text: 'Merhaba.', length_scale: 1, voice: 'tr_TR-dfki-medium' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.endpoint, '/'); assert.deepStrictEqual(Buffer.from(await r.arrayBuffer()), WAV);
    assert.deepStrictEqual(off.seen.map((x) => x.key), ['POST /synthesize', 'POST /']);
    assert.deepStrictEqual(off.seen[1].body, { text: 'Merhaba.', length_scale: 1, voice: 'tr_TR-dfki-medium' });
    assert.strictEqual(pp.pathOf(off.base), '/');
    await (await pp.speak(off.base, { text: 'Tekrar.', length_scale: 1 })).arrayBuffer();
    assert.deepStrictEqual(off.seen.map((x) => x.key).slice(2), ['POST /'], 'the remembered path is used first');
    assert.deepStrictEqual(await pp.voices(off.base), { ok: true, voices: ['tr_TR-dfki-medium', 'en_US-lessac-medium'] });
    await off.close();
    // the older custom server: /synthesize answers at once; no voice list is fine
    const old = await fake({ 'POST /synthesize': () => [200, WAV] });
    r = await pp.speak(old.base, { text: 'Hello.', length_scale: 0.9 }); await r.arrayBuffer();
    assert.strictEqual(r.endpoint, '/synthesize'); assert.strictEqual(old.seen.length, 1);
    const v = await pp.voices(old.base); assert.strictEqual(v.ok, false);
    await old.close();
    // a server error is passed on as it is (not retried on another path)
    const bad = await fake({ 'POST /synthesize': () => [500, { error: 'no model' }] });
    r = await pp.speak(bad.base, { text: 'x', length_scale: 1 }); assert.strictEqual(r.status, 500); assert.strictEqual(bad.seen.length, 1); await r.arrayBuffer();
    await bad.close();
    assert.deepStrictEqual(normPiperVoices(['a', { name: 'b' }, { id: 'a' }]), ['a', 'b']); assert.deepStrictEqual(normPiperVoices({ voices: ['x'] }), ['x']); assert.deepStrictEqual(normPiperVoices(null), []);

    // the main process takes engine / url / voice per piece from the renderer, instead of the saved settings
    const piperSrv = await fake({ 'POST /': () => [200, WAV] });
    const kokoro = await fake({ 'POST /v1/audio/speech': () => [200, WAV] });
    const handlers = {}; const ipcMain = { handle: (n, f) => { handlers[n] = f; } };
    const settings = { ttsEngine: 'openai', ttsUrl: kokoro.base + '/v1', ttsVoice: 'af_heart', ttsModel: 'kokoro' };
    require('../electron/ipc/voice')({ ipcMain, getSettings: () => settings, logger, providersLib: require('../electron/providers'), systemPreferences: {}, transcribeAudio: () => ({}), fs: require('fs'), path: require('path'), crypto: require('crypto'), cacheDir: () => require('os').tmpdir() });
    let out = await handlers['voice:speak']({}, { text: 'Merhaba, nasılsın?', speed: 1, engine: 'piper', url: piperSrv.base, voice: 'tr_TR-dfki-medium' });
    assert.strictEqual(out.ok, true, out.error); assert.strictEqual(out.engine, 'piper');
    assert.deepStrictEqual(piperSrv.seen.map((x) => x.key), ['POST /synthesize', 'POST /']);
    assert.strictEqual(piperSrv.seen[1].body.voice, 'tr_TR-dfki-medium'); assert.strictEqual(kokoro.seen.length, 0, 'the main server is not asked');
    out = await handlers['voice:speak']({}, { text: 'Hello there.', speed: 1, voice: 'af_bella' }); // no engine: the main engine
    assert.strictEqual(out.ok, true, out.error); assert.strictEqual(kokoro.seen[0].body.voice, 'af_bella');
    out = await handlers['voice:speak']({}, { text: 'x', engine: 'piper', url: 'ftp://nope' });
    assert.strictEqual(out.ok, false); assert.match(out.error, /http/);
    out = await handlers['voice:stream']({ sender: { isDestroyed: () => true, send() {} } }, { id: 's1', text: 'Merhaba.', engine: 'piper', url: piperSrv.base });
    assert.strictEqual(out.ok, false); assert.match(out.error, /Streaming needs/); // Piper is never streamed
    out = await handlers['voice:piperVoices']({}, 'javascript:alert(1)'); assert.strictEqual(out.ok, false);
    await piperSrv.close(); await kokoro.close(); }
  console.log('voice tests passed');

})().catch((e) => { console.error(e); process.exit(1); });
