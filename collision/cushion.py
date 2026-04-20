"""
斯诺克库边碰撞模块
==================
物理模型：瞬时冲量法（法向）+ 库仑摩擦（切向）

法向：Jn = -(1+e)*m*vn，e=0.80
切向：粘滞/滑动判断，考虑旋转对接触点速度的影响

坐标系（台面中心为原点）：
  x - 台面水平，击球默认朝 +x 方向
  y - 台面水平，垂直于 x
  z - 垂直台面向上

台面尺寸（标准斯诺克）：
  x: -1.7845 ~ +1.7845 m
  y: -0.889  ~ +0.889  m
"""

import numpy as np
from dataclasses import dataclass

# ── 台面尺寸 ──────────────────────────────────────────────────────
TABLE_X_MAX =  1.7845
TABLE_X_MIN = -1.7845
TABLE_Y_MAX =  0.889
TABLE_Y_MIN = -0.889

# ── 物理常数 ──────────────────────────────────────────────────────
BALL_RADIUS = 0.02625
BALL_MASS   = 0.1406
INERTIA     = 2 / 5 * BALL_MASS * BALL_RADIUS ** 2

# ── 库边参数 ──────────────────────────────────────────────────────
E_RESTITUTION = 0.80   # 恢复系数
MU_CUSHION    = 0.40   # 库边摩擦系数

# 切向冲量分母：1/m + R²/I = 7/(2m)
# 推导：粘滞时让接触点切向速度归零所需冲量
CUSHION_DENOM = 7.0 / (2 * BALL_MASS)


# ── 库边定义 ──────────────────────────────────────────────────────
@dataclass
class Cushion:
    name:     str
    axis:     int     # 0=x轴，1=y轴
    position: float
    inward:   float   # 法向朝台内：+1 或 -1

    @property
    def n_hat(self) -> np.ndarray:
        n = np.zeros(3)
        n[self.axis] = self.inward
        return n

    @property
    def t_hat(self) -> np.ndarray:
        t = np.zeros(3)
        t[1 - self.axis] = 1.0
        return t


CUSHIONS = [
    Cushion('right',  1,  TABLE_Y_MAX, -1),
    Cushion('left',   1,  TABLE_Y_MIN, +1),
    Cushion('top',    0,  TABLE_X_MAX, -1),
    Cushion('bottom', 0,  TABLE_X_MIN, +1),
]


# ── 接触状态 ──────────────────────────────────────────────────────
@dataclass
class CushionContactState:
    in_contact:       bool  = False
    already_resolved: bool  = False   # 本次碰撞是否已施加冲量


def init_cushion_states() -> dict:
    return {c.name: CushionContactState() for c in CUSHIONS}


