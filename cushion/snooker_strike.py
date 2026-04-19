"""
斯诺克击球物理模型
==================
输入：击球点 (a, b)、水平角 φ、俯仰角 θ、力度 F (0~1)
输出：母球初始速度向量、角速度向量、运动状态

坐标系：
  x - 台面水平，击球默认朝 +x 方向（φ=0）
  y - 台面水平，垂直于 x
  z - 垂直台面向上

击球点 (a, b)：
  a - 水平偏移（正 = 偏右 → 右侧旋）
  b - 垂直偏移（正 = 偏上 → 上旋）
  原点 = 球心正前方，单位：米
  有效范围：a² + b² ≤ R²（超出球面范围无效）
"""

import numpy as np
from dataclasses import dataclass


# ── 斯诺克标准物理常数 ──────────────────────────────────────────
BALL_MASS        = 0.1406    # 球质量 kg
BALL_RADIUS      = 0.02625   # 球半径 m（斯诺克标准 52.5mm 直径）
MAX_FORCE_N      = 0.8       # 归一化力度 1.0 对应冲量 N·s（真实斯诺克约 0.1~0.5 N·s）
MU_SLIDING       = 0.50      # 台布滑动摩擦系数
MU_ROLLING       = 0.01      # 台布滚动摩擦系数
MU_TIP           = 0.4       # 皮头摩擦系数（库仑摩擦极限系数）
G                = 9.81      # 重力加速度 m/s²

# 转动惯量 I = 2/5 * m * R²（实心均质球）
INERTIA = (2 / 5) * BALL_MASS * BALL_RADIUS ** 2


# ── 数据结构 ────────────────────────────────────────────────────
@dataclass
class StrikeInput:
    """击球输入参数"""
    a: float      # 击球点水平偏移 m，正=偏右
    b: float      # 击球点垂直偏移 m，正=偏上
    phi: float    # 水平瞄准角 度，0=朝+x，逆时针为正
    theta: float  # 俯仰角 度，0=水平击球，正=向上击（跳球）
    force: float  # 归一化力度 0.0~1.0


@dataclass
class BallState:
    """母球初始物理状态"""
    velocity:         np.ndarray  # 线速度 [vx, vy, vz] m/s
    omega:            np.ndarray  # 角速度 [ωx, ωy, ωz] rad/s（世界坐标）
    spin_type:        str         # 旋转类型描述
    motion_state:     str         # 'sliding' 或 'rolling'
    contact_velocity: np.ndarray  # 台面接触点速度（判断滑动/滚动用）
    squirt_angle:     float       # squirt 偏转角（度），呲杆时 v 偏离球杆方向
    miscue:           bool        # 是否呲杆（切向冲量超过摩擦极限）
    omega_topspin:    float       # 上/下旋分量（正=上旋，负=下旋）
    omega_sidespin:   float       # 侧旋分量（正=右旋，负=左旋）


# ── 核心计算 ────────────────────────────────────────────────────
def validate_hit_point(a: float, b: float) -> tuple[bool, float]:
    """
    验证击球点是否在球面范围内。
    返回 (是否有效, 偏心距/R)。
    是否呲杆由 MU_TIP 在 compute_strike 内部用库仑摩擦定律判断。
    """
    r_offset = np.sqrt(a**2 + b**2)
    return r_offset <= BALL_RADIUS, r_offset / BALL_RADIUS


