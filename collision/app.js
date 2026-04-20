// ── Physics constants ───────────────────────────────────────────────
const BALL_MASS=0.1406, BALL_RADIUS=0.02625;
const MU_SLIDING=0.20, MU_ROLLING=0.015, G=9.81;
const INERTIA=2/5*BALL_MASS*BALL_RADIUS**2;
const DT=1/240;

// ── API Server connection ────────────────────────────────────────────
// (See api.js for all backend API communication)

// ── Audio System (See audio.js) ─────────────────────────────────────

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

// Table surface — actual table size (往外拓宽0.03米)
const tableGeo=new THREE.PlaneGeometry(TABLE_WIDTH + 0.06, TABLE_LENGTH + 0.06);
const fabricTexture = makeFabricTexture();
const roughnessMap = makeRoughnessMap();
const tableMat=new THREE.MeshStandardMaterial({
  color: 0x2f6b2f,
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

const CUSHION_HEIGHT=0.05;           // ★ 梯形高度
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

/**
 * 创建梯形库边的2D轮廓
 * @param {boolean} flipInside - 是否翻转内侧方向
 *   false (默认): 左侧斜、右侧垂直
 *   true: 左侧垂直、右侧斜
 */
function createCushionShape(flipInside = false) {
  const shape = new THREE.Shape();
  
  const topW = 0.08;      // 顶部宽度
  const bottomW = 0.05;   // 底部宽度
  const h = CUSHION_HEIGHT;
  const r = 0.008;         // 圆角半径

  if (!flipInside) {
    // ── 标准方向：左侧斜（0,-b/2到-t/2,h），右侧垂直（b/2,0到b/2,h）──
    shape.moveTo(-bottomW/2 + r, 0);
    shape.lineTo(bottomW/2 - r, 0);
    shape.absarc(bottomW/2 - r, r, r, -Math.PI/2, 0, false);
    shape.lineTo(bottomW/2, h);
    shape.lineTo(-topW/2 + r, h);
    shape.absarc(-topW/2 + r, h - r, r, Math.PI/2, Math.PI, false);
    shape.lineTo(-bottomW/2, r);
    shape.absarc(-bottomW/2 + r, r, r, Math.PI, Math.PI * 1.5, false);
  } else {
    // ── 翻转方向：左侧垂直（-b/2,0到-b/2,h），右侧斜（b/2,0到t/2,h）──
    shape.moveTo(-bottomW/2 + r, 0);
    shape.lineTo(bottomW/2 - r, 0);
    // 右下圆角
    shape.absarc(bottomW/2 - r, r, r, -Math.PI/2, 0, false);
    // 右上：(topW/2, h) - 斜边
    shape.lineTo(topW/2 - r, h);
    // 右上圆角
    shape.absarc(topW/2 - r, h - r, r, 0, Math.PI/2, false);
    // 左上：(-bottomW/2, h) - 垂直边
    shape.lineTo(-bottomW/2, h);
    // 左上圆角
    shape.absarc(-bottomW/2 + r, h - r, r, Math.PI/2, Math.PI, false);
    // 左侧：垂直边
    shape.lineTo(-bottomW/2, r);
    // 左下圆角
    shape.absarc(-bottomW/2 + r, r, r, Math.PI, Math.PI * 1.5, false);
  }

  shape.closePath();
  return shape;
}

/**
 * 创建3D梯形库边几何体
 * 将2D形状沿指定方向挤出，形成3D几何体
 * @param {number} length - 挤出长度
 * @param {string} along - 挤出方向: 'x' 或 'z' (默认 'z')
 * @param {boolean} flipInside - 是否翻转内侧方向
 */
function createCushionGeometry(length, along = 'z', flipInside = false) {
  const shape = createCushionShape(flipInside);
  
  const extrudeSettings = {
    depth: length,
    bevelEnabled: false
  };
  
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  
  // 默认是沿 +Z 挤出，如果需要沿 X，则旋转 90°
  if (along === 'x') {
    geo.rotateY(Math.PI / 2);
  }
  
  return geo;
}

const CUSHION_LEN_Y = TABLE_Y_MAX - TABLE_Y_MIN + CUSHION_HEIGHT;
const CUSHION_LEN_X = TABLE_X_MAX - TABLE_X_MIN + CUSHION_HEIGHT;

// ★ 缺口参数：4.344英寸 = 0.1104m
const POCKET_GAP = 0.1104;  // 缺口宽度
const HALF_GAP = POCKET_GAP / 2;  // 缺口半宽

// ★ 上库边（靠近开球线，沿 X 方向拉伸）
const topCushionGeo = createCushionGeometry(CUSHION_LEN_Y, 'x', false);
const topCushion=new THREE.Mesh(topCushionGeo, cushionMat);
topCushion.position.set(-CUSHION_LEN_Y/2, 0, TABLE_X_MIN - 0.035);
topCushion.castShadow=true;
topCushion.receiveShadow=true;
scene.add(topCushion);

// ★ 下库边（开球线对边，沿 X 方向拉伸，内侧方向翻转）
const bottomCushionGeo = createCushionGeometry(CUSHION_LEN_Y, 'x', true);
const bottomCushion=new THREE.Mesh(bottomCushionGeo, cushionMat);
bottomCushion.position.set(-CUSHION_LEN_Y/2, 0, TABLE_X_MAX + 0.035);
bottomCushion.castShadow=true;
bottomCushion.receiveShadow=true;
scene.add(bottomCushion);

// ★ 左库边（沿 Z 方向拉伸）- 分为上下两段
const leftCushionSegmentLen = (CUSHION_LEN_X - POCKET_GAP) / 2;
const leftCushionTopGeo = createCushionGeometry(leftCushionSegmentLen, 'z', true);
const leftCushionTop = new THREE.Mesh(leftCushionTopGeo, cushionMat);
leftCushionTop.position.set(TABLE_Y_MIN - 0.035, 0, -CUSHION_LEN_X/2);  // 从左端开始
leftCushionTop.castShadow=true;
leftCushionTop.receiveShadow=true;
scene.add(leftCushionTop);

const leftCushionBottomGeo = createCushionGeometry(leftCushionSegmentLen, 'z', true);
const leftCushionBottom = new THREE.Mesh(leftCushionBottomGeo, cushionMat);
leftCushionBottom.position.set(TABLE_Y_MIN - 0.035, 0, HALF_GAP);  // 从缺口右侧开始
leftCushionBottom.castShadow=true;
leftCushionBottom.receiveShadow=true;
scene.add(leftCushionBottom);

// ★ 右库边（沿 Z 方向拉伸，内侧方向翻转）- 分为上下两段
const rightCushionTopGeo = createCushionGeometry(leftCushionSegmentLen, 'z', false);
const rightCushionTop = new THREE.Mesh(rightCushionTopGeo, cushionMat);
rightCushionTop.position.set(TABLE_Y_MAX + 0.035, 0, -CUSHION_LEN_X/2);  // 从左端开始
rightCushionTop.castShadow=true;
rightCushionTop.receiveShadow=true;
scene.add(rightCushionTop);

const rightCushionBottomGeo = createCushionGeometry(leftCushionSegmentLen, 'z', false);
const rightCushionBottom = new THREE.Mesh(rightCushionBottomGeo, cushionMat);
rightCushionBottom.position.set(TABLE_Y_MAX + 0.035, 0, HALF_GAP);  // 从缺口右侧开始
rightCushionBottom.castShadow=true;
rightCushionBottom.receiveShadow=true;
scene.add(rightCushionBottom);

// ★ 左右库边中点的口袋圆弧 ─────────────────────────────────────────
const POCKET_EXTENSION = 0.0532;  // 2.094英寸往外延长
const POCKET_ARC_RADIUS = HALF_GAP * 1.1;
const ARC_ANGLE_DEG = 180;  // 改成180度
const ARC_ANGLE_RAD = (ARC_ANGLE_DEG * Math.PI) / 180;

// 左库边中点圆弧（表格坐标XY平面，转换到Three.js）
const leftPocketCenterY = TABLE_Y_MIN - POCKET_EXTENSION;
const leftStartAngle = ARC_ANGLE_RAD / 2;  // 180度的一半是90度

// 右库边中点圆弧（表格坐标XY平面，转换到Three.js）
const rightPocketCenterY = TABLE_Y_MAX + POCKET_EXTENSION;
const rightStartAngle = Math.PI - ARC_ANGLE_RAD / 2;

// ★ 计算口袋边界（直接使用180度圆弧连接表边端点）─────────────────────────
// ★ 创建黑色填充区域（使用三角形网格）
// 左口袋填充
const leftPocketFillPoints = [];
// 添加圆心点
leftPocketFillPoints.push(new THREE.Vector3(leftPocketCenterY, 0.003, 0));
// 添加半圆弧上的所有点
for (let i = 0; i <= 32; i++) {
  const angle = leftStartAngle - (i / 32) * ARC_ANGLE_RAD;
  const table_x = POCKET_ARC_RADIUS * Math.sin(angle);
  const table_y = leftPocketCenterY + POCKET_ARC_RADIUS * Math.cos(angle);
  leftPocketFillPoints.push(new THREE.Vector3(table_y, 0.003, -table_x));
}

const leftPocketFillGeo = new THREE.BufferGeometry();
const leftPocketFillIndices = [];
// 构建三角形扇形（从圆心出发）
for (let i = 0; i < 32; i++) {
  leftPocketFillIndices.push(0, i + 1, i + 2);
}
leftPocketFillGeo.setFromPoints(leftPocketFillPoints);
leftPocketFillGeo.setIndex(leftPocketFillIndices);

const blackMat = new THREE.MeshBasicMaterial({color: 0x000000, side: THREE.DoubleSide});
const leftPocketFill = new THREE.Mesh(leftPocketFillGeo, blackMat);
scene.add(leftPocketFill);

// 右口袋填充
const rightPocketFillPoints = [];
rightPocketFillPoints.push(new THREE.Vector3(rightPocketCenterY, 0.003, 0));
for (let i = 0; i <= 32; i++) {
  const angle = rightStartAngle + (i / 32) * ARC_ANGLE_RAD;
  const table_x = POCKET_ARC_RADIUS * Math.sin(angle);
  const table_y = rightPocketCenterY + POCKET_ARC_RADIUS * Math.cos(angle);
  rightPocketFillPoints.push(new THREE.Vector3(table_y, 0.003, -table_x));
}

const rightPocketFillGeo = new THREE.BufferGeometry();
const rightPocketFillIndices = [];
for (let i = 0; i < 32; i++) {
  rightPocketFillIndices.push(0, i + 1, i + 2);
}
rightPocketFillGeo.setFromPoints(rightPocketFillPoints);
rightPocketFillGeo.setIndex(rightPocketFillIndices);

const rightPocketFill = new THREE.Mesh(rightPocketFillGeo, blackMat);
scene.add(rightPocketFill);

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

tableLight.shadow.mapSize.width = 2048;
tableLight.shadow.mapSize.height = 2048;
tableLight.shadow.camera.left = -3;
tableLight.shadow.camera.right = 3;
tableLight.shadow.camera.top = 3;
tableLight.shadow.camera.bottom = -3;
tableLight.shadow.camera.near = 0.5;
tableLight.shadow.camera.far = 10;
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

// ── Minimap ────────────────────────────────────────────────────────
// (See minimap.js for all minimap rendering and window functions)

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
  // ★ Safari 兼容：在用户交互中初始化音频
  await initAudio();
  
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
let savedFollowCamState=false;  // 保存 Strike Mode 前的 followCam 状态
let isDragging=false, isRightDrag=false, lastMx=0, lastMy=0;
let orbitTheta=0.0, orbitPhi=1.1, orbitR=0.45;
let panX=0, panZ=0;
const ballQuat=new THREE.Quaternion();
const tmpQ=new THREE.Quaternion(), tmpAxis=new THREE.Vector3();

let collisionEvents = [];
let eventIdx = 0;

// 保存这一次击球前的球位置
let preStrikeWhitePos = [0, 0, BALL_RADIUS];
let preStrikeRedPos = [0.3, 0.0, BALL_RADIUS];

// ── History & State Management ─────────────────────────────────────
// (See history.js for all undo/redo and state restoration functions)

let selectedBall = null;
let dragStartMouse = null;
let dragStartBall = null;
const balls = {
  white: { mesh: ballMesh, pos: [0, 0, BALL_RADIUS] },
  red: { mesh: redBallMesh, pos: [0.3, 0.0, BALL_RADIUS] }
};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let strikePointOffset = { x: 0, y: 0 };  // 击打点相对于球心的偏移 (a, b)

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
  // ★ Safari 兼容：在用户交互中初始化音频
  await initAudio();
  
  // 保存当前状态到历史记录（支持撤销/重做）
  saveStateToHistory();
  
  // 保存这一次击球前的球位置（用于后续Reset）
  preStrikeWhitePos = [...balls.white.pos];
  preStrikeRedPos = [...balls.red.pos];
  
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
  document.getElementById('pt').value=theta; document.getElementById('vt').textContent=(typeof theta === 'number' ? theta.toFixed(1) : theta)+'°';
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
  // Strike Mode 开启时，不允许切换相机模式（必须保持 Follow）
  if(strikeMode) return;
  
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

// 击打模式切换
let strikeMode = false;  // 初始值为false，启动时通过toggleStrikeMode()设为true
function toggleStrikeMode(){
  strikeMode = !strikeMode;
  const btn = document.getElementById('strike-mode-btn');
  btn.textContent = strikeMode ? '⚙ Strike ON' : '⚙ Strike Mode';
  btn.className = strikeMode ? 'on' : '';
  if(strikeMode) {
    btn.style.background = 'rgba(150,200,150,0.25)';
    btn.style.borderColor = '#8aaa8a';
    btn.style.color = '#aaffaa';
    // 保存当前 followCam 状态，然后强制启用 Follow 模式
    savedFollowCamState = followCam;
    followCam = true;
    orbitPhi = Math.PI / 3;  // 60度俯视角
    orbitR = 0.35;  // 调整距离
    panX = 0;
    panZ = 0;
    document.getElementById('btn-cam').textContent = 'Follow';
    const camBtn = document.getElementById('btn-cam');
    camBtn.style.borderColor = '#c8a84a';  // 黄色边框，表示被锁定
    camBtn.style.color = '#c8a84a';  // 黄色文字
    // 同步 phi 参数为当前视角在 XY 平面上的方向角（orbitTheta）
    const phiDegrees = (-orbitTheta * 180 / Math.PI + 360) % 360;
    document.getElementById('pp').value = Math.round(phiDegrees * 100) / 100;
    document.getElementById('vp').textContent = Math.round(phiDegrees * 100) / 100 + '°';
    // 显示力度条
    document.getElementById('power-container').style.display = 'block';
    setPower(0.5);  // 初始力度
    // 显示母球示意图
    document.getElementById('white-ball-guide').style.display = 'block';
    drawWhiteBallGuide();  // 绘制球示意图
  } else {
    btn.style.background = 'rgba(100,150,100,0.15)';
    btn.style.borderColor = '#6a8a6a';
    btn.style.color = '#8aaa8a';
    // 恢复之前的 followCam 状态
    followCam = savedFollowCamState;
    const camBtn = document.getElementById('btn-cam');
    camBtn.textContent = followCam ? 'Follow' : 'Free';
    camBtn.className = followCam ? 'on' : '';
    camBtn.style.borderColor = '';  // 恢复默认边框颜色
    camBtn.style.color = '';  // 恢复默认文字颜色
    // 隐藏力度条
    document.getElementById('power-container').style.display = 'none';
    // 隐藏母球示意图
    document.getElementById('white-ball-guide').style.display = 'none';
  }
}

// 设置力度条高度（0-1）
function setPower(value) {
  const bar = document.getElementById('power-bar');
  bar.style.height = (value * 100) + '%';
}

// 绘制母球示意图（8条直径线 + 红色圆心）
function drawWhiteBallGuide() {
  const canvas = document.getElementById('white-ball-canvas');
  const ctx = canvas.getContext('2d');
  const centerX = 30;
  const centerY = 30;
  const radius = 25;
  
  // 清空画布
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 绘制白色圆（球）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // 绘制 8 条直径线（相邻 45 度）
  ctx.strokeStyle = 'rgba(150, 150, 150, 0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45) * Math.PI / 180;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  
  // 计算击打点的 canvas 显示位置
  // strikePointOffset 范围是 ±22mm，canvas 半径是 25px
  // 映射比例：25px / 26.25mm ≈ 0.952
  // 注意：Y 轴反转（b 向上为正）
  const canvasScale = radius / 26.25;
  const strikeX = centerX + strikePointOffset.x * canvasScale;
  const strikeY = centerY - strikePointOffset.y * canvasScale;  // 反转 Y 轴
  
  // 限制击打点在圆形范围内
  const distToCenter = Math.sqrt((strikeX - centerX) ** 2 + (strikeY - centerY) ** 2);
  let displayX = strikeX;
  let displayY = strikeY;
  if (distToCenter > radius) {
    const scale = radius / distToCenter;
    displayX = centerX + (strikeX - centerX) * scale;
    displayY = centerY + (strikeY - centerY) * scale;
  }
  
  // 绘制击打点（红色圆点）
  ctx.fillStyle = eKeyPressed ? '#ff6b6b' : '#ff3b3b';  // E 按下时更亮
  ctx.beginPath();
  ctx.arc(displayX, displayY, 4, 0, Math.PI * 2);
  ctx.fill();
  
  // 如果 E 键按下，显示参考圆（帮助显示击打范围）
  if (eKeyPressed) {
    ctx.strokeStyle = 'rgba(255, 59, 59, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(displayX, displayY, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// 绘制俯仰角（theta）指示器
function drawThetaAngle() {
  const canvas = document.getElementById('theta-angle-canvas');
  if(!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 35;
  
  // 清空画布
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.clearRect(0, 0, width, height);
  
  // 获取当前 theta 值
  const thetaValue = parseFloat(document.getElementById('pt').value) || 0;
  
  // 绘制水平参考线（代表 XY 平面）
  ctx.strokeStyle = 'rgba(100, 150, 100, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - radius - 5, centerY);
  ctx.lineTo(centerX + radius + 5, centerY);
  ctx.stroke();
  
  // 绘制出杆方向（从水平线向上旋转 theta 度）
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 2.5;
  const thetaRad = thetaValue * Math.PI / 180;
  const strikeEndX = centerX + radius * Math.cos(thetaRad);
  const strikeEndY = centerY - radius * Math.sin(thetaRad);  // Y 向上为负
  
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(strikeEndX, strikeEndY);
  ctx.stroke();
  
  // 绘制出杆端点
  ctx.fillStyle = '#ff6b6b';
  ctx.beginPath();
  ctx.arc(strikeEndX, strikeEndY, 2, 0, Math.PI * 2);
  ctx.fill();
  
  // 绘制角度弧线
  ctx.strokeStyle = 'rgba(200, 168, 74, 0.6)';
  ctx.lineWidth = 1;
  const arcRadius = 14;
  ctx.beginPath();
  ctx.arc(centerX, centerY, arcRadius, 0, -thetaRad, thetaValue < 0);
  ctx.stroke();
  
  // 绘制角度文字
  ctx.fillStyle = '#c8a84a';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textAngle = thetaValue * Math.PI / 180 / 2;
  const textX = centerX + (arcRadius + 8) * Math.cos(textAngle);
  const textY = centerY - (arcRadius + 8) * Math.sin(textAngle);
  ctx.fillText(thetaValue.toFixed(1) + '°', textX, textY);
}

// UI Panel & Dialogs
// (See ui.js for all UI panel and dialog functions)

function resetBallPosition(){
  // 恢复到这一次击球前的位置
  balls.white.pos = [...preStrikeWhitePos];
  balls.red.pos = [...preStrikeRedPos];
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

// ★ 保存状态函数
async function saveState(){
  const saveName = await showInputDialog('Enter save name');
  if (!saveName) return;  // 用户取消
  
  const state = {
    // 参数状态
    params: {
      a: parseFloat(document.getElementById('pa').value),
      b: parseFloat(document.getElementById('pb').value),
      phi: parseFloat(document.getElementById('pp').value),
      theta: parseFloat(document.getElementById('pt').value),
      force: parseFloat(document.getElementById('pf').value),
      mu_tip: parseFloat(document.getElementById('pmu').value)
    },
    // 高级物理参数
    advParams: {
      e_restitution: parseFloat(document.getElementById('padv-er').value),
      mu_cushion: parseFloat(document.getElementById('padv-mc').value),
      mu_rolling: parseFloat(document.getElementById('padv-mr').value),
      mu_sliding: parseFloat(document.getElementById('padv-ms').value),
      e_floor: parseFloat(document.getElementById('padv-ef').value)
    },
    // 球位置
    balls: {
      white: balls.white.pos,
      red: balls.red.pos
    },
    // 保存时间
    timestamp: new Date().toISOString()
  };
  
  // 保存到 localStorage
  const allSaves = JSON.parse(localStorage.getItem('snookerSaves') || '{}');
  allSaves[saveName] = state;
  localStorage.setItem('snookerSaves', JSON.stringify(allSaves));
  
  showSuccess(`✓ Saved: ${saveName}`, 2000);
  console.log('✓ State saved:', saveName);
}

// Dialog & Notification Functions
// (See ui.js for all dialog and notification functions)

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
      const nearest = Math.round(v * 10) / 10;
      if(Math.abs(v - nearest) < 0.01) {
        this.value = nearest;
        document.getElementById('vt').textContent = nearest.toFixed(1) + '°';
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

// 从 localStorage 加载历史记录
initHistoryFromLocalStorage();
// 初始化迷你地图
initMinimap();
// 初始化按钮状态
updateHistoryButtons();
// 初始化快捷键监听
initKeyboardListeners();
// 默认启用 Strike Mode
toggleStrikeMode();

const app=document.getElementById('app');
app.addEventListener('mousedown',e=>{
  if(e.target.closest('#ui')) return;
  
  if(!playing && e.button === 0) {
    mouse.x=(e.clientX/window.innerWidth)*2-1;
    mouse.y=-(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObjects([ballMesh, redBallMesh]);
    if(intersects.length > 0 && !vKeyPressed){
      if(intersects[0].object === ballMesh) selectedBall = 'white';
      else if(intersects[0].object === redBallMesh) selectedBall = 'red';
      isDragging = true;
      isRightDrag = false;
      lastMx=e.clientX; 
      lastMy=e.clientY;
      
      // 记录拖拽起始点
      dragStartMouse = { x: e.clientX, y: e.clientY };
      dragStartBall = [...balls[selectedBall].pos];
      
      return;
    }
  }
  
  isDragging=true; 
  isRightDrag = e.button===0 && vKeyPressed;  // V+左键 = pan
  selectedBall = null;
  lastMx=e.clientX; 
  lastMy=e.clientY;
});
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
// (See keyboard.js for detailed key handling)
window.addEventListener('blur', () => {
  isDragging = false;
  dragStartMouse = null;
  dragStartBall = null;
});
window.addEventListener('mouseup',()=>{
  isDragging=false;
  dragStartMouse = null;
  dragStartBall = null;
});
window.addEventListener('mousemove',e=>{
  // 处理 E 键调整击打点（母球示意图）
  if(eKeyPressed && strikeMode) {
    const canvas = document.getElementById('white-ball-canvas');
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    
    // 仅当鼠标在 canvas 范围内时处理
    if(canvasX >= 0 && canvasX <= rect.width && canvasY >= 0 && canvasY <= rect.height) {
      // canvas 中心
      const centerX = 30;
      const centerY = 30;
      const radius = 25;
      
      // 计算鼠标相对于 canvas 中心的位置
      const relX = canvasX - centerX;
      const relY = canvasY - centerY;
      const distToCenter = Math.sqrt(relX * relX + relY * relY);
      
      // 限制在圆形范围内
      let mappedX = relX;
      let mappedY = relY;
      if (distToCenter > radius) {
        const scale = radius / distToCenter;
        mappedX = relX * scale;
        mappedY = relY * scale;
      }
      
      // 转换为 a, b 参数（mm）
      // canvas 范围 ±25px 对应 ±26.25mm
      // 注意：canvas 向下是 +y，但 b（高杆）应该向上，所以需要反转
      const canvasScale = 26.25 / radius;
      let newA = mappedX * canvasScale;
      let newB = -mappedY * canvasScale;  // 反转 Y 轴方向
      
      // 限制在 UI 范围内
      newA = Math.max(-22, Math.min(22, newA));
      newB = Math.max(-22, Math.min(22, newB));
      
      // 更新全局变量
      strikePointOffset.x = newA;
      strikePointOffset.y = newB;
      
      // 更新 UI（保留一位小数）
      const aRounded = Math.round(newA * 10) / 10;
      const bRounded = Math.round(newB * 10) / 10;
      document.getElementById('pa').value = aRounded;
      document.getElementById('va').textContent = aRounded.toFixed(1);
      document.getElementById('pb').value = bRounded;
      document.getElementById('vb').textContent = bRounded.toFixed(1);
      
      // 重新绘制母球示意图
      drawWhiteBallGuide();
      return;
    }
  }
  
  if(!isDragging) return;
  
  // 使用增量方法拖拽球，根据视角变化屏幕坐标映射
  if(selectedBall && dragStartMouse && dragStartBall){
    const dx = e.clientX - dragStartMouse.x;
    const dy = e.clientY - dragStartMouse.y;
    
    const scale = 0.002 * orbitR; // 灵敏度随相机焦距变化
    
    // 根据相机方位角 orbitTheta 计算屏幕坐标到世界坐标的映射
    // 屏幕右(+dx) 对应世界方向 (cosθ, sinθ)
    // 屏幕下(+dy) 对应世界方向 (-sinθ, cosθ)
    // 注意: table坐标中 pos[1]对应world-x, pos[0]对应world-(-z)
    const c = Math.cos(orbitTheta);
    const s = Math.sin(orbitTheta);
    
    // 屏幕坐标变换到世界xz平面，使用摄像机的方向向量
    // 屏幕右(+dx) -> 摄像机右方向 (cos, -sin)
    // 屏幕下(+dy) -> 摄像机前方向 (-sin, -cos)  
    const dx_world = dx * c + dy * s;      // world-x分量
    const dz_world = dx * s - dy * c;     // world-z分量 (修正符号)
    
    // 映射到table坐标
    balls[selectedBall].pos[1] = dragStartBall[1] + scale * dx_world;      // table-y (world-x)
    balls[selectedBall].pos[0] = dragStartBall[0] + scale * dz_world;      // table-x (world-(-z))
    balls[selectedBall].pos[2] = BALL_RADIUS;
    
    checkBallCollisions(selectedBall);
    return;
  }
  
  const dx=e.clientX-lastMx, dy=e.clientY-lastMy;
  
  if(isRightDrag){
    // Strike模式下，禁用右键平移
    if(strikeMode) return;
    
    const moveSpeed = 0.002;
    const rightX = Math.cos(orbitTheta);
    const rightZ = -Math.sin(orbitTheta);
    const forwardX = -Math.sin(orbitTheta);
    const forwardZ = -Math.cos(orbitTheta);
    
    panX += dx * moveSpeed * rightX - dy * moveSpeed * forwardX;
    panZ += dx * moveSpeed * rightZ - dy * moveSpeed * forwardZ;
  } else {
    // 按住 F 键时，降低鼠标灵敏度 4 倍（精准调整）
    let effectiveDx = dx;
    if (fKeyPressed && strikeMode) {
      effectiveDx *= 0.05;  // 灵敏度降低 10 倍
    }
    
    const sens=followCam ? 0.006 : 0.012;
    orbitTheta-=effectiveDx*sens;
    orbitPhi=Math.max(0.05,Math.min(Math.PI/2-0.02,orbitPhi-dy*sens*0.8));
    
    // Strike 模式下，当改变视角（orbitTheta）时，同步 phi 参数为 XY 平面的方向角
    if(strikeMode && Math.abs(dx) > 0) {
      const phiDegrees = (-orbitTheta * 180 / Math.PI + 360) % 360;
      const currentPhi = parseFloat(document.getElementById('pp').value);
      // 精度都改为 0.01°
      const phiSnapped = Math.round(phiDegrees * 100) / 100;
      
      if (Math.abs(phiSnapped - currentPhi) >= 0.01) {
        document.getElementById('pp').value = phiSnapped;
        document.getElementById('vp').textContent = phiSnapped.toFixed(2) + '°';
      }
    }
  }
  lastMx=e.clientX; lastMy=e.clientY;
});
app.addEventListener('wheel',e=>{
  const uiPanel = document.getElementById('ui');
  if (uiPanel) {
    const rect = uiPanel.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && 
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
      return; // 在UI面板内，不改变视角
    }
  }
  
  // 如果 S 键刚刚松开，忽略本次滚轮事件（过滤硬件惯性）
  if (sKeyJustReleased) {
    e.preventDefault();
    return;
  }
  
  // 如果 B 键刚刚松开，忽略本次滚轮事件（过滤硬件惯性）
  if (bKeyJustReleased) {
    e.preventDefault();
    return;
  }
  
  // Strike 模式下，按住 S 键调整力度
  if(strikeMode && sKeyPressed) {
    e.preventDefault();
    const forceInput = document.getElementById('pf');
    let currentForce = parseFloat(forceInput.value);
    
    // 累积 delta
    wheelAccum += e.deltaY;
    
    const STEP_TRIGGER = 145;  // 阈值：一轮滚动触发一次 0.01 的变化
    
    if (wheelAccum >= STEP_TRIGGER) {
      currentForce -= 0.01;
      wheelAccum = 0;  // 清零（保证"一格一步"）
    } else if (wheelAccum <= -STEP_TRIGGER) {
      currentForce += 0.01;
      wheelAccum = 0;
    }
    
    currentForce = Math.max(0.05, Math.min(1.0, currentForce));
    forceInput.value = currentForce;
    document.getElementById('vf').textContent = currentForce.toFixed(2);
    setPower(currentForce);  // 更新力度条
    return;
  }
  
  // Strike 模式下，按住 B 键调整 theta（俯仰角）
  if(strikeMode && bKeyPressed) {
    e.preventDefault();
    const thetaInput = document.getElementById('pt');
    let currentTheta = parseFloat(thetaInput.value);
    
    // 累积 delta
    bWheelAccum += e.deltaY;
    
    const STEP_TRIGGER = 145;  // 阈值：一轮滚动触发一次 0.1° 的变化
    
    if (bWheelAccum >= STEP_TRIGGER) {
      currentTheta -= 0.5;  // 向下滚动：theta 变小（更低的杆点）
      bWheelAccum = 0;
    } else if (bWheelAccum <= -STEP_TRIGGER) {
      currentTheta += 0.5;  // 向上滚动：theta 变大（更高的杆点）
      bWheelAccum = 0;
    }
    
    // 限制在 -85° 到 0° 范围内
    currentTheta = Math.max(-85, Math.min(0, currentTheta));
    thetaInput.value = currentTheta;
    document.getElementById('vt').textContent = currentTheta.toFixed(1) + '°';
    return;
  }
  
  orbitR=Math.max(0.04,Math.min(8,orbitR*Math.pow(1.001,e.deltaY)));
},{passive:false});

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

// ── Minimap Expanded Window ────────────────────────────────────────
// (See minimap.js for expanded minimap window functions)

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
    
    // Strike模式下，相机中心始终锁定于母球，不受panX/panZ影响
    if(strikeMode) {
      camTarget.set(tx+ox, baseHeight+oy, tz+oz);
      lookTarget.set(tx, baseHeight, tz);
    } else {
      camTarget.set(tx+ox+panX, baseHeight+oy, tz+oz+panZ);
      lookTarget.set(tx+panX, baseHeight, tz+panZ);
    }
    
    camPos.lerp(camTarget,0.18);
    // ★ 限制相机最小高度为库边高度的1.5倍
    camPos.y = Math.max(camPos.y, CUSHION_HEIGHT * 1.5);
    camera.position.copy(camPos);
    camera.lookAt(lookTarget);
  } else {
    const cx=Math.sin(orbitPhi)*Math.sin(orbitTheta)*orbitR+panX;
    const cy=Math.cos(orbitPhi)*orbitR;
    const cz=Math.sin(orbitPhi)*Math.cos(orbitTheta)*orbitR+panZ;
    const camPosNew = new THREE.Vector3(cx, Math.max(cy, CUSHION_HEIGHT * 1.5), cz);
    camera.position.lerp(camPosNew, 0.25);
    camera.lookAt(panX,0,panZ);
  }
  
  drawMinimap();
  
  renderer.render(scene, camera);
}

loop();