# ── 核心：瞬时冲量碰库 ────────────────────────────────────────────
def compute_cushion_impulse(
    pos:     np.ndarray,
    v:       np.ndarray,
    omega:   np.ndarray,
    cushion: Cushion,
    state:   CushionContactState,
) -> tuple[np.ndarray, np.ndarray, CushionContactState]:
    """
    检测碰库并施加瞬时冲量。

    物理流程：
      ① 检测是否接触（delta > 0）
      ② 检测是否是新碰撞（从无接触变为有接触，且朝库边运动）
      ③ 计算接触点速度（含旋转贡献）
      ④ 法向冲量：Jn = -(1+e)*m*vn
      ⑤ 切向冲量：库仑摩擦判断粘滞/滑动
      ⑥ 更新 v 和 omega

    返回：(v_new, omega_new, updated_state)
    """
    n_hat = cushion.n_hat
    t_hat = cushion.t_hat
    z_hat = np.array([0., 0., 1.])

    # ── ① 检测接触 ────────────────────────────────────────────────
    dist  = abs(pos[cushion.axis] - cushion.position)
    delta = BALL_RADIUS - dist

    if delta <= 0:
        # 没有接触，重置状态
        state.in_contact       = False
        state.already_resolved = False
        return v.copy(), omega.copy(), state

    # ── ② 判断是否需要施加冲量 ────────────────────────────────────
    vn = np.dot(v, n_hat)   # 法向速度，朝台内为正

    # 检测是否为新碰撞：从无接触变为有接触
    is_new_contact = not state.in_contact
    state.in_contact = True

    # 如果球法向速度不足以引起碰撞（即沿库边运动），忽略
    # 这避免了"贴着库边沿方向打球"被误识别为碰库的问题
    COLLISION_THRESHOLD = 0.01  # m/s，只有超过此值的朝库边速度才算碰撞
    if vn > -COLLISION_THRESHOLD:
        state.already_resolved = False
        return v.copy(), omega.copy(), state

    # 如果是新接触或已从库边弹出但还未重置，施加冲量（只施加一次）
    # 逻辑：新接触时 already_resolved=False，施加后变True
    #     旧接触时 already_resolved=True，不施加
    #     离开时（vn>=0）重置 already_resolved=False，准备下次接触
    
    if state.already_resolved:
        # 这次碰撞已经施加过冲量了，不重复施加
        return v.copy(), omega.copy(), state

    # 到这里：vn < 0 且 already_resolved=False，施加冲量
    state.already_resolved = True

    # ── ③ 接触点速度 ──────────────────────────────────────────────
    # ★ 库边只处理 2D 摩擦（x-y 平面），不处理 z 方向 ★
    r_c       = BALL_RADIUS * (-n_hat)   # 球心→接触点
    v_contact = v + np.cross(omega, r_c)

    vc_t  = np.dot(v_contact, t_hat)  # 切向速度

    v_slip = abs(vc_t)  # 只考虑切向滑动速度

    # ── ④ 法向冲量 ────────────────────────────────────────────────
    Jn = -(1 + E_RESTITUTION) * BALL_MASS * vn   # >0，朝台内

    # ── ⑤ 切向冲量（库仑摩擦）────────────────────────────────────
    # ★ 只处理 2D 摩擦 ★
    F_limit = MU_CUSHION * abs(Jn)

    if v_slip < 1e-9:
        Jt = 0.0
    else:
        # 粘滞：让接触点切向速度归零
        Jt_stick = -vc_t / CUSHION_DENOM
        J_stick  = abs(Jt_stick)

        if J_stick <= F_limit:
            Jt = Jt_stick
        else:
            # 滑动：截断到库仑极限（用接触点速度 vc_t）
            Jt = -F_limit * vc_t / v_slip

    # ── ⑥ 更新速度和角速度 ────────────────────────────────────────
    # ★ 只包含法向和切向冲量（2D 摩擦）★
    J_total   = Jn * n_hat + Jt * t_hat
    v_new     = v     + J_total / BALL_MASS
    omega_new = omega + np.cross(r_c, J_total) / INERTIA

    return v_new, omega_new, state


# ── 演示 ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("库边碰撞测试（瞬时冲量法）")
    print("=" * 50)

    n_hat = np.array([0., -1., 0.])   # 右库
    t_hat = np.array([1.,  0., 0.])
    cushion = CUSHIONS[0]  # right

    cases = [
        ("中杆平击", np.array([0., 2.0, 0.]), np.zeros(3)),
        ("上旋碰库", np.array([0., 2.0, 0.]), np.array([100., 0., 0.])),
        ("下旋碰库", np.array([0., 2.0, 0.]), np.array([-100., 0., 0.])),
        ("右侧旋",   np.array([0., 2.0, 0.]), np.array([0., 0., -50.])),
        ("左侧旋",   np.array([0., 2.0, 0.]), np.array([0., 0.,  50.])),
        ("斜角入射", np.array([1., 2.0, 0.]), np.zeros(3)),
    ]

    pos = np.array([0., TABLE_Y_MAX - BALL_RADIUS + 0.001, BALL_RADIUS])
    for name, v_in, omega_in in cases:
        state = CushionContactState()
        v_out, omega_out, state = compute_cushion_impulse(
            pos, v_in, omega_in, cushion, state)
        vn_in  = np.dot(v_in,  n_hat)
        vn_out = np.dot(v_out, n_hat)
        e = abs(vn_out / vn_in) if abs(vn_in) > 1e-9 else 0
        print(f"【{name}】")
        print(f"  v_in ={v_in}  omega_in ={omega_in}")
        print(f"  v_out={np.round(v_out,4)}  vz={v_out[2]:.4f}  e={e:.3f}")
        print()