"""
斯诺克球球碰撞模块
==================
物理模型：瞬时冲量法（法向）+ 库仑摩擦（切向）

法向：Jn = (1+e) * m_eff * |v_rel_n|，m_eff = m/2
切向：粘滞/滑动判断，两球都受反向冲量

坐标系（台面中心为原点）：
  x - 台面水平
  y - 台面水平，垂直于 x
  z - 垂直台面向上

核心物理（对照 cushion.py）：
  - cushion 是"单球撞无穷大墙"：m_eff = m，切向分母 = 7/(2m)
  - ball-ball 是"两等质量球相撞"：m_eff = m/2，切向分母 = 7/m
  - 法向 n_hat 是从 CB 心指向 OB 心（动态计算）
"""

import numpy as np
from dataclasses import dataclass

# ── 物理常数 ──────────────────────────────────────────────────────
BALL_RADIUS = 0.02625
BALL_MASS   = 0.1406
INERTIA     = 2 / 5 * BALL_MASS * BALL_RADIUS ** 2

# ── 球球碰撞参数 ──────────────────────────────────────────────────
E_BALL      = 0.96    # 球球恢复系数（远高于库边，球是硬质酚醛树脂）

# 球球摩擦系数（速度依赖模型，基于 Alciatore + Marlow 实验数据）
# μ(v_rel) = MU_BALL_A + MU_BALL_B * exp(-MU_BALL_C * v_rel)
# 典型值：v_rel=0.1m/s → μ≈0.11（低速粘滞强）
#        v_rel=1.0m/s → μ≈0.05（中速）
#        v_rel=3.0m/s → μ≈0.014（高速打滑）
MU_BALL_A   = 0.01    # 高速极限
MU_BALL_B   = 0.108   # 低速增量
MU_BALL_C   = 1.088   # 衰减系数


def mu_ball(v_rel: float) -> float:
    """
    球球间的速度依赖摩擦系数（Alciatore 模型）。
    v_rel: 两球接触面的切向相对速度（m/s）
    
    物理含义：
      - 低速时两球表面"咬合"，μ 大（容易粘滞）
      - 高速时两球表面打滑，μ 小（容易滑动）
    
    这解释了真实现象：
      - 大力击球时塞效果减弱（v_rel 大 → μ 小）
      - 大 cut 角时塞效果减弱（v_rel 大 → μ 小）
    """
    return MU_BALL_A + MU_BALL_B * np.exp(-MU_BALL_C * v_rel)


# 切向冲量分母：两球都受反向冲量，线速度 + 角速度效应都翻倍
# 分母 = 2*(1/m + R²/I) = 2 * 7/(2m) = 7/m
BALL_DENOM  = 7.0 / BALL_MASS


# ── 接触状态 ──────────────────────────────────────────────────────
@dataclass
class BallPairContactState:
    """记录一对球的接触历史，防止同一次碰撞重复施加冲量"""
    in_contact:       bool = False
    already_resolved: bool = False


