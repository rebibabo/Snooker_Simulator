/**
 * UI Panel Module
 * ===============
 * 管理所有UI面板、对话框和交互
 */

// ── UI Panel State ──────────────────────────────────────────────────
let uiPanelCollapsed = false;

/**
 * 切换UI面板折叠/展开
 */
function toggleUIPanel() {
  uiPanelCollapsed = !uiPanelCollapsed;
  const ui = document.getElementById('ui');
  const btn = document.getElementById('ui-collapse-btn');
  const label = document.getElementById('ui-toggle-label');
  
  if (uiPanelCollapsed) {
    ui.classList.add('collapsed');
    btn.textContent = '►';
    btn.style.color = '#7a9a7a';
    label.textContent = 'Show';
    label.style.color = '#7a9a7a';
  } else {
    ui.classList.remove('collapsed');
    btn.textContent = '◄';
    btn.style.color = '#5a7a5a';
    label.textContent = 'Hide';
    label.style.color = '#5a7a5a';
  }
}

/**
 * 切换高级物理参数面板
 */
function toggleAdvPhysics() {
  const content = document.getElementById('adv-physics-content');
  const arrow = document.querySelector('.collapse-arrow');
  content.classList.toggle('collapsed');
  arrow.classList.toggle('collapsed');
}

/**
 * 切换Multi-Trace面板
 */
function toggleMultiTrace() {
  const content = document.getElementById('mt-content');
  const header = document.getElementById('mt-header');
  const arrow = header.querySelector('.collapse-arrow');
  content.classList.toggle('collapsed');
  arrow.classList.toggle('collapsed');
}

/**
 * 显示警告提示
 */
function showWarning(msg, duration = 2000) {
  const warningEl = document.getElementById('warning');
  warningEl.textContent = msg;
  warningEl.style.opacity = '1';
  setTimeout(() => {
    warningEl.style.opacity = '0';
  }, duration);
}

/**
 * 显示成功提示
 */
function showSuccess(msg, duration = 2000) {
  const successEl = document.getElementById('success');
  successEl.textContent = msg;
  successEl.style.opacity = '1';
  setTimeout(() => {
    successEl.style.opacity = '0';
  }, duration);
}

/**
 * 显示输入对话框
 */
function showInputDialog(title) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('input-dialog');
    const titleEl = document.getElementById('input-title');
    const inputField = document.getElementById('input-field');
    const okBtn = document.getElementById('input-ok');
    const cancelBtn = document.getElementById('input-cancel');
    
    titleEl.textContent = title;
    inputField.value = 'shot_' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
    inputField.focus();
    inputField.select();
    
    const cleanup = () => {
      dialog.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      inputField.removeEventListener('keypress', onKeyPress);
    };
    
    const onOk = () => {
      const value = inputField.value.trim();
      cleanup();
      resolve(value);
    };
    
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    
    const onKeyPress = (e) => {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    };
    
    dialog.style.display = 'flex';
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    inputField.addEventListener('keypress', onKeyPress);
  });
}

/**
 * 显示确认删除对话框
 */
function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const yesBtn = document.getElementById('confirm-yes');
    const noBtn = document.getElementById('confirm-no');
    
    titleEl.textContent = message;
    
    const cleanup = () => {
      dialog.style.display = 'none';
      yesBtn.onclick = null;
      noBtn.onclick = null;
    };
    
    yesBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
    
    noBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
    
    dialog.style.display = 'flex';
  });
}

/**
 * 显示历史记录列表对话框
 */