def compute_strike(strike: StrikeInput) -> BallState:
    """
    将击球参数转换为母球初始物理状态。

    物理流程：
      Step 1  计算球杆冲量向量 J_vec
      Step 2  构建击球者视角局部坐标系（right_h, up_h）
      Step 3  计算偏心向量 r = a*right_h + b*up_h
      Step 4  计算接触点 P = -R*d + r，求法向 n_hat
      Step 5  库仑摩擦判断呲杆：
                正常  -> J_total = J_vec（全传递）
                呲杆  -> J_total = J_n + mu_tip*|J_n|*J_t_hat（截断）
      Step 6  求线速度 v = J_total/m，角速度 w = r x J_total/I
      Step 7  判断滑动/滚动初始状态
    """
    # ── 参数验证 ──────────────────────────────────────────────────
    valid, offset_ratio = validate_hit_point(strike.a, strike.b)
    if not valid:
        raise ValueError(
            f"击球点偏心距 {offset_ratio:.2f}R > R，超出球面范围，无效输入"
        )
    if not (0.0 <= strike.force <= 1.0):
        raise ValueError(f"力度须在 0.0~1.0 之间，当前值：{strike.force}")

    # ── Step 1: 球杆冲量 ─────────────────────────────────────────
    J_magnitude = strike.force * MAX_FORCE_N

    phi_rad   = np.radians(strike.phi)
    theta_rad = np.radians(strike.theta)

    cue_dir = np.array([
        np.cos(theta_rad) * np.cos(phi_rad),
        np.cos(theta_rad) * np.sin(phi_rad),
        np.sin(theta_rad),
    ])
    J_vec = J_magnitude * cue_dir

    # ── Step 2: 局部坐标系 ──────────────────────────────────────
    forward_h = np.array([np.cos(phi_rad), np.sin(phi_rad), 0.0])
    world_up  = np.array([0.0, 0.0, 1.0])

    # right_h：击球者站在球杆后方看球时的"右"方向
    # world_up x forward_h 给出正确右手方向（phi=0 时为 +y）
    right_h = np.cross(world_up, forward_h)
    right_h = right_h / np.linalg.norm(right_h)

    up_h = world_up  # 始终世界正上方，与俯仰角无关

    # ── Step 3: 偏心向量 r ──────────────────────────────────────
    r_contact = strike.a * right_h + strike.b * up_h

    # ── Step 4: 接触点法向 n ─────────────────────────────────────
    # P = -R*d_hat + r
    P_vec = -BALL_RADIUS * cue_dir + r_contact
    n_hat = P_vec / np.linalg.norm(P_vec)

    # ── Step 5: 呲杆判断（库仑摩擦定律）────────────────────────
    J_n     = np.dot(J_vec, n_hat) * n_hat
    J_t     = J_vec - J_n
    J_n_mag = np.linalg.norm(J_n)
    J_t_mag = np.linalg.norm(J_t)
    friction_limit = MU_TIP * J_n_mag

    if J_t_mag <= friction_limit or J_t_mag < 1e-9:
        J_total = J_vec.copy()
        miscue  = False
    else:
        J_f     = friction_limit * (J_t / J_t_mag)
        J_total = J_n + J_f
        miscue  = True

    # ── Step 6: 线速度与角速度 ──────────────────────────────────
    velocity = J_total / BALL_MASS
    omega    = np.cross(r_contact, J_total) / INERTIA

    # squirt 偏转角（水平面内，呲杆时才非零）
    v_h, d_h = velocity[:2], cue_dir[:2]
    v_h_mag, d_h_mag = np.linalg.norm(v_h), np.linalg.norm(d_h)
    if v_h_mag > 1e-9 and d_h_mag > 1e-9:
        cos_sq       = np.clip(np.dot(v_h / v_h_mag, d_h / d_h_mag), -1.0, 1.0)
        squirt_angle = float(np.degrees(np.arccos(cos_sq)))
    else:
        squirt_angle = 0.0

    # ── Step 7: 初始运动状态 ────────────────────────────────────
    r_ground        = np.array([0.0, 0.0, -BALL_RADIUS])
    v_contact_point = velocity + np.cross(omega, r_ground)
    slip_speed      = np.linalg.norm(v_contact_point[:2])
    # Step 7: 初始运动状态
    if velocity[2] > 0:
        motion_state = "airborne"          # vz>0：跳起
    elif velocity[2] < -1e-3 and strike.theta < 0:
        motion_state = "airborne"          # 向下击产生的真实下压速度，落地后弹起
    elif slip_speed < 1e-4:
        motion_state = "rolling"
    else:
        motion_state = "sliding"

    spin_type = _describe_spin(strike.a, strike.b)

    # ── 局部旋转分量 ─────────────────────────────────────────────
    # right_h = world_up x forward_h，phi=0 时为 +y
    # 上旋轴 = right_h（右手拇指沿 right_h，手指 +z→+x = 球顶向前 = 上旋）
    # 侧旋轴 = -z（a>0 时 r x J 给出 wz<0，取 -z 使右旋显示为正）
    topspin_axis  = right_h
    sidespin_axis = np.array([0.0, 0.0, -1.0])

    omega_topspin  = float(np.dot(omega, topspin_axis))
    omega_sidespin = float(np.dot(omega, sidespin_axis))

    return BallState(
        velocity         = velocity,
        omega            = omega,
        spin_type        = spin_type,
        motion_state     = motion_state,
        contact_velocity = v_contact_point,
        squirt_angle     = squirt_angle,
        miscue           = miscue,
        omega_topspin    = omega_topspin,
        omega_sidespin   = omega_sidespin,
    )


def _describe_spin(a: float, b: float) -> str:
    threshold = 0.1 * BALL_RADIUS
    parts = []
    if b > threshold:
        parts.append("上旋(topspin)")
    elif b < -threshold:
        parts.append("下旋(backspin/screw)")
    if abs(b) < threshold and abs(a) < threshold:
        parts.append("中杆(stun)")
    if a > threshold:
        parts.append("右侧旋(right english)")
    elif a < -threshold:
        parts.append("左侧旋(left english)")
    return " + ".join(parts) if parts else "中杆(center)"


