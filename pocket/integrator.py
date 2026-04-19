"""
斯诺克多球物理积分器
====================
扩展 integrator.py 以支持多球碰撞。

架构：
  - BallEntity：封装单个球的完整状态
  - step_single_ball：单球单步演化（从 integrate() 里抽出来）
  - integrate_multi：主循环，每帧：
      ① 每个球独立单步演化
      ② 检测所有球对碰撞
      ③ 记录轨迹

设计原则：球级物理（摩擦、碰库、跳跃）和球间物理（球球碰撞）解耦，
         每个球用一个 BallEntity 独立追踪。
"""

import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional
import sys, os

# Add parent cushion directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cushion'))
# Add current directory to path for pocket module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from snooker_strike import (
    BallState, BALL_MASS, BALL_RADIUS, INERTIA, MU_SLIDING, G,
)
from cushion import (
    CUSHIONS, TABLE_X_MAX, TABLE_X_MIN, TABLE_Y_MAX, TABLE_Y_MIN,
    CushionContactState, init_cushion_states,
    compute_cushion_impulse,
    MU_CUSHION, E_RESTITUTION, CUSHION_DENOM,
)
from ball_collision import (
    compute_ball_collision, separate_balls, BallPairContactState,
)
from pocket import (
    make_all_pockets, check_potted, check_jaw_collision, Pocket
)

# Import physics constants and helper functions from parent cushion/integrator.py
# Use importlib to explicitly load the parent directory's integrator module
import importlib.util
parent_integrator_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cushion', 'integrator.py')
spec = importlib.util.spec_from_file_location("cushion_integrator", parent_integrator_path)
cushion_integrator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cushion_integrator)

# Now import the needed members from the parent integrator
MU_ROLLING = cushion_integrator.MU_ROLLING
OUT_MARGIN = cushion_integrator.OUT_MARGIN
DT = cushion_integrator.DT
MAX_TIME = cushion_integrator.MAX_TIME
V_STOP = cushion_integrator.V_STOP
W_STOP = cushion_integrator.W_STOP
E_FLOOR = cushion_integrator.E_FLOOR
VZ_MIN_BOUNCE = cushion_integrator.VZ_MIN_BOUNCE
VZ_ESCAPE = cushion_integrator.VZ_ESCAPE
apply_cushion_impulses = cushion_integrator.apply_cushion_impulses
contact_velocity = cushion_integrator.contact_velocity
sliding_accel = cushion_integrator.sliding_accel
wz_rolling_decay = cushion_integrator.wz_rolling_decay
apply_rolling_constraint = cushion_integrator.apply_rolling_constraint
update_state = cushion_integrator.update_state


# ── 数据结构 ──────────────────────────────────────────────────────
@dataclass
class BallEntity:
    """
    单个球的完整运行时状态。
    把 pos/v/omega/state/cushion_states 打包在一起，方便传递。
    """
    ball_id:        str                       # 球标识（如 'cue', 'red'）
    pos:            np.ndarray                # [x, y, z]
    v:              np.ndarray                # [vx, vy, vz]
    omega:          np.ndarray                # [wx, wy, wz]
    state:          str                       # 'sliding' / 'rolling' / 'airborne' / 'stopped'
    cushion_states: dict = field(default_factory=init_cushion_states)
    stopped:        bool = False              # 已停止标记，不再更新


@dataclass
class MultiFrame:
    """单时间点所有球的快照"""
    t:      float
    balls:  dict   # {ball_id: {pos, v, omega, state}}


@dataclass
class MultiResult:
    frames:     List[MultiFrame]
    total_time: float
    events:     List[dict]
    out_of_bounds: List[str]   # 飞出台面的球 id 列表


# ── 创建球实体 ────────────────────────────────────────────────────
def make_cue_ball(initial_state: BallState,
                  initial_pos: np.ndarray = None) -> BallEntity:
    """从 compute_strike 的结果创建母球实体"""
    if initial_pos is None:
        initial_pos = np.array([0., 0.])
    return BallEntity(
        ball_id = 'cue',
        pos     = np.array([initial_pos[0], initial_pos[1], BALL_RADIUS], dtype=float),
        v       = initial_state.velocity.copy().astype(float),
        omega   = initial_state.omega.copy().astype(float),
        state   = initial_state.motion_state,
    )