# ── 核心：瞬时冲量球球碰撞 ────────────────────────────────────────
def compute_ball_collision(
    pos_cb:   np.ndarray,
    v_cb:     np.ndarray,
    omega_cb: np.ndarray,
    pos_ob:   np.ndarray,
    v_ob:     np.ndarray,
    omega_ob: np.ndarray,
    state:    BallPairContactState,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, BallPairContactState]:
    """
    检测两球碰撞并施加瞬时冲量。

    物理流程（对照 cushion.py）：
      ① 检测是否接触（两球心距离 < 2R）
      ② 判断是否为新碰撞（防重复触发）
      ③ 计算接触点速度和相对速度（含旋转贡献）
      ④ 法向冲量：Jn = (1+e) * m_eff * |v_rel_n|
      ⑤ 切向冲量：库仑摩擦判断粘滞/滑动
      ⑥ 两球速度和角速度都更新（反向冲量）

    参数：
      pos_cb, v_cb, omega_cb: 母球位置、速度、角速度
      pos_ob, v_ob, omega_ob: 目标球位置、速度、角速度
      state: 接触状态对象

    返回：
      (v_cb', omega_cb', v_ob', omega_ob', updated_state)
    """
    z_hat = np.array([0., 0., 1.])

    # ── ① 检测接触 ────────────────────────────────────────────────
    r_vec = pos_ob - pos_cb
    dist  = np.linalg.norm(r_vec)
    delta = 2 * BALL_RADIUS - dist   # > 0 表示两球重叠

    if delta <= 0 or dist < 1e-9:
        # 没有接触，重置状态
        state.in_contact       = False
        state.already_resolved = False
        return (v_cb.copy(), omega_cb.copy(),
                v_ob.copy(), omega_ob.copy(), state)

    # 法向：从母球心指向目标球心
    n_hat = r_vec / dist

    # ── ② 判断是否需要施加冲量 ────────────────────────────────────
    # 相对法向速度（母球相对目标球朝 n_hat 方向的分量）
    # v_rel_n > 0 表示两球正在靠近（朝碰撞方向运动）
    v_rel    = v_cb - v_ob
    v_rel_n  = np.dot(v_rel, n_hat)

    # 只有球在靠近时才施加冲量（v_rel_n > 0）
    if v_rel_n <= 0:
        state.already_resolved = False
        state.in_contact       = True
        return (v_cb.copy(), omega_cb.copy(),
                v_ob.copy(), omega_ob.copy(), state)

    state.in_contact = True

    if state.already_resolved:
        # 本次碰撞已施加过冲量，不重复
        return (v_cb.copy(), omega_cb.copy(),
                v_ob.copy(), omega_ob.copy(), state)

    state.already_resolved = True

    # ── ③ 接触点速度 ──────────────────────────────────────────────
    # 母球接触点：从母球心沿 +n_hat 方向 R 处
    r_c_cb =  BALL_RADIUS * n_hat      # 母球心 → 接触点
    r_c_ob = -BALL_RADIUS * n_hat      # 目标球心 → 接触点（反方向）

    # 接触点速度 = 平动速度 + 旋转速度
    v_contact_cb = v_cb + np.cross(omega_cb, r_c_cb)
    v_contact_ob = v_ob + np.cross(omega_ob, r_c_ob)

    # 相对接触点速度（母球相对目标球）
    v_contact_rel = v_contact_cb - v_contact_ob

    # 分解为法向和切向
    vc_rel_n = np.dot(v_contact_rel, n_hat)
    v_rel_t  = v_contact_rel - vc_rel_n * n_hat   # 切向向量（3D，含 z 分量）

    v_slip = np.linalg.norm(v_rel_t)

    # ── ④ 法向冲量 ────────────────────────────────────────────────
    # m_eff = m/2（两等质量球的约化质量）
    # Jn = (1+e) * m_eff * v_rel_n
    # 注意：这里 v_rel_n 是球心相对速度的法向分量（不是接触点速度）
    #      因为法向冲量推导只涉及质心运动（旋转对法向无影响，刚体假设）
    m_eff = BALL_MASS / 2
    Jn    = (1 + E_BALL) * m_eff * v_rel_n    # > 0

    # ── ⑤ 切向冲量（速度依赖库仑摩擦）────────────────────────────
    mu = mu_ball(v_slip)
    F_limit = mu * Jn

    if v_slip < 1e-9:
        # 无切向相对速度，不产生切向冲量
        Jt_vec = np.zeros(3)
    else:
        # 切向滑动方向的反方向（摩擦冲量方向）
        t_slip_hat = v_rel_t / v_slip

        # 粘滞冲量：让切向相对速度归零
        # J_t_stick = |v_rel_t| / (2/m + 2R²/I) = m * |v_rel_t| / 7
        Jt_stick = v_slip / BALL_DENOM

        if Jt_stick <= F_limit:
            # 粘滞：接触点相对速度被完全抵消（齿轮效应）
            Jt_mag = Jt_stick
        else:
            # 滑动：截断到库仑极限
            Jt_mag = F_limit

        # 切向冲量向量（沿 -v_rel_t 方向，阻碍相对滑动）
        Jt_vec = -Jt_mag * t_slip_hat

    # ── ⑥ 更新两球速度和角速度 ───────────────────────────────────
    # 总冲量向量（作用于目标球，母球受反作用力）
    # 法向冲量方向：把两球分开 → 作用于 OB 的冲量沿 +n_hat
    #             作用于 CB 的冲量沿 -n_hat
    J_total = Jn * n_hat + Jt_vec

    # 母球：受 -J_total
    v_cb_new     = v_cb     - J_total / BALL_MASS
    omega_cb_new = omega_cb - np.cross(r_c_cb, J_total) / INERTIA

    # 目标球：受 +J_total
    v_ob_new     = v_ob     + J_total / BALL_MASS
    omega_ob_new = omega_ob + np.cross(r_c_ob, J_total) / INERTIA

    return (v_cb_new, omega_cb_new,
            v_ob_new, omega_ob_new, state)


