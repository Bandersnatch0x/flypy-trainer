// 合成音效（小程序版）：wx.createWebAudioContext 振荡器，无外部资源；不可用时静默。
let ctx = null;
function ac() {
  if (!ctx && typeof wx !== 'undefined' && wx.createWebAudioContext) ctx = wx.createWebAudioContext();
  return ctx;
}
function blip(freq, dur, type = 'square', gain = 0.04) {
  try {
    const a = ac();
    if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch { /* 音频不可用时静默 */ }
}
const sound = {
  key: () => blip(880, 0.05, 'square', 0.025),
  hit: () => { blip(660, 0.07, 'triangle', 0.05); setTimeout(() => blip(990, 0.09, 'triangle', 0.04), 40); },
  miss: () => blip(160, 0.12, 'sawtooth', 0.05),
};
module.exports = { sound };
