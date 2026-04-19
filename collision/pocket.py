"""
斯诺克袋口模块
================
6 个袋口（4 角袋 + 2 中袋）的几何定义、落袋检测、袋口弧形碰撞。

核心概念：
  1. 吞球判定：球心进入 capture_radius 圆 → 落袋消失
  2. 袋颚弧反弹：球碰到袋颚弧 → 像碰库边一样反弹（可能晃袋而出）
  3. 紧度参数：控制开口宽度和袋颚弧半径

WPBSA 标准尺寸参考：
  - 角袋开口 ≈ 83-102 mm（职业窄，俱乐部宽）
  - 中袋开口 ≈ 93-112 mm（比角袋宽 10mm）
  - 袋颚弧半径 ≈ 15-40 mm
"""

import numpy as np
from dataclasses import dataclass
from typing import List, Optional, Tuple


# ── 物理常数 ──────────────────────────────────────────────────────
BALL_RADIUS = 0.02625

# 台面尺寸
TABLE_X_MAX =  1.7845
TABLE_X_MIN = -1.7845
TABLE_Y_MAX =  0.889
TABLE_Y_MIN = -0.889


# ── 袋口尺寸（按紧度参数化）────────────────────────────────────────
def corner_mouth_width(tightness: float) -> float:
    """角袋开口宽度（米）。tightness=0 → 102mm（宽），=1 → 83mm（窄）"""
    t = np.clip(tightness, 0.0, 1.0)
    return 0.102 - 0.019 * t


def center_mouth_width(tightness: float) -> float:
    """中袋开口宽度（米）。标准比角袋宽 10mm。"""
    return corner_mouth_width(tightness) + 0.010


def jaw_radius(tightness: float) -> float:
    """袋颚弧半径（米）。tightness=0 → 40mm（大弧引导进袋），=1 → 15mm（小弧易晃袋）"""
    t = np.clip(tightness, 0.0, 1.0)
    return 0.040 - 0.025 * t


# ── 袋口数据结构 ──────────────────────────────────────────────────
@dataclass
class Pocket:
    """单个袋口的完整几何定义"""
    name:            str               # 'tr'/'tl'/'br'/'bl'/'rc'/'lc'
    pocket_type:     str               # 'corner' 或 'center'
    center:          np.ndarray        # 袋口吞球圆心 (x, y)
    mouth_dir:       np.ndarray        # 开口方向（从袋口指向台内的单位向量）
    jaw_left_center: np.ndarray        # 左袋颚圆心 (x, y)
    jaw_right_center: np.ndarray       # 右袋颚圆心 (x, y)
    nose_left:       np.ndarray        # 左袋颚鼻尖（圆上最朝库边的点）
    nose_right:      np.ndarray        # 右袋颚鼻尖
    jaw_radius:      float             # 袋颚弧半径
    mouth_width:     float             # 开口宽度（两鼻尖距离）
    capture_radius:  float             # 吞球半径


