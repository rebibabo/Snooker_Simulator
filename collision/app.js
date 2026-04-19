// ── Physics constants ───────────────────────────────────────────────
const BALL_MASS=0.1406, BALL_RADIUS=0.02625;
const MU_SLIDING=0.20, MU_ROLLING=0.015, G=9.81;
const INERTIA=2/5*BALL_MASS*BALL_RADIUS**2;
const DT=1/240;

// ── API Server connection ───────────────────────────────────────────
const API_URL = 'http://localhost:8000/simulate';

// 从 Python API 获取轨迹数据
async function requestSimulation(a, b, phi, theta, force, mu_tip, whiteBallPos=null, redBallPos=null, advParams=null) {
  try {
    const payload = { a, b, phi, theta, force, mu_tip, enable_collision: true };
    if (whiteBallPos) {
      payload.initial_x = whiteBallPos[0];
      payload.initial_y = whiteBallPos[1];
      payload.initial_z = whiteBallPos[2];
    }
    if (redBallPos) {
      payload.red_x = redBallPos[0];
      payload.red_y = redBallPos[1];
      payload.red_z = redBallPos[2];
    }
    if (advParams) {
      payload.e_restitution = advParams.e_restitution;
      payload.mu_cushion = advParams.mu_cushion;
      payload.mu_rolling = advParams.mu_rolling;
      payload.mu_sliding = advParams.mu_sliding;
      payload.e_floor = advParams.e_floor;
    }
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    if (!data.success) throw new Error(data.error || 'Simulation failed');
    
    // 转换 API 返回的帧数据格式，同时保存完整数据
    const frames = data.frames.map(f => ({
      pos: f.pos,
      v: f.v,
      omega: f.omega,
      state: f.state,
      t: f.t,
      balls: f.balls || {}  // 包含多球数据（如果有的话）
    }));
    
    // 将完整数据附加到 frames 对象上
    frames._data = data;
    return frames;
    
  } catch (error) {
    console.error('❌ Simulation error:', error.message);
    alert(`Simulation failed: ${error.message}\n\nMake sure to run: python simulator_server.py`);
    return [];
  }
}

// ── Audio System for Collision Sounds ──────────────────────────────
let audioCtx = null;
let collisionBuffer = null;
let strikeBuffer = null;

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    console.log('✓ Audio context initialized');
    preloadAudioFiles();  // 初始化时预加载音频
  } catch(e) {
    console.warn('Web Audio not supported');
  }
}

// 用户第一次点击时激活 audio context（浏览器自动播放策略）
window.addEventListener('click', initAudio, { once: true });

// 预加载音频文件
async function preloadAudioFiles() {
  if (!audioCtx) return;
  
  try {
    // 加载球碰撞声
    const collisionResponse = await fetch('http://localhost:8000/assets/collision.wav');
    if (!collisionResponse.ok) {
      throw new Error(`HTTP ${collisionResponse.status}: ${collisionResponse.statusText}`);
    }
    const collisionArrayBuffer = await collisionResponse.arrayBuffer();
    collisionBuffer = await audioCtx.decodeAudioData(collisionArrayBuffer);
    console.log('✓ Loaded collision.wav');
  } catch(e) {
    console.warn('Failed to load collision.wav:', e);
  }
  
  try {
    // 加载开球声
    const strikeResponse = await fetch('http://localhost:8000/assets/strike.wav');
    if (!strikeResponse.ok) {
      throw new Error(`HTTP ${strikeResponse.status}: ${strikeResponse.statusText}`);
    }
    const strikeArrayBuffer = await strikeResponse.arrayBuffer();
    strikeBuffer = await audioCtx.decodeAudioData(strikeArrayBuffer);
    console.log('✓ Loaded strike.wav');
  } catch(e) {
    console.warn('Failed to load strike.wav:', e);
  }
}

/**
 * 播放球碰撞声
 * 使用真实录音，音量根据碰撞速度调整
 */
function playBallHit(relVel) {
  if (!audioCtx || !collisionBuffer) return;
  
  // 根据速度计算音量（0-1范围）
  const intensity = Math.min(1.0, relVel / 3.0);
  if (intensity < 0.05) return;  // 太小的碰撞不播放
  
  const source = audioCtx.createBufferSource();
  source.buffer = collisionBuffer;
  
  const gain = audioCtx.createGain();
  gain.gain.value = intensity * 0.8;  // 缩放音量
  
  source.connect(gain).connect(audioCtx.destination);
  source.start(0);
}

/**
 * 播放开球声
 */
function playStrike() {
  if (!audioCtx || !strikeBuffer) return;
  
  const source = audioCtx.createBufferSource();
  source.buffer = strikeBuffer;
  
  const gain = audioCtx.createGain();
  gain.gain.value = 1.0;
  
  source.connect(gain).connect(audioCtx.destination);
  source.start(0);
}

/**
 * 真实斯诺克库边碰撞声
 * 低沉的 bass 鼓点风格 - 音调固定，只有音量随速度变化
 */