def make_stationary_ball(ball_id: str, pos_xy: np.ndarray) -> BallEntity:
    """创建一个静止球（目标球、红球等）"""
    return BallEntity(
        ball_id = ball_id,
        pos     = np.array([pos_xy[0], pos_xy[1], BALL_RADIUS], dtype=float),
        v       = np.zeros(3),
        omega   = np.zeros(3),
        state   = 'stopped',
        stopped = True,
    )


# ── 袋口物理：施加冲量 ──────────────────────────────────────────────
def apply_jaw_impulse(v: np.ndarray, omega: np.ndarray,
                     jaw_center: np.ndarray, n_hat: np.ndarray,
                     ball_pos: np.ndarray) -> tuple:
    """
    对袋颚弧碰撞施加冲量（复用库边的冲量公式）。
    
    参数：
      v, omega: 球的速度和角速度
      jaw_center: 袋颚圆心 [x, y]
      n_hat: 从袋颚圆心指向球心的单位向量（碰撞法向）
      ball_pos: 球心位置 [x, y, z]
    
    返回：(v_new, omega_new)
    """
    # 扩展为3D向量
    if len(jaw_center) == 2:
        jaw_center_3d = np.array([jaw_center[0], jaw_center[1], ball_pos[2]])
    else:
        jaw_center_3d = jaw_center
    
    # n_hat 已经是从圆心指向球心的单位向量（指向球），这就是法向
    if len(n_hat) == 2:
        n = np.array([n_hat[0], n_hat[1], 0.])
    else:
        n = n_hat.copy()
    n_norm = np.linalg.norm(n)
    if n_norm > 1e-9:
        n = n / n_norm
    else:
        n = np.array([1., 0., 0.])
    
    # 接触点（球心指向圆心方向偏 R）
    r_c = -BALL_RADIUS * n  # 球心→接触点
    
    # 接触点速度
    v_contact = v + np.cross(omega, r_c)
    vn = np.dot(v_contact, n)  # 法向速度（朝球外为正）
    
    # 只在球朝圆心运动时施加冲量 (vn < 0)
    if vn >= -1e-6:  # 已离开或相切
        return v.copy(), omega.copy()
    
    # 恢复系数（用库边参数）
    Jn = -(1 + E_RESTITUTION) * BALL_MASS * vn
    
    # 切向基向量：垂直于 n 在 xy 平面内
    if abs(n[0]) > 1e-6 or abs(n[1]) > 1e-6:
        t_xy = np.array([-n[1], n[0], 0.])
        t_norm = np.linalg.norm(t_xy)
        if t_norm > 1e-9:
            t = t_xy / t_norm
        else:
            t = np.array([1., 0., 0.])
    else:
        t = np.array([1., 0., 0.])
    z = np.array([0., 0., 1.])
    
    vt = np.dot(v_contact, t)
    vz = np.dot(v_contact, z)
    v_slip = np.sqrt(vt**2 + vz**2)
    
    # 库仑摩擦
    F_limit = MU_CUSHION * abs(Jn)
    
    if v_slip < 1e-9:
        Jt, Jz = 0.0, 0.0
    else:
        Jt_stick = -vt / CUSHION_DENOM
        Jz_stick = -vz / CUSHION_DENOM
        J_stick = np.sqrt(Jt_stick**2 + Jz_stick**2)
        
        if J_stick <= F_limit:
            Jt, Jz = Jt_stick, Jz_stick
        else:
            Jt = -F_limit * vt / v_slip
            Jz = -F_limit * vz / v_slip
    
    # 合成冲量
    J_total = Jn * n + Jt * t + Jz * z
    v_new = v + J_total / BALL_MASS
    omega_new = omega + np.cross(r_c, J_total) / INERTIA
    
    return v_new, omega_new