# ── 演示 ─────────────────────────────────────────────────────────
def print_result(strike: StrikeInput, state: BallState):
    print("=" * 55)
    v = state.velocity
    w = state.omega
    print(f"  类型：{state.spin_type}")
    print(f"  v = [{v[0]:.3f}, {v[1]:.3f}, {v[2]:.3f}] m/s")
    print(f"  w = [{w[0]:.2f}, {w[1]:.2f}, {w[2]:.2f}] rad/s")
    ts, ss = state.omega_topspin, state.omega_sidespin
    print(f"  上/下旋={ts:+.2f}  侧旋={ss:+.2f}")
    print(f"  squirt={state.squirt_angle:.2f}°  呲杆={'是⚠️' if state.miscue else '否'}")
    print(f"  状态={state.motion_state}")
    print("=" * 55)


if __name__ == "__main__":
    R = BALL_RADIUS
    cases = [
        # 基础杆法
        ("中杆",               StrikeInput(a=0,       b=0,       phi=0,   theta=0,   force=0.5)),
        ("上旋（跟杆）",        StrikeInput(a=0,       b=R*0.5,   phi=0,   theta=0,   force=0.5)),
        ("下旋（缩杆）",        StrikeInput(a=0,       b=-R*0.5,  phi=0,   theta=0,   force=0.5)),
        ("右侧旋",              StrikeInput(a=R*0.5,   b=0,       phi=0,   theta=0,   force=0.5)),
        ("左侧旋",              StrikeInput(a=-R*0.5,  b=0,       phi=0,   theta=0,   force=0.5)),
        ("左侧旋+上旋",         StrikeInput(a=-R*0.4,  b=R*0.4,   phi=0,   theta=0,   force=0.6)),
        ("右侧旋+下旋",         StrikeInput(a=R*0.4,   b=-R*0.4,  phi=0,   theta=0,   force=0.6)),
        # 自然滚动点
        ("自然滚动点 rolling",  StrikeInput(a=0,       b=R*0.4,   phi=0,   theta=0,   force=0.5)),
        # 斜向
        ("45°+下旋",           StrikeInput(a=0,       b=-R*0.5,  phi=45,  theta=0,   force=0.8)),
        ("45°+右侧旋",         StrikeInput(a=R*0.5,   b=0,       phi=45,  theta=0,   force=0.5)),
        ("135°+上旋",          StrikeInput(a=0,       b=R*0.5,   phi=135, theta=0,   force=0.5)),
        # 跳球（向上击）
        ("跳球 theta=+10",     StrikeInput(a=0,       b=0,       phi=0,   theta=10,  force=0.7)),
        ("跳球 theta=+20",     StrikeInput(a=0,       b=0,       phi=0,   theta=20,  force=0.7)),
        ("跳球+右侧旋",         StrikeInput(a=R*0.3,   b=0,       phi=0,   theta=15,  force=0.7)),
        # 向下击
        ("向下轻击不跳 t=-10",  StrikeInput(a=0,       b=0,       phi=0,   theta=-10, force=0.3)),
        ("向下重击弹起 t=-45",  StrikeInput(a=0,       b=0,       phi=0,   theta=-45, force=0.7)),
        ("低杆铲球 t=-15",     StrikeInput(a=0,       b=-R*0.5,  phi=0,   theta=-15, force=0.8)),
        ("低杆呲杆 t=-15",     StrikeInput(a=0,       b=-R*0.6,  phi=0,   theta=-15, force=0.8)),
        # 扎杆/masse
        ("扎杆 t=-20 右上",    StrikeInput(a=R*0.4,   b=R*0.2,   phi=0,   theta=-60, force=0.2)),
        ("扎杆 t=-60 右上",    StrikeInput(a=R*0.4,   b=R*0.2,   phi=0,   theta=-60, force=0.4)),
        ("masse t=-80 右上",   StrikeInput(a=R*0.4,   b=R*0.3,   phi=0,   theta=-80, force=0.4)),
        # 呲杆
        ("呲杆（大偏心）",      StrikeInput(a=R*0.8,   b=0,       phi=0,   theta=0,   force=0.8)),
        ("呲杆+大力",          StrikeInput(a=R*0.75,  b=R*0.3,   phi=0,   theta=0,   force=0.9)),
        ("极限偏心",           StrikeInput(a=R*0.7,   b=R*0.7,   phi=0,   theta=0,   force=0.5)),
        ("极限偏心",           StrikeInput(a=R*0,   b=0.022,   phi=0,   theta=0,   force=1)),
        ("极限偏心",           StrikeInput(a=R*0,   b=-0.022,   phi=0,   theta=0,   force=1)),
    ]
    for name, strike in cases:
        print(f"\n【{name}】")
        print(f"输入参数: a={strike.a:.3f}m, b={strike.b:.3f}m, "
              f"phi={strike.phi:.1f}°, theta={strike.theta:.1f}°, force={strike.force:.2f}")
        try:
            print_result(strike, compute_strike(strike))
        except ValueError as e:
            print(f"  错误：{e}")