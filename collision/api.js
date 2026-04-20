/**
 * Backend API Communication Module
 * =================================
 * 封装所有与后端 API 的通信逻辑
 */

// ── API Server Configuration ────────────────────────────────────────
const API_URL = 'http://localhost:8000/simulate';

/**
 * 从 Python API 获取轨迹数据
 * @param {number} a - x轴方向击打点偏移 (mm)
 * @param {number} b - y轴方向击打点偏移 (mm)
 * @param {number} phi - 方向角 (度)
 * @param {number} theta - 俯仰角 (度)
 * @param {number} force - 击打力度 (0.05-1.0)
 * @param {number} mu_tip - 球杆与球的摩擦系数
 * @param {Array} whiteBallPos - 白球初始位置 [x, y, z]，可选
 * @param {Array} redBallPos - 红球初始位置 [x, y, z]，可选
 * @param {Object} advParams - 高级物理参数，可选
 * @returns {Promise<Array>} 模拟帧数据数组
 */
async function requestSimulation(a, b, phi, theta, force, mu_tip, whiteBallPos=null, redBallPos=null, advParams=null) {
  try {
    const payload = buildSimulationPayload(a, b, phi, theta, force, mu_tip, whiteBallPos, redBallPos, advParams);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Simulation failed');
    }
    
    return parseSimulationFrames(data);
    
  } catch (error) {
    console.error('❌ Simulation error:', error.message);
    alert(`Simulation failed: ${error.message}\n\nMake sure to run: python simulator_server.py`);
    return [];
  }
}

/**
 * 构建发送给后端的模拟请求有效负载
 * @private
 */
function buildSimulationPayload(a, b, phi, theta, force, mu_tip, whiteBallPos, redBallPos, advParams) {
  const payload = {
    a,
    b,
    phi,
    theta,
    force,
    mu_tip,
    enable_collision: true
  };
  
  // 添加白球初始位置
  if (whiteBallPos) {
    payload.initial_x = whiteBallPos[0];
    payload.initial_y = whiteBallPos[1];
    payload.initial_z = whiteBallPos[2];
  }
  
  // 添加红球初始位置
  if (redBallPos) {
    payload.red_x = redBallPos[0];
    payload.red_y = redBallPos[1];
    payload.red_z = redBallPos[2];
  }
  
  // 添加高级物理参数
  if (advParams) {
    payload.e_restitution = advParams.e_restitution;
    payload.mu_cushion = advParams.mu_cushion;
    payload.mu_rolling = advParams.mu_rolling;
    payload.mu_sliding = advParams.mu_sliding;
    payload.e_floor = advParams.e_floor;
  }
  
  return payload;
}

/**
 * 解析后端返回的模拟数据
 * @private
 */
function parseSimulationFrames(data) {
  // 转换 API 返回的帧数据格式，同时保存完整数据
  const frames = data.frames.map(f => ({
    pos: f.pos,
    v: f.v,
    omega: f.omega,
    state: f.state,
    t: f.t,
    balls: f.balls || {}  // 包含多球数据（如果有的话）
  }));
  
  // 将完整数据附加到 frames 对象上（用于访问元信息）
  frames._data = data;
  
  return frames;
}