# ── 构造函数：角袋 ────────────────────────────────────────────────
def make_corner_pocket(name: str, corner_x: float, corner_y: float,
                       tightness: float) -> Pocket:
    """
    创建一个角袋。
    
    几何模型（以右上角 tr 为例，corner = (+1.7845, +0.889)）：
    
      两条库边在角落相交。实际上袋口是"切掉"角落的一部分：
      - 上库（y=corner_y）从 x = corner_x - d 位置开始切开
      - 右库（x=corner_x）从 y = corner_y - d 位置开始切开
      - 这两个"切口起点"就是袋颚的鼻尖
      - 两鼻尖直线距离 = mw（开口宽度）
      - 由对称性 d = mw / √2
      
                     ↑ y = corner_y 的上库
            ═════════╗
                     ╲● ← nose_A = (corner_x - d, corner_y)
                      ╲   
                       ╲ ← 开口对角线
                        ╲
                         ● ← nose_B = (corner_x, corner_y - d)
                         ║
                         ║ ← x = corner_x 的右库
      
      袋颚圆心：在对应库边**内侧** jr 处（让圆与库边相切），
                x 或 y 方向上稍微远离角落，让圆对着袋口方向。
      
      具体：
        jaw_A（对应 nose_A）：
          圆心 y = corner_y - sgn_y * jr  （在上库内侧 jr）
          圆心 x 这样选：让鼻尖（圆上最靠近袋口 = 最靠近对角线的点）
                        恰好在 (corner_x - d, corner_y)
        
        圆上最靠近袋口方向的点 = 圆心 + jr * (指向袋口的单位向量)
        
        "指向袋口"对于 jaw_A 来说是朝 -u_hat 方向（朝对角线外侧？）
        实际上应该是：圆心在 (corner_x - d, corner_y - jr)，
                     鼻尖就在圆上 y 最大的点 = 圆心 + (0, jr) = (corner_x - d, corner_y) ✓
      
      所以：
        jaw_A 圆心 = (corner_x + sgn_x * d, corner_y + sgn_y * jr)
        jaw_B 圆心 = (corner_x + sgn_x * jr, corner_y + sgn_y * d)
      
      这样：
        - jaw_A 圆的最上点（y 最大）= 圆心 + (0, -sgn_y * jr) = (corner_x - d, corner_y) ✓ 在库边上
        - jaw_A 圆的最左点（朝袋内方向 -sgn_x）= 圆心 + (sgn_x * jr, 0)
          这就是鼻尖的位置...
      
      等等，"鼻尖"到底在哪？鼻尖是圆的"朝袋口内"的那个点。
      
      对 jaw_A（上库袋颚）来说：
        它的"职责"是阻挡从 -sgn_x 方向（从袋外沿上库滚来的球）进入。
        球从 -sgn_x 方向来，撞到这个圆的最左边（-sgn_x 方向）。
        所以"袋颚鼻尖" = 圆心 + (-sgn_x * jr, 0)
                       = (corner_x + sgn_x * d - sgn_x * jr, corner_y + sgn_y * jr)
                       = (corner_x + sgn_x * (d - jr), corner_y + sgn_y * jr)
      
      但我们希望鼻尖正好在库边 y = corner_y 上。所以应该 sgn_y * jr = 0？不对。
      
      看来"圆心在库边内侧 jr 处让弧切到库面"和"鼻尖在库边切口起点"这两个条件不能同时满足。
      必须选一个优先级。
    
    我的决策：**优先让鼻尖位于正确的开口位置**（即两鼻尖距离 = mw），
              允许袋颚圆略微"侵入"库边或略微"远离"库边。
    
    最终公式：
      jaw_A 圆心 = (corner_x + sgn_x * d, corner_y + sgn_y * jr)
      鼻尖A      = 圆的"最左点"（朝袋口开口方向）
                 = (corner_x + sgn_x * (d - jr), corner_y + sgn_y * jr)
      
      这样 jaw_A 的弧和上库面大致相切（相差 0），两鼻尖也大致在开口的两侧。
    """
    mw = corner_mouth_width(tightness)
    jr = jaw_radius(tightness)
    
    # 从角落指向台心的方向
    sgn_x = -1.0 if corner_x > 0 else 1.0
    sgn_y = -1.0 if corner_y > 0 else 1.0
    
    # 沿对角线方向，从角落到鼻尖的距离
    d = mw / np.sqrt(2)
    
    # 袋颚A 圆心：在上库（y 方向库边）内侧 jr 处
    # x 方向从角落沿 sgn_x 方向偏 d（= mw/√2）
    jaw_A = np.array([
        corner_x + sgn_x * d,
        corner_y + sgn_y * jr,
    ])
    
    # 袋颚B 圆心：在右库（x 方向库边）内侧 jr 处
    jaw_B = np.array([
        corner_x + sgn_x * jr,
        corner_y + sgn_y * d,
    ])
    
    # 鼻尖：每个袋颚圆上最朝向库边的点
    # jaw_A 在上库（y 方向），鼻尖是圆上 y 最大（-sgn_y 方向）的点
    nose_A = jaw_A + np.array([0.0, -sgn_y * jr])
    # jaw_B 在右库（x 方向），鼻尖是圆上 x 最大（-sgn_x 方向）的点
    nose_B = jaw_B + np.array([-sgn_x * jr, 0.0])
    
    # 开口方向：朝台内的对角线方向
    mouth_dir = np.array([sgn_x, sgn_y]) / np.sqrt(2)
    
    # 袋心：两袋颚圆心的中点（自然位于对角线上，稍微退入袋内）
    center = (jaw_A + jaw_B) / 2
    
    # 吞球半径：让球能从开口进入到袋心区域就算进
    # 从袋心到开口距离大约是 (d - jr) * √2 / 2 ≈ d/√2 - jr/√2
    # capture_radius 设得略小于"袋心到两袋颚鼻尖连线"的距离，
    # 避免台面上靠近袋口但未进入的球被误判
    capture_radius = mw / 2 * 0.7   # 从 0.85 调到 0.7，更保守
    
    return Pocket(
        name=name,
        pocket_type='corner',
        center=center,
        mouth_dir=mouth_dir,
        jaw_left_center=jaw_A,
        jaw_right_center=jaw_B,
        nose_left=nose_A,
        nose_right=nose_B,
        jaw_radius=jr,
        mouth_width=mw,
        capture_radius=capture_radius,
    )