function playCushionHit(relVel) {
  if (!audioCtx) return;
  
  // 更严格的阈值：速度小于 0.3 m/s 基本听不到声音
  if (relVel < 0.3) return;
  
  const now = audioCtx.currentTime;
  const duration = 0.18;  // 180ms，更长的衰减
  
  // ★ 更敏感的缩放：二次方映射，小速度时音量非常小
  const baseIntensity = Math.max(0, (relVel - 0.3) / 2.0);  // 0-1 范围，0.3 是死区
  const intensity = baseIntensity * baseIntensity;  // 二次方，增加敏感度
  
  const now2 = audioCtx.currentTime;
  const duration2 = 0.18;
  
  // ── 超低频基音：固定 20Hz (极端 sub-bass) ──
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 20;  // 降至 20Hz，像低沉的打击乐
  
  // ── 次低音：固定 35Hz，强化轰鸣感 ──
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 35;  // 降至 35Hz
  
  // ── 混音器 ──
  const mixer = audioCtx.createGain();
  
  // 基音增益包络（快速起音，缓慢衰减）
  const gain1 = audioCtx.createGain();
  const peak1 = 0.55 * intensity;  // 音量随 intensity² 变化，敏感度更高
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(peak1, now + 0.002);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + duration);
  
  // 次低音增益包络（略微延迟，更强的低频）
  const gain2 = audioCtx.createGain();
  const peak2 = 0.70 * intensity;  // 音量随 intensity² 变化
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(peak2, now + 0.003);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.9);
  
  osc1.connect(gain1).connect(mixer);
  osc2.connect(gain2).connect(mixer);
  
  // ── 粉红噪声：只保留20ms的短促噪声 ──
  const noiseDuration = 0.02;
  const noiseBuffer = audioCtx.createBuffer(1, 
    audioCtx.sampleRate * noiseDuration, 
    audioCtx.sampleRate
  );
  const noiseData = noiseBuffer.getChannelData(0);
  
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < noiseData.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    noiseData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  
  // ── 极强低通滤波：只保留低频 ──
  const lowpass1 = audioCtx.createBiquadFilter();
  lowpass1.type = 'lowpass';
  lowpass1.frequency.value = 250;  // 去除中频
  lowpass1.Q.value = 1.0;
  
  // ── 第二层低通：进一步强化bass ──
  const lowpass2 = audioCtx.createBiquadFilter();
  lowpass2.type = 'lowpass';
  lowpass2.frequency.value = 150;  // 只保留极低频
  lowpass2.Q.value = 0.6;
  
  // 噪声增益包络（短促）
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.18 * intensity, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);
  
  // ── 主增益 ──
  const mainGain = audioCtx.createGain();
  mainGain.gain.value = 1.0;
  
  // ── 连接链 ──
  mixer.connect(lowpass2);
  noise.connect(noiseGain).connect(lowpass1).connect(lowpass2);
  lowpass2.connect(mainGain).connect(audioCtx.destination);
  
  // ── 启动 ──
  osc1.start(now);
  osc2.start(now);
  noise.start(now);
  osc1.stop(now + duration);
  osc2.stop(now + duration);
  noise.stop(now + noiseDuration);
}

// ── Three.js scene ──────────────────────────────────────────────────
const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x060806);

// ── PBR 环境贴图 ──────────────────────────────────────────────────
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0x0a1810);  // 很深的绿色，几乎黑色
const envTexture = pmremGenerator.fromScene(envScene).texture;
scene.environment = envTexture;  // PBR材质用于环境反射

// ── 程序生成台布纹理 ──────────────────────────────────────────────
function makeFabricTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  
  // 简单的Perlin-like噪声
  for (let i = 0; i < data.length; i += 4) {
    const noise = Math.random() * 35;
    data[i]     = Math.floor(26 + noise);    // R
    data[i + 1] = Math.floor(122 + noise);   // G
    data[i + 2] = Math.floor(58 + noise);    // B
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 10);
  return tex;
}

