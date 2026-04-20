/**
 * Minimap Module
 * ==============
 * 管理所有迷你地图相关的绘制和交互
 */

// ── Minimap 2D Canvas ───────────────────────────────────────────────
let minimapCanvas = null;
let minimapCtx = null;
let minimapTrajectory = [];

const dpr = window.devicePixelRatio || 1;
const MINIMAP_W = 200, MINIMAP_H = 280;
const MAP_PADDING = 20, MAP_INNER_W = MINIMAP_W - MAP_PADDING * 2, MAP_INNER_H = MINIMAP_H - MAP_PADDING * 2;

// ── Minimap Expanded Window ────────────────────────────────────────
let minimapExpandedCtx = null;
let minimapExpandedDpr = 1;
let minimapExpandedAnimationId = null;

/**
 * 初始化迷你地图
 */
function initMinimap() {
  minimapCanvas = document.getElementById('minimap-canvas');
  if (!minimapCanvas) return;
  
  minimapCtx = minimapCanvas.getContext('2d');
  minimapCanvas.width = 200 * dpr;
  minimapCanvas.height = 280 * dpr;
  minimapCtx.scale(dpr, dpr);
}

/**
 * 绘制迷你地图
 */
function drawMinimap() {
  if (!minimapCtx) return;
  
  minimapCtx.fillStyle = 'rgba(8,10,8,0.95)';
  minimapCtx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
  
  const tableW = TABLE_X_MAX - TABLE_X_MIN;
  const tableH = TABLE_Y_MAX - TABLE_Y_MIN;
  const scaleX = MAP_INNER_H / tableW;
  const scaleY = MAP_INNER_W / tableH;
  
  const mapOriginX = MAP_PADDING + MAP_INNER_W / 2;
  const mapOriginY = MAP_PADDING + MAP_INNER_H / 2;
  
  // 绘制台子背景
  minimapCtx.fillStyle = 'rgba(16, 147, 38, 0.9)';
  minimapCtx.fillRect(MAP_PADDING, MAP_PADDING, MAP_INNER_W, MAP_INNER_H);
  
  // 绘制D线
  minimapCtx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
  minimapCtx.lineWidth = 1.5;
  const dLineX = TABLE_X_MIN + D_DISTANCE;
  const dLineY = mapOriginY + dLineX * scaleX;
  
  minimapCtx.beginPath();
  minimapCtx.moveTo(MAP_PADDING, dLineY);
  minimapCtx.lineTo(MAP_PADDING + MAP_INNER_W, dLineY);
  minimapCtx.stroke();
  
  // 绘制D区半圆
  minimapCtx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
  minimapCtx.lineWidth = 1;
  const dSemiRadius = D_RADIUS * scaleX;
  minimapCtx.beginPath();
  minimapCtx.arc(mapOriginX, dLineY, dSemiRadius, Math.PI, Math.PI * 2, false);
  minimapCtx.stroke();
  
  // 绘制球位置
  if (selectedBall !== null || !playing) {
    // 显示初始球位置
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
  } else if (frames.length > 0) {
    // 显示模拟中的球位置
    const f = frames[Math.min(playIdx, frames.length - 1)];
    
    const whiteSimMapX = mapOriginX + f.pos[1] * scaleY;
    const whiteSimMapY = mapOriginY - f.pos[0] * scaleX;
    minimapCtx.fillStyle = 'rgba(255, 250, 245, 1.0)';
    minimapCtx.beginPath();
    minimapCtx.arc(whiteSimMapX, whiteSimMapY, 2.5, 0, Math.PI * 2);
    minimapCtx.fill();
    
    if (f.balls && f.balls.red && f.balls.red.pos) {
      const redSimMapX = mapOriginX + f.balls.red.pos[1] * scaleY;
      const redSimMapY = mapOriginY - f.balls.red.pos[0] * scaleX;
      minimapCtx.fillStyle = 'rgba(220, 20, 20, 1.0)';
      minimapCtx.beginPath();
      minimapCtx.arc(redSimMapX, redSimMapY, 2.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }
  
  // 绘制轨迹
  if (minimapTrajectory.length > 1 && showTrail) {
    minimapCtx.save();
    minimapCtx.rect(MAP_PADDING, MAP_PADDING, MAP_INNER_W, MAP_INNER_H);
    minimapCtx.clip();
    
    minimapCtx.strokeStyle = 'rgba(200,168,74,0.7)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.moveTo(mapOriginX + minimapTrajectory[0][1] * scaleY, mapOriginY - minimapTrajectory[0][0] * scaleX);
    for (let i = 1; i < minimapTrajectory.length; i++) {
      minimapCtx.lineTo(mapOriginX + minimapTrajectory[i][1] * scaleY, mapOriginY - minimapTrajectory[i][0] * scaleX);
    }
    minimapCtx.stroke();
    minimapCtx.restore();
  }
  
  // 绘制标题
  minimapCtx.fillStyle = '#5a6a5a';
  minimapCtx.font = '9px monospace';
  minimapCtx.textAlign = 'center';
  minimapCtx.fillText('TOP VIEW', MINIMAP_W / 2, MAP_PADDING - 5);
}

/**
 * 更新迷你地图轨迹
 */
function updateMinimapTrajectory() {
  minimapTrajectory = frames.map(f => [f.pos[0], f.pos[1]]);
}

/**
 * 打开放大的迷你地图窗口
 */
function openMinimapWindow() {
  const modal = document.getElementById('minimap-expanded');
  const canvas = document.getElementById('minimap-expanded-canvas');
  
  modal.style.display = 'flex';
  
  // 等待DOM渲染完成后再设置canvas
  setTimeout(() => {
    minimapExpandedDpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * minimapExpandedDpr;
    canvas.height = rect.height * minimapExpandedDpr;
    minimapExpandedCtx = canvas.getContext('2d');
    minimapExpandedCtx.scale(minimapExpandedDpr, minimapExpandedDpr);
    
    // 启动持续的动画帧更新
    function animateExpandedMinimap() {
      if (minimapExpandedCtx) {
        drawExpandedMinimap();
        minimapExpandedAnimationId = requestAnimationFrame(animateExpandedMinimap);
      }
    }
    animateExpandedMinimap();
  }, 0);
}

/**
 * 关闭放大的迷你地图窗口
 */
function closeMinimapWindow() {
  const modal = document.getElementById('minimap-expanded');
  modal.style.display = 'none';
  
  // 停止动画帧
  if (minimapExpandedAnimationId) {
    cancelAnimationFrame(minimapExpandedAnimationId);
    minimapExpandedAnimationId = null;
  }
  minimapExpandedCtx = null;
}

/**
 * 绘制放大的迷你地图
 */
function drawExpandedMinimap() {
  if (!minimapExpandedCtx) return;
  
  const canvas = document.getElementById('minimap-expanded-canvas');
  const displayW = canvas.getBoundingClientRect().width;
  const displayH = canvas.getBoundingClientRect().height;
  
  minimapExpandedCtx.fillStyle = 'rgba(8,10,8,0.95)';
  minimapExpandedCtx.fillRect(0, 0, displayW, displayH);
  
  const tableW = TABLE_X_MAX - TABLE_X_MIN;
  const tableH = TABLE_Y_MAX - TABLE_Y_MIN;
  const padding = 50;
  
  // 保持与原minimap相同的长宽比例：160:240 = 2:3
  const targetRatio = 160 / 240;
  const availableW = displayW - padding * 2;
  const availableH = displayH - padding * 2;
  
  let innerW, innerH, drawingX, drawingY;
  
  if (availableW / availableH > targetRatio) {
    // 宽度相对充足，按高度计算宽度并水平居中
    innerH = availableH;
    innerW = availableH * targetRatio;
    drawingX = padding + (availableW - innerW) / 2;
    drawingY = padding;
  } else {
    // 宽度相对不足，按宽度计算高度并垂直居中
    innerW = availableW;
    innerH = availableW / targetRatio;
    drawingX = padding;
    drawingY = padding + (availableH - innerH) / 2;
  }
  
  const scaleX = innerH / tableW;
  const scaleY = innerW / tableH;
  
  const mapOriginX = drawingX + innerW / 2;
  const mapOriginY = drawingY + innerH / 2;
  
  // 绘制台子背景
  minimapExpandedCtx.fillStyle = 'rgba(16, 147, 38, 0.9)';
  minimapExpandedCtx.fillRect(drawingX, drawingY, innerW, innerH);
  
  // 绘制D线
  minimapExpandedCtx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
  minimapExpandedCtx.lineWidth = 2;
  const dLineX = TABLE_X_MIN + D_DISTANCE;
  const dLineY = mapOriginY + dLineX * scaleX;
  minimapExpandedCtx.beginPath();
  minimapExpandedCtx.moveTo(drawingX, dLineY);
  minimapExpandedCtx.lineTo(drawingX + innerW, dLineY);
  minimapExpandedCtx.stroke();
  
  // 绘制D区半圆
  minimapExpandedCtx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
  minimapExpandedCtx.lineWidth = 1.5;
  const dSemiRadius = D_RADIUS * scaleX;
  minimapExpandedCtx.beginPath();
  minimapExpandedCtx.arc(mapOriginX, dLineY, dSemiRadius, Math.PI, Math.PI * 2, false);
  minimapExpandedCtx.stroke();
  
  // 绘制球位置
  if (selectedBall !== null || !playing) {
    const whiteMapX = mapOriginX + balls.white.pos[1] * scaleY;
    const whiteMapY = mapOriginY - balls.white.pos[0] * scaleX;
    minimapExpandedCtx.fillStyle = 'rgba(255, 250, 245, 1.0)';
    minimapExpandedCtx.beginPath();
    minimapExpandedCtx.arc(whiteMapX, whiteMapY, 6, 0, Math.PI * 2);
    minimapExpandedCtx.fill();
    
    const redMapX = mapOriginX + balls.red.pos[1] * scaleY;
    const redMapY = mapOriginY - balls.red.pos[0] * scaleX;
    minimapExpandedCtx.fillStyle = 'rgba(220, 20, 20, 1.0)';
    minimapExpandedCtx.beginPath();
    minimapExpandedCtx.arc(redMapX, redMapY, 6, 0, Math.PI * 2);
    minimapExpandedCtx.fill();
  } else if (frames.length > 0) {
    const f = frames[Math.min(playIdx, frames.length - 1)];
    
    const whiteSimMapX = mapOriginX + f.pos[1] * scaleY;
    const whiteSimMapY = mapOriginY - f.pos[0] * scaleX;
    minimapExpandedCtx.fillStyle = 'rgba(255, 250, 245, 1.0)';
    minimapExpandedCtx.beginPath();
    minimapExpandedCtx.arc(whiteSimMapX, whiteSimMapY, 6, 0, Math.PI * 2);
    minimapExpandedCtx.fill();
    
    if (f.balls && f.balls.red && f.balls.red.pos) {
      const redSimMapX = mapOriginX + f.balls.red.pos[1] * scaleY;
      const redSimMapY = mapOriginY - f.balls.red.pos[0] * scaleX;
      minimapExpandedCtx.fillStyle = 'rgba(220, 20, 20, 1.0)';
      minimapExpandedCtx.beginPath();
      minimapExpandedCtx.arc(redSimMapX, redSimMapY, 6, 0, Math.PI * 2);
      minimapExpandedCtx.fill();
    }
  }
  
  // 绘制轨迹
  if (minimapTrajectory.length > 1 && showTrail) {
    minimapExpandedCtx.save();
    minimapExpandedCtx.rect(drawingX, drawingY, innerW, innerH);
    minimapExpandedCtx.clip();
    
    minimapExpandedCtx.strokeStyle = 'rgba(200, 168, 74, 0.7)';
    minimapExpandedCtx.lineWidth = 2;
    minimapExpandedCtx.beginPath();
    minimapExpandedCtx.moveTo(mapOriginX + minimapTrajectory[0][1] * scaleY, mapOriginY - minimapTrajectory[0][0] * scaleX);
    for (let i = 1; i < minimapTrajectory.length; i++) {
      minimapExpandedCtx.lineTo(mapOriginX + minimapTrajectory[i][1] * scaleY, mapOriginY - minimapTrajectory[i][0] * scaleX);
    }
    minimapExpandedCtx.stroke();
    minimapExpandedCtx.restore();
  }
  
  // 绘制标题
  minimapExpandedCtx.fillStyle = '#5a6a5a';
  minimapExpandedCtx.font = '14px monospace';
  minimapExpandedCtx.textAlign = 'center';
  minimapExpandedCtx.fillText('TOP VIEW (Expanded)', displayW / 2, 30);
}
