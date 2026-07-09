const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = 8765;
const SALT = 'game-platform-salt';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'platform.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const LLM_LOCAL = process.env.LLM_LOCAL === 'true' || process.env.LLM_LOCAL === '1';
const LLM_HOST = LLM_LOCAL ? 'llm-local' : 'api.deepseek.com';
const LLM_PORT = LLM_LOCAL ? 8000 : 443;
const LLM_HTTPS = !LLM_LOCAL;
const LLM_MODEL = LLM_LOCAL ? 'Qwen3.6-35B-A3B-UD-Q3_K_M.gguf' : (process.env.LLM_MODEL || 'deepseek-v4-flash');

if(!require('fs').existsSync(DATA_DIR)) require('fs').mkdirSync(DATA_DIR,{recursive:true});

const db = new Database(DB_PATH);
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');

// ==================== DB Schema ====================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    code    TEXT NOT NULL UNIQUE,
    active  INTEGER DEFAULT 1,
    created TEXT DEFAULT (date('now'))
  );
  CREATE TABLE IF NOT EXISTS games (
    id      TEXT NOT NULL,
    username TEXT NOT NULL REFERENCES users(username),
    title   TEXT NOT NULL,
    html    TEXT NOT NULL,
    icon    TEXT DEFAULT '🎮',
    ver     INTEGER DEFAULT 1,
    updated TEXT DEFAULT (datetime('now')),
    public  INTEGER DEFAULT 0,
    likes   INTEGER DEFAULT 0,
    PRIMARY KEY (id, username)
  );
  CREATE TABLE IF NOT EXISTS game_likes (
    game_id TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (game_id, username)
  );
  CREATE TABLE IF NOT EXISTS game_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created TEXT DEFAULT (datetime('now'))
  );
`);

// 迁移
try{db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'")}catch(e){}
try{db.exec("ALTER TABLE users ADD COLUMN plan_expires TEXT")}catch(e){}
try{db.exec("ALTER TABLE users ADD COLUMN daily_ai_usage INTEGER DEFAULT 0")}catch(e){}
try{db.exec("ALTER TABLE users ADD COLUMN daily_ai_date TEXT")}catch(e){}
try{db.exec("ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0")}catch(e){}
try{db.exec("ALTER TABLE games ADD COLUMN icon TEXT DEFAULT '🎮'")}catch(e){}
try{db.exec("ALTER TABLE games ADD COLUMN public INTEGER DEFAULT 0")}catch(e){}
try{db.exec("ALTER TABLE games ADD COLUMN likes INTEGER DEFAULT 0")}catch(e){}
// 确保点赞/评论表存在（旧数据库可能没有）
db.exec(`
  CREATE TABLE IF NOT EXISTS game_likes (game_id TEXT NOT NULL, username TEXT NOT NULL, PRIMARY KEY(game_id,username));
  CREATE TABLE IF NOT EXISTS game_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, created TEXT DEFAULT(datetime('now')));
