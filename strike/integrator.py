"""
斯诺克母球物理积分器
====================
输入：BallState（来自 snooker_strike.py）
输出：完整运动轨迹，每帧包含：
      x, y, z, vx, vy, vz, wx, wy, wz, state

状态：
  sliding  - 台面滑动（接触点有相对滑动）
  rolling  - 台面纯滚（接触点速度为零）
  airborne - 空中飞行

本文件只处理母球单独运动，不含库边反弹和球球碰撞。
"""

import numpy as np
from dataclasses import dataclass
from typing import List
import sys, os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from snooker_strike import (
    BallState, StrikeInput, compute_strike,
    BALL_MASS, BALL_RADIUS, INERTIA,
    MU_SLIDING, G,
)
MU_ROLLING = 0.015   # 覆盖 strike 模型的值，积分器使用更真实的参数


# ── 积分器参数 ────────────────────────────────────────────────────
DT            = 1 / 240      # 时间步长 s（240Hz）
MAX_TIME      = 30.0         # 最大模拟时间 s
V_STOP        = 1e-4         # 停止速度阈值 m/s
W_STOP        = 1e-2         # 停止角速度阈值 rad/s（rolling时omega≈v/R，跟随v即可）

E_FLOOR       = 0.5          # 落地弹性系数

GROUND_TOLERANCE = 0.001    # 接触容差 m，允许球稍微穿地以避免数值问题
VZ_MIN_BOUNCE = 0.08        # 提高到 G*dt*2 左右，避免"微弹"（约 0.081 m/s）


# ── 数据结构 ──────────────────────────────────────────────────────
@dataclass
class Frame:
    """一帧的完整物理状态"""
    t:     float
    x:     float
    y:     float
    z:     float
    vx:    float
    vy:    float
    vz:    float
    wx:    float
    wy:    float
    wz:    float
    state: str    # 'sliding' / 'rolling' / 'airborne'


@dataclass
class IntegratorResult:
    frames:     List[Frame]
    final_pos:  np.ndarray   # [x, y]
    total_time: float
    total_dist: float
    events:     List[dict]


# ── 物理辅助函数 ──────────────────────────────────────────────────
def contact_velocity(v: np.ndarray, omega: np.ndarray) -> np.ndarray:
    """台面接触点速度 = v + omega × r_ground，r_ground = [0,0,-R]"""
    r_g = np.array([0., 0., -BALL_RADIUS])
    return v + np.cross(omega, r_g)


def sliding_accel(v: np.ndarray, omega: np.ndarray):
    """
    sliding 阶段加速度和角加速度

    摩擦力方向反对接触点滑动方向：
      a_lin  = -mu_s * g * v_slip_hat
      a_ang  = r_ground × (m * a_lin) / I
             = [0,0,-R] × (m * a_lin) / I
    """
    vc        = contact_velocity(v, omega)
    slip_xy   = vc[:2]
    slip_spd  = np.linalg.norm(slip_xy)

    if slip_spd < 1e-9:
        return np.zeros(3), np.zeros(3), 0.0

    slip_hat = np.array([slip_xy[0], slip_xy[1], 0.]) / slip_spd

    # 线加速度
    a_lin = -MU_SLIDING * G * slip_hat

    # 角加速度：r_ground × f / I
    # r_ground = [0,0,-R]，f = m*a_lin = [fx,fy,0]
    # cross = [(-R)*fy - 0, 0 - (-R)*fx, 0] = [-R*fy, R*fx, 0]... 
    # 用 numpy 直接算
    r_g   = np.array([0., 0., -BALL_RADIUS])
    f_fric = BALL_MASS * a_lin
    a_ang  = np.cross(r_g, f_fric) / INERTIA

    return a_lin, a_ang, slip_spd


def rolling_accel(v: np.ndarray) -> np.ndarray:
    """
    rolling 阶段线加速度（滚动阻力）
    a = -mu_r * g * v_hat
    """
    spd = np.linalg.norm(v[:2])
    if spd < V_STOP:
        return np.zeros(3)
    return -MU_ROLLING * G * np.array([v[0], v[1], 0.]) / spd


def apply_rolling_constraint(v: np.ndarray, omega: np.ndarray) -> np.ndarray:
    """
    强制纯滚动约束：omega 跟随 v
    纯滚条件：v_contact = 0
    => v + omega × [0,0,-R] = 0
    => vx = R*wy,  vy = -R*wx
    => wy = vx/R,  wx = -vy/R
    wz 不受台面法向约束，单独衰减
    """
    omega_new    = omega.copy()
    omega_new[1] =  v[0] / BALL_RADIUS
    omega_new[0] = -v[1] / BALL_RADIUS
    return omega_new