# ── 单球单步演化（从 integrate() 里抽出来）────────────────────────
def step_single_ball(ball: BallEntity, dt: float,
                     events: list, t: float,
                     pockets: Optional[List[Pocket]] = None,
                     tightness: float = 0.5) -> None:
    """
    对一个球执行单步演化（in-place 更新 ball）。

    逻辑完全对应 integrator.py 里 integrate() 主循环内 while 循环一次迭代，
    只是把操作对象从全局变量换成 ball 的字段。
    
    新增物理：
      - 落袋检测（check_potted）→ 球消失
      - 袋颚弧碰撞（check_jaw_collision）→ 像库边一样反弹
    """
    if ball.stopped:
        return
    
    # 初始化袋口（第一次调用时）
    if pockets is None:
        pockets = make_all_pockets(tightness)

    pos, v, omega = ball.pos, ball.v, ball.omega
    state = ball.state

    # ── 落袋检测（优先级最高）────────────────────────────────────────
    potted = check_potted(pos[:2], pockets)
    if potted:
        events.append({'t': t, 'type': 'potted',
                       'ball': ball.ball_id, 'pocket': potted.name, 'pos': pos[:2].copy()})
        ball.stopped = True
        return

    # ── 飞出台面检测 ──────────────────────────────────────────
    if (pos[0] > TABLE_X_MAX + OUT_MARGIN or
            pos[0] < TABLE_X_MIN - OUT_MARGIN or
            pos[1] > TABLE_Y_MAX + OUT_MARGIN or
            pos[1] < TABLE_Y_MIN - OUT_MARGIN):
        events.append({'t': t, 'type': 'out_of_bounds',
                       'ball': ball.ball_id, 'pos': pos[:2].copy()})
        ball.stopped = True
        return

    # ── 空中状态 ──────────────────────────────────────────────
    if state == 'airborne':
        v[2] -= G * dt
        pos += v * dt

        v, omega, hit_cushion = apply_cushion_impulses(
            pos, v, omega, ball.cushion_states)

        if pos[2] <= BALL_RADIUS and v[2] <= 0:
            pos[2]   = BALL_RADIUS
            vz_after = -E_FLOOR * v[2]
            gravity_accumulated = G * dt

            if vz_after > VZ_MIN_BOUNCE and abs(v[2]) > gravity_accumulated * 2:
                v[2]  = vz_after
                state = 'airborne'
                events.append({'t': t, 'type': 'land(bounce)',
                               'ball': ball.ball_id, 'pos': pos[:2].copy()})
            else:
                v[2]  = 0.0
                vc    = contact_velocity(v, omega)
                state = 'sliding' if np.linalg.norm(vc[:2]) > 0.05 else 'rolling'
                events.append({'t': t, 'type': f'land→{state}',
                               'ball': ball.ball_id, 'pos': pos[:2].copy()})

        # 写回
        ball.pos, ball.v, ball.omega, ball.state = pos, v, omega, state
        return

    # ── 台面状态（sliding / rolling）─────────────────────────
    pos[2] = BALL_RADIUS
    v, omega, hit_cushion = apply_cushion_impulses(
        pos, v, omega, ball.cushion_states)

    # ── 袋颚弧碰撞检测（在库边碰撞之后）────────────────────────
    # 检测是否撞到任何袋的袋颚弧，如果有则施加冲量
    jaw_collision = check_jaw_collision(pos[:2], pockets)
    if jaw_collision:
        jaw_center, n_hat, pocket, side = jaw_collision
        # 施加冲量（复用库边的冲量公式）
        v, omega = apply_jaw_impulse(v, omega, jaw_center, n_hat, pos)
        events.append({'t': t, 'type': 'jaw_collision',
                       'ball': ball.ball_id, 'pocket': pocket.name, 'side': side,
                       'pos': pos[:2].copy()})
        hit_cushion = True  # 视为碰撞事件，后续可能导致跳跃

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
            events.append({'t': t, 'type': 'rolling',
                           'ball': ball.ball_id, 'pos': pos[:2].copy()})
        else:
            v, omega = v_new, omega_new

    elif state == 'rolling':
        spd = np.linalg.norm(v[:2])
        if spd > V_STOP:
            a_lin = -MU_ROLLING * G * np.array([v[0], v[1], 0.]) / spd
            v += a_lin * dt
        v[2] = 0.0
        omega[2] = wz_rolling_decay(omega[2], dt)
        omega = apply_rolling_constraint(v, omega)

    # 状态更新
    new_state = update_state(state, v, omega, hit_cushion)
    if new_state != old_state:
        if new_state == 'airborne':
            event_type = 'cushion_jump' if hit_cushion else 'jump'
            events.append({'t': t, 'type': event_type,
                           'ball': ball.ball_id, 'pos': pos[:2].copy()})
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
        ball.stopped = True
        events.append({'t': t, 'type': 'stop',
                       'ball': ball.ball_id, 'pos': pos[:2].copy()})

    # 写回
    ball.pos, ball.v, ball.omega, ball.state = pos, v, omega, state