`);

// ==================== Plan Config ====================
const PLANS = {
  free:    {dailyAi:5,  maxGames:2,  voice:false, download:false, name:'免费版'},
  credits: {dailyAi:Infinity, maxGames:10, voice:true,  download:true,  name:'按次',  costPerCall:1},
  creator: {dailyAi:Infinity, maxGames:Infinity, voice:true,  download:true,  name:'创作者'},
  family:  {dailyAi:Infinity, maxGames:Infinity, voice:true,  download:true,  name:'家庭版'},
};
const VALID_PLANS = Object.keys(PLANS);

function getUserPlan(user) {
  var now = new Date().toISOString().slice(0,10);
  var plan = user.plan || 'free';
  if (user.plan_expires && user.plan_expires < now) plan = 'free';
  if (user.daily_ai_date !== now) {
    db.prepare('UPDATE users SET daily_ai_usage=0, daily_ai_date=? WHERE username=?').run(now, user.username);
    user.daily_ai_usage = 0;
  }
  return {plan:plan, cfg:PLANS[plan], dailyUsed:user.daily_ai_usage||0, credits:(user.credits||0)};
}

function checkLimit(req, res, next) {
  var user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(req.userName);
  if (!user) return res.status(403).json({error:'账号无效'});
  var info = getUserPlan(user);
  var cfg = info.cfg;

  // 按次付费：检查 credits
  if (info.plan === 'credits') {
    if (info.credits <= 0) {
      return res.status(429).json({error:'次数已用完，请充值', code:'NO_CREDITS', plan:'credits'});
    }
    req.userPlanInfo = info;
    return next();
  }

  // 免费/会员：检查每日限额
  if (info.dailyUsed >= cfg.dailyAi || cfg.dailyAi === Infinity) {
    // pass
  }
  if (info.dailyUsed >= cfg.dailyAi && cfg.dailyAi !== Infinity) {
    return res.status(429).json({error:'今日AI对话次数已用完', code:'LIMIT_REACHED', plan:info.plan});
  }
  req.userPlanInfo = info;
  next();
}

function consumeUsage(username, plan) {
  if (plan === 'credits') {
    db.prepare('UPDATE users SET credits=credits-1 WHERE username=?').run(username);
    return;
  }
  var now = new Date().toISOString().slice(0,10);
  db.prepare("UPDATE users SET daily_ai_usage=daily_ai_usage+1, daily_ai_date=? WHERE username=?").run(now, username);
}

function hash(pw){return crypto.createHash('sha256').update(pw+SALT).digest('hex')}
function userCode(name){return crypto.createHash('sha256').update('u_'+name).digest('hex').slice(0,6)}
function nextGameId(username){
  var row=db.prepare("SELECT coalesce(max(cast(substr(id,2) as integer)),0)+1 as n FROM games WHERE username=?").get(username);
  return 'g'+row.n;
}
function pickIcon(title){
  var icons=['🚀','👾','🐍','🏃','💎','🎯','⚔️','🌟','🎪','🦈','🐉','🦋','🌍','🔥','💡','🎨','🎵','🏆','🧩','👑'];
  var sum=0;for(var i=0;i<title.length;i++)sum+=title.charCodeAt(i);
  return icons[sum%icons.length];
}

// ==================== Express ====================
var app=express();
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.use(function(req,res,next){
  res.set('Cache-Control','no-store,no-cache,must-revalidate');
  next();
});

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req,res){
  res.type('html').send(require('fs').readFileSync(path.resolve(__dirname,'public','plaza.html'),'utf8'));
});
app.get('/workspace', function(req,res){
  res.set('Cache-Control','no-store,no-cache,must-revalidate');
  res.set('Pragma','no-cache');
  res.type('html').send(require('fs').readFileSync(path.resolve(__dirname,'public','workspace.html'),'utf8'));
});
app.get('/login', function(req,res){
  res.type('html').send(require('fs').readFileSync(path.join(__dirname,'public','login.html'),'utf8'));
});
app.get('/admin', function(req,res){
  res.type('html').send(require('fs').readFileSync(path.join(__dirname,'public','admin.html'),'utf8'));
});

// ==================== Name Polish (轻量纠错，用非推理模型) ====================
app.post('/api/polish-name', requireAuth, function(req,res){
  var text = (req.body.text||'').trim();
  if(!text||text.length<2)return res.json({name:text});
  var payload = JSON.stringify({
    model: LLM_MODEL,
    messages: [
      {role:'system',content:'你是儿童游戏命名纠错助手。用户语音输入了游戏名（可能有同音错字），请纠正成正确的游戏名。只回复纠正后的名字本身，不要解释不要引号。不超过8个字。常见游戏名：星际大冒险、小勇士闯关、极速赛车王、太空探险、海底世界、恐龙乐园。特别注意："官员的关"→"勇士闯关"。如果听起来像某个常见名就纠正，否则原样返回。'},
      {role:'user',content:text}
    ],
    max_tokens: 20,
    temperature: 0.3
  });
  var transport = LLM_HTTPS ? require('https') : require('http');
  var opts = {
    hostname: LLM_HOST, port: LLM_PORT, path: '/v1/chat/completions',
    method: 'POST', timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  if (!LLM_LOCAL) opts.headers['Authorization'] = 'Bearer '+DEEPSEEK_API_KEY;
  var apiReq = transport.request(opts, function(apiRes){
    var data=[];
    apiRes.on('data',function(c){data.push(c)});
    apiRes.on('end',function(){
      try{
        var json = JSON.parse(Buffer.concat(data).toString());
        var name = json.choices[0].message.content||'';
        name = name.trim().replace(/^["'「」]+|["'「」]+$/g,'');
        res.json({name: name||text});
      }catch(e){
        res.json({name:text});
      }
    });
  });
  apiReq.on('error',function(){res.json({name:text})});
  apiReq.write(payload);apiReq.end();
});

// ==================== TTS ====================
app.get('/api/tts', function(req,res){
  var text=req.query.text, voice=req.query.voice||'zh-CN-XiaoxiaoNeural';
  if(!text)return res.status(400).json({error:'no text'});
  var http=require('http');
  var qs='text='+encodeURIComponent(text)+'&voice='+encodeURIComponent(voice);
  http.get({hostname:'whisper-speech',port:8766,path:'/tts?'+qs},function(r2){
    if(r2.statusCode!==200){
      res.status(503).json({error:'TTS 不可用'});
      return;
    }
    res.set('Content-Type','audio/mpeg');
    r2.pipe(res);
  }).on('error',function(){res.status(503).json({error:'TTS 服务暂不可用'})});
});

// ==================== Speech ====================
app.post('/api/speech', function(req,res){
  var chunks=[];
  req.on('data',function(c){chunks.push(c)});
  req.on('end',function(){
    var buf=Buffer.concat(chunks);
    var http=require('http');
    var r=http.request({hostname:'whisper-speech',port:8766,path:'/transcribe',method:'POST',
      headers:{'Content-Type':'application/octet-stream','Content-Length':buf.length}},function(r2){
      var data=[];r2.on('data',function(c){data.push(c)});r2.on('end',function(){
        try{res.json(JSON.parse(Buffer.concat(data).toString()))}catch(e){res.json({text:Buffer.concat(data).toString()})}
      });
    });
    r.on('error',function(){res.status(503).json({error:'语音服务暂不可用'})});
    r.write(buf);r.end();
  });
});

// ==================== Play (分享) ====================
app.get('/play/:ucode/:gcode', function(req,res){
  res.set('Cache-Control','no-store,no-cache,must-revalidate');
  res.set('Pragma','no-cache');
  var row=db.prepare(`
    SELECT g.*, u.username FROM games g JOIN users u ON g.username=u.username
    WHERE u.code=? AND g.id=?
  `).get(req.params.ucode, req.params.gcode);
  if(!row)return res.status(404).send('游戏不存在');
  var author=row.username,title=row.title;
  var credit='<div style="position:fixed;top:0;left:0;right:0;z-index:9999;'+
    'background:rgba(0,0,0,0.85);padding:12px 16px;font-family:system-ui;'+
    'display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.08)">'+
    '<div style="display:flex;align-items:center;gap:10px;pointer-events:none">'+
    '<span style="font-size:22px">🎮</span>'+
    '<span style="color:#fff;font-size:15px;font-weight:700">'+title+'</span></div>'+
    '<a href="https://studio.2u1.cn" target="_top" style="text-decoration:none;color:#aaa;font-size:12px;display:flex;align-items:center;gap:4px">'+
    '👤 '+author+' <span style="color:#4a6cf7">🏭 AI 游戏工坊</span></a></div>';
  var wrapper='<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no">'+
    '<meta http-equiv="Cache-Control" content="no-cache,no-store,must-revalidate">'+
    '<meta http-equiv="Pragma" content="no-cache">'+
    '<meta http-equiv="Expires" content="0">'+
    '<script src="https://studio.2u1.cn/platform/sfx.js"><\/script>'+
    '<script>document.addEventListener("visibilitychange",function(){if(document.hidden&&window.SFX)SFX.stopBGM()})<\/script>'+
    '<title>'+title+' - '+author+' - AI 游戏工坊</title>'+
    '<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#000}'+
    'canvas{display:block}</style></head><body>'+credit;
  res.send(row.html.replace(/<!DOCTYPE[^>]*>/i,'').replace(/<html[^>]*>/i,'').replace(/<\/html>/i,'').replace(/<head>[\s\S]*?<\/head>/i,function(m){
    return wrapper+m.replace(/<\/head>/i,'');
  }));
});

// ==================== Auth ====================
function requireAuth(req,res,next){
  var user=req.cookies&&req.cookies.auth_token;
  if(!user)return res.status(401).json({error:'请先登录'});
  var row=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(user);
  if(!row)return res.status(403).json({error:'账号无效'});
  req.userName=row.username;
  req.userCode=row.code;
  next();
}

function requireAdmin(req,res,next){
  var pass=(req.headers&&req.headers['x-admin-password'])||(req.cookies&&req.cookies.admin_pass);
  if(pass!==ADMIN_PASSWORD)return res.status(401).json({error:'管理员密码错误'});
  next();
}

// ==================== Auth APIs ====================
app.post('/api/register',function(req,res){
  var u=(req.body.username||'').trim().slice(0,20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g,'');
  var p=req.body.password||'';
  if(!u||u.length<2)return res.status(400).json({error:'用户名2-20字符'});
  if(p.length<3)return res.status(400).json({error:'密码至少3位'});
  var existing=db.prepare('SELECT 1 FROM users WHERE username=?').get(u);
  if(existing)return res.status(409).json({error:'用户名已存在'});
  var code=userCode(u);
  db.prepare('INSERT INTO users(username,password,code) VALUES(?,?,?)').run(u,hash(p),code);
  res.cookie('auth_token',u,{maxAge:30*24*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true,username:u,code:code});
});

app.post('/api/login',function(req,res){
  var u=(req.body.username||'').trim(),p=req.body.password||'';
  var row=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(u);
  if(!row||row.password!==hash(p))return res.status(401).json({error:'用户名或密码错误'});
  res.cookie('auth_token',u,{maxAge:30*24*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true,username:u,code:row.code});
});

app.post('/api/logout',function(req,res){
  res.clearCookie('auth_token');
  res.json({ok:true});
});

// ==================== Plan Info ====================
app.get('/api/me',function(req,res){
  var user=req.cookies&&req.cookies.auth_token;
  if(!user)return res.json({loggedIn:false});
  var row=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(user);
  if(!row)return res.json({loggedIn:false});
  var info = getUserPlan(row);
  var gameCount = db.prepare('SELECT count(*) as n FROM games WHERE username=?').get(row.username).n;
  res.json({
    loggedIn:true,
    username:row.username,
    code:row.code,
    plan:info.plan,
    planName:info.cfg.name,
    planExpires:row.plan_expires||null,
    credits:info.credits,
    limits:{
      dailyAi:{used:info.dailyUsed, max:info.cfg.dailyAi===Infinity?999:info.cfg.dailyAi},
      games:{used:gameCount, max:info.cfg.maxGames===Infinity?999:info.cfg.maxGames},
      voice:info.cfg.voice,
      download:info.cfg.download
    }
  });
});

// ==================== Game APIs ====================
app.get('/api/my-games',requireAuth,listGames);
app.get('/api/games',requireAuth,listGames);
function listGames(req,res){
  var rows=db.prepare('SELECT id,title,icon,ver,updated,public,likes FROM games WHERE username=? ORDER BY updated DESC').all(req.userName);
  res.json({games:rows,userCode:req.userCode});
}

app.post('/api/save-game',requireAuth,checkGameLimit);
app.post('/api/save',requireAuth,checkGameLimit);
function checkGameLimit(req,res,next){
  var user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(req.userName);
  var info = getUserPlan(user);
  var gameCount = db.prepare('SELECT count(*) as n FROM games WHERE username=?').get(req.userName).n;
  var existingId = req.body.id||'';
  if (!existingId && gameCount >= info.cfg.maxGames && info.cfg.maxGames !== Infinity) {
    return res.status(429).json({error:'游戏数量已达上限('+info.cfg.maxGames+'个)，请升级会员', code:'GAME_LIMIT'});
  }
  saveGame(req,res);
}

function saveGame(req,res){
  var title=req.body.title||'',html=req.body.html||'',existingId=req.body.id||'';
  if(!title||!html)return res.status(400).json({error:'缺少参数'});
  var gid,ver,icon;
  if(existingId){
    var old=db.prepare('SELECT id,ver,icon FROM games WHERE id=? AND username=?').get(existingId,req.userName);
    if(old){gid=old.id;ver=old.ver+1;icon=old.icon}
    else{gid=existingId;ver=1;icon=pickIcon(title)}
  }else{
    gid=nextGameId(req.userName);ver=1;icon=pickIcon(title);
  }
  db.prepare("INSERT OR REPLACE INTO games(id,username,title,html,icon,ver,updated) VALUES(?,?,?,?,?,?,datetime('now'))")
    .run(gid,req.userName,title,html,icon,ver);
  res.json({ok:true,id:gid,ver:ver,icon:icon});
}

app.get('/api/load-game/:id',requireAuth,function(req,res){
  var row=db.prepare('SELECT * FROM games WHERE id=? AND username=?').get(req.params.id,req.userName);
  if(!row)return res.status(404).json({error:'游戏不存在'});
  res.json({ok:true,html:row.html,title:row.title,id:row.id,version:row.ver});
});
app.get('/api/game/:id',requireAuth,function(req,res){
  var row=db.prepare('SELECT * FROM games WHERE id=? AND username=?').get(req.params.id,req.userName);
  if(!row)return res.status(404).json({error:'游戏不存在'});
  res.json({ok:true,html:row.html,title:row.title,id:row.id,version:row.ver});
});

// 下载游戏源码（zip）
app.get('/api/download-game/:id',requireAuth,function(req,res){
  var user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(req.userName);
  var info = getUserPlan(user);
  if (!info.cfg.download) return res.status(403).json({error:'下载源码需要会员或按次付费'});

  var row=db.prepare('SELECT * FROM games WHERE id=? AND username=?').get(req.params.id,req.userName);
  if(!row)return res.status(404).json({error:'游戏不存在'});

  var archiver = require('archiver');
  var buffers = [];
  var archive = archiver('zip',{zlib:{level:9}});

  archive.on('data',function(chunk){buffers.push(chunk);});
  archive.on('error',function(err){res.status(500).end();});
  archive.on('end',function(){
    var buf = Buffer.concat(buffers);
    var filename = (row.title||'game').replace(/[^\w\u4e00-\u9fa5]/g,'_');
    var enc = encodeURIComponent(filename);
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Length',buf.length);
    res.setHeader('Content-Disposition','attachment; filename="'+enc+'.zip"; filename*=UTF-8\'\''+enc+'.zip');
    res.end(buf);
  });

  archive.append(row.html,{name:'index.html'});
  archive.append(
    '\uFEFF游戏名称: '+row.title+'\n'+
    '作者: '+row.username+'\n'+
    '版本: v'+row.ver+'\n'+
    '更新时间: '+row.updated+'\n'+
    '创作平台: AI 游戏工坊 (studio.2u1.cn)\n'+
    '开源协议: MIT\n'+
    '\n使用方法: 解压后用浏览器打开 index.html\n',
    {name:'README.txt'}
  );
  archive.finalize();
});

app.post('/api/delete-game',requireAuth,function(req,res){
  var id=req.body.id||'';
  if(!id)return res.status(400).json({error:'缺少参数'});
  db.prepare('DELETE FROM games WHERE id=? AND username=?').run(id,req.userName);
  res.json({ok:true});
});
app.post('/api/delete',requireAuth,function(req,res){
  var id=req.body.id||'';
  if(!id)return res.status(400).json({error:'缺少参数'});
  db.prepare('DELETE FROM games WHERE id=? AND username=?').run(id,req.userName);
  res.json({ok:true});
});

// ==================== AI Chat (支持流式和非流式) ====================
app.post('/api/chat', requireAuth, checkLimit, function(req,res){
  var messages = req.body.messages;
  var planInfo = req.userPlanInfo;
  var useStream = req.body.stream === true;
  if (!messages||!Array.isArray(messages)) return res.status(400).json({error:'缺少消息'});

  var modelName = LLM_MODEL;
  var payloadObj = {
    model: modelName,
    messages: messages,
    max_tokens: 32768,
    temperature: 0.7,
    stream: useStream
  };
  // 本地推理模型可能支持reasoning，DeepSeek不支持
  if (!LLM_LOCAL) payloadObj.thinking = {type: 'disabled'};
  var payload = JSON.stringify(payloadObj);

  var transport = LLM_HTTPS ? require('https') : require('http');
  var opts = {
    hostname: LLM_HOST,
    port: LLM_PORT,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 300000
  };
  if (!LLM_LOCAL) opts.headers['Authorization'] = 'Bearer '+DEEPSEEK_API_KEY;

  var apiReq = transport.request(opts, function(apiRes){
    if (useStream) {
      // 流式模式：透传 SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      var consumed = false;
      apiRes.on('data', function(c){ res.write(c); });
      apiRes.on('end', function(){
        if (!consumed) { consumed = true; consumeUsage(req.userName, planInfo.plan); }
        res.end();
      });
      apiReq.on('close', function(){
        if (!consumed) { consumed = true; consumeUsage(req.userName, planInfo.plan); }
      });
    } else {
      // 非流式模式：聚合后返回 JSON（兼容旧聊天）
      var data=[];
      apiRes.on('data',function(c){data.push(c)});
      apiRes.on('end',function(){
        try{
          var json = JSON.parse(Buffer.concat(data).toString());
          if (json.error) return res.status(500).json({error: json.error.message||'API错误'});
          consumeUsage(req.userName, planInfo.plan);
          res.json(json);
        }catch(e){
          res.status(500).json({error:'API返回异常'});
        }
      });
    }
  });
  apiReq.on('error', function(e){ res.status(503).json({error:'AI服务连接失败: '+e.message}); });
  apiReq.on('timeout', function(){ apiReq.destroy(); res.status(504).json({error:'AI响应超时'}); });
  apiReq.write(payload);
  apiReq.end();
});

// ==================== Admin APIs ====================
app.post('/api/admin/login',function(req,res){
  if(req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:'密码错误'});
  res.cookie('admin_pass',req.body.password,{maxAge:8*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true});
});

app.get('/api/admin/users',requireAdmin,function(req,res){
  var rows=db.prepare(`
    SELECT u.username, u.code, u.active, u.created, u.plan, u.plan_expires, u.credits,
      (SELECT count(*) FROM games g WHERE g.username=u.username) as gameCount
    FROM users u ORDER BY u.created DESC
  `).all();
  var today = new Date().toISOString().slice(0,10);
  rows.forEach(function(r){
    var u = db.prepare('SELECT daily_ai_usage, daily_ai_date FROM users WHERE username=?').get(r.username);
    r.dailyAiUsed = (u&&u.daily_ai_date===today) ? u.daily_ai_usage : 0;
  });
  res.json({users:rows});
});

app.post('/api/admin/toggle-user',requireAdmin,function(req,res){
  var u=req.body.username;
  var row=db.prepare('SELECT * FROM users WHERE username=?').get(u);
  if(!row)return res.status(404).json({error:'用户不存在'});
  db.prepare('UPDATE users SET active=? WHERE username=?').run(row.active?0:1,u);
  res.json({ok:true,active:!row.active});
});

app.post('/api/admin/grant-plan', requireAdmin, function(req,res){
  var usernames = req.body.usernames;
  var plan = req.body.plan || 'creator';
  var days = parseInt(req.body.days) || 365;
  if (!usernames||!Array.isArray(usernames)||usernames.length===0) return res.status(400).json({error:'请选择用户'});
  if (!VALID_PLANS.includes(plan)) return res.status(400).json({error:'无效等级'});
  var expires = null;
  if (plan !== 'free' && plan !== 'credits' && days > 0) {
    var d=new Date(); d.setDate(d.getDate()+days); expires=d.toISOString().slice(0,10);
  }
  var stmt=db.prepare('UPDATE users SET plan=?, plan_expires=? WHERE username=?');
  var updated=[];
  var tx=db.transaction(function(){
    usernames.forEach(function(u){
      if(db.prepare('SELECT username FROM users WHERE username=?').get(u)){
        stmt.run(plan,expires,u);updated.push(u);
      }
    });
  });tx();
  res.json({ok:true,updated:updated,plan:plan,expires:expires});
});

// 赠送次数
app.post('/api/admin/grant-credits', requireAdmin, function(req,res){
  var usernames = req.body.usernames;
  var amount = parseInt(req.body.amount) || 0;
  if (!usernames||!Array.isArray(usernames)||usernames.length===0) return res.status(400).json({error:'请选择用户'});
  if (amount <= 0) return res.status(400).json({error:'数量必须>0'});
  var stmt=db.prepare('UPDATE users SET credits=credits+? WHERE username=?');
  var updated=[];
  var tx=db.transaction(function(){
    usernames.forEach(function(u){
      if(db.prepare('SELECT username FROM users WHERE username=?').get(u)){
        stmt.run(amount,u);updated.push(u);
      }
    });
  });tx();
  res.json({ok:true,updated:updated,amount:amount,total:db.prepare('SELECT credits FROM users WHERE username=?').get(updated[0]).credits});
});

app.post('/api/admin/reset-usage', requireAdmin, function(req,res){
  var usernames = req.body.usernames;
  if (!usernames||!Array.isArray(usernames)) return res.status(400).json({error:'请选择用户'});
  var stmt=db.prepare('UPDATE users SET daily_ai_usage=0, daily_ai_date=NULL WHERE username=?');
  usernames.forEach(function(u){stmt.run(u)});
  res.json({ok:true});
});

app.get('/api/stats',requireAdmin,function(req,res){
  var users=db.prepare('SELECT count(*) as n FROM users').get();
  var games=db.prepare('SELECT count(*) as n FROM games').get();
  var active=db.prepare('SELECT count(*) as n FROM users WHERE active=1').get();
  var pro=db.prepare("SELECT count(*) as n FROM users WHERE plan!='free'").get();
  res.json({userCount:users.n, gameCount:games.n, activeUsers:active.n, proUsers:pro.n});
});

// 管理员：列出所有游戏
app.get('/api/admin/games',requireAdmin,function(req,res){
  var rows=db.prepare(`
    SELECT g.*, u.code as userCode FROM games g JOIN users u ON g.username=u.username
    ORDER BY g.updated DESC LIMIT 200
  `).all();
  res.json({games:rows});
});

// 管理员：下架游戏
app.post('/api/admin/delete-game',requireAdmin,function(req,res){
  var id=req.body.id,username=req.body.username;
  if(!id||!username)return res.status(400).json({error:'缺少参数'});
  db.prepare('DELETE FROM games WHERE id=? AND username=?').run(id,username);
  res.json({ok:true});
});

// ==================== Plaza ====================
app.get('/plaza',function(req,res){
  res.type('html').send(require('fs').readFileSync(path.join(__dirname,'public','plaza.html'),'utf8'));
});

app.get('/api/plaza',function(req,res){
  var rows = db.prepare(`
    SELECT g.id, g.username, g.title, g.icon, g.ver, g.updated, g.likes,
           u.code as userCode,
           (SELECT count(*) FROM game_comments WHERE game_id=g.id) as comments
    FROM games g JOIN users u ON g.username=u.username
    WHERE g.public=1
    ORDER BY g.likes DESC, g.updated DESC
    LIMIT 100
  `).all();
  // 当前用户是否已点赞（未登录则为空）
  var currentUser = (req.cookies&&req.cookies.auth_token)||'';
  var likedSet = new Set();
  if (currentUser) {
    var liked = db.prepare('SELECT game_id FROM game_likes WHERE username=?').all(currentUser);
    liked.forEach(function(r){likedSet.add(r.game_id)});
  }
  rows.forEach(function(r){
    r.liked = likedSet.has(r.id);
  });
  res.json({games:rows});
});

// 发布/取消发布到广场
app.post('/api/publish-game',requireAuth,function(req,res){
  var id=req.body.id, pub=req.body.public?1:0;
  if(!id)return res.status(400).json({error:'缺少参数'});
  db.prepare('UPDATE games SET public=? WHERE id=? AND username=?').run(pub,id,req.userName);
  res.json({ok:true,public:!!pub});
});

// 点赞/取消
app.post('/api/like/:gameId/:gameUser',requireAuth,function(req,res){
  var gid=req.params.gameId, guser=req.params.gameUser;
  var row=db.prepare('SELECT 1 FROM games WHERE id=? AND username=? AND public=1').get(gid,guser);
  if(!row)return res.status(404).json({error:'游戏不存在'});
  var already = db.prepare('SELECT 1 FROM game_likes WHERE game_id=? AND username=?').get(gid,req.userName);
  if(already){
    db.prepare('DELETE FROM game_likes WHERE game_id=? AND username=?').run(gid,req.userName);
    db.prepare('UPDATE games SET likes=MAX(0,COALESCE(likes,0)-1) WHERE id=? AND username=?').run(gid,guser);
    var l=db.prepare('SELECT likes FROM games WHERE id=? AND username=?').get(gid,guser);
    return res.json({ok:true,liked:false,likes:l.likes});
  }
  db.prepare('INSERT INTO game_likes(game_id,username) VALUES(?,?)').run(gid,req.userName);
  db.prepare('UPDATE games SET likes=COALESCE(likes,0)+1 WHERE id=? AND username=?').run(gid,guser);
  var l2=db.prepare('SELECT likes FROM games WHERE id=? AND username=?').get(gid,guser);
  res.json({ok:true,liked:true,likes:l2.likes});
});

// 评论
app.get('/api/comments/:gameId/:gameUser',function(req,res){
  var rows=db.prepare('SELECT * FROM game_comments WHERE game_id=? ORDER BY created ASC LIMIT 50').all(req.params.gameId);
  res.json({comments:rows});
});

app.post('/api/comment/:gameId/:gameUser',requireAuth,function(req,res){
  var text=(req.body.text||'').trim().slice(0,200);
  if(!text)return res.status(400).json({error:'评论不能为空'});
  var row=db.prepare('SELECT 1 FROM games WHERE id=? AND username=? AND public=1').get(req.params.gameId,req.params.gameUser);
  if(!row)return res.status(404).json({error:'游戏不存在'});
  db.prepare('INSERT INTO game_comments(game_id,username,text) VALUES(?,?,?)').run(req.params.gameId,req.userName,text);
  var newC=db.prepare('SELECT * FROM game_comments WHERE id=last_insert_rowid()').get();
  res.json({ok:true,comment:newC});
});

app.listen(PORT,function(){
  console.log('AI 游戏工坊 SQLite: http://localhost:'+PORT);
});
