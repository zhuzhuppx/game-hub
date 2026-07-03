// ====== 通用音效 & BGM 系统 ======
// 纯 Web Audio API 生成，零外部文件
// 音量配置: 改下面数值即可调整
var SFX_VOL = { move:0.025, tank:0.025, tread:0.018, hit:0.12, explode:0.15, shoot:0.06, blip:0.07, power:0.08 };

var sfxCtx = null, sfxGain = null, bgmGain = null, bgmNodes = [], bgmPlaying = false;

function sfxInit() {
  if (sfxCtx) return sfxCtx;
  sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
  sfxGain = sfxCtx.createGain();
  sfxGain.gain.value = 1;
  sfxGain.connect(sfxCtx.destination);
  bgmGain = sfxCtx.createGain();
  bgmGain.gain.value = 0.15;
  bgmGain.connect(sfxCtx.destination);
  return sfxCtx;
}

function sfxResume() {
  try { if (sfxCtx && sfxCtx.state === 'suspended') sfxCtx.resume(); } catch(e) {}
}

// ---- 基础音效生成 ----

function sfxTone(freq, dur, type, vol) {
  try {
    sfxInit(); sfxResume();
    var o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, sfxCtx.currentTime);
    g.gain.setValueAtTime(vol || 0.12, sfxCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, sfxCtx.currentTime + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(sfxCtx.currentTime + dur);
  } catch(e) {}
}

function sfxNoise(dur, vol) {
  try {
    sfxInit(); sfxResume();
    var buf = sfxCtx.createBuffer(1, sfxCtx.sampleRate * dur, sfxCtx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    var s = sfxCtx.createBufferSource(); s.buffer = buf;
    var g = sfxCtx.createGain();
    g.gain.setValueAtTime(vol || 0.08, sfxCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, sfxCtx.currentTime + dur);
    s.connect(g); g.connect(sfxGain); s.start();
  } catch(e) {}
}

function sfxFreqSweep(f1, f2, dur, type, vol) {
  try {
    sfxInit(); sfxResume();
    var o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f1, sfxCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f2, sfxCtx.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.12, sfxCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, sfxCtx.currentTime + dur);
    o.connect(g); g.connect(sfxGain); o.start(); o.stop(sfxCtx.currentTime + dur);
  } catch(e) {}
}

// ---- 命名音效 ----

function sfxClick()   { sfxTone(800, 0.05, 'square', 0.05); }
function sfxMove()    { sfxTone(600, 0.04, 'square', SFX_VOL.move); }
function sfxTankMove(){ sfxNoise(0.12, 0.08); sfxFreqSweep(80, 40, 0.15, 'sawtooth', 0.06); }

// ---- 坦克履带连续音效 ----
var tankSoundNodes = [];
function sfxTankStart() {
  try {
    sfxTankStop(); // kill any existing sound
    sfxInit(); sfxResume();
    var now = sfxCtx.currentTime;
    // Low rumble oscillator (continuous)
    var o = sfxCtx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, now);
    var g = sfxCtx.createGain();
    g.gain.setValueAtTime(SFX_VOL.tank, now);
    o.connect(g); g.connect(sfxGain); o.start();
    // Noise layer for tread grinding
    var buf = sfxCtx.createBuffer(1, sfxCtx.sampleRate * 0.3, sfxCtx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    var ns = sfxCtx.createBufferSource(); ns.buffer = buf; ns.loop = true;
    var ng = sfxCtx.createGain();
    ng.gain.setValueAtTime(SFX_VOL.tread, now);
    // Filter to make it sound mechanical
    var bp = sfxCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 200; bp.Q.value = 1;
    ns.connect(bp); bp.connect(ng); ng.connect(sfxGain); ns.start();
    tankSoundNodes = [o, ns, g, ng, bp];
  } catch(e) {}
}
function sfxTankStop() {
  try {
    if (!tankSoundNodes.length) return;
    tankSoundNodes[0].stop(); tankSoundNodes[1].stop();
    tankSoundNodes = [];
  } catch(e) { tankSoundNodes = []; }
}
function sfxSelect()  { sfxTone(1000, 0.08, 'sine', 0.07); setTimeout(function() { sfxTone(1200, 0.08, 'sine', 0.05); }, 60); }
function sfxBlip()    { sfxTone(880, 0.06, 'triangle', 0.07); }
function sfxEat()     { sfxFreqSweep(400, 800, 0.1, 'sine', 0.08); }
function sfxCoin()    { sfxTone(660, 0.08, 'sine', 0.08); setTimeout(function() { sfxTone(880, 0.1, 'sine', 0.06); }, 80); setTimeout(function() { sfxTone(1100, 0.15, 'sine', 0.05); }, 160); }
function sfxJump()    { sfxFreqSweep(200, 600, 0.12, 'triangle', 0.1); }
function sfxShoot()   { sfxNoise(0.06, 0.06); sfxFreqSweep(800, 200, 0.08, 'square', 0.04); }
function sfxHit()     { sfxNoise(0.08, 0.1); sfxTone(200, 0.1, 'sawtooth', 0.06); }
function sfxPew()     { sfxFreqSweep(1200, 400, 0.06, 'square', 0.05); }
function sfxExplode() { sfxNoise(0.3, 0.15); sfxFreqSweep(400, 50, 0.3, 'sawtooth', 0.08); }
function sfxPowerUp() { sfxTone(400, 0.1, 'sine', 0.08); setTimeout(function() { sfxTone(600, 0.1, 'sine', 0.07); }, 100); setTimeout(function() { sfxTone(900, 0.15, 'sine', 0.06); }, 200); }
function sfxCorrect() { sfxTone(523, 0.1, 'sine', 0.07); setTimeout(function() { sfxTone(659, 0.1, 'sine', 0.06); }, 100); setTimeout(function() { sfxTone(784, 0.15, 'sine', 0.05); }, 200); }
function sfxWrong()   { sfxTone(300, 0.12, 'sawtooth', 0.06); setTimeout(function() { sfxTone(200, 0.2, 'sawtooth', 0.05); }, 120); }
function sfxWin()     { [523,587,659,784,880,1047].forEach(function(f,i) { setTimeout(function() { sfxTone(f, 0.15, 'sine', 0.08); }, i*80); }); }
function sfxLose()    { [400,350,300,250,200,150].forEach(function(f,i) { setTimeout(function() { sfxTone(f, 0.2, 'sawtooth', 0.06); }, i*120); }); }
function sfxGameOver() { sfxLose(); }
function sfxClear()   { for (var i = 0; i < 6; i++) setTimeout(function() { sfxTone(523 + Math.random() * 300, 0.12, 'sine', 0.06); }, i*60); }