def wz_rolling_decay(wz: float, dt: float) -> float:
    """
    rolling 时 wz（侧旋）的衰减
    力矩 = mu_r * m * g * R，方向反对 wz
    alpha_z = mu_r * m * g * R / I
    """
    alpha = MU_ROLLING * BALL_MASS * G * BALL_RADIUS / INERTIA
    decay = alpha * dt
    if abs(wz) <= decay:
        return 0.0
    return wz - np.sign(wz) * decay


# ── 主积分函数 ────────────────────────────────────────────────────
def integrate(
    initial_state: BallState,
    initial_pos:   np.ndarray = None,
    dt:            float = DT,
) -> IntegratorResult:

    if initial_pos is None:
        initial_pos = np.array([0., 0.])

    # 初始化
    pos   = np.array([initial_pos[0], initial_pos[1], BALL_RADIUS], dtype=float)
    v     = initial_state.velocity.copy().astype(float)
    omega = initial_state.omega.copy().astype(float)

    # 初始状态：直接从 strike 的判断开始
    # 不清零 vz，让后续台面约束逻辑统一处理
    state = initial_state.motion_state

    frames   = []
    events   = []
    t        = 0.0
    dist     = 0.0
    prev_pos = pos[:2].copy()
    frame_count = 0  # 调试计数器

    def record():
        nonlocal frame_count
        frames.append(Frame(
            t=round(t, 6),
            x=pos[0], y=pos[1], z=pos[2],
            vx=v[0],  vy=v[1],  vz=v[2],
            wx=omega[0], wy=omega[1], wz=omega[2],
            state=state,
        ))
        frame_count += 1
        # 每 10 frame 打印一次
        if frame_count % 10 == 0:
            v_spd = np.linalg.norm(v[:2])
            print(f"[{frame_count:4d}] t={t:.4f}s  pos=[{pos[0]:7.4f},{pos[1]:7.4f},{pos[2]:6.4f}]  "
                  f"v=[{v[0]:7.3f},{v[1]:7.3f},{v[2]:6.3f}] (|v|={v_spd:.3f})  "
                  f"ω=[{omega[0]:7.2f},{omega[1]:7.2f},{omega[2]:7.2f}]  state={state}")

    record()

    while t < MAX_TIME:
        t    += dt
        dist += np.linalg.norm(pos[:2] - prev_pos)
        prev_pos = pos[:2].copy()

        # ── 空中 ────────────────────────────────────────────────
        if state == 'airborne':
            # 修复 2: 调整积分顺序 - 先更新速度，再更新位置
            v[2]  -= G * dt
            pos   += v * dt

            # 检查是否接触地面或非常接近（容差 1mm）
            if pos[2] <= BALL_RADIUS + GROUND_TOLERANCE and v[2] <= 0:
                pos[2] = BALL_RADIUS
                vz_before = v[2]
                vz_after  = -E_FLOOR * vz_before   # 弹性反弹
                gravity_accumulated = G * dt  # 一帧重力积累量
                
                # 修复 3: 微弹过滤 - 只有明显的下落速度才弹起，否则停止
                # 条件：弹起速度>阈值 AND 下落速度明显大于一帧重力积累
                if vz_after > VZ_MIN_BOUNCE and abs(vz_before) > gravity_accumulated * 2:
                    v[2]  = vz_after   # 继续弹跳
                    state = 'airborne' # 保持空中
                    events.append({'t': t, 'type': 'land(bounce)', 'pos': pos[:2].copy()})
                else:
                    v[2]   = 0.0       # 落定
                    pos[2] = BALL_RADIUS
                    vc    = contact_velocity(v, omega)
                    slip  = np.linalg.norm(vc[:2])
                    state = 'sliding' if slip > 0.001 else 'rolling'
                    events.append({'t': t, 'type': 'land→{}'.format(state), 'pos': pos[:2].copy()})

            record()
            continue

        # ── 台面运动 ────────────────────────────────────────────
        pos[2] = BALL_RADIUS

        # ===== 台面法向约束（核心物理）=====
        if v[2] > 0:
            v_xy = np.linalg.norm(v[:2])
            VZ_ESCAPE_THRESH = 0.2 * v_xy  # 0.1~0.3 adjustable
            if v[2] > VZ_ESCAPE_THRESH:
                state = 'airborne'
                continue
            else:
                v[2] = 0.0
        elif v[2] < 0:
            v[2] = 0.0

        if state == 'sliding':
            a_lin, a_ang, slip_spd = sliding_accel(v, omega)

            # 防止过冲：如果加速度会让速度反向，直接切换
            v_new     = v + a_lin * dt
            omega_new = omega + a_ang * dt

            # 检查新的接触点速度是否穿越零点（反号 = 过冲）
            vc_old = contact_velocity(v,     omega)[:2]
            vc_new = contact_velocity(v_new, omega_new)[:2]

            if np.linalg.norm(vc_old) > 1e-9 and np.dot(vc_old, vc_new) < 0:
                # 止文方向一斸反向，理即切换为rolling
                state = 'rolling'
                omega = apply_rolling_constraint(v, omega)
                events.append({'t': t, 'type': 'rolling', 'pos': pos[:2].copy()})
            else:
                v     = v_new
                omega = omega_new

        elif state == 'rolling':
            a_lin    = rolling_accel(v)
            v       += a_lin * dt
            v[2]     = 0.0                               # 台面约束
            omega[2] = wz_rolling_decay(omega[2], dt)   # 先衰减 wz
            omega    = apply_rolling_constraint(v, omega)  # 再约束 wx/wy

        # 更新位置（只用水平分量）
        pos[0] += v[0] * dt
        pos[1] += v[1] * dt

        # ── 停止检测 ────────────────────────────────────────────
        v_spd = np.linalg.norm(v[:2])
        w_spd = np.linalg.norm(omega)
        # rolling 时 omega = v/R，只需检查 v_spd
        # 同时捕捉极小振荡：v < 5*V_STOP 且 w < W_STOP
        should_stop = (
            (v_spd < V_STOP and w_spd < W_STOP) or
            (state == 'rolling' and v_spd < 5 * V_STOP)
        )
        if should_stop:
            v[:]     = 0.
            omega[:] = 0.
            events.append({'t': t, 'type': 'stop', 'pos': pos[:2].copy()})
            record()
            break

        record()

    return IntegratorResult(
        frames     = frames,
        final_pos  = pos[:2].copy(),
        total_time = t,
        total_dist = dist,
        events     = events,
    )


