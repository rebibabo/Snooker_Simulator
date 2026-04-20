/**
 * Audio System for Snooker Collision Sounds
 * ==========================================
 * 负责音频加载、初始化和播放
 */

let audioCtx = null;
let collisionBuffer = null;
let strikeBuffer = null;

/**
 * 初始化音频系统（Safari 兼容）
 */
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // ★ Safari 关键：强制解锁 AudioContext
  if (audioCtx.state !== 'running') {
    await audioCtx.resume();
  }

  // ★ 确保音频文件加载完成
  if (!collisionBuffer || !strikeBuffer) {
    await preloadAudioFiles();
  }

  console.log('✅ Audio ready (Safari compatible)');
}

/**
 * 预加载音频文件
 */
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
  
  audioCtx.resume().then(() => {
    // 根据速度计算音量（0-1范围）
    const intensity = Math.min(1.0, relVel / 3.0);
    if (intensity < 0.05) return;  // 太小的碰撞不播放
    
    const source = audioCtx.createBufferSource();
    source.buffer = collisionBuffer;
    
    const gain = audioCtx.createGain();
    gain.gain.value = intensity * 0.8;  // 缩放音量
    
    source.connect(gain).connect(audioCtx.destination);
    source.start(0);
  });
}

/**
 * 播放开球声
 */
function playStrike() {
  if (!audioCtx || !strikeBuffer) return;
  
  audioCtx.resume().then(() => {
    const source = audioCtx.createBufferSource();
    source.buffer = strikeBuffer;
    
    const gain = audioCtx.createGain();
    gain.gain.value = 1.0;
    
    source.connect(gain).connect(audioCtx.destination);
    source.start(0);
  });
}

/**
 * 真实斯诺克库边碰撞声
 * 低沉的 bass 鼓点风格 - 音调固定，只有音量随速度变化
 */
function playCushionHit(relVel) {
  if (!audioCtx) return;
  
  audioCtx.resume().then(() => {
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
  });
}
