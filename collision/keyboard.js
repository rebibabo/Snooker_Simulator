/**
 * Keyboard Shortcuts and Input Handling
 * ======================================
 * 负责所有快捷键处理和键盘输入
 */

// ── 快捷键状态 ────────────────────────────────────────────────────
let vKeyPressed = false;      // V: 平移视角
let sKeyPressed = false;      // S: 调整力度
let eKeyPressed = false;      // E: 调整击打点（a, b 坐标）
let bKeyPressed = false;      // B: 调整俯仰角 theta
let fKeyPressed = false;      // F: 精准调整 phi 角度
let wheelAccum = 0;           // 滚轮累积值（S 键用）
let bWheelAccum = 0;          // 滚轮累积值（B 键用）
let sKeyJustReleased = false; // S 键刚刚松开，用于过滤硬件惯性滚轮
let bKeyJustReleased = false; // B 键刚刚松开，用于过滤硬件惯性滚轮

/**
 * 快捷键文档
 * ==========
 * V + 拖动鼠标：平移视角
 * S + 滚轮：调整力度
 * E + 拖动鼠标：在白球示意图上调整击打点 (a, b)
 * B + 滚轮：调整俯仰角 (theta)
 * F + 拖动鼠标：精准调整方向角 (phi)，灵敏度降低 4 倍
 * M：切换迷你地图
 * Space：执行击打（Strike Mode）
 * R：重置球位置
 * Ctrl/Cmd+Z：撤销
 * Ctrl/Cmd+Shift+Z：重做
 */

/**
 * 初始化快捷键监听
 */
function initKeyboardListeners() {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleWindowBlur);
}

/**
 * 关闭快捷键监听
 */
function closeKeyboardListeners() {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);
  window.removeEventListener('blur', handleWindowBlur);
}

/**
 * 处理按键按下事件
 */
function handleKeyDown(e) {
  // Ctrl+Z 撤销，Ctrl+Shift+Z 重做
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redoState();
    } else {
      undoState();
    }
  }
  
  // 单个按键识别
  if (e.key.toLowerCase() === 'v') vKeyPressed = true;
  if (e.key.toLowerCase() === 's') sKeyPressed = true;
  if (e.key.toLowerCase() === 'e') eKeyPressed = true;
  if (e.key.toLowerCase() === 'b') bKeyPressed = true;
  if (e.key.toLowerCase() === 'f') fKeyPressed = true;  // F 键：精准调整 phi
  
  // M 键切换 2D 图显示/隐藏
  if (e.key.toLowerCase() === 'm') {
    const minimapExpanded = document.getElementById('minimap-expanded');
    if (minimapExpanded.style.display === 'none' || minimapExpanded.style.display === '') {
      openMinimapWindow();
    } else {
      closeMinimapWindow();
    }
  }
  
  // 空格键在 Strike Mode 下执行击打
  if (e.key === ' ') {
    e.preventDefault();
    if (strikeMode) {
      simulate();
    }
  }
  
  // A 键重置球的位置
  if (e.key.toLowerCase() === 'a') {
    e.preventDefault();
    resetBallPosition();
  }
}

/**
 * 处理按键释放事件
 */
function handleKeyUp(e) {
  if (e.key.toLowerCase() === 'v') vKeyPressed = false;
  if (e.key.toLowerCase() === 'e') eKeyPressed = false;
  if (e.key.toLowerCase() === 'f') fKeyPressed = false;  // F 键释放
  
  if (e.key.toLowerCase() === 'b') {
    bKeyPressed = false;
    bWheelAccum = 0;  // 清零滚轮累积值
    // 标记 B 键刚刚松开，用于过滤硬件惯性滚轮事件（500ms 内忽略）
    bKeyJustReleased = true;
    setTimeout(() => { bKeyJustReleased = false; }, 500);
  }
  
  if (e.key.toLowerCase() === 's') {
    sKeyPressed = false;
    wheelAccum = 0;  // 清零滚轮累积值，防止视角缩放冲突
    // 标记 S 键刚刚松开，用于过滤硬件惯性滚轮事件（500ms 内忽略）
    sKeyJustReleased = true;
    setTimeout(() => { sKeyJustReleased = false; }, 500);
  }
}

/**
 * 处理窗口失焦事件（重置快捷键状态）
 */
function handleWindowBlur() {
  // 重置所有按键状态
  vKeyPressed = false;
  sKeyPressed = false;
  eKeyPressed = false;
  bKeyPressed = false;
  fKeyPressed = false;
  wheelAccum = 0;
  bWheelAccum = 0;
  sKeyJustReleased = false;
  bKeyJustReleased = false;
}

/**
 * 检查指定按键是否被按下
 */
function isKeyPressed(key) {
  switch (key.toLowerCase()) {
    case 'v': return vKeyPressed;
    case 's': return sKeyPressed;
    case 'e': return eKeyPressed;
    case 'b': return bKeyPressed;
    case 'f': return fKeyPressed;
    default: return false;
  }
}
