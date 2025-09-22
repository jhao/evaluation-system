#!/bin/bash

echo "=== 小组评价系统启动脚本 ==="
echo "正在启动系统..."

# 进入后端目录
cd backend

# 激活虚拟环境
echo "激活虚拟环境..."
source venv/bin/activate

# 安装依赖
echo "安装依赖包..."
pip install -r requirements.txt

# 启动应用
echo "启动应用服务器..."
echo "系统将在 http://localhost:5000 启动"
echo "请在浏览器中访问该地址"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""

python src/main.py

