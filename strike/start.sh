#!/bin/bash
echo "🎱 Starting Snooker Simulator..."

# 清理旧进程
lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

cleanup() {
    echo "🛑 Shutting down..."
    kill $API_PID 2>/dev/null || true
    lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# 用 watchmedo 监测 py 文件，变化时重启 API
watchmedo auto-restart \
    --patterns="*.py" \
    --recursive \
    -- python3 simulator_server.py 8000 &
API_PID=$!

sleep 2

# 打开浏览器直接访问 index.html（去掉 livereload.js 那行）
if [[ "$OSTYPE" == "darwin"* ]]; then
    open index.html
fi

echo "✅ API: http://localhost:8000"
echo "   Press Ctrl+C to stop"

wait $API_PID