// ── 创建 Roughness Map（打破塑料感，更接近布料） ──
function makeRoughnessMap(size = 256) {
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(size, size);

  for (let i = 0; i < rimg.data.length; i += 4) {
    const v = 200 + Math.random() * 30;
    rimg.data[i] = rimg.data[i+1] = rimg.data[i+2] = v;
    rimg.data[i+3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);

  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(40, 80);
  return roughTex;
}

const camera=new THREE.PerspectiveCamera(55,1,0.001,300);
camera.position.set(0,0.25,0.5);
camera.lookAt(0,0,0);

// ── Table dimensions ───────────────────────────────────────────────
const TABLE_X_MAX=1.7845, TABLE_X_MIN=-1.7845;
const TABLE_Y_MAX=0.889, TABLE_Y_MIN=-0.889;
const TABLE_WIDTH=TABLE_Y_MAX-TABLE_Y_MIN;   // 1.778m
const TABLE_LENGTH=TABLE_X_MAX-TABLE_X_MIN;  // 3.569m

// Table surface — actual table size
const tableGeo=new THREE.PlaneGeometry(TABLE_WIDTH, TABLE_LENGTH);
const fabricTexture = makeFabricTexture();
const roughnessMap = makeRoughnessMap();
const tableMat=new THREE.MeshStandardMaterial({
  color: 0x1a7a3a,
  map: fabricTexture,
  roughnessMap: roughnessMap,
  roughness: 1.0,  // 哑光感（高粗糙度）
  metalness: 0.0,
  bumpMap: fabricTexture,  // 轻微凹凸感
  bumpScale: 0.0015,  // 极小的凹凸强度
  envMap: envTexture,
  envMapIntensity: 0.08  // 大大降低环境反射
});
const tableMesh=new THREE.Mesh(tableGeo,tableMat);
tableMesh.rotation.x=-Math.PI/2;
tableMesh.receiveShadow=true;
scene.add(tableMesh);

// ── Cushions (库边) ─────────────────────────────────────────────────
// 为库边单独创建纹理
const cushionFabric = makeFabricTexture();
cushionFabric.repeat.set(1, 2);

const cushionRough = makeRoughnessMap();
cushionRough.repeat.set(1, 20);

const CUSHION_WIDTH=BALL_RADIUS*2;
const CUSHION_HEIGHT=0.05;
const CUSHION_COLOR=0x1b4d0e;

const cushionMat=new THREE.MeshStandardMaterial({
  color: 0x1e5f2c,
  map: cushionFabric,
  roughnessMap: cushionRough,
  roughness: 0.92,
  metalness: 0.0,
  bumpMap: cushionFabric,
  bumpScale: 0.0035,
  envMap: envTexture,
  envMapIntensity: 0.05
});

const CUSHION_LEN_Y = TABLE_Y_MAX - TABLE_Y_MIN + CUSHION_WIDTH*2;
const CUSHION_LEN_X = TABLE_X_MAX - TABLE_X_MIN + CUSHION_WIDTH*2;

const topCushion=new THREE.Mesh(
  new THREE.BoxGeometry(CUSHION_LEN_Y, CUSHION_HEIGHT, CUSHION_WIDTH),
  cushionMat
);
topCushion.position.set(0, CUSHION_HEIGHT/2, -TABLE_X_MAX - CUSHION_WIDTH/2);
topCushion.castShadow=true;
topCushion.receiveShadow=true;
scene.add(topCushion);

const bottomCushion=new THREE.Mesh(
  new THREE.BoxGeometry(CUSHION_LEN_Y, CUSHION_HEIGHT, CUSHION_WIDTH),
  cushionMat
);
bottomCushion.position.set(0, CUSHION_HEIGHT/2, TABLE_X_MAX + CUSHION_WIDTH/2);
bottomCushion.castShadow=true;
bottomCushion.receiveShadow=true;
scene.add(bottomCushion);

const rightCushion=new THREE.Mesh(
  new THREE.BoxGeometry(CUSHION_WIDTH, CUSHION_HEIGHT, CUSHION_LEN_X),
  cushionMat
);
rightCushion.position.set(TABLE_Y_MAX + CUSHION_WIDTH/2, CUSHION_HEIGHT/2, 0);
rightCushion.castShadow=true;
rightCushion.receiveShadow=true;
scene.add(rightCushion);

const leftCushion=new THREE.Mesh(
  new THREE.BoxGeometry(CUSHION_WIDTH, CUSHION_HEIGHT, CUSHION_LEN_X),
  cushionMat
);
leftCushion.position.set(-TABLE_Y_MAX - CUSHION_WIDTH/2, CUSHION_HEIGHT/2, 0);
leftCushion.castShadow=true;
leftCushion.receiveShadow=true;
scene.add(leftCushion);

// ── Snooker opening area (D area) ──────────────────────────────────
const D_DISTANCE = 0.7366;
const D_LINE_Z = TABLE_X_MIN + D_DISTANCE;
const D_RADIUS = 0.2921;

const dLineGeo = new THREE.BufferGeometry();
const dLinePts = [
  new THREE.Vector3(TABLE_Y_MIN, 0.002, D_LINE_Z),
  new THREE.Vector3(TABLE_Y_MAX, 0.002, D_LINE_Z)
];
dLineGeo.setFromPoints(dLinePts);
const dLineMat = new THREE.LineBasicMaterial({color: 0xffffff, linewidth: 2});
scene.add(new THREE.Line(dLineGeo, dLineMat));

const semicirclePoints = [];
for (let i = 0; i <= 32; i++) {
  const angle = (i / 32) * Math.PI;
  const x = D_RADIUS * Math.cos(angle);
  const z = D_LINE_Z - D_RADIUS * Math.sin(angle);
  semicirclePoints.push(new THREE.Vector3(x, 0.002, z));
}
const dSemicircleGeo = new THREE.BufferGeometry();
dSemicircleGeo.setFromPoints(semicirclePoints);
const dSemicircleMat = new THREE.LineBasicMaterial({color: 0xffffff});
scene.add(new THREE.Line(dSemicircleGeo, dSemicircleMat));

// Ball
const ballGeo=new THREE.SphereGeometry(BALL_RADIUS,48,48);
const ballMat=new THREE.MeshPhysicalMaterial({
  color: 0xf0ead8,
  roughness: 0.32,
  metalness: 0.0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.2,
  reflectivity: 0.15,
  envMap: envTexture,
  envMapIntensity: 0.15
});
const ballMesh=new THREE.Mesh(ballGeo,ballMat);
ballMesh.castShadow=true;
scene.add(ballMesh);

const dotMat=new THREE.MeshPhysicalMaterial({
  color: 0xee1111,
  roughness: 0.4,
  metalness: 0.0,
  clearcoat: 0.2,
  envMap: envTexture,
  envMapIntensity: 0.1
});
const dotGeo=new THREE.CircleGeometry(BALL_RADIUS*0.08,16);
const markerDirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[0.707,0.707,0],[-0.707,0.707,0]];
markerDirs.forEach(d=>{
  const dot=new THREE.Mesh(dotGeo,dotMat);
  const n=Math.sqrt(d[0]**2+d[1]**2+d[2]**2);
  const pos=[d[0]/n*BALL_RADIUS,d[1]/n*BALL_RADIUS,d[2]/n*BALL_RADIUS];
  dot.position.set(pos[0],pos[1],pos[2]);
  dot.lookAt(pos[0]*2,pos[1]*2,pos[2]*2);
  ballMesh.add(dot);
});