# ── 球球碰撞处理 ──────────────────────────────────────────────────
def resolve_ball_collisions(
    balls: List[BallEntity],
    pair_states: dict,   # {(id_a, id_b): BallPairContactState}
    events: list,
    t: float,
) -> None:
    """
    检测所有球对，触发碰撞并施加冲量。

    对每一对球 (a, b)，如果距离 < 2R 且在靠近，就施加冲量。
    用 BallPairContactState 防止同一次碰撞重复触发。
    """
    n = len(balls)
    for i in range(n):
        for j in range(i+1, n):
            ball_a = balls[i]
            ball_b = balls[j]

            # 两球都停止，跳过
            if ball_a.stopped and ball_b.stopped:
                continue

            # 取或创建接触状态
            key = (ball_a.ball_id, ball_b.ball_id)
            if key not in pair_states:
                pair_states[key] = BallPairContactState()
            ps = pair_states[key]

            # 记录碰撞前速度，判断是否发生了实际碰撞
            v_a_before = ball_a.v.copy()

            # 调用碰撞物理
            v_a_new, omega_a_new, v_b_new, omega_b_new, ps_new = compute_ball_collision(
                ball_a.pos, ball_a.v, ball_a.omega,
                ball_b.pos, ball_b.v, ball_b.omega,
                ps,
            )
            pair_states[key] = ps_new

            # 如果速度变了，说明冲量施加了
            if not np.allclose(v_a_new, v_a_before):
                # 防止嵌入：把两球推开
                ball_a.pos, ball_b.pos = separate_balls(ball_a.pos, ball_b.pos)

                # 更新速度和角速度
                ball_a.v, ball_a.omega = v_a_new, omega_a_new
                ball_b.v, ball_b.omega = v_b_new, omega_b_new

                # ★ 关键修复：碰撞后两球都要重新评估 motion state ★
                # 不管碰撞前是什么状态（rolling/sliding/stopped），
                # 碰撞改变了速度和角速度的关系，state 必须重新根据接触点 slip 决定。
                # 否则 rolling 状态的球碰撞后会被 apply_rolling_constraint 抹掉上旋能量。
                for b in [ball_a, ball_b]:
                    b.stopped = False  # 任何碰撞都唤醒球
                    
                    # vz 大 → airborne（跟杆 hop）
                    if b.v[2] > VZ_MIN_BOUNCE:
                        b.state = 'airborne'
                    else:
                        # 根据接触点 slip 速度决定 sliding/rolling
                        vc = contact_velocity(b.v, b.omega)
                        slip = np.linalg.norm(vc[:2])
                        b.state = 'sliding' if slip > 0.05 else 'rolling'
                        
                        # 调试日志
                        print(f"[collision] {b.ball_id} state re-evaluated:")
                        print(f"  v: {b.v}, omega: {b.omega}")
                        print(f"  slip_speed: {slip:.4f}, new_state: {b.state}")

                events.append({
                    't': t, 'type': 'collision',
                    'balls': (ball_a.ball_id, ball_b.ball_id),
                    'pos': ((ball_a.pos[:2] + ball_b.pos[:2]) / 2).copy(),
                })


