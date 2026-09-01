import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const storage = new Map();
global.wx = {
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => { storage.set(key, value); },
  removeStorageSync: (key) => { storage.delete(key); },
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  showToast: () => {},
  vibrateShort: () => {},
};
let app = { drill: null };
global.getApp = () => app;
let pageDef;
global.Page = (def) => { pageDef = def; };

const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
const timers = new Map();
const intervals = new Map();
let timerId = 0;
global.setTimeout = (fn, delay) => {
  const id = ++timerId;
  timers.set(id, { fn, at: delay });
  return id;
};
global.clearTimeout = (id) => { timers.delete(id); };
global.setInterval = (fn, delay) => {
  const id = ++timerId;
  intervals.set(id, { fn, delay });
  return id;
};
global.clearInterval = (id) => { intervals.delete(id); };
function advance(ms) {
  for (const [id, timer] of [...timers]) {
    timer.at -= ms;
    if (timer.at <= 0) {
      timers.delete(id);
      timer.fn();
    }
  }
}

const req = createRequire(new URL('../miniprogram/pages/practice/', import.meta.url));
const engine = req('../../utils/engine.js');
req('./practice.js');

function makePage() {
  const page = Object.create(pageDef);
  page.data = {
    active: true,
    mode: 'chars',
    keyboardMode: 'vkb',
    keyImpact: true,
    pressedKey: '',
    pressedClass: 'pressed-a',
    errKey: '',
    errClass: 'err-a',
    result: null,
    curKey: 'a',
    nextKey: 'b',
    fb: '',
  };
  page.setData = (patch) => Object.assign(page.data, patch);
  page.timer = null;
  page.render = (extra = {}) => page.setData(extra);
  page.onLoad({});
  return page;
}

function withPressResult(result, fn) {
  const original = engine.press;
  engine.press = () => result;
  try { fn(); } finally { engine.press = original; }
}

function withStartResult(result, fn) {
  const original = engine.startSession;
  engine.startSession = () => result;
  try { fn(); } finally { engine.startSession = original; }
}

try {
  {
    const page = makePage();
    withPressResult({ ok: true, sessionDone: true, result: { mode: 'chars', secs: 1, acc: 100, kpm: 60, total: 1, words: 1, scheme: 'flypy' } }, () => page.handlePress('a'));
    assert.equal(page.data.result.words, 1, 'final key should show result');
    assert.equal(page.data.pressedKey, 'a', 'final key should keep pressed feedback');
    advance(89);
    assert.equal(page.data.pressedKey, 'a', 'pressed feedback should last 90ms');
    advance(1);
    assert.equal(page.data.pressedKey, '', 'pressed feedback should clear at 90ms');
  }

  {
    const page = makePage();
    withPressResult({ ok: true, sessionDone: false }, () => page.handlePress('a'));
    assert.equal(page.data.pressedClass, 'pressed-b', 'pressed class should toggle for replay');
    advance(90);
    assert.equal(page.data.pressedKey, '', 'pressed feedback should use its own duration');
  }

  {
    const page = makePage();
    withPressResult({ ok: false, cleared: false, feedback: 'wrong' }, () => page.handlePress('q'));
    const firstClass = page.data.errClass;
    withPressResult({ ok: false, cleared: false, feedback: 'wrong' }, () => page.handlePress('q'));
    assert.notEqual(page.data.errClass, firstClass, 'same-key error should toggle class for animation replay');
    advance(129);
    assert.equal(page.data.errKey, 'q', 'error feedback should last 130ms');
    advance(1);
    assert.equal(page.data.errKey, '', 'error feedback should clear at 130ms');
  }

  {
    const page = makePage();
    withPressResult({ ok: true, sessionDone: false }, () => page.handlePress('a'));
    advance(40);
    withStartResult({ status: 'ok' }, () => page.start('chars'));
    withPressResult({ ok: true, sessionDone: false }, () => page.handlePress('a'));
    advance(50);
    assert.equal(page.data.pressedKey, 'a', 'old-session timeout must not clear new-session feedback');
    advance(40);
    assert.equal(page.data.pressedKey, '', 'new-session feedback should keep its full duration');
  }

  {
    const page = makePage();
    let writes = 0;
    const setData = page.setData;
    page.setData = (patch) => { writes++; setData(patch); };
    withPressResult({ ok: true, sessionDone: false }, () => page.handlePress('a'));
    page.onHide();
    const writesAfterHide = writes;
    advance(90);
    assert.equal(writes, writesAfterHide, 'hidden page timeout must not call setData');
    assert.equal(page.data.pressedKey, '', 'hiding should clear key feedback state');
  }

  {
    const page = makePage();
    let writes = 0;
    const setData = page.setData;
    page.setData = (patch) => { writes++; setData(patch); };
    withPressResult({ ok: false, cleared: true, feedback: 'wrong' }, () => page.handlePress('q'));
    page.onUnload();
    const writesAfterUnload = writes;
    advance(130);
    assert.equal(writes, writesAfterUnload, 'unloaded page timeout must not call setData');
  }

  {
    const page = makePage();
    page._shown = true;
    page.scheme = { id: 'flypy' };
    page.onHide();
    assert.equal(page.timer, null, 'hiding should stop the practice ticker');
    page.onShow();
    assert.ok(page.timer && intervals.has(page.timer), 'showing an active page should restart the practice ticker');
  }

  {
    const page = makePage();
    page.setData({ pressedKey: 'a', errKey: 'q' });
    page.showResult({ secs: 1 });
    assert.deepEqual([page.data.pressedKey, page.data.errKey], ['', ''], 'ordinary result should clear key feedback');
  }

  {
    const wxml = readFileSync(new URL('../miniprogram/pages/practice/practice.wxml', import.meta.url), 'utf8');
    assert.match(wxml, /pressed-class="\{\{pressedClass\}\}"/, 'practice page should pass pressed animation class');
    assert.match(wxml, /err-class="\{\{errClass\}\}"/, 'practice page should pass error animation class');
  }

  console.log('mp-practice: 9 scenarios passed, 0 failed');
} finally {
  timers.clear();
  intervals.clear();
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
  global.setInterval = realSetInterval;
  global.clearInterval = realClearInterval;
}