// Target red ball
const redBallMat=new THREE.MeshPhysicalMaterial({
  color: 0xb80000,
  roughness: 0.28,
  metalness: 0.0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.2,
  reflectivity: 0.15,
  envMap: envTexture,
  envMapIntensity: 0.15
});
const redBallMesh=new THREE.Mesh(ballGeo, redBallMat);
redBallMesh.castShadow=true;
redBallMesh.receiveShadow=true;
redBallMesh.position.set(0, BALL_RADIUS, 0.3);
scene.add(redBallMesh);

// ── Lights ─────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const hemi = new THREE.HemisphereLight(0xffffff, 0x224422, 0.5);
scene.add(hemi);

const tableLight = new THREE.DirectionalLight(0xffffff, 1.2);
tableLight.position.set(0, 3, 0);
tableLight.castShadow = true;

tableLight.shadow.mapSize.width = 512;
tableLight.shadow.mapSize.height = 512;
tableLight.shadow.camera.left = -3;
tableLight.shadow.camera.right = 3;
tableLight.shadow.camera.top = 3;
tableLight.shadow.camera.bottom = -3;
tableLight.shadow.camera.near = 0.5;
tableLight.shadow.camera.far = 20;
tableLight.shadow.radius = 8;
tableLight.shadow.bias = -0.000001;

scene.add(tableLight);

// Trail
let trailLine=null, trailLines=[], showTrail=true;

// ── Helper functions ────────────────────────────────────────────────
function readStrikeParams() {
  return {
    a: parseFloat(document.getElementById('pa').value),
    b: parseFloat(document.getElementById('pb').value),
    phi: parseFloat(document.getElementById('pp').value),
    theta: parseFloat(document.getElementById('pt').value),
    force: parseFloat(document.getElementById('pf').value),
    mu_tip: parseFloat(document.getElementById('pmu').value)
  };
}

function readAdvancedParams() {
  return {
    e_restitution: parseFloat(document.getElementById('padv-er').value),
    mu_cushion: parseFloat(document.getElementById('padv-mc').value),
    mu_rolling: parseFloat(document.getElementById('padv-mr').value),
    mu_sliding: parseFloat(document.getElementById('padv-ms').value),
    e_floor: parseFloat(document.getElementById('padv-ef').value)
  };
}

function tableToThree(pos) {
  return { x: pos[1], y: pos[2], z: -pos[0] };
}

// ── Minimap 2D ─────────────────────────────────────────────────────
const minimapCanvas=document.getElementById('minimap-canvas');
const minimapCtx=minimapCanvas.getContext('2d');
let minimapTrajectory=[];

const dpr=window.devicePixelRatio||1;
minimapCanvas.width=200*dpr;
minimapCanvas.height=280*dpr;
minimapCtx.scale(dpr, dpr);

const MINIMAP_W=200, MINIMAP_H=280;
const MAP_PADDING=20, MAP_INNER_W=MINIMAP_W-MAP_PADDING*2, MAP_INNER_H=MINIMAP_H-MAP_PADDING*2;

