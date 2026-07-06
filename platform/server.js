const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const SALT = 'game-platform-salt';
const DATA_DIR = path.join(__dirname, 'data');
const GAMES_DIR = path.join(DATA_DIR, 'games');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

[DATA_DIR, GAMES_DIR].forEach(function(d){if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true})});
if(!fs.existsSync(USERS_FILE))fs.writeFileSync(USERS_FILE,'{}');
function readUsers(){return JSON.parse(fs.readFileSync(USERS_FILE,'utf8'))}
function writeUsers(u){fs.writeFileSync(USERS_FILE,JSON.stringify(u,null,2))}
function hash(pw){return crypto.createHash('sha256').update(pw+SALT).digest('hex')}

var app=express();
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.get('/', function(req,res){res.redirect('/platform/')});
app.get('/platform/', function(req,res){
  var html=fs.readFileSync(path.resolve(__dirname,'workspace.html'),'utf8');
  res.type('html').send(html);
});
app.get('/api/config', function(req,res){
  res.json({apiKey:process.env.DEEPSEEK_API_KEY_GAME||''});
});
app.use('/platform', express.static(__dirname, {index: false}));

app.get('/p/:user/:slug',function(req,res){
  var file=path.join(GAMES_DIR,req.params.user,req.params.slug+'.html');
  if(!fs.existsSync(file))return res.status(404).send('not found');
  res.sendFile(file);
});

function requireAuth(req,res,next){
  var user=req.cookies&&req.cookies.auth_token;
  if(!user)return res.status(401).json({error:'请先登录'});
  var users=readUsers();
  if(!users[user]||!users[user].active)return res.status(403).json({error:'账号无效'});
  req.userName=user;
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
  var users=readUsers();
  if(users[u])return res.status(409).json({error:'用户名已存在'});
  users[u]={pass:hash(p),active:true,created:new Date().toISOString().slice(0,10)};
  writeUsers(users);
  res.cookie('auth_token',u,{maxAge:30*24*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true,username:u});
});

app.post('/api/login',function(req,res){
  var u=(req.body.username||'').trim(),p=req.body.password||'';
  var users=readUsers();
  if(!users[u]||!users[u].active||users[u].pass!==hash(p))
    return res.status(401).json({error:'用户名或密码错误'});
  res.cookie('auth_token',u,{maxAge:30*24*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true,username:u});
});

app.post('/api/logout',function(req,res){
  res.clearCookie('auth_token');
  res.json({ok:true});
});

app.get('/api/me',function(req,res){
  var user=req.cookies&&req.cookies.auth_token;
  if(!user)return res.json({loggedIn:false});
  var users=readUsers();
  if(!users[user]||!users[user].active)return res.json({loggedIn:false});
  res.json({loggedIn:true,username:user});
});

app.get('/api/my-games',requireAuth,function(req,res){
  var dir=path.join(GAMES_DIR,req.userName);
  if(!fs.existsSync(dir))return res.json({games:[]});
  var metaFile=path.join(dir,'meta.json');
  var meta=fs.existsSync(metaFile)?JSON.parse(fs.readFileSync(metaFile,'utf8')):{};
  var games=Object.values(meta).sort(function(a,b){return b.updated-a.updated});
  res.json({games:games});
});

app.post('/api/save-game',requireAuth,function(req,res){
  var slug=req.body.slug||'',title=req.body.title||'',html=req.body.html||'';
  if(!slug||!html)return res.status(400).json({error:'缺少参数'});
  slug=slug.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,40);
  var dir=path.join(GAMES_DIR,req.userName);
  if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
  var metaFile=path.join(dir,'meta.json');
  var meta=fs.existsSync(metaFile)?JSON.parse(fs.readFileSync(metaFile,'utf8')):{};
  var existing=meta[slug],ver=existing?existing.ver+1:1;
  meta[slug]={title:title||slug,ver:ver,slug:slug,updated:Date.now()};
  fs.writeFileSync(metaFile,JSON.stringify(meta,null,2));
  fs.writeFileSync(path.join(dir,slug+'.html'),html);
  res.json({ok:true,slug:slug,ver:ver});
});

app.get('/api/load-game/:slug',requireAuth,function(req,res){
  var file=path.join(GAMES_DIR,req.userName,req.params.slug+'.html');
  if(!fs.existsSync(file))return res.status(404).json({error:'游戏不存在'});
  res.json({html:fs.readFileSync(file,'utf8')});
});

app.post('/api/delete-game',requireAuth,function(req,res){
  var slug=req.body.slug;
  if(!slug)return res.status(400).json({error:'缺少slug'});
  var dir=path.join(GAMES_DIR,req.userName);
  var file=path.join(dir,slug+'.html');
  if(fs.existsSync(file))fs.unlinkSync(file);
  var metaFile=path.join(dir,'meta.json');
  if(fs.existsSync(metaFile)){
    var meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));
    delete meta[slug];
    fs.writeFileSync(metaFile,JSON.stringify(meta,null,2));
  }
  res.json({ok:true});
});

app.post('/api/admin/login',function(req,res){
  if(req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:'密码错误'});
  res.cookie('admin_pass',req.body.password,{maxAge:8*3600*1000,httpOnly:false,sameSite:'lax'});
  res.json({ok:true});
});

app.get('/api/admin/users',requireAdmin,function(req,res){
  var users=readUsers(),result=[];
  Object.keys(users).forEach(function(name){
    var u=users[name];
    var dir=path.join(GAMES_DIR,name);
    var meta=fs.existsSync(path.join(dir,'meta.json'))?JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')):{};
    result.push({username:name,active:u.active,created:u.created,gameCount:Object.keys(meta).length});
  });
  res.json({users:result});
});

app.post('/api/admin/toggle-user',requireAdmin,function(req,res){
  var username=req.body.username;
  var users=readUsers();
  if(!users[username])return res.status(404).json({error:'用户不存在'});
  users[username].active=!users[username].active;
  writeUsers(users);
  res.json({ok:true,active:users[username].active});
});

app.get('/api/stats',requireAdmin,function(req,res){
  var users=readUsers(),totalGames=0;
  Object.keys(users).forEach(function(name){
    var dir=path.join(GAMES_DIR,name);
    var meta=fs.existsSync(path.join(dir,'meta.json'))?JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')):{};
    totalGames+=Object.keys(meta).length;
  });
  res.json({userCount:Object.keys(users).length,gameCount:totalGames,activeUsers:Object.values(users).filter(function(u){return u.active}).length});
});

app.listen(PORT,function(){
  console.log('平台运行: http://localhost:'+PORT+'/platform/');
});