// ---- BGM: 程序化背景音乐 ----
// 简单芯片音乐风格，C 大调五声音阶

var BGM_NOTES = {
  c3:131,d3:147,e3:165,f3:175,g3:196,a3:220,b3:247,
  c4:262,d4:294,e4:330,f4:349,g4:392,a4:440,b4:494,
  c5:523,d5:587,e5:659,f5:698,g5:784,a5:880,b5:988,
  c6:1047
};
// 超级玛丽风格：旋律主导，欢快明亮
var BGM_PATTERNS = [
  // 1️⃣ 跳跃主题 - 向上跳动的旋律，像在地上走
  {bass:['c3','g2','a2','e3'], melody:['e5','e5','e5','c5','e5','g5','g5','', 'c5','g4','e4','d4','c4','g4','a4','b4'], bpm:150},
  // 2️⃣ 明亮主题 - 琶音上行，开阔感
  {bass:['c3','f3','g3','c4'], melody:['g4','c5','e5','d5','c5','g4','a4','b4', 'g4','e5','d5','c5','b4','a4','g4','c5'], bpm:155},
  // 3️⃣ 冒险主题 - 小调风味，探索感
  {bass:['a2','e3','f3','g3'], melody:['a4','c5','e5','a5','g5','e5','c5','a4', 'e5','d5','c5','a4','g4','a4','c5','e5'], bpm:145},
  // 4️⃣ 胜利主题 - 快速上行，结尾感
  {bass:['c3','g3','c3','g3'], melody:['c5','g4','e4','g4','c5','e5','d5','c5', 'g5','e5','c5','e5','g5','a5','g5','e5'], bpm:160},
];
var bgmPatternIdx = 0, bgmBassTimer = null, bgmMelodyTimer = null;

function bgmStart() {
  try {
    // Always stop previous BGM first to prevent overlap
    bgmStop();
    sfxInit(); sfxResume();
    // Ensure gain is at normal level (bgmStop doesn't touch gain anymore)
    try { if (bgmGain && bgmGain.gain.value < 0.05) bgmGain.gain.value = 0.15; } catch(e) {}
    bgmPlaying = true;
    bgmPatternIdx = Math.floor(Math.random() * BGM_PATTERNS.length);
    bgmPlayLoop();
  } catch(e) {}
}

function bgmStop() {
  bgmPlaying = false;
  // Stop all pending timers
  if (bgmBassTimer) { clearInterval(bgmBassTimer); bgmBassTimer = null; }
  if (bgmMelodyTimer) { clearTimeout(bgmMelodyTimer); bgmMelodyTimer = null; }
  // Stop all active oscillator nodes immediately
  bgmNodes.forEach(function(n) { try { n.stop(); } catch(e) {} });
  bgmNodes = [];
}