function showHistory() {
  const allSaves = JSON.parse(localStorage.getItem('snookerSaves') || '{}');
  const saveNames = Object.keys(allSaves);
  
  const dialog = document.getElementById('select-dialog');
  const selectList = document.getElementById('select-list');
  const cancelBtn = document.getElementById('select-cancel');
  
  selectList.innerHTML = ''; // 清空列表
  
  // 如果没有保存，显示空列表
  if (saveNames.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.textContent = 'No saves available';
    emptyMsg.style.cssText = `padding: 20px; text-align: center; color: #666;`;
    selectList.appendChild(emptyMsg);
  } else {
    // 为每个保存创建控制条
    saveNames.forEach((saveName) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 12px; background: #333; border: 1px solid #666; border-radius: 4px;
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        transition: all 0.2s;
      `;
      
      // 名称部分
      const nameDiv = document.createElement('div');
      nameDiv.textContent = saveName;
      nameDiv.style.cssText = `flex: 1; color: #aaa; word-break: break-all;`;
      
      // 按钮组
      const buttonsDiv = document.createElement('div');
      buttonsDiv.style.cssText = `display: flex; gap: 5px;`;
      
      // Edit按钮
      const editBtn = document.createElement('button');
      editBtn.textContent = '✎ Edit';
      editBtn.style.cssText = `
        padding: 6px 10px; background: #4a6a8a; border: 1px solid #6a8aaa; border-radius: 3px;
        color: #aaa; font-size: 11px; cursor: pointer; transition: all 0.2s;
      `;
      editBtn.onmouseover = () => {
        editBtn.style.background = '#5a7aaa';
        editBtn.style.color = '#fff';
      };
      editBtn.onmouseout = () => {
        editBtn.style.background = '#4a6a8a';
        editBtn.style.color = '#aaa';
      };
      editBtn.onclick = () => editSaveName(saveName);
      
      // Delete按钮
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '✕ Del';
      deleteBtn.style.cssText = `
        padding: 6px 10px; background: #8a4a4a; border: 1px solid #aa6a6a; border-radius: 3px;
        color: #aaa; font-size: 11px; cursor: pointer; transition: all 0.2s;
      `;
      deleteBtn.onmouseover = () => {
        deleteBtn.style.background = '#aa5a5a';
        deleteBtn.style.color = '#fff';
      };
      deleteBtn.onmouseout = () => {
        deleteBtn.style.background = '#8a4a4a';
        deleteBtn.style.color = '#aaa';
      };
      deleteBtn.onclick = () => deleteSave(saveName);
      
      // Load按钮
      const loadBtn = document.createElement('button');
      loadBtn.textContent = '► Load';
      loadBtn.style.cssText = `
        padding: 6px 10px; background: #4a8a4a; border: 1px solid #6aaa6a; border-radius: 3px;
        color: #aaa; font-size: 11px; cursor: pointer; transition: all 0.2s;
      `;
      loadBtn.onmouseover = () => {
        loadBtn.style.background = '#5aaa5a';
        loadBtn.style.color = '#fff';
      };
      loadBtn.onmouseout = () => {
        loadBtn.style.background = '#4a8a4a';
        loadBtn.style.color = '#aaa';
      };
      loadBtn.onclick = () => loadSave(saveName);
      
      buttonsDiv.appendChild(editBtn);
      buttonsDiv.appendChild(deleteBtn);
      buttonsDiv.appendChild(loadBtn);
      
      item.appendChild(nameDiv);
      item.appendChild(buttonsDiv);
      selectList.appendChild(item);
    });
  }
  
  // 清除之前的事件监听并添加新的
  cancelBtn.onclick = () => {
    dialog.style.display = 'none';
  };
  
  dialog.style.display = 'flex';
}

/**
 * 编辑保存名称
 */
async function editSaveName(oldName) {
  const newName = await showInputDialog('Enter new name');
  if (!newName || newName === oldName) return;
  
  const allSaves = JSON.parse(localStorage.getItem('snookerSaves') || '{}');
  
  // 检查新名称是否已存在
  if (allSaves[newName]) {
    showWarning('✗ Name already exists', 2000);
    return;
  }
  
  // 重命名
  allSaves[newName] = allSaves[oldName];
  delete allSaves[oldName];
  localStorage.setItem('snookerSaves', JSON.stringify(allSaves));
  
  showSuccess(`✓ Renamed: ${oldName} → ${newName}`, 2000);
  showHistory(); // Refresh list
}

/**
 * 删除保存
 */
async function deleteSave(saveName) {
  const confirmed = await showConfirmDialog(`Delete "${saveName}"?`);
  if (!confirmed) return;
  
  const allSaves = JSON.parse(localStorage.getItem('snookerSaves') || '{}');
  delete allSaves[saveName];
  localStorage.setItem('snookerSaves', JSON.stringify(allSaves));
  
  showSuccess(`✓ Deleted: ${saveName}`, 2000);
  showHistory(); // 立即更新列表
}

/**
 * 加载保存
 */
function loadSave(saveName) {
  const allSaves = JSON.parse(localStorage.getItem('snookerSaves') || '{}');
  const state = allSaves[saveName];
  
  if (!state) {
    showWarning('✗ Save not found', 2000);
    return;
  }
  
  // 恢复参数
  document.getElementById('pa').value = state.params.a;
  document.getElementById('pb').value = state.params.b;
  document.getElementById('pp').value = state.params.phi;
  document.getElementById('pt').value = state.params.theta;
  document.getElementById('pf').value = state.params.force;
  document.getElementById('pmu').value = state.params.mu_tip;
  
  // 更新显示值
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
  
  // 清除当前模拟
  frames = [];
  playIdx = 0;
  playing = false;
  if(trailLine){scene.remove(trailLine);trailLine=null;}
  clearMultiTrails();
  document.getElementById('btn-play').textContent='Play';
  
  // 关闭历史对话框
  document.getElementById('select-dialog').style.display = 'none';
  
  showSuccess(`✓ Loaded: ${saveName}`, 2000);
  console.log('✓ State loaded:', saveName);
}
