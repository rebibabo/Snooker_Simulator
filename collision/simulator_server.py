"""
简单的斯诺克模拟器 HTTP API 服务器
使用 http.server 无依赖运行
"""

import json
import sys
import os
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import numpy as np

# 导入物理模型
collision_dir = os.path.dirname(os.path.abspath(__file__))
cushion_dir = os.path.join(os.path.dirname(collision_dir), 'cushion')

sys.path.insert(0, collision_dir)
sys.path.insert(1, cushion_dir)

import snooker_strike as snooker_strike
from snooker_strike import compute_strike, StrikeInput

# 多球碰撞相关函数
from integrator import integrate_multi, make_cue_ball, make_stationary_ball

# 单球积分函数（从 cushion 目录）
sys.path.insert(0, cushion_dir)
import importlib.util
cushion_integrator_path = os.path.join(cushion_dir, 'integrator.py')
spec = importlib.util.spec_from_file_location("cushion_integrator", cushion_integrator_path)
cushion_integrator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cushion_integrator)
integrate = cushion_integrator.integrate


class NumpyEncoder(json.JSONEncoder):
    """支持 numpy 类型的 JSON 编码器"""
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.integer, np.floating)):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        return super().default(obj)


def convert_multi_result(multi_result):
    """
    将多球模拟结果转换为兼容的格式
    保留白球数据，并额外返回所有球的数据
    """
    class SimpleFrame:
        def __init__(self):
            self.t = 0
            self.x = 0
            self.y = 0
            self.z = 0
            self.vx = 0
            self.vy = 0
            self.vz = 0
            self.wx = 0
            self.wy = 0
            self.wz = 0
            self.state = "rolling"
            self.balls = {}
    
    class SimpleResult:
        pass
    
    result = SimpleResult()
    result.frames = []
    result.total_time = multi_result.total_time
    result.total_dist = 0  # 暂时默认值
    result.events = multi_result.events
    result.out_of_bounds = multi_result.out_of_bounds
    result.final_pos = [0, 0]  # 暂时默认值
    result.all_balls = multi_result  # 保存完整的多球结果
    
    # 对每个时间帧进行转换
    for mf in multi_result.frames:
        # 创建一个包含所有球数据的帧
        frame = SimpleFrame()
        frame.t = mf.t
        frame.balls = mf.balls.copy()  # 所有球的数据字典
        
        # 为了向后兼容，提取白球数据作为主要球数据
        if 'cue' in mf.balls:
            cue_data = mf.balls['cue']
            frame.x = cue_data['pos'][0]
            frame.y = cue_data['pos'][1]
            frame.z = cue_data['pos'][2]
            frame.vx = cue_data['v'][0]
            frame.vy = cue_data['v'][1]
            frame.vz = cue_data['v'][2]
            frame.wx = cue_data['omega'][0]
            frame.wy = cue_data['omega'][1]
            frame.wz = cue_data['omega'][2]
            frame.state = cue_data['state']
        
        result.frames.append(frame)
    
    if result.frames:
        result.final_pos = [result.frames[-1].x, result.frames[-1].y]
    
    return result


class SimulatorHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""
    
    def log_message(self, format, *args):
        """简化日志输出"""
        print(f"[{self.client_address[0]}] {format % args}")
    
    def do_GET(self):
        """处理 GET 请求（支持静态文件）"""
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        
        # 根路径返回 index.html
        if path == '/' or path == '/index.html':
            try:
                file_path = os.path.join(os.path.dirname(__file__), 'index.html')
                with open(file_path, 'rb') as f:
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(f.read())
                return
            except:
                pass
        
        # 处理 CSS 和 JS 文件（在同一目录）
        if path.endswith('.css') or path.endswith('.js'):
            filename = path.split('/')[-1]
            try:
                file_path = os.path.join(os.path.dirname(__file__), filename)
                
                # 安全检查
                if not os.path.abspath(file_path).startswith(os.path.abspath(os.path.dirname(__file__))):
                    raise ValueError("Path traversal attempt")
                
                if not os.path.exists(file_path):
                    raise FileNotFoundError(f"File not found: {file_path}")
                
                with open(file_path, 'rb') as f:
                    self.send_response(200)
                    if filename.endswith('.css'):
                        self.send_header('Content-type', 'text/css; charset=utf-8')
                    elif filename.endswith('.js'):
                        self.send_header('Content-type', 'application/javascript; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(f.read())
                return
            except Exception as e:
                print(f"Error serving {path}: {e}")
        
        # 处理 assets 文件
        if path.startswith('/assets/'):
            filename = path.split('/')[-1]
            try:
                assets_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets')
                file_path = os.path.join(assets_dir, filename)
                
                # 安全检查：确保路径在 assets 目录内
                if not os.path.abspath(file_path).startswith(os.path.abspath(assets_dir)):
                    raise ValueError("Path traversal attempt")
                
                if not os.path.exists(file_path):
                    raise FileNotFoundError(f"File not found: {file_path}")
                
                with open(file_path, 'rb') as f:
                    self.send_response(200)
                    if filename.endswith('.wav'):
                        self.send_header('Content-type', 'audio/wav')
                    elif filename.endswith('.mp3'):
                        self.send_header('Content-type', 'audio/mpeg')
                    else:
                        self.send_header('Content-type', 'application/octet-stream')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(f.read())
                return
            except Exception as e:
                print(f"Error serving {path}: {e}")
        
        self.send_response(404)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
    
    def do_POST(self):
        """处理 POST 请求 - 模拟击球"""
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == '/simulate':
            try:
                # 读取请求体
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length <= 0:
                    raise ValueError("Empty request body")
                    
                body = self.rfile.read(content_length).decode('utf-8')
                params = json.loads(body)
                
                print(f"📥 Received: a={params.get('a')}mm, b={params.get('b')}mm, "
                      f"phi={params.get('phi')}°, theta={params.get('theta')}°, "
                      f"force={params.get('force')}, mu_tip={params.get('mu_tip')}")
                
                # 提取参数（转换单位：mm → m）
                a = float(params.get('a', 0)) / 1000.0
                b = float(params.get('b', 0)) / 1000.0
                phi = float(params.get('phi', 0))
                theta = float(params.get('theta', 0))
                force = float(params.get('force', 0.5))
                mu_tip = float(params.get('mu_tip', 0.4))
                
                # 提取初始位置（可选）
                initial_x = float(params.get('initial_x', 0))
                initial_y = float(params.get('initial_y', 0))
                initial_z = float(params.get('initial_z', 0))
                
                # 提取红球位置（可选，默认 0.3, 0.0）
                red_x = float(params.get('red_x', 0.3))
                red_y = float(params.get('red_y', 0.0))
                red_z = float(params.get('red_z', 0.02625))  # BALL_RADIUS
                
                # 提取高级物理参数（可选）
                e_restitution = float(params.get('e_restitution', 0.80))
                mu_cushion = float(params.get('mu_cushion', 0.40))
                mu_rolling = float(params.get('mu_rolling', 0.015))
                mu_sliding = float(params.get('mu_sliding', 0.20))
                e_floor = float(params.get('e_floor', 0.50))
                
                # 验证力度和摩擦系数
                force = max(0.0, min(1.0, force))
                mu_tip = max(0.1, min(1.0, mu_tip))
                
                # 设置物理参数
                snooker_strike.MU_TIP = mu_tip
                # 在cushion模块中设置库边参数
                import cushion as cushion_module
                cushion_module.E_RESTITUTION = e_restitution
                cushion_module.MU_CUSHION = mu_cushion
                # 在integrator模块中设置台面参数
                import integrator as integrator_module
                integrator_module.MU_ROLLING = mu_rolling
                integrator_module.MU_SLIDING = mu_sliding
                integrator_module.E_FLOOR = e_floor
                
                print(f"🎯 Converted: a={a:.6f}m, b={b:.6f}m")
                print(f"⚙️  Physics: e_restitution={e_restitution}, μ_cushion={mu_cushion}, μ_rolling={mu_rolling}, μ_sliding={mu_sliding}, e_floor={e_floor}")
                if initial_x!=0 or initial_y!=0 or initial_z!=0:
                    print(f"📍 White ball position: x={initial_x:.3f}, y={initial_y:.3f}, z={initial_z:.3f}")
                if red_x!=0.3 or red_y!=0.0 or red_z!=0.02625:
                    print(f"📍 Red ball position: x={red_x:.3f}, y={red_y:.3f}, z={red_z:.3f}")
                
                # 计算初始状态
                strike = StrikeInput(a=a, b=b, phi=phi, theta=theta, force=force)
                initial_state = compute_strike(strike)
                
                print(f"✓ Strike computed: v={initial_state.velocity}, state={initial_state.motion_state}")
                
                # 检查是否启用多球碰撞
                enable_collision = bool(params.get('enable_collision', False))
                
                # 积分运动轨迹
                initial_pos_array = np.array([initial_x, initial_y]) if (initial_x!=0 or initial_y!=0) else None
                
                # 开始计时
                import time
                start_time = time.time()
                
                if enable_collision:
                    print("🎯 Multi-ball collision enabled")
                    # 创建白球
                    cue_ball = make_cue_ball(initial_state, initial_pos_array)
                    # 创建红球（用前端传来的位置）
                    red_ball = make_stationary_ball('red', np.array([red_x, red_y]))
                    balls = [cue_ball, red_ball]
                    result_obj = integrate_multi(balls)
                    # 转换多球结果格式
                    result = convert_multi_result(result_obj)
                else:
                    result = integrate(initial_state, initial_pos=initial_pos_array)
                
                # 计算耗时
                elapsed_time = time.time() - start_time
                
                # for frame in result.frames[::10]:
                #     print(f"  t={frame.t:.3f}s pos=({frame.x:.3f}, {frame.y:.3f}, {frame.z:.3f}) "
                #           f"v=({frame.vx:.2f}, {frame.vy:.2f}, {frame.vz:.2f}) "
                #           f"omega=({frame.wx:.2f}, {frame.wy:.2f}, {frame.wz:.2f}) state={frame.state}")
                
                print(f"✓ Integration complete: {len(result.frames)} frames, {result.total_time:.2f}s")
                print(f"⏱️  Computation time: {elapsed_time*1000:.2f}ms")
                
                # 转换为 JSON 可序列化格式
                frames_data = []
                for f in result.frames:
                    frame_entry = {
                        't': float(f.t),
                        'pos': [float(f.x), float(f.y), float(f.z)],
                        'v': [float(f.vx), float(f.vy), float(f.vz)],
                        'omega': [float(f.wx), float(f.wy), float(f.wz)],
                        'state': str(f.state),
                    }
                    # 如果有多球数据，添加进来
                    if hasattr(f, 'balls') and f.balls:
                        frame_entry['balls'] = f.balls
                    frames_data.append(frame_entry)
                
                response = {
                    'success': True,
                    'frames': frames_data,
                    'final_pos': [float(result.final_pos[0]), float(result.final_pos[1])],
                    'total_time': float(result.total_time),
                    'total_dist': float(result.total_dist),
                    'events': result.events,
                    'out_of_bounds': result.out_of_bounds,
                    'enable_collision': enable_collision,
                    'computation_time_ms': round(elapsed_time * 1000, 2),  # 单位：毫秒
                    'initial_state': {
                        'velocity': [float(initial_state.velocity[0]), 
                                   float(initial_state.velocity[1]), 
                                   float(initial_state.velocity[2])],
                        'omega': [float(initial_state.omega[0]), 
                                float(initial_state.omega[1]), 
                                float(initial_state.omega[2])],
                        'motion_state': str(initial_state.motion_state),
                        'spin_type': str(initial_state.spin_type),
                        'miscue': bool(initial_state.miscue),
                    }
                }
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response, cls=NumpyEncoder).encode('utf-8'))
                print("✓ Response sent successfully\n")
                
            except Exception as e:
                error_msg = str(e)
                print(f"❌ Error: {error_msg}")
                print(traceback.format_exc())
                
                self.send_response(400)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = {'success': False, 'error': error_msg}
                self.wfile.write(json.dumps(error_response, cls=NumpyEncoder).encode('utf-8'))
        else:
            self.send_response(404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
    
    def do_OPTIONS(self):
        """处理 CORS preflight 请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-type')
        self.end_headers()


def run_server(port=8000):
    """运行服务器"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, SimulatorHandler)
    print(f"\n🎱 Snooker Simulator API Server")
    print(f"   🌐 http://localhost:{port}")
    print(f"   📍 POST /simulate - Run simulation")
    print(f"   🟢 Ready\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n✓ Server stopped")
        httpd.server_close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_server(port)