# ── 主积分函数 ────────────────────────────────────────────────────
def integrate_multi(
    balls: List[BallEntity],
    dt:    float = DT,
    max_time: float = MAX_TIME,
    verbose:  bool  = True,
    tightness: float = 0.5,
) -> MultiResult:
    """
    多球积分主循环。

    每帧：
      ① 每个球独立单步演化（含落袋和袋颚弧碰撞）
      ② 所有球对碰撞检测与处理
      ③ 记录快照
      ④ 如果所有球都停止，提前结束
    
    参数：
      tightness: 袋口紧度 (0-1)，控制开口宽度和袋颚弧大小
    """
    pair_states: dict = {}
    frames: List[MultiFrame] = []
    events: list = []
    t = 0.0
    frame_count = 0
    
    # 初始化袋口
    pockets = make_all_pockets(tightness)

    def snapshot():
        """记录所有球当前状态"""
        nonlocal frame_count
        balls_snap = {}
        for b in balls:
            balls_snap[b.ball_id] = {
                'pos':   b.pos.copy(),
                'v':     b.v.copy(),
                'omega': b.omega.copy(),
                'state': b.state,
            }
        frames.append(MultiFrame(t=round(t, 6), balls=balls_snap))
        frame_count += 1

        if verbose and frame_count % 20 == 0:
            info = []
            for b in balls:
                if not b.stopped:
                    info.append(f"{b.ball_id}:[{b.pos[0]:6.3f},{b.pos[1]:6.3f}] "
                                f"|v|={np.linalg.norm(b.v[:2]):.3f} {b.state[:4]}")
            if info:
                print(f"[{frame_count:4d}] t={t:.3f}s  " + "  ".join(info))

    snapshot()

    while t < max_time:
        t += dt

        # ① 每个球独立单步演化（含落袋检测和袋颚弧碰撞）
        for ball in balls:
            step_single_ball(ball, dt, events, t, pockets=pockets, tightness=tightness)

        # ② 球球碰撞检测与处理
        resolve_ball_collisions(balls, pair_states, events, t)

        # ③ 记录快照
        snapshot()

        # ④ 全部停止则退出
        if all(b.stopped for b in balls):
            events.append({'t': t, 'type': 'all_stopped'})
            break

    out_of_bounds = [
        e['ball'] for e in events if e['type'] == 'out_of_bounds'
    ]

    return MultiResult(
        frames        = frames,
        total_time    = t,
        events        = events,
        out_of_bounds = out_of_bounds,
    )


# ── 打印工具 ──────────────────────────────────────────────────────
def print_multi_summary(result: MultiResult, step: int = 60):
    print(f"\n{'='*90}")
    print(f"  总时间：{result.total_time:.3f}s   总帧数：{len(result.frames)}")
    if result.out_of_bounds:
        print(f"  ⚠️ 飞出台面：{result.out_of_bounds}")

    # 关键事件（碰撞、停止、落袋）
    key_events = [e for e in result.events
                  if e['type'] in ('collision', 'stop', 'out_of_bounds',
                                    'rolling', 'land→sliding', 'land→rolling')]
    print(f"  关键事件：")
    for e in key_events[:20]:
        t_str = f"t={e['t']:.3f}s"
        if e['type'] == 'collision':
            print(f"    {t_str}  ⚫⚫ 球球碰撞 {e['balls']} @ [{e['pos'][0]:.3f}, {e['pos'][1]:.3f}]")
        elif e['type'] == 'stop':
            print(f"    {t_str}  ⏹️  {e.get('ball', '?')} 停止 @ [{e['pos'][0]:.3f}, {e['pos'][1]:.3f}]")
        elif e['type'] == 'out_of_bounds':
            print(f"    {t_str}  🚫 {e.get('ball', '?')} 出界")
        elif e['type'] == 'rolling':
            print(f"    {t_str}  🔄 {e.get('ball', '?')} 进入 rolling")

    # 打印各球最终位置
    last = result.frames[-1]
    print(f"\n  最终状态：")
    for ball_id, data in last.balls.items():
        p = data['pos']
        v = data['v']
        print(f"    {ball_id}: pos=[{p[0]:.3f}, {p[1]:.3f}]  |v|={np.linalg.norm(v):.3f}  {data['state']}")
    print(f"{'='*90}")