# ── 打印工具 ──────────────────────────────────────────────────────
def print_summary(result: IntegratorResult, step: int = 60):
    print(f"\n{'='*90}")
    print(f"  总时间：{result.total_time:.3f}s  "
          f"总路程：{result.total_dist:.3f}m  "
          f"最终位置：[{result.final_pos[0]:.4f}, {result.final_pos[1]:.4f}]")
    print(f"  事件：" + "  |  ".join(
        f"t={e['t']:.3f}s {e['type']} [{e['pos'][0]:.3f},{e['pos'][1]:.3f}]"
        for e in result.events))
    print(f"{'='*90}")
    print(f"  {'t':>7}  {'x':>8}  {'y':>8}  {'z':>6}  "
          f"{'vx':>7}  {'vy':>7}  {'vz':>6}  "
          f"{'wx':>8}  {'wy':>8}  {'wz':>8}  state")
    print(f"  {'-'*90}")
    for i, f in enumerate(result.frames):
        if i % step == 0 or i == len(result.frames) - 1:
            print(f"  {f.t:>7.3f}  {f.x:>8.4f}  {f.y:>8.4f}  {f.z:>6.4f}  "
                  f"{f.vx:>7.3f}  {f.vy:>7.3f}  {f.vz:>6.3f}  "
                  f"{f.wx:>8.1f}  {f.wy:>8.1f}  {f.wz:>8.1f}  {f.state}")
    print(f"{'='*90}")


# ── 演示 ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    R = BALL_RADIUS

    cases = [
        ("中杆平击",
         StrikeInput(a=0,      b=0,       phi=0, theta=0,   force=0.5)),
        ("上旋（跟杆）",
         StrikeInput(a=0,      b=R*0.5,   phi=0, theta=0,   force=0.5)),
        ("下旋（缩杆）",
         StrikeInput(a=0,      b=-R*0.5,  phi=0, theta=0,   force=0.5)),
        ("右侧旋",
         StrikeInput(a=R*0.5,  b=0,       phi=0, theta=0,   force=0.5)),
        ("跳球 theta=+15",
         StrikeInput(a=0,      b=0,       phi=0, theta=15,  force=0.7)),
        ("masse t=-80",
         StrikeInput(a=R*0.4,  b=R*0.3,   phi=0, theta=-80, force=0.4)),
    ]

    for name, strike in cases:
        print(f"\n\n{'━'*90}")
        print(f"  【{name}】")
        state  = compute_strike(strike)
        result = integrate(state)
        print_summary(result, step=60)