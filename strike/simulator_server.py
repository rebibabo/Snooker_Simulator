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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snooker_strike as snooker_strike
from snooker_strike import compute_strike, StrikeInput
from integrator import integrate


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


class SimulatorHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""
    
    def log_message(self, format, *args):
        """简化日志输出"""
        print(f"[{self.client_address[0]}] {format % args}")
    
    def do_GET(self):
        """处理 GET 请求（跨域支持）"""
        parsed_path = urlparse(self.path)
        
        # 健康检查
        if parsed_path.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {"status": "ok", "message": "Snooker Simulator API Running"}
            self.wfile.write(json.dumps(response, cls=NumpyEncoder).encode())
            return
        
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
                
                # 验证力度和摩擦系数
                force = max(0.0, min(1.0, force))
                mu_tip = max(0.1, min(1.0, mu_tip))
                
                # 设置 MU_TIP
                snooker_strike.MU_TIP = mu_tip
                
                print(f"🎯 Converted: a={a:.6f}m, b={b:.6f}m")#
                
                # 计算初始状态
                strike = StrikeInput(a=a, b=b, phi=phi, theta=theta, force=force)
                initial_state = compute_strike(strike)
                
                print(f"✓ Strike computed: v={initial_state.velocity}, state={initial_state.motion_state}")
                
                # 积分运动轨迹
                result = integrate(initial_state)
                # for frame in result.frames[::10]:
                #     print(f"  t={frame.t:.3f}s pos=({frame.x:.3f}, {frame.y:.3f}, {frame.z:.3f}) "
                #           f"v=({frame.vx:.2f}, {frame.vy:.2f}, {frame.vz:.2f}) "
                #           f"omega=({frame.wx:.2f}, {frame.wy:.2f}, {frame.wz:.2f}) state={frame.state}")
                
                print(f"✓ Integration complete: {len(result.frames)} frames, {result.total_time:.2f}s")
                
                # 转换为 JSON 可序列化格式
                frames_data = []
                for f in result.frames:
                    frames_data.append({
                        't': float(f.t),
                        'pos': [float(f.x), float(f.y), float(f.z)],
                        'v': [float(f.vx), float(f.vy), float(f.vz)],
                        'omega': [float(f.wx), float(f.wy), float(f.wz)],
                        'state': str(f.state),
                    })
                
                response = {
                    'success': True,
                    'frames': frames_data,
                    'final_pos': [float(result.final_pos[0]), float(result.final_pos[1])],
                    'total_time': float(result.total_time),
                    'total_dist': float(result.total_dist),
                    'events': result.events,
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
