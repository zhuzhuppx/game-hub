const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = 8765;
const SALT = 'game-platform-salt';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'platform.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if(!require('fs').existsSync(DATA_DIR)) require('fs').mkdirSync(DATA_DIR,{recursive:true});

const db = new Database(DB_PATH);
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');

// 建表
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
    PRIMARY KEY (id, username)
  );
`);
// 确保旧 users.json 数据迁移到 SQLite
// 确保旧数据有 icon 列
try{db.exec("ALTER TABLE games ADD COLUMN icon TEXT DEFAULT '🎮'")}catch(e){}
migrateUsers();

function hash(pw){return crypto.createHash('sha256').update(pw+SALT).digest('hex')}
function userCode(name){return crypto.createHash('sha256').update('u_'+name).digest('hex').slice(0,6)}
function nextGameId(username){
  var row=db.prepare('SELECT coalesce(max(cast(substr(id,2) as integer)),0)+1 as n FROM games WHERE username=?').get(username);
  return 'g'+row.n;
}
// 根据标题选图标（稳定的哈希映射）
function pickIcon(title){
  var icons=['🚀','👾','🐍','🏃','💎','🎯','⚔️','🌟','🎪','🦈','🐉','🦋','🌍','🔥','💡','🎨','🎵','🏆','🧩','👑'];
  var sum=0;for(var i=0;i<title.length;i++)sum+=title.charCodeAt(i);
  return icons[sum%icons.length];
}

function migrateUsers(){
  var fs=require('fs'),ufile=path.join(DATA_DIR,'users.json');
  if(!fs.existsSync(ufile))return;
  var users=JSON.parse(fs.readFileSync(ufile,'utf8'));
  var insert=db.prepare('INSERT OR IGNORE INTO users(username,password,code,active,created) VALUES(?,?,?,?,?)');
  var migrate=db.transaction(function(){
    Object.keys(users).forEach(function(n){
      var u=users[n];
      insert.run(n, u.pass||u.password||'', u.code||userCode(n), u.active?1:0, u.created||'');
    });
  });
  migrate();
  // 迁移游戏数据
  var gamesDir=path.join(DATA_DIR,'games');
  if(fs.existsSync(gamesDir)){
    var insertGame=db.prepare('INSERT OR IGNORE INTO games(id,username,title,html,ver,updated) VALUES(?,?,?,?,?,?)');
    var migrateGames=db.transaction(function(){
      fs.readdirSync(gamesDir).forEach(function(userDir){
        var d=path.join(gamesDir,userDir);
        if(!fs.statSync(d).isDirectory())return;
        var metaFile=path.join(d,'meta.json');
        if(!fs.existsSync(metaFile))return;
        var meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));
        // 旧格式兼容：key 可能是 title 或数字
        Object.entries(meta).forEach(function(entry){
          var oldKey=entry[0], g=entry[1];
          var gid=g.id||g.slug||oldKey;
          // 如果 gid 含中文/太长 → 用新短码
          if(/[^\x00-\x7F]/.test(gid)||gid.length>10) gid='g'+Object.keys(meta).indexOf(oldKey);
          var hFile=path.join(d,(g.id||g.slug||oldKey)+'.html');
          if(!fs.existsSync(hFile)){
            // 尝试找任意 html 文件
            var files=fs.readdirSync(d).filter(function(f){return f.endsWith('.html')});
            if(files.length>0)hFile=path.join(d,files[0]);
          }
          var html=fs.existsSync(hFile)?fs.readFileSync(hFile,'utf8'):'';
          insertGame.run(gid,userDir,g.title||oldKey,html,g.ver||1,g.updated||new Date().toISOString());
        });
      });
    });
    migrateGames();
  }
  // 备份后删除旧文件
  fs.renameSync(ufile,ufile+'.bak');
}

var app=express();
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.use(function(req,res,next){
  res.set('Cache-Control','no-store,no-cache,must-revalidate');
  next();
});
app.get('/', function(req,res){
  res.type('html').send(require('fs').readFileSync(path.resolve(__dirname,'workspace.html'),'utf8'));
});
app.get('/login', function(req,res){
  res.type('html').send(require('fs').readFileSync(path.join(__dirname,'login.html'),'utf8'));
});
app.get('/admin', function(req,res){
  res.type('html').send(require('fs').readFileSync(path.join(__dirname,'admin.html'),'utf8'));
});
app.get('/api/config', function(req,res){
  res.json({apiKey:'',notice:'请点击右上角 ⚙️ 设置你的 DeepSeek API Key'});
});
app.use('/platform', express.static(__dirname, {index: false}));

// 独立游戏播放页（分享用）
app.get('/play/:ucode/:gcode',function(req,res){
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
    '<a href="https://studio.2u1.cn" target="_blank" style="text-decoration:none;color:#aaa;font-size:12px;display:flex;align-items:center;gap:4px">'+
    '👤 '+author+' <span style="color:#4a6cf7">🏭 AI 游戏工坊</span></a></div>';
  var wrapper='<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no">'+
    '<title>'+title+' - '+author+' - AI 游戏工坊</title>'+
    '<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#000}'+
    'canvas{display:block}</style></head><body>'+credit;
  res.send(row.html.replace(/<!DOCTYPE[^>]*>/i,'').replace(/<html[^>]*>/i,'').replace(/<\/html>/i,'').replace(/<head>[\s\S]*?<\/head>/i,function(m){
    return wrapper+m.replace(/<\/head>/i,'');
  }));
});

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

app.post('/api/register',function(req,res){
  var u=req.body.username||'',p=req.body.password||'';
  u=u.trim().slice(0,20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g,'');
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

app.get('/api/me',function(req,res){
  var user=req.cookies&&req.cookies.auth_token;
  if(!user)return res.json({loggedIn:false});
  var row=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(user);
  if(!row)return res.json({loggedIn:false});
  res.json({loggedIn:true,username:row.username,code:row.code});
});

app.get('/api/my-games',requireAuth,listGames);
app.get('/api/games',requireAuth,listGames);
function listGames(req,res){
  var rows=db.prepare('SELECT id,title,icon,ver,updated FROM games WHERE username=? ORDER BY updated DESC').all(req.userName);
  res.json({games:rows,userCode:req.userCode});
}

app.post('/api/save-game',requireAuth,saveGame);
app.post('/api/save',requireAuth,saveGame);
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
  db.prepare('INSERT OR REPLACE INTO games(id,username,title,html,icon,ver,updated) VALUES(?,?,?,?,?,?,datetime(\'now\'))').run(gid,req.userName,title,html,icon,ver);
  res.json({ok:true,id:gid,ver:ver,icon:icon});
}

app.get('/api/load-game/:id',requireAuth,loadGame);
app.get('/api/game/:id',requireAuth,loadGame);
function loadGame(req,res){
  var row=db.prepare('SELECT * FROM games WHERE id=? AND username=?').get(req.params.id,req.userName);
  if(!row)return res.status(404).json({error:'游戏不存在'});
  res.json({ok:true,html:row.html,title:row.title,id:row.id,version:row.ver});
}

app.post('/api/delete-game',requireAuth,deleteGame);
app.post('/api/delete',requireAuth,deleteGame);
function deleteGame(req,res){
  var id=req.body.id||req.body.slug||req.body.title||'';
  if(!id)return res.status(400).json({error:'缺少参数'});
  db.prepare('DELETE FROM games WHERE id=? AND username=?').run(id,req.userName);
  res.json({ok:true});
}

app.post('/api/admin/login',function(req,res){
  if(req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:'密码错误'});
  res.cookie('admin_pass',req.body.password,{maxAge:8*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true});
});

app.get('/api/admin/users',requireAdmin,function(req,res){
  var rows=db.prepare(`
    SELECT u.username, u.code, u.active, u.created,
      (SELECT count(*) FROM games g WHERE g.username=u.username) as gameCount
    FROM users u ORDER BY u.created DESC
  `).all();
  res.json({users:rows});
});

app.post('/api/admin/toggle-user',requireAdmin,function(req,res){
  var u=req.body.username;
  var row=db.prepare('SELECT * FROM users WHERE username=?').get(u);
  if(!row)return res.status(404).json({error:'用户不存在'});
  db.prepare('UPDATE users SET active=? WHERE username=?').run(row.active?0:1,u);
  res.json({ok:true,active:!row.active});
});

app.get('/api/stats',requireAdmin,function(req,res){
  var users=db.prepare('SELECT count(*) as n FROM users').get();
  var games=db.prepare('SELECT count(*) as n FROM games').get();
  var active=db.prepare('SELECT count(*) as n FROM users WHERE active=1').get();
  res.json({userCount:users.n,gameCount:games.n,activeUsers:active.n});
});

app.listen(PORT,function(){
  console.log('AI 游戏工坊 SQLite: http://localhost:'+PORT);
});
