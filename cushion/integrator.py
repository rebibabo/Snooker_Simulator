"""
斯诺克母球物理积分器（含库边碰撞）
====================================
集成：
  - 台面运动（sliding / rolling）
  - 空中飞行（airborne）
  - 库边碰撞（Hertz + Hunt-Crossley + Mindlin）

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
from typing import List
import sys, os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from snooker_strike import (
    BallState, StrikeInput, compute_strike,
    BALL_MASS, BALL_RADIUS, INERTIA,
    MU_SLIDING, G,
)
from cushion import (
    CUSHIONS, TABLE_X_MAX, TABLE_X_MIN, TABLE_Y_MAX, TABLE_Y_MIN,
    CushionContactState, init_cushion_states,
    compute_cushion_impulse,
)

# ── 台面参数 ──────────────────────────────────────────────────────
MU_ROLLING    = 0.015
MU_SLIDING    = 0.20      # 台面滑动摩擦系数
OUT_MARGIN    = 0.15

# ── 积分器参数 ────────────────────────────────────────────────────
DT            = 1 / 240
MAX_TIME      = 30.0
V_STOP        = 1e-4
W_STOP        = 1e-2
E_FLOOR       = 0.5
VZ_MIN_BOUNCE = 0.08    # 提高到 G*dt*2 左右，避免"微弹"（约 0.081 m/s）
VZ_ESCAPE     = 0.5      # 碰库后vz高于此值才起跳


def apply_cushion_impulses(
    pos: np.ndarray, v: np.ndarray, omega: np.ndarray,
    cushion_states: dict,
) -> tuple[np.ndarray, np.ndarray, bool]:
    """
    对所有库边施加瞬时冲量，返回 (v, omega, any_contact)。
    每次新碰撞只施加一次冲量。（简化：单循环处理）
    """
    any_contact = False
    for cushion in CUSHIONS:
        dist  = abs(pos[cushion.axis] - cushion.position)
        delta = BALL_RADIUS - dist
        
        if delta <= 0:
            # 脱离接触，重置状态
            cushion_states[cushion.name].in_contact = False
            cushion_states[cushion.name].already_resolved = False
        else:
            # 有接触：施加冲量
            any_contact = True
            cs = cushion_states[cushion.name]
            v_before = v.copy()
            v, omega, cs = compute_cushion_impulse(pos, v, omega, cushion, cs)
            cushion_states[cushion.name] = cs
            
            # 如果冲量真的施加了，把球推出接触区域
            if not np.allclose(v, v_before):
                pos[cushion.axis] += cushion.inward * (delta + 1e-4)

    return v, omega, any_contact


# ── 台面物理辅助 ──────────────────────────────────────────────────
def contact_velocity(v: np.ndarray, omega: np.ndarray) -> np.ndarray:
    return v + np.cross(omega, np.array([0., 0., -BALL_RADIUS]))


def sliding_accel(v: np.ndarray, omega: np.ndarray):
    vc       = contact_velocity(v, omega)
    slip_xy  = vc[:2]
    slip_spd = np.linalg.norm(slip_xy)
    if slip_spd < 1e-9:
        return np.zeros(3), np.zeros(3)
    slip_hat = np.array([slip_xy[0], slip_xy[1], 0.]) / slip_spd
    a_lin    = -MU_SLIDING * G * slip_hat
    r_g      = np.array([0., 0., -BALL_RADIUS])
    a_ang    = np.cross(r_g, BALL_MASS * a_lin) / INERTIA
    return a_lin, a_ang


def wz_rolling_decay(wz: float, dt: float) -> float:
    """z轴角速度的滚动摩擦衰减"""
    alpha = MU_ROLLING * BALL_MASS * G * BALL_RADIUS / INERTIA
    decay = alpha * dt
    return 0.0 if abs(wz) <= decay else wz - np.sign(wz) * decay


def update_state(state: str, v: np.ndarray, omega: np.ndarray, hit_cushion: bool = False) -> str:
    """统一的状态转移逻辑"""
    # 碰库弹起判定
    if hit_cushion and v[2] > VZ_ESCAPE:
        return 'airborne'
    
    # sliding → rolling 判定
    if state == 'sliding':
        vc = contact_velocity(v, omega)[:2]
        if np.linalg.norm(vc) < 0.05:
            return 'rolling'
    
    # 跳跃判定
    if state != 'airborne' and v[2] > 0:
        v_xy = np.linalg.norm(v[:2])
        if v_xy < 1e-9 or v[2] > 0.2 * v_xy:
            return 'airborne'
    
    return state


def apply_rolling_constraint(v: np.ndarray, omega: np.ndarray) -> np.ndarray:
    """纯滚动约束：接触点速度为零"""
    omega_new    = omega.copy()
    omega_new[1] =  v[0] / BALL_RADIUS
    omega_new[0] = -v[1] / BALL_RADIUS
    return omega_new


# ── 数据结构 ──────────────────────────────────────────────────────
@dataclass
class Frame:
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
    state: str


@dataclass
class IntegratorResult:
    frames:     List[Frame]
    final_pos:  np.ndarray
    total_time: float
    total_dist: float
    events:     List[dict]
    out_of_bounds: bool


# ── 主积分函数 ────────────────────────────────────────────────────
def integrate(
    initial_state: BallState,
    initial_pos:   np.ndarray = None,
    dt:            float = DT,
) -> IntegratorResult:

    if initial_pos is None:
        initial_pos = np.array([0., 0.])

    pos   = np.array([initial_pos[0], initial_pos[1], BALL_RADIUS], dtype=float)
    v     = initial_state.velocity.copy().astype(float)
    omega = initial_state.omega.copy().astype(float)
    state = initial_state.motion_state

    cushion_states = init_cushion_states()

    frames         = []
    events         = []
    t              = 0.0
    dist           = 0.0
    prev_pos       = pos[:2].copy()
    out_of_bounds  = False
    frame_count    = 0

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
        # 检查是否与任何库边接触
        any_cushion_contact = any(cs.in_contact for cs in cushion_states.values())
        if any_cushion_contact or frame_count % 10 == 0:
            v_spd = np.linalg.norm(v[:2])
            marker = ' *** 碰库中 ***' if any_cushion_contact else ''
            print(f"[{frame_count:4d}] t={t:.4f}s  pos=[{pos[0]:7.4f},{pos[1]:7.4f},{pos[2]:6.4f}]  "
                  f"v=[{v[0]:7.3f},{v[1]:7.3f},{v[2]:6.3f}] (|v|={v_spd:.3f})  "
                  f"ω=[{omega[0]:7.2f},{omega[1]:7.2f},{omega[2]:7.2f}]  state={state}{marker}")

    record()

    while t < MAX_TIME:
        t    += dt
        if state != 'airborne':
            dist += np.linalg.norm(pos[:2] - prev_pos)
        prev_pos = pos[:2].copy()

        # ── 飞出台面检测 ──────────────────────────────────────────
        if (pos[0] > TABLE_X_MAX + OUT_MARGIN or
                pos[0] < TABLE_X_MIN - OUT_MARGIN or
                pos[1] > TABLE_Y_MAX + OUT_MARGIN or
                pos[1] < TABLE_Y_MIN - OUT_MARGIN):
            events.append({'t': t, 'type': 'out_of_bounds', 'pos': pos[:2].copy()})
            out_of_bounds = True
            record()
            break

        # ── 空中状态 ──────────────────────────────────────────────
        if state == 'airborne':
            # 修复 2: 调整积分顺序
            # Step 1: 先更新速度（重力在前）
            v[2] -= G * dt
            
            # Step 2: 再更新位置
            pos += v * dt

            # Step 3: 库边冲量（空中也可能碰库）
            v, omega, hit_cushion = apply_cushion_impulses(pos, v, omega, cushion_states)

            # Step 4: 落台检测（注意：此时重力已经施加，落地后不会再被"二次重力污染"）
            if pos[2] <= BALL_RADIUS and v[2] <= 0:
                pos[2]   = BALL_RADIUS
                vz_after = -E_FLOOR * v[2]
                gravity_accumulated = G * dt  # 一帧重力积累量
                
                # 修复 3: 微弹过滤 - 只有明显的下落速度才弹起，否则停止
                # 条件：弹起后速度>阈值 AND 下落速度明显大于一帧重力积累
                if vz_after > VZ_MIN_BOUNCE and abs(v[2]) > gravity_accumulated * 2:
                    v[2]  = vz_after
                    state = 'airborne'
                    events.append({'t': t, 'type': 'land(bounce)', 'pos': pos[:2].copy()})
                else:
                    v[2]  = 0.0
                    vc    = contact_velocity(v, omega)
                    state = 'sliding' if np.linalg.norm(vc[:2]) > 0.05 else 'rolling'
                    events.append({'t': t, 'type': f'land→{state}', 'pos': pos[:2].copy()})

            record()
            continue

        # ── 台面状态（sliding / rolling）─────────────────────────
        pos[2] = BALL_RADIUS
        v, omega, hit_cushion = apply_cushion_impulses(pos, v, omega, cushion_states)
        
        # Z轴速度约束
        if hit_cushion:
            v[2] = 0.0
        elif v[2] > 0:
            v_xy = np.linalg.norm(v[:2])
            if v_xy > 1e-9 and v[2] <= 0.2 * v_xy:
                v[2] = 0.0
        else:
            v[2] = 0.0
        
        # 台面摩擦
        old_state = state
        if state == 'sliding':
            a_lin, a_ang = sliding_accel(v, omega)
            v_new        = v     + a_lin * dt
            omega_new    = omega + a_ang * dt
            
            vc_old = contact_velocity(v,     omega)[:2]
            vc_new = contact_velocity(v_new, omega_new)[:2]
            
            if np.linalg.norm(vc_old) > 1e-9 and np.dot(vc_old, vc_new) < 0:
                state = 'rolling'
                omega = apply_rolling_constraint(v, omega)
                events.append({'t': t, 'type': 'rolling', 'pos': pos[:2].copy()})
            else:
                v, omega = v_new, omega_new
        
        elif state == 'rolling':
            # 内联 rolling_accel：-MU_ROLLING*G*v_xy / spd
            spd = np.linalg.norm(v[:2])
            if spd > V_STOP:
                a_lin = -MU_ROLLING * G * np.array([v[0], v[1], 0.]) / spd
                v += a_lin * dt
            v[2] = 0.0
            omega[2] = wz_rolling_decay(omega[2], dt)
            omega = apply_rolling_constraint(v, omega)
        
        # 使用状态机更新状态
        new_state = update_state(state, v, omega, hit_cushion)
        if new_state != old_state:
            if new_state == 'airborne':
                event_type = 'cushion_jump' if hit_cushion else 'jump'
                events.append({'t': t, 'type': event_type, 'pos': pos[:2].copy()})
            state = new_state

        # 位置更新
        pos[0] += v[0] * dt
        pos[1] += v[1] * dt

        # 停止检测
        v_spd = np.linalg.norm(v[:2])
        w_spd = np.linalg.norm(omega)
        if ((v_spd < V_STOP and w_spd < W_STOP) or
                (state == 'rolling' and v_spd < 5 * V_STOP)):
            v[:]     = 0.
            omega[:] = 0.
            events.append({'t': t, 'type': 'stop', 'pos': pos[:2].copy()})
            record()
            break

        record()

    return IntegratorResult(
        frames        = frames,
        final_pos     = pos[:2].copy(),
        total_time    = t,
        total_dist    = dist,
        events        = events,
        out_of_bounds = out_of_bounds,
    )


# ── 打印工具 ──────────────────────────────────────────────────────
def print_summary(result: IntegratorResult, step: int = 60):
    oob = '  ⚠️ 飞出台面！' if result.out_of_bounds else ''
    print(f"\n{'='*90}")
    print(f"  总时间：{result.total_time:.3f}s  "
          f"总路程：{result.total_dist:.3f}m  "
          f"最终位置：[{result.final_pos[0]:.4f}, {result.final_pos[1]:.4f}]{oob}")
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
        ("中杆平击碰上库",
         np.array([0., 0.]),
         StrikeInput(a=0, b=0, phi=0, theta=0, force=0.6)),
        ("上旋碰上库",
         np.array([0., 0.]),
         StrikeInput(a=0, b=R*0.5, phi=0, theta=0, force=0.6)),
        ("右侧旋碰右库",
         np.array([0., 0.]),
         StrikeInput(a=R*0.5, b=0, phi=90, theta=0, force=0.5)),
        ("低杆碰右库（预期跳起）",
         np.array([0., 0.]),
         StrikeInput(a=0, b=-R*0.5, phi=90, theta=0, force=0.6)),
        ("跳球碰上库",
         np.array([0., 0.]),
         StrikeInput(a=0, b=0, phi=0, theta=15, force=0.7)),
        ("中杆45°斜击",
         np.array([0., 0.]),
         StrikeInput(a=0, b=0, phi=45, theta=0, force=0.6)),
    ]

    for name, init_pos, strike in cases:
        print(f"\n{'━'*90}")
        print(f"  【{name}】")
        state  = compute_strike(strike)
        result = integrate(state, initial_pos=init_pos)
        print_summary(result, step=120)