# ── 构造函数：中袋 ────────────────────────────────────────────────
def make_center_pocket(name: str, sign_y: int, tightness: float) -> Pocket:
    """
    创建中袋（在长边 y=±TABLE_Y_MAX 的中点）。
    
    几何模型（以右中袋 rc 为例，sign_y = +1，y = +TABLE_Y_MAX）：
    
       ─────╗       ╔─────   ← 库边（y = TABLE_Y_MAX）
            ○       ○         ← 两袋颚（左右对称）
            │●中心●│             中心点在开口线后方一点
            │       │
            开口 mw
    
    两袋颚圆心在库边内侧 jr 处（让弧切到库面）。
    鼻尖相对，开口宽度 mw。
    
    参数：
      sign_y: +1 = 右中袋（y=+TABLE_Y_MAX），-1 = 左中袋
    """
    mw = center_mouth_width(tightness)
    jr = jaw_radius(tightness)
    
    corner_y = sign_y * TABLE_Y_MAX
    sgn_y    = -float(sign_y)   # 从袋口指向台内的 y 方向
    
    # 两袋颚圆心：在开口两端（x = ±mw/2）向台内偏 jr
    # jaw_left 在 x = -mw/2 向右（朝台内）偏 jr
    jaw_left = np.array([
        -mw / 2 + jr,
        corner_y + sgn_y * jr,
    ])
    # jaw_right 在 x = +mw/2 向左（朝台内）偏 jr
    jaw_right = np.array([
        +mw / 2 - jr,
        corner_y + sgn_y * jr,
    ])
    
    # 鼻尖：每个袋颚圆上最朝向库边（开口边缘）的点
    # jaw_left 的鼻尖：圆上 x 最小的点 = 圆心 - (jr, 0) = (-mw/2, y) 在库边上 ✓
    nose_left  = jaw_left  + np.array([-jr, 0.0])
    # jaw_right 的鼻尖：圆上 x 最大的点 = 圆心 + (jr, 0) = (+mw/2, y) 在库边上 ✓
    nose_right = jaw_right + np.array([+jr, 0.0])
    # 鼻尖中点（在 x=0, y=corner_y 附近）
    mouth_midpoint = (nose_left + nose_right) / 2
    
    # 开口方向：朝台内（朝 -sign_y 方向）
    mouth_dir = np.array([0.0, sgn_y])
    
    # 袋心：从鼻尖中点朝库边外偏一点（袋的"深处"）
    # 中袋的"袋深"方向是 +sign_y（朝库边外）
    center = mouth_midpoint + np.array([0.0, -sgn_y * (mw / 4)])
    
    # 吞球半径（保守，防止台面误判）
    capture_radius = mw / 2 * 0.7
    
    return Pocket(
        name=name,
        pocket_type='center',
        center=center,
        mouth_dir=mouth_dir,
        jaw_left_center=jaw_left,
        jaw_right_center=jaw_right,
        nose_left=nose_left,
        nose_right=nose_right,
        jaw_radius=jr,
        mouth_width=mw,
        capture_radius=capture_radius,
    )


# ── 创建全部 6 个袋 ───────────────────────────────────────────────
def make_all_pockets(tightness: float = 0.5) -> List[Pocket]:
    """
    创建斯诺克 6 个标准袋。
    
    命名约定（以俯视图看）：
      tr: top-right (+x, +y)   角袋
      tl: top-left  (+x, -y)   角袋
      br: bottom-right (-x, +y) 角袋
      bl: bottom-left  (-x, -y) 角袋
      rc: right-center (0, +y)  中袋
      lc: left-center  (0, -y)  中袋
    """
    return [
        make_corner_pocket('tr', TABLE_X_MAX,  TABLE_Y_MAX, tightness),
        make_corner_pocket('tl', TABLE_X_MAX,  TABLE_Y_MIN, tightness),
        make_corner_pocket('br', TABLE_X_MIN,  TABLE_Y_MAX, tightness),
        make_corner_pocket('bl', TABLE_X_MIN,  TABLE_Y_MIN, tightness),
        make_center_pocket('rc', +1, tightness),
        make_center_pocket('lc', -1, tightness),
    ]


# ── 落袋检测 ──────────────────────────────────────────────────────
def check_potted(pos_2d: np.ndarray,
                 pockets: List[Pocket]) -> Optional[Pocket]:
    """
    检测球心是否进入任何袋的吞球圆。
    
    参数：
      pos_2d: 球心 2D 位置 (x, y)
      pockets: 袋列表
    
    返回：
      落袋的 Pocket 对象，未落袋返回 None
    """
    for pocket in pockets:
        dist = np.linalg.norm(pos_2d - pocket.center)
        if dist < pocket.capture_radius:
            return pocket
    return None