# ── 位置修正（防止嵌入）───────────────────────────────────────────
def separate_balls(
    pos_cb: np.ndarray, pos_ob: np.ndarray,
    eps: float = 1e-4,
) -> tuple[np.ndarray, np.ndarray]:
    """
    如果两球重叠，沿球心连线方向把它们分开到刚好接触（留 eps 间隙）。
    两球平分位移（对称）。
    """
    r_vec = pos_ob - pos_cb
    dist  = np.linalg.norm(r_vec)
    if dist < 1e-9:
        # 完全重合：任意方向分开（避免除零）
        n_hat = np.array([1., 0., 0.])
        dist = 0.0
    else:
        n_hat = r_vec / dist

    penetration = 2 * BALL_RADIUS - dist
    if penetration > 0:
        shift = (penetration + eps) / 2
        pos_cb_new = pos_cb - shift * n_hat
        pos_ob_new = pos_ob + shift * n_hat
        return pos_cb_new, pos_ob_new
    return pos_cb.copy(), pos_ob.copy()


# ── 演示与验证 ────────────────────────────────────────────────────
if __name__ == "__main__":
    print("球球碰撞测试（瞬时冲量法）")
    print("=" * 70)

    R = BALL_RADIUS

    def run_case(name, pos_cb, v_cb, omega_cb, pos_ob, v_ob=None, omega_ob=None):
        """运行一个碰撞用例并打印结果"""
        if v_ob     is None: v_ob     = np.zeros(3)
        if omega_ob is None: omega_ob = np.zeros(3)

        state = BallPairContactState()
        v_cb_out, w_cb_out, v_ob_out, w_ob_out, state = compute_ball_collision(
            pos_cb, v_cb, omega_cb, pos_ob, v_ob, omega_ob, state)

        # 验证指标
        v_rel_in  = v_cb - v_ob
        v_rel_out = v_cb_out - v_ob_out
        n_hat     = (pos_ob - pos_cb) / np.linalg.norm(pos_ob - pos_cb)

        # cut 角
        v_cb_mag = np.linalg.norm(v_cb)
        if v_cb_mag > 1e-9:
            cos_phi = np.dot(v_cb, n_hat) / v_cb_mag
            phi_deg = np.degrees(np.arccos(np.clip(cos_phi, -1, 1)))
        else:
            phi_deg = 0

        # 动量守恒
        p_in  = BALL_MASS * (v_cb + v_ob)
        p_out = BALL_MASS * (v_cb_out + v_ob_out)
        p_err = np.linalg.norm(p_out - p_in) / (np.linalg.norm(p_in) + 1e-9)

        # 90° rule: 两球出射速度夹角
        vcb_xy = v_cb_out[:2]
        vob_xy = v_ob_out[:2]
        if np.linalg.norm(vcb_xy) > 1e-3 and np.linalg.norm(vob_xy) > 1e-3:
            cos_sep = np.dot(vcb_xy, vob_xy) / (
                np.linalg.norm(vcb_xy) * np.linalg.norm(vob_xy))
            sep_deg = np.degrees(np.arccos(np.clip(cos_sep, -1, 1)))
        else:
            sep_deg = float('nan')

        print(f"\n【{name}】")
        print(f"  cut 角 φ = {phi_deg:.1f}°")
        print(f"  v_CB  in : {np.round(v_cb, 3)}  ω = {np.round(omega_cb, 1)}")
        print(f"  v_OB  in : {np.round(v_ob, 3)}")
        print(f"  v_CB out : {np.round(v_cb_out, 3)}  ω = {np.round(w_cb_out, 1)}")
        print(f"  v_OB out : {np.round(v_ob_out, 3)}  ω = {np.round(w_ob_out, 1)}")
        print(f"  分离角   : {sep_deg:.1f}°  (stun 应 ≈ 90°)")
        print(f"  动量误差 : {p_err*100:.2f}%")

    # 测试用：让两球轻微重叠（模拟"刚碰到"的瞬间）
    OVERLAP = 0.0001   # 0.1mm 重叠，确保 delta > 0 触发碰撞
    dist_collision = 2*R - OVERLAP

    # ── 测试 1: 90° rule（定杆，full hit）─────────────────────────
    # 母球沿 +x 方向撞静止目标球，φ=0
    pos_cb = np.array([0., 0., R])
    pos_ob = np.array([dist_collision, 0., R])       # 目标球在 +x 方向
    run_case("90° rule - full hit (φ=0°)",
             pos_cb, np.array([2., 0., 0.]), np.zeros(3), pos_ob)

    # ── 测试 2: 90° rule（半球切击，φ=30°）────────────────────────
    # 目标球偏移，让球心连线和入射方向成 30°
    phi_target = 30
    pos_ob_30 = np.array([dist_collision*np.cos(np.radians(phi_target)),
                          dist_collision*np.sin(np.radians(phi_target)),
                          R])
    run_case("90° rule - half ball (φ=30°)",
             pos_cb, np.array([2., 0., 0.]), np.zeros(3), pos_ob_30)

    # ── 测试 3: 90° rule（薄切，φ=60°）───────────────────────────
    pos_ob_60 = np.array([dist_collision*np.cos(np.radians(60)),
                          dist_collision*np.sin(np.radians(60)),
                          R])
    run_case("90° rule - thin cut (φ=60°)",
             pos_cb, np.array([2., 0., 0.]), np.zeros(3), pos_ob_60)

    # ── 测试 4: 定杆（φ=0，无旋转）预期母球停止 ─────────────────
    run_case("定杆 (stun, full hit, ω=0)",
             pos_cb, np.array([2., 0., 0.]), np.zeros(3), pos_ob)

    # ── 测试 5: 跟杆（上旋，φ=0）──────────────────────────────────
    # rolling 状态：wy = vx/R = 2/0.02625 ≈ 76
    omega_roll = np.array([0., 2./R, 0.])
    run_case("跟杆 (follow, φ=0, natural roll)",
             pos_cb, np.array([2., 0., 0.]), omega_roll, pos_ob)

    # ── 测试 6: 缩杆（下旋，φ=0）──────────────────────────────────
    omega_draw = np.array([0., -2./R, 0.])   # 反向上旋 = 下旋
    run_case("缩杆 (draw, φ=0, backspin)",
             pos_cb, np.array([2., 0., 0.]), omega_draw, pos_ob)

    # ── 测试 7: 右侧旋（stun + right english）────────────────────
    omega_right = np.array([0., 0., -50.])   # wz<0 = 右旋（按 snooker_strike 约定）
    run_case("右侧旋 stun (φ=0, right english)",
             pos_cb, np.array([2., 0., 0.]), omega_right, pos_ob)

    # ── 测试 8: gearing（φ=30° + 刚好匹配的左侧旋）───────────────
    # gearing 条件: ω_z = -v * sin(φ) / R
    # φ=30°, v=2 m/s: ω_z = -2 * 0.5 / 0.02625 = -38.1 rad/s
    # 注意：snooker_strike 里右旋 ω_z<0，所以这里要正值才"向左抵消"切向滑动
    phi_g = 30
    v_g   = 2.0
    wz_gearing = v_g * np.sin(np.radians(phi_g)) / R
    omega_gear = np.array([0., 0., wz_gearing])
    run_case(f"gearing (φ={phi_g}°, ω_z={wz_gearing:.1f} 理论无 throw)",
             pos_cb, np.array([v_g, 0., 0.]), omega_gear, pos_ob_30)

    print("\n" + "=" * 70)
    print("关键观察：")
    print("  - 测试 1-3：ω=0 的 stun 击，两球分离角应接近 90°（略小因 μ>0）")
    print("  - 测试 4：定杆 φ=0，母球应几乎停止，目标球接走全部动量")
    print("  - 测试 5：跟杆，碰后母球 ω 不变 → 后续 rolling 让它继续前进")
    print("  - 测试 6：缩杆，碰后母球 ω 不变（反旋）→ 后续 rolling 让它倒退")
    print("  - 测试 7：右侧旋给目标球产生 throw（SIT）")
    print("  - 测试 8：gearing 条件下目标球几乎沿 n_hat 方向走，throw ≈ 0")