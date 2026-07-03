#!/bin/bash
# Chess Game Hub + Pikafish 启动脚本
# 运行在宿主机（非 Docker），因为 Pikafish 需要 native 二进制
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
export JAVA=/home/ppx/jdk-17.0.19+10/bin/java
export PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
LOG=/tmp/chessproxy.log
PIDFILE=/tmp/chessproxy.pid

# 检查是否已在运行
if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "ChessProxy already running (PID $OLD_PID)"
        exit 0
    fi
fi

# 清理旧进程和端口
pkill -9 -f "java.*ChessProxy" 2>/dev/null
fuser -k 8656/tcp 2>/dev/null
sleep 1

# 启动
nohup "$JAVA" -cp . ChessProxy > "$LOG" 2>&1 &
PID=$!
echo $PID > "$PIDFILE"
echo "ChessProxy started (PID $PID)"
