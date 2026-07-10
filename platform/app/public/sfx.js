// 🎵 sfx.js - 游戏音效&背景音乐系统 (Web Audio API 合成，无需音频文件)
var SFX = (function(){
  var ctx = null;
  var enabled = true;
  var volume = 0.3;
  var bgmNode = null, bgmGain = null, bgmOn = false;

  function getCtx(){
    if(!ctx){
      try{ ctx = new (window.AudioContext||window.webkitAudioContext)(); }
      catch(e){ console.warn('SFX: AudioContext not available'); return null; }
    }
    if(ctx && ctx.state==='suspended'){
      ctx.resume().catch(function(){});
    }
    return ctx;
  }

  // ===== 工具函数 =====
  function noise(dur){
    var c=getCtx(), len=c.sampleRate*dur;
    var buf=c.createBuffer(1,len,c.sampleRate);
    var d=buf.getChannelData(0);
    for(var i=0;i<len;i++) d[i]=(Math.random()*2-1)*0.3;
    return buf;
  }

  function playBuf(buf,opt){
    if(!enabled)return;
    opt=opt||{};
    var c=getCtx();if(!c)return;
    var s=c.createBufferSource();
    var s=c.createBufferSource();
    s.buffer=buf;
    var g=c.createGain();
    g.gain.value=(opt.vol!=null?opt.vol:1)*volume;
    if(opt.detune) s.detune.value=opt.detune;
    g.connect(c.destination);
    s.connect(g);
    s.start(c.currentTime+(opt.delay||0));
    if(opt.loop){s.loop=true;return s}
    s.stop(c.currentTime+(opt.dur||buf.duration)+(opt.delay||0));
  }

  function tone(freq,dur,type,opt){
    if(!enabled)return;
    opt=opt||{};
    var c=getCtx();if(!c)return;
    var o=c.createOscillator();
    o.type=type||'square';
    o.frequency.value=freq;
    var g=c.createGain();
    g.gain.setValueAtTime((opt.vol!=null?opt.vol:1)*volume, c.currentTime+(opt.delay||0));
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+(opt.delay||0)+dur);
    g.connect(c.destination);
    o.connect(g);
    o.start(c.currentTime+(opt.delay||0));
    o.stop(c.currentTime+(opt.delay||0)+dur);
  }

  // ===== 背景音乐 (BGM) =====

  // 8-bit 风格冒险 BGM
  function bgmAdventure(){
    stopBGM();
    var c=getCtx();
    bgmGain = c.createGain();
    bgmGain.gain.value = volume * 0.25;
    bgmGain.connect(c.destination);

    var notes = [262,294,330,349,392,349,330,294, 262,330,392,523, 392,330,349,294];
    var dur = 0.2;
    var i = 0;
    function playNote(){
      if(!bgmOn)return;
      var o=c.createOscillator();o.type='square';
      var g=c.createGain();g.gain.setValueAtTime(0.3,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01,c.currentTime+dur*0.9);
      o.frequency.value=notes[i%notes.length];
      g.connect(bgmGain);o.connect(g);
      o.start();o.stop(c.currentTime+dur);
      i++;
      bgmNode=setTimeout(playNote,dur*1000);
    }
    bgmOn=true;playNote();
  }

  // 轻快探索 BGM
  function bgmExplore(){
    stopBGM();
    var c=getCtx();
    bgmGain = c.createGain();
    bgmGain.gain.value = volume * 0.2;
    bgmGain.connect(c.destination);

    var notes=[330,392,440,392, 330,294,262,294, 330,392,523,440, 392,330,294,262];
    var dur=0.3;
    var i=0;
    function playNote(){
      if(!bgmOn)return;
      var o=c.createOscillator();o.type='triangle';
      var g=c.createGain();g.gain.setValueAtTime(0.25,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01,c.currentTime+dur*0.85);
      o.frequency.value=notes[i%notes.length];
      g.connect(bgmGain);o.connect(g);
      o.start();o.stop(c.currentTime+dur);
      i++;
      bgmNode=setTimeout(playNote,dur*1000);
    }
    bgmOn=true;playNote();
  }

  // 紧张刺激 BGM
  function bgmTense(){
    stopBGM();
    var c=getCtx();
    bgmGain = c.createGain();
    bgmGain.gain.value = volume * 0.3;
    bgmGain.connect(c.destination);

    var notes=[196,220,247,262, 247,220,196,220, 262,294,330,294, 262,247,220,196];
    var dur=0.15;
    var i=0;
    function playNote(){
      if(!bgmOn)return;
      var o=c.createOscillator();o.type='sawtooth';
      var g=c.createGain();g.gain.setValueAtTime(0.2,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01,c.currentTime+dur*0.7);
      o.frequency.value=notes[i%notes.length];
      g.connect(bgmGain);o.connect(g);
      o.start();o.stop(c.currentTime+dur);
      i++;
      bgmNode=setTimeout(playNote,dur*1000);
    }
    bgmOn=true;playNote();
  }

  // 太空科幻 BGM
  function bgmSpace(){
    stopBGM();
    var c=getCtx();
    bgmGain = c.createGain();
    bgmGain.gain.value = volume * 0.2;
    bgmGain.connect(c.destination);

    var notes=[262,262,392,392,440,440,392, 349,349,330,330,294,294,262];
    var dur=0.35;
    var i=0;
    function playNote(){
      if(!bgmOn)return;
      var o=c.createOscillator();o.type='sine';
      var g=c.createGain();g.gain.setValueAtTime(0.3,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01,c.currentTime+dur*0.9);
      o.frequency.value=notes[i%notes.length];
      var o2=c.createOscillator();o2.type='sine';
      o2.frequency.value=notes[i%notes.length]*1.5;
      var g2=c.createGain();g2.gain.setValueAtTime(0.1,c.currentTime);
      g2.gain.exponentialRampToValueAtTime(0.01,c.currentTime+dur*0.9);
      g.connect(bgmGain);o.connect(g);
      g2.connect(bgmGain);o2.connect(g2);
      o.start();o2.start();
      o.stop(c.currentTime+dur);o2.stop(c.currentTime+dur);
      i++;
      bgmNode=setTimeout(playNote,dur*1000);
    }
    bgmOn=true;playNote();
  }

  function stopBGM(){
    bgmOn=false;
    if(bgmNode){clearTimeout(bgmNode);bgmNode=null}
  }

  // 切换背景音乐开关
  function toggleBGM(){
    if(bgmOn){stopBGM();return false}
    return true;
  }

  // ===== 音效预设 =====
  function click(){ tone(800,0.05,'sine'); }
  function tap(){ tone(600,0.04,'sine'); }
  function collect(){
    tone(880,0.08,'sine');
    setTimeout(function(){tone(1320,0.08,'sine')},60);
  }
  function shoot(){
    var buf=noise(0.06);
    playBuf(buf,{vol:0.4});
    tone(200,0.1,'square',{vol:0.3});
  }
  function boom(){
    var buf=noise(0.25);
    playBuf(buf,{vol:0.6});
    tone(60,0.3,'sawtooth',{vol:0.5,detune:-300});
  }
  function hurt(){
    tone(200,0.15,'sawtooth',{vol:0.4,detune:-200});
  }
  function score(){
    tone(523,0.1,'sine');
    setTimeout(function(){tone(659,0.1,'sine')},80);
    setTimeout(function(){tone(784,0.15,'sine')},160);
  }
  function success(){
    tone(523,0.1,'sine');
    setTimeout(function(){tone(659,0.1,'sine')},100);
    setTimeout(function(){tone(784,0.1,'sine')},200);
    setTimeout(function(){tone(1047,0.2,'sine')},300);
  }
  function fail(){
    tone(300,0.15,'sawtooth',{vol:0.3});
    setTimeout(function(){tone(200,0.2,'sawtooth',{vol:0.3})},120);
  }
  function jump(){
    tone(400,0.06,'sine');
    setTimeout(function(){tone(600,0.06,'sine')},40);
  }
  function powerup(){
    tone(440,0.08,'sine');
    setTimeout(function(){tone(554,0.08,'sine')},70);
    setTimeout(function(){tone(659,0.08,'sine')},140);
    setTimeout(function(){tone(880,0.15,'sine')},210);
  }
  function tick(){ tone(1000,0.03,'sine'); }
  function notify(){ tone(1200,0.06,'sine');tone(1600,0.06,'sine',{delay:0.04}); }
  function whoosh(){
    var buf=noise(0.1);
    playBuf(buf,{vol:0.2,detune:800});
  }
  function teleport(){
    tone(300,0.15,'sine',{detune:1200});
  }

  return {
    enabled: function(v){ if(v!==undefined) enabled=v; return enabled; },
    volume: function(v){ if(v!==undefined) volume=Math.max(0,Math.min(1,v)); return volume; },
    resume: function(){ var c=getCtx(); if(c.state==='suspended') c.resume(); },
    // 背景音乐
    bgmAdventure: bgmAdventure, bgmExplore: bgmExplore,
    bgmTense: bgmTense, bgmSpace: bgmSpace,
    stopBGM: stopBGM, toggleBGM: toggleBGM,
    // 音效预设
    click: click, tap: tap, collect: collect, shoot: shoot, boom: boom,
    hurt: hurt, score: score, success: success, fail: fail, jump: jump,
    powerup: powerup, tick: tick, notify: notify, whoosh: whoosh, teleport: teleport,
    tone: tone, noise: function(d){return playBuf(noise(d))}
  };
})();