# ── 演示 ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    from snooker_strike import compute_strike, StrikeInput

    R = BALL_RADIUS

    # ══════════════════════════════════════════════════════════════
    # 用例 1: 90° rule 验证 - 中杆 full hit
    # 母球 (0, 0) 向 +x 打，目标球在 (0.5, 0)
    # 预期：碰后母球停，目标球朝 +x 走
    # ══════════════════════════════════════════════════════════════
    print("\n" + "━"*90)
    print("  【用例 1】中杆 full hit - 定杆效果")
    print("━"*90)
    strike = StrikeInput(a=0, b=0, phi=0, theta=0, force=0.4)
    cue_state = compute_strike(strike)

    cue_ball = make_cue_ball(cue_state, initial_pos=np.array([-0.5, 0.]))
    red_ball = make_stationary_ball('red', np.array([0.3, 0.]))
    result = integrate_multi([cue_ball, red_ball], verbose=True)
    print_multi_summary(result)

    # ══════════════════════════════════════════════════════════════
    # 用例 2: 90° rule 验证 - 半球击（φ=30°）
    # ══════════════════════════════════════════════════════════════
    print("\n" + "━"*90)
    print("  【用例 2】半球击 (φ=30°) - 90° rule")
    print("━"*90)
    strike = StrikeInput(a=0, b=0, phi=0, theta=0, force=0.4)
    cue_state = compute_strike(strike)

    # 目标球位置：从母球出发沿 x 方向距离 0.8m，但偏移让 cut 角 = 30°
    # 当母球到达时，球心连线和入射方向夹角 30°
    # 母球直线运动时，接触发生在：目标球心向左前方 2R 处
    cue_ball = make_cue_ball(cue_state, initial_pos=np.array([-0.5, 0.]))
    # 目标球放在 (0.3, 2R*sin(30°)) 附近，让母球到达时形成 30° cut
    red_ball = make_stationary_ball('red', np.array([0.3, 2*R*np.sin(np.radians(30))]))
    result = integrate_multi([cue_ball, red_ball], verbose=True)
    print_multi_summary(result)

    # ══════════════════════════════════════════════════════════════
    # 用例 3: 跟杆（topspin）full hit
    # 预期：母球碰后短暂停住，然后因上旋继续前进
    # ══════════════════════════════════════════════════════════════
    print("\n" + "━"*90)
    print("  【用例 3】高杆 full hit - 跟杆效果")
    print("━"*90)
    strike = StrikeInput(a=0, b=R*0.6, phi=0, theta=0, force=0.4)
    cue_state = compute_strike(strike)

    cue_ball = make_cue_ball(cue_state, initial_pos=np.array([-0.5, 0.]))
    red_ball = make_stationary_ball('red', np.array([0.3, 0.]))
    result = integrate_multi([cue_ball, red_ball], verbose=True)
    print_multi_summary(result)

    # ══════════════════════════════════════════════════════════════
    # 用例 4: 缩杆（draw）full hit
    # 预期：母球碰后倒退
    # ══════════════════════════════════════════════════════════════
    print("\n" + "━"*90)
    print("  【用例 4】低杆 full hit - 缩杆效果")
    print("━"*90)
    strike = StrikeInput(a=0, b=-R*0.6, phi=0, theta=0, force=0.5)
    cue_state = compute_strike(strike)

    cue_ball = make_cue_ball(cue_state, initial_pos=np.array([-0.5, 0.]))
    red_ball = make_stationary_ball('red', np.array([0.3, 0.]))
    result = integrate_multi([cue_ball, red_ball], verbose=True)
    print_multi_summary(result)