function bgmPlayLoop() {
  if (!bgmPlaying) return;
  var step = 0, barCount = 0;

  function playKick(vol, f0) {
    try {
      var o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0||120, sfxCtx.currentTime);
      o.frequency.exponentialRampToValueAtTime(30, sfxCtx.currentTime + 0.06);
      g.gain.setValueAtTime(vol||0.1, sfxCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, sfxCtx.currentTime + 0.1);
      o.connect(g); g.connect(bgmGain); o.start(); o.stop(sfxCtx.currentTime + 0.1);
    } catch(e) {}
  }

  function scheduleNext() {
    if (!bgmPlaying) return;
    var pat = BGM_PATTERNS[bgmPatternIdx];
    var beatMs = 60000 / pat.bpm / 4;
    bgmBassTimer = setTimeout(function() {
      try { playBeat(); } catch(e) {}
      if (bgmPlaying) scheduleNext();
    }, beatMs);
  }

  function playBeat() {
    if (!bgmPlaying) return;
    var t = sfxCtx.currentTime;
    var pat = BGM_PATTERNS[bgmPatternIdx];
    var beatMs = 60000 / pat.bpm / 4;
    var noteLen = beatMs / 1000;

    // === Bass ===
    if (step % 4 === 0) {
      var bi = Math.floor(step / 4) % 4;
      var n = pat.bass[bi];
      try {
        var o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(BGM_NOTES[n]||196, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + noteLen * 3);
        o.connect(g); g.connect(bgmGain); o.start(); o.stop(t + noteLen * 3);
        if (bgmNodes.length < 500) bgmNodes.push(o);
        if (step % 8 === 0) {
          var o5 = sfxCtx.createOscillator(), g5 = sfxCtx.createGain();
          o5.type = 'triangle';
          o5.frequency.setValueAtTime(BGM_NOTES[n]*1.5||294, t);
          g5.gain.setValueAtTime(0.04, t);
          g5.gain.exponentialRampToValueAtTime(0.001, t + noteLen * 2);
          o5.connect(g5); g5.connect(bgmGain); o5.start(); o5.stop(t + noteLen * 2);
          if (bgmNodes.length < 500) bgmNodes.push(o5);
        }
      } catch(e) {}
    }

    // === Melody ===
    var mn = pat.melody[step % 16];
    if (mn && mn.length > 0) {
      var mf = BGM_NOTES[mn] || 0;
      if (mf > 0) {
        try {
          var o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
          o.type = 'square';
          o.frequency.setValueAtTime(mf, t);
          g.gain.setValueAtTime(0.055, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + noteLen * 0.85);
          o.connect(g); g.connect(bgmGain); o.start(); o.stop(t + noteLen);
          if (bgmNodes.length < 500) bgmNodes.push(o);
          if (step % 4 === 0) {
            o.frequency.setValueAtTime(mf, t);
            o.frequency.linearRampToValueAtTime(mf * 1.02, t + noteLen * 0.3);
            o.frequency.linearRampToValueAtTime(mf, t + noteLen * 0.6);
          }
        } catch(e) {}
      }
    }

    // === Percussion ===
    if (step === 0) playKick(0.12, 150);
    else if (step === 8) playKick(0.08, 120);
    if (step % 4 === 2) {
      try {
        var n2 = sfxCtx.createOscillator(), g2 = sfxCtx.createGain();
        n2.type = 'square';
        n2.frequency.setValueAtTime(8000, t);
        g2.gain.setValueAtTime(0.02, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
        n2.connect(g2); g2.connect(bgmGain); n2.start(); n2.stop(t + 0.03);
        if (bgmNodes.length < 500) bgmNodes.push(n2);
      } catch(e) {}
    }

    step++;
    if (step >= 16) { step = 0; barCount++; if (barCount % 2 === 0) bgmPatternIdx = (bgmPatternIdx + 1) % BGM_PATTERNS.length; }
  }

  scheduleNext();
}

// ---- 音效开关 ----

var sfxMuted = false;
function sfxToggle() {
  sfxMuted = !sfxMuted;
  if (sfxGain) sfxGain.gain.value = sfxMuted ? 0 : 1;
  if (bgmGain) bgmGain.gain.value = sfxMuted ? 0 : 0.15;
  if (sfxMuted) bgmStop(); else bgmStart();
  return !sfxMuted;
}

// Auto-init AudioContext and start BGM on first user interaction
document.addEventListener('click', function sfxAutoInit() {
  sfxInit();
  bgmStart();
  document.removeEventListener('click', sfxAutoInit);
}, {once: true});
document.addEventListener('touchstart', function sfxAutoInit2() {
  sfxInit();
  bgmStart();
  document.removeEventListener('touchstart', sfxAutoInit2);
}, {once: true});
document.addEventListener('keydown', function sfxAutoInit3() {
  sfxInit();
  bgmStart();
  document.removeEventListener('keydown', sfxAutoInit3);
}, {once: true});

// Stop BGM when page is hidden/unloaded
document.addEventListener('visibilitychange', function() {
  if (document.hidden) bgmStop();
});
window.addEventListener('beforeunload', function() {
  bgmStop();
});
