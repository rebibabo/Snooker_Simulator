/**
 * History & State Management Module
 * =================================
 * 管理撤销/重做系统和状态恢复
 */

// ── History Configuration ──────────────────────────────────────────
const MAX_HISTORY = 10;
const HISTORY_STORAGE_KEY = 'snookerHistoryData';

// ── History State ──────────────────────────────────────────────────
let stateHistory = [];    // 历史状态数组
let historyIndex = -1;    // 当前历史索引

/**
 * 从 localStorage 加载历史记录
 */
function initHistoryFromLocalStorage() {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      stateHistory = data.history || [];
      historyIndex = data.index >= 0 ? data.index : -1;
      
      // 如果有历史记录，恢复当前状态
      if (historyIndex >= 0 && stateHistory[historyIndex]) {
        restoreState(stateHistory[historyIndex]);
      }
    }
  } catch (err) {
    console.warn('Failed to load history from localStorage:', err);
  }
  updateHistoryButtons();
}

/**
 * 同步历史记录到 localStorage
 */
function syncHistoryToLocalStorage() {
  try {
    const data = {
      history: stateHistory,
      index: historyIndex
    };
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed to sync history to localStorage:', err);
  }
}

/**
 * 保存当前状态到历史记录
 */
function saveStateToHistory() {
  const state = {
    params: {
      a: parseFloat(document.getElementById('pa').value),
      b: parseFloat(document.getElementById('pb').value),
      phi: parseFloat(document.getElementById('pp').value),
      theta: parseFloat(document.getElementById('pt').value),
      force: parseFloat(document.getElementById('pf').value),
      mu_tip: parseFloat(document.getElementById('pmu').value)
    },
    advParams: {
      e_restitution: parseFloat(document.getElementById('padv-er').value),
      mu_cushion: parseFloat(document.getElementById('padv-mc').value),
      mu_rolling: parseFloat(document.getElementById('padv-mr').value),
      mu_sliding: parseFloat(document.getElementById('padv-ms').value),
      e_floor: parseFloat(document.getElementById('padv-ef').value)
    },
    balls: {
      white: [...balls.white.pos],
      red: [...balls.red.pos]
    }
  };
  
  // 删除当前索引后的所有历史（防止分支）
  stateHistory = stateHistory.slice(0, historyIndex + 1);
  
  // 添加新状态
  stateHistory.push(state);
  
  // 限制最多MAX_HISTORY条
  if (stateHistory.length > MAX_HISTORY) {
    stateHistory.shift();
  } else {
    historyIndex++;
  }
  
  updateHistoryButtons();
  syncHistoryToLocalStorage();  // 同步到 localStorage
}

/**
 * 恢复指定历史状态
 */
function restoreState(state) {
  if (!state) return;
  
  // 恢复参数
  document.getElementById('pa').value = state.params.a;
  document.getElementById('pb').value = state.params.b;
  document.getElementById('pp').value = state.params.phi;
  document.getElementById('pt').value = state.params.theta;
  document.getElementById('pf').value = state.params.force;
  document.getElementById('pmu').value = state.params.mu_tip;
  
  // 更新参数显示值
  document.getElementById('va').textContent = state.params.a;
  document.getElementById('vb').textContent = state.params.b;
  document.getElementById('vp').textContent = state.params.phi + '°';
  document.getElementById('vt').textContent = (state.params.theta).toFixed(1) + '°';
  document.getElementById('vf').textContent = state.params.force.toFixed(2);
  document.getElementById('vmu').textContent = state.params.mu_tip.toFixed(2);
  
  // 恢复高级参数
  document.getElementById('padv-er').value = state.advParams.e_restitution;
  document.getElementById('padv-mc').value = state.advParams.mu_cushion;
  document.getElementById('padv-mr').value = state.advParams.mu_rolling;
  document.getElementById('padv-ms').value = state.advParams.mu_sliding;
  document.getElementById('padv-ef').value = state.advParams.e_floor;
  
  document.getElementById('vadv-er').textContent = state.advParams.e_restitution.toFixed(3);
  document.getElementById('vadv-mc').textContent = state.advParams.mu_cushion.toFixed(2);
  document.getElementById('vadv-mr').textContent = state.advParams.mu_rolling.toFixed(3);
  document.getElementById('vadv-ms').textContent = state.advParams.mu_sliding.toFixed(2);
  document.getElementById('vadv-ef').textContent = state.advParams.e_floor.toFixed(2);
  
  // 恢复球位置
  balls.white.pos = [...state.balls.white];
  balls.red.pos = [...state.balls.red];
  preStrikeWhitePos = [...state.balls.white];
  preStrikeRedPos = [...state.balls.red];
  
  // 更新3D位置
  const tx = balls.white.pos[1], ty = balls.white.pos[2], tz = -balls.white.pos[0];
  ballMesh.position.set(tx, ty, tz);
  
  const redX = balls.red.pos[1], redY = balls.red.pos[2], redZ = -balls.red.pos[0];
  redBallMesh.position.set(redX, redY, redZ);
  
  // 清除模拟
  frames = [];
  playIdx = 0;
  playing = false;
  if (trailLine) {
    scene.remove(trailLine);
    trailLine = null;
  }
  clearMultiTrails();
  document.getElementById('btn-play').textContent = 'Play';
}

/**
 * 撤销（回到上一个状态）
 */
function undoState() {
  if (historyIndex > 0) {
    historyIndex--;
    restoreState(stateHistory[historyIndex]);
    showSuccess('↶ Undo', 1000);
    updateHistoryButtons();
    syncHistoryToLocalStorage();
  }
}

/**
 * 重做（回到下一个状态）
 */
function redoState() {
  if (historyIndex < stateHistory.length - 1) {
    historyIndex++;
    restoreState(stateHistory[historyIndex]);
    showSuccess('↷ Redo', 1000);
    updateHistoryButtons();
    syncHistoryToLocalStorage();
  }
}

/**
 * 更新历史按钮的启用状态
 */
function updateHistoryButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= stateHistory.length - 1;
}
