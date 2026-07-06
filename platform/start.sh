#!/bin/bash
cd /home/ppx/.qwenpaw/workspaces/D2GPcF/www/platform
# Set DEEPSEEK_API_KEY_GAME and ADMIN_PASSWORD before running
# export DEEPSEEK_API_KEY_GAME=sk-xxx
# export ADMIN_PASSWORD=admin123
node server.js >> /tmp/platform.log 2>&1 &
echo "啟動於 PID: $!"