# ── 袋颚弧碰撞检测 ────────────────────────────────────────────────
def check_jaw_collision(pos_2d: np.ndarray,
                        pockets: List[Pocket]
                        ) -> Optional[Tuple[np.ndarray, np.ndarray, Pocket, str]]:
    """
    检测球是否接触任何袋颚弧。
    
    物理：球（半径 R）与袋颚弧（半径 jr）外切 → 两圆心距离 = R + jr
         距离 < R + jr 时发生接触（重叠）
    
    返回：
      (jaw_center, n_hat, pocket, side) 四元组：
        jaw_center: 袋颚圆心（2D）
        n_hat:      从袋颚圆心指向球心的单位向量（碰撞法向）
        pocket:     所属的袋
        side:       'left' 或 'right'
      未碰到返回 None
    """
    for pocket in pockets:
        for jaw_c, side in [(pocket.jaw_left_center, 'left'),
                             (pocket.jaw_right_center, 'right')]:
            r_vec = pos_2d - jaw_c
            dist  = np.linalg.norm(r_vec)
            if dist < pocket.jaw_radius + BALL_RADIUS:
                if dist < 1e-9:
                    # 极端情况：球心恰好在袋颚圆心，任取一个方向
                    n_hat = np.array([1.0, 0.0])
                else:
                    n_hat = r_vec / dist
                return (jaw_c, n_hat, pocket, side)
    return None


# ── 自测 ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 70)
    print("袋口几何测试")
    print("=" * 70)
    
    for tightness in [0.0, 0.5, 1.0]:
        print(f"\n【tightness = {tightness}】")
        print(f"  角袋开口:  {corner_mouth_width(tightness)*1000:6.1f} mm")
        print(f"  中袋开口:  {center_mouth_width(tightness)*1000:6.1f} mm")
        print(f"  袋颚半径:  {jaw_radius(tightness)*1000:6.1f} mm")
    
    print("\n" + "=" * 70)
    print("袋口位置（tightness=0.5）")
    print("=" * 70)
    pockets = make_all_pockets(0.5)
    for p in pockets:
        print(f"\n  {p.name} ({p.pocket_type}):")
        print(f"    center      = [{p.center[0]:+.4f}, {p.center[1]:+.4f}]")
        print(f"    mouth_dir   = [{p.mouth_dir[0]:+.3f}, {p.mouth_dir[1]:+.3f}]")
        print(f"    jaw_left    = [{p.jaw_left_center[0]:+.4f}, {p.jaw_left_center[1]:+.4f}]")
        print(f"    jaw_right   = [{p.jaw_right_center[0]:+.4f}, {p.jaw_right_center[1]:+.4f}]")
        print(f"    capture_R   = {p.capture_radius*1000:.1f} mm")
        print(f"    jaw_radius  = {p.jaw_radius*1000:.1f} mm")
    
    print("\n" + "=" * 70)
    print("落袋检测测试")
    print("=" * 70)
    
    # 测试右上角袋
    pockets = make_all_pockets(0.5)
    tr = pockets[0]  # top-right corner
    
    print(f"\n  右上角袋中心: {tr.center}")
    print(f"  吞球半径:     {tr.capture_radius*1000:.1f} mm")
    
    test_positions = [
        (tr.center, "袋心精确"),
        (tr.center + np.array([0.01, 0]), "偏 10mm"),
        (tr.center + np.array([0.03, 0.03]), "偏 30mm (×2)"),
        (np.array([1.7, 0.85]), "袋外"),
        (np.array([TABLE_X_MAX, TABLE_Y_MAX]), "角落顶点"),
    ]
    
    for pos, desc in test_positions:
        potted = check_potted(np.array(pos), pockets)
        jaw    = check_jaw_collision(np.array(pos), pockets)
        status = []
        if potted: status.append(f"🎯 落袋 {potted.name}")
        if jaw:    status.append(f"⚠️  碰袋颚 ({jaw[3]})")
        if not status: status.append("✓ 台面")
        print(f"  pos={np.round(pos,3)} ({desc:15s}): {' + '.join(status)}")
    
    print("\n" + "=" * 70)
    print("紧度对袋口的影响（角袋）")
    print("=" * 70)
    for t in [0.0, 0.3, 0.5, 0.7, 1.0]:
        pockets = make_all_pockets(t)
        tr = pockets[0]
        
        # 测试一个稍微偏离袋心的球
        test_pos = tr.center + np.array([0.02, 0.02])
        potted = check_potted(test_pos, pockets)
        jaw    = check_jaw_collision(test_pos, pockets)
        
        print(f"\n  tightness={t}: 开口 {tr.mouth_width*1000:.0f}mm, "
              f"袋颚 R={tr.jaw_radius*1000:.0f}mm")
        print(f"    测试球偏离袋心 28mm: ", end="")
        if potted: print(f"落袋 ✓")
        elif jaw:  print(f"碰袋颚（晃袋）")
        else:      print(f"未触发")