// ===== 全局兼容别名（供使用 sfxXxx() 风格的老游戏使用） =====
(function(){
  var m = {
    // 通用音效
    sfxClick: SFX.click, sfxTap: SFX.tap, sfxBlip: SFX.tick,
    sfxCoin: SFX.collect, sfxEat: SFX.collect, sfxGem: SFX.collect,
    sfxShoot: SFX.shoot, sfxPew: SFX.shoot,
    sfxExplode: SFX.boom,
    sfxHit: SFX.hurt,
    sfxJump: SFX.jump,
    sfxLose: SFX.fail, sfxWrong: SFX.fail,
    sfxWin: SFX.success, sfxClear: SFX.success,
    sfxPowerUp: SFX.powerup,
    sfxNotify: SFX.notify,
    // 俄罗斯方块
    sfxDrop: function(){SFX.tone && SFX.tone(200,0.1,'sine');},
    sfxLock: function(){SFX.tone && SFX.tone(300,0.08,'square');},
    sfxRotate: function(){SFX.tone && SFX.tone(400,0.05,'sine');},
    sfxTetris: function(){SFX.tone && (SFX.tone(800,0.2,'sine'), SFX.tone(1000,0.2,'sine',{delay:0.1}));},
    sfxGameOver: SFX.fail,
    sfxInit: function(){},
    sfxMove: function(){SFX.tone && SFX.tone(220,0.03,'sine',{vol:0.2});},
    sfxMoveStop: function(){},
    sfxNoise: function(){try{SFX.noise(0.05)}catch(e){}},
    sfxTone: function(f,d,t,o){SFX.tone && SFX.tone(f,d,t,o);},
    sfxBGM: SFX.bgmAdventure,
    sfxResume: function(){try{SFX.resume()}catch(e){}},
    sfxResumeAll: SFX.bgmAdventure,
    sfxStopAll: SFX.stopBGM,
    sfxTankStart: SFX.bgmAdventure,
    sfxTankStop: SFX.stopBGM,
    sfxBGM: SFX.bgmAdventure
  };
  for(var k in m) window[k]=m[k];
})();