function drawMinimap(){
  minimapCtx.fillStyle='rgba(8,10,8,0.95)';
  minimapCtx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
  
  const tableW=TABLE_X_MAX-TABLE_X_MIN;
  const tableH=TABLE_Y_MAX-TABLE_Y_MIN;
  const scaleX=MAP_INNER_H/tableW;
  const scaleY=MAP_INNER_W/tableH;
  
  const mapOriginX=MAP_PADDING+MAP_INNER_W/2;
  const mapOriginY=MAP_PADDING+MAP_INNER_H/2;
  
  minimapCtx.fillStyle='rgba(16, 147, 38, 0.9)';
  minimapCtx.fillRect(MAP_PADDING, MAP_PADDING, MAP_INNER_W, MAP_INNER_H);
  
  minimapCtx.strokeStyle='rgba(200, 200, 200, 0.5)';
  minimapCtx.lineWidth=1.5;
  const dLineX = TABLE_X_MIN + D_DISTANCE;
  const dLineY = mapOriginY + dLineX * scaleX;
  
  minimapCtx.beginPath();
  minimapCtx.moveTo(MAP_PADDING, dLineY);
  minimapCtx.lineTo(MAP_PADDING + MAP_INNER_W, dLineY);
  minimapCtx.stroke();
  
  minimapCtx.strokeStyle='rgba(200, 200, 200, 0.4)';
  minimapCtx.lineWidth=1;
  const dSemiRadius = D_RADIUS * scaleX;
  minimapCtx.beginPath();
  minimapCtx.arc(mapOriginX, dLineY, dSemiRadius, Math.PI, Math.PI * 2, false);
  minimapCtx.stroke();
  
  if(selectedBall !== null || !playing) {
    const whiteMapX = mapOriginX + balls.white.pos[1] * scaleY;
    const whiteMapY = mapOriginY - balls.white.pos[0] * scaleX;
    minimapCtx.fillStyle = 'rgba(255, 250, 245, 1.0)';
    minimapCtx.beginPath();
    minimapCtx.arc(whiteMapX, whiteMapY, 2.5, 0, Math.PI * 2);
    minimapCtx.fill();
    
    const redMapX = mapOriginX + balls.red.pos[1] * scaleY;
    const redMapY = mapOriginY - balls.red.pos[0] * scaleX;
    minimapCtx.fillStyle = 'rgba(220, 20, 20, 1.0)';
    minimapCtx.beginPath();
    minimapCtx.arc(redMapX, redMapY, 2.5, 0, Math.PI * 2);
    minimapCtx.fill();
  } else if(frames.length > 0) {
    const f = frames[Math.min(playIdx, frames.length-1)];
    
    const whiteSimMapX = mapOriginX + f.pos[1] * scaleY;
    const whiteSimMapY = mapOriginY - f.pos[0] * scaleX;
    minimapCtx.fillStyle = 'rgba(255, 250, 245, 1.0)';
    minimapCtx.beginPath();
    minimapCtx.arc(whiteSimMapX, whiteSimMapY, 2.5, 0, Math.PI * 2);
    minimapCtx.fill();
    
    if(f.balls && f.balls.red && f.balls.red.pos) {
      const redSimMapX = mapOriginX + f.balls.red.pos[1] * scaleY;
      const redSimMapY = mapOriginY - f.balls.red.pos[0] * scaleX;
      minimapCtx.fillStyle = 'rgba(220, 20, 20, 1.0)';
      minimapCtx.beginPath();
      minimapCtx.arc(redSimMapX, redSimMapY, 2.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }
  
  if(minimapTrajectory.length>1 && showTrail){
    minimapCtx.save();
    minimapCtx.rect(MAP_PADDING, MAP_PADDING, MAP_INNER_W, MAP_INNER_H);
    minimapCtx.clip();
    
    minimapCtx.strokeStyle='rgba(200,168,74,0.7)';
    minimapCtx.lineWidth=1.5;
    minimapCtx.beginPath();
    minimapCtx.moveTo(mapOriginX+minimapTrajectory[0][1]*scaleY, mapOriginY-minimapTrajectory[0][0]*scaleX);
    for(let i=1;i<minimapTrajectory.length;i++){
      minimapCtx.lineTo(mapOriginX+minimapTrajectory[i][1]*scaleY, mapOriginY-minimapTrajectory[i][0]*scaleX);
    }
    minimapCtx.stroke();
    minimapCtx.restore();
  }
  
  minimapCtx.fillStyle='#5a6a5a';
  minimapCtx.font='9px monospace';
  minimapCtx.textAlign='center';
  minimapCtx.fillText('TOP VIEW', MINIMAP_W/2, MAP_PADDING-5);
}

function updateMinimapTrajectory(){
  minimapTrajectory=frames.map(f=>[f.pos[0], f.pos[1]]);
}

function rebuildTrail(frames){
  if(trailLine){
    scene.remove(trailLine);
    trailLine.geometry.dispose();
    trailLine.material.dispose();
    trailLine=null;
  }
  if(!showTrail||frames.length<2) return;
  
  const pts=frames.map(f=>new THREE.Vector3(f.pos[1], f.pos[2], -f.pos[0]));
  const curve=new THREE.CatmullRomCurve3(pts);
  const tubeGeo=new THREE.TubeGeometry(curve, pts.length, 0.002, 4, false);
  const tubeMat=new THREE.MeshPhongMaterial({color:0xffff00, transparent:true, opacity:0.9});
  trailLine=new THREE.Mesh(tubeGeo, tubeMat);
  scene.add(trailLine);
}

function clearMultiTrails(){
  trailLines.forEach(line => {
    scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  });
  trailLines=[];
}

function addTrailLine(frames, color, opacity=0.6){
  if(frames.length<2) return;
  const pts=frames.map(f=>new THREE.Vector3(f.pos[1], f.pos[2], -f.pos[0]));
  const curve=new THREE.CatmullRomCurve3(pts);
  const tubeGeo=new THREE.TubeGeometry(curve, pts.length, 0.002, 4, false);
  const tubeMat=new THREE.MeshPhongMaterial({color, transparent:true, opacity});
  const mesh=new THREE.Mesh(tubeGeo, tubeMat);
  scene.add(mesh);
  trailLines.push(mesh);
}

async function multiTrace(){
  const param = document.getElementById('mt-param').value;
  const from = parseFloat(document.getElementById('mt-from').value);
  const to = parseFloat(document.getElementById('mt-to').value);
  const step = parseFloat(document.getElementById('mt-step').value);
  
  clearMultiTrails();
  if(trailLine){scene.remove(trailLine);trailLine=null;}
  
  const values=[];
  for(let v=from; v<=to+step*0.01; v+=step) values.push(parseFloat(v.toFixed(6)));
  
  document.getElementById('mt-btn').textContent='🔄 Computing...';
  document.getElementById('mt-btn').disabled=true;
  
  let count=0;
  for(const val of values){
    const params = readStrikeParams();
    const advParams = readAdvancedParams();
    
    if(param==='force') params.force=val;
    else if(param==='a') params.a=val;
    else if(param==='b') params.b=val;
    else if(param==='phi') params.phi=val;
    else if(param==='theta') params.theta=val;
    
    const trace=await requestSimulation(params.a,params.b,params.phi,params.theta,params.force,params.mu_tip, 
      balls.white.pos,
      balls.red.pos,
      advParams);
    if(trace.length>0){
      const hue=(count/(values.length-1 || 1))*0.7;
      const color=new THREE.Color().setHSL(hue, 0.8, 0.35);
      addTrailLine(trace, color.getHex(), 0.8);
      count++;
    }
  }
  
  document.getElementById('mt-btn').textContent='Multi-Trace';
  document.getElementById('mt-btn').disabled=false;
}

// State
let frames=[], playIdx=0, playing=false, followCam=false;
let isDragging=false, isRightDrag=false, lastMx=0, lastMy=0;
let orbitTheta=0.0, orbitPhi=1.1, orbitR=0.45;
let panX=0, panZ=0;
const ballQuat=new THREE.Quaternion();
const tmpQ=new THREE.Quaternion(), tmpAxis=new THREE.Vector3();

let collisionEvents = [];
let eventIdx = 0;

let selectedBall = null;
const balls = {
  white: { mesh: ballMesh, pos: [0, 0, BALL_RADIUS] },
  red: { mesh: redBallMesh, pos: [0.3, 0.0, BALL_RADIUS] }
};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function checkBallCollisions(ballName) {
  const MIN_DIST = BALL_RADIUS * 2;
  const CUSHION_MARGIN = BALL_RADIUS;
  
  const ballPos = balls[ballName].pos;
  const otherBallName = ballName === 'white' ? 'red' : 'white';
  const otherBallPos = balls[otherBallName].pos;
  
  for(let iter = 0; iter < 5; iter++) {
    ballPos[0] = Math.max(TABLE_X_MIN + CUSHION_MARGIN, Math.min(TABLE_X_MAX - CUSHION_MARGIN, ballPos[0]));
    ballPos[1] = Math.max(TABLE_Y_MIN + CUSHION_MARGIN, Math.min(TABLE_Y_MAX - CUSHION_MARGIN, ballPos[1]));
    
    const dx = ballPos[0] - otherBallPos[0];
    const dy = ballPos[1] - otherBallPos[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if(dist < MIN_DIST) {
      if(dist < 0.0001) {
        ballPos[0] += MIN_DIST * 0.525;
      } else {
        const pushDist = (MIN_DIST - dist) * 0.525;
        const angle = Math.atan2(dy, dx);
        ballPos[0] += Math.cos(angle) * pushDist;
        ballPos[1] += Math.sin(angle) * pushDist;
      }
    } else {
      if(iter > 0) break;
    }
  }
}

async function simulate(){
  clearMultiTrails();
  
  const params = readStrikeParams();
  const advParams = readAdvancedParams();
  
  document.getElementById('sim-btn').textContent='⏳ Computing...';
  document.getElementById('sim-btn').disabled=true;
  
  frames = await requestSimulation(
    params.a, params.b, params.phi, params.theta, params.force, params.mu_tip,
    balls.white.pos,
    balls.red.pos,
    advParams
  );
  
  document.getElementById('sim-btn').textContent='▶ Simulate';
  document.getElementById('sim-btn').disabled=false;
  
  if (frames._data && frames._data.initial_state && frames._data.initial_state.miscue) {
    showWarning('⚠️ MISCUE!', 2000);
  }
  
  if (frames._data && frames._data.computation_time_ms !== undefined) {
    console.log(`⏱️ Computation time: ${frames._data.computation_time_ms}ms`);
  }
  
  if (frames.length > 0) {
    rebuildTrail(frames);
    updateMinimapTrajectory();
    ballQuat.identity();
    ballMesh.quaternion.copy(ballQuat);
    playIdx=0; 
    playing=true;
    document.getElementById('btn-play').textContent='Pause';
    selectedBall = null;
    
    if (params.force > 0) {
      playStrike();
    }
    
    if (frames._data && frames._data.events) {
      collisionEvents = frames._data.events.filter(e => 
        e.type === 'ball_collision' ||
        e.type === 'cushion_hit'
      );
      eventIdx = 0;
      console.log(`📊 Loaded ${collisionEvents.length} collision events`);
    }
  }
}

function applyPreset(a,b,phi,theta,force){
  document.getElementById('pa').value=a; document.getElementById('va').textContent=a;
  document.getElementById('pb').value=b; document.getElementById('vb').textContent=b;
  document.getElementById('pp').value=phi; document.getElementById('vp').textContent=phi+'°';
  document.getElementById('pt').value=theta; document.getElementById('vt').textContent=theta+'°';
  document.getElementById('pf').value=force; document.getElementById('vf').textContent=force.toFixed(2);
  simulate();
}

function toggleTrail(){
  showTrail=!showTrail;
  document.getElementById('btn-trail').textContent=showTrail?'Trail on':'Trail off';
  document.getElementById('btn-trail').className=showTrail?'on':'';
  rebuildTrail(frames);
  trailLines.forEach(line => line.visible = showTrail);
}

function toggleCam(){
  followCam=!followCam;
  document.getElementById('btn-cam').textContent=followCam?'Follow':'Free';
  document.getElementById('btn-cam').className=followCam?'on':'';
}

function togglePlay(){
  if(frames.length === 0) return;
  
  if(!playing && playIdx >= frames.length-1){
    playIdx = 0;
    ballQuat.identity();
  }
  
  playing=!playing;
  document.getElementById('btn-play').textContent=playing?'Pause':'Play';
}

function resetBallPosition(){
  balls.white.pos = [0, 0, BALL_RADIUS];
  balls.red.pos = [0.3, 0.0, BALL_RADIUS];
  frames = [];
  playIdx = 0;
  playing = false;
  if(trailLine){scene.remove(trailLine);trailLine=null;}
  clearMultiTrails();
  document.getElementById('btn-play').textContent='Play';
  ballQuat.identity();
  ballMesh.quaternion.copy(ballQuat);
  selectedBall = null;
  
  collisionEvents = [];
  eventIdx = 0;
  
  const tx=balls.white.pos[1], ty=balls.white.pos[2], tz=-balls.white.pos[0];
  ballMesh.position.set(tx, ty, tz);
  
  const redX=balls.red.pos[1], redY=balls.red.pos[2], redZ=-balls.red.pos[0];
  redBallMesh.position.set(redX, redY, redZ);
}

function toggleAdvPhysics(){
  const content = document.getElementById('adv-physics-content');
  const arrow = document.querySelector('.collapse-arrow');
  content.classList.toggle('collapsed');
  arrow.classList.toggle('collapsed');
}

function showWarning(msg, duration=2000) {
  const warningEl = document.getElementById('warning');
  warningEl.textContent = msg;
  warningEl.style.opacity = '1';
  setTimeout(() => {
    warningEl.style.opacity = '0';
  }, duration);
}

[['pa','va',''],['pb','vb',''],['pp','vp','°'],['pt','vt','°'],['pf','vf','f'],['pmu','vmu','f']].forEach(([id,vid,unit])=>{
  document.getElementById(id).addEventListener('input',function(){
    let v=parseFloat(this.value);
    
    if(id==='pt' && Math.abs(v) < 0.5) {
      v = 0;
      this.value = 0;
    }
    
    const el=document.getElementById(vid);
    if(unit==='f') el.textContent=v.toFixed(2);
    else if(unit==='°') el.textContent=v+'°';
    else el.textContent=v;
  });
  
  if(id==='pt') {
    document.getElementById(id).addEventListener('change',function(){
      let v=parseFloat(this.value);
      const nearest = Math.round(v);
      if(Math.abs(v - nearest) < 0.01) {
        this.value = nearest;
        document.getElementById('vt').textContent = nearest + '°';
      }
    });
  }
});

[['padv-er','vadv-er',3],['padv-mc','vadv-mc',2],['padv-mr','vadv-mr',3],['padv-ms','vadv-ms',2],['padv-ef','vadv-ef',2]].forEach(([id,vid,decimals])=>{
  document.getElementById(id).addEventListener('input',function(){
    const v=parseFloat(this.value);
    document.getElementById(vid).textContent=v.toFixed(decimals);
  });
});

const app=document.getElementById('app');
app.addEventListener('mousedown',e=>{
  if(e.target.closest('#ui')) return;
  
  if(!playing) {
    mouse.x=(e.clientX/window.innerWidth)*2-1;
    mouse.y=-(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObjects([ballMesh, redBallMesh]);
    if(intersects.length > 0){
      if(intersects[0].object === ballMesh) selectedBall = 'white';
      else if(intersects[0].object === redBallMesh) selectedBall = 'red';
      isDragging = true;
      isRightDrag = false;
      lastMx=e.clientX; 
      lastMy=e.clientY;
      return;
    }
  }
  
  isDragging=true; 
  isRightDrag=e.button===2;
  selectedBall = null;
  lastMx=e.clientX; 
  lastMy=e.clientY;
});
app.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mouseup',()=>{isDragging=false;});
window.addEventListener('mousemove',e=>{
  if(!isDragging) return;
  const dx=e.clientX-lastMx, dy=e.clientY-lastMy;
  
  if(selectedBall){
    mouse.x=(e.clientX/window.innerWidth)*2-1;
    mouse.y=-(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const tableNormal=new THREE.Vector3(0,1,0);
    const tablePlane=new THREE.Plane(tableNormal, 0);
    const intersection=new THREE.Vector3();
    raycaster.ray.intersectPlane(tablePlane, intersection);
    
    balls[selectedBall].pos[0]=-intersection.z;
    balls[selectedBall].pos[1]=intersection.x;
    balls[selectedBall].pos[2]=BALL_RADIUS;
    
    checkBallCollisions(selectedBall);
    return;
  }
  
  if(isRightDrag){
    const moveSpeed = 0.002;
    const rightX = Math.cos(orbitTheta);
    const rightZ = -Math.sin(orbitTheta);
    const forwardX = -Math.sin(orbitTheta);
    const forwardZ = -Math.cos(orbitTheta);
    
    panX += dx * moveSpeed * rightX + dy * moveSpeed * forwardX;
    panZ += dx * moveSpeed * rightZ + dy * moveSpeed * forwardZ;
  } else {
    const sens=followCam ? 0.006 : 0.012;
    orbitTheta-=dx*sens;
    orbitPhi=Math.max(0.05,Math.min(Math.PI/2-0.02,orbitPhi-dy*sens*0.8));
  }
  lastMx=e.clientX; lastMy=e.clientY;
});
app.addEventListener('wheel',e=>{
  orbitR=Math.max(0.04,Math.min(8,orbitR*Math.pow(1.001,e.deltaY)));
},{passive:true});

function resize(){
  const w=window.innerWidth,h=window.innerHeight;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
}
resize(); window.addEventListener('resize',resize);

function updateHUD(f){
  if(!f) return;
  document.getElementById('hx').textContent=f.pos[0].toFixed(3)+'m';
  document.getElementById('hy').textContent=f.pos[1].toFixed(3)+'m';
  const spd=Math.sqrt(f.v[0]**2+f.v[1]**2);
  document.getElementById('hspd').textContent=spd.toFixed(3)+'m/s';
  const om=Math.sqrt(f.omega[0]**2+f.omega[1]**2+f.omega[2]**2);
  document.getElementById('hom').textContent=om.toFixed(1)+' r/s';
  document.getElementById('ht').textContent=f.t.toFixed(3)+'s';
  document.getElementById('hstate').textContent=f.state.toUpperCase();
}

document.querySelectorAll('.info-tooltip').forEach(tooltip => {
  tooltip.addEventListener('mouseenter', () => {
    const rect = tooltip.getBoundingClientRect();
    const left = rect.left + rect.width / 2;
    const top = rect.top - 110;
    tooltip.style.setProperty('--tt-left', `${left}px`);
    tooltip.style.setProperty('--tt-top', `${top}px`);
  });
  tooltip.addEventListener('mouseleave', () => {
    tooltip.style.removeProperty('--tt-left');
    tooltip.style.removeProperty('--tt-top');
  });
});

// ── Render loop ─────────────────────────────────────────────────────
const clock=new THREE.Clock();
const camTarget=new THREE.Vector3();
const camPos=new THREE.Vector3(0,0.25,0.5);
const lookTarget=new THREE.Vector3();

function loop(){
  requestAnimationFrame(loop);
  const dt=clock.getDelta();

  if(playing&&frames.length>0){
    const realDT=Math.min(dt,0.05);
    const stepsPerFrame=Math.max(1,Math.round(realDT/DT));
    for(let s=0;s<stepsPerFrame&&playIdx<frames.length-1;s++){
      const f=frames[playIdx];
      const om=f.omega;
      const omSpd=Math.sqrt(om[0]**2+om[1]**2+om[2]**2);
      if(omSpd>1e-6){
        tmpAxis.set(om[1], om[2], -om[0]).normalize();
        tmpQ.setFromAxisAngle(tmpAxis, omSpd*DT);
        ballQuat.premultiply(tmpQ);
        ballMesh.quaternion.copy(ballQuat);
      }
      playIdx++;
      
      const currentT = frames[playIdx] ? frames[playIdx].t : 0;
      while (eventIdx < collisionEvents.length && 
             collisionEvents[eventIdx].t <= currentT) {
        const ev = collisionEvents[eventIdx];
        
        if (ev.type === 'ball_collision' && ev.rel_velocity !== undefined) {
          playBallHit(ev.rel_velocity);
          console.log(`🎵 Ball hit: vel=${ev.rel_velocity.toFixed(2)} m/s`);
        } else if (ev.type === 'cushion_hit' && ev.rel_velocity !== undefined) {
          playCushionHit(ev.rel_velocity);
          console.log(`🎵 Cushion hit: vel=${ev.rel_velocity.toFixed(2)} m/s`);
        }
        
        eventIdx++;
      }
    }
    if(playIdx>=frames.length-1){
      const lastFrame = frames[frames.length-1];
      balls.white.pos = [...lastFrame.pos];
      if(lastFrame.balls && lastFrame.balls.red) {
        balls.red.pos = [...lastFrame.balls.red.pos];
      }
      playing=false;
      document.getElementById('btn-play').textContent='Play';
    }
  }

  const fi=Math.min(playIdx, frames.length-1);
  
  const whitePosTable = (playing && frames.length>0) ? frames[fi].pos : balls.white.pos;
  const whitePos = tableToThree(whitePosTable);
  ballMesh.position.set(whitePos.x, whitePos.y, whitePos.z);
  
  if(playing && frames.length>0) updateHUD(frames[fi]);
  
  let redPosTable;
  if(playing && frames.length>0 && frames[fi].balls && frames[fi].balls.red) {
    redPosTable = frames[fi].balls.red.pos;
  } else {
    redPosTable = balls.red.pos;
  }
  const redPos = tableToThree(redPosTable);
  redBallMesh.position.set(redPos.x, redPos.y, redPos.z);
  
  if(followCam){
    const posDat = frames.length>0 ? frames[fi].pos : balls.white.pos;
    const tPos = tableToThree(posDat);
    const tx = tPos.x, ty = tPos.y, tz = tPos.z;
    const ox=Math.sin(orbitPhi)*Math.sin(orbitTheta)*orbitR;
    const oy=Math.cos(orbitPhi)*orbitR+0.01;
    const oz=Math.sin(orbitPhi)*Math.cos(orbitTheta)*orbitR;
    const baseHeight=0.0;
    camTarget.set(tx+ox+panX, baseHeight+oy, tz+oz+panZ);
    lookTarget.set(tx+panX, baseHeight, tz+panZ);
    camPos.lerp(camTarget,0.18);
    camera.position.copy(camPos);
    camera.lookAt(lookTarget);
  } else {
    const cx=Math.sin(orbitPhi)*Math.sin(orbitTheta)*orbitR+panX;
    const cy=Math.cos(orbitPhi)*orbitR;
    const cz=Math.sin(orbitPhi)*Math.cos(orbitTheta)*orbitR+panZ;
    camera.position.lerp(new THREE.Vector3(cx,cy,cz),0.25);
    camera.lookAt(panX,0,panZ);
  }
  
  drawMinimap();
  
  renderer.render(scene, camera);
}

loop();
