import os
import sys
import argparse
# DON\'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from src.models.evaluation import db
from src.routes.evaluation import evaluation_bp

DEFAULT_ADMIN_PASSWORD = 'tiandatiankai2025'
ADMIN_PASSWORD_ENV_KEY = 'EVALUATION_ADMIN_PASSWORD'


def resolve_admin_password():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--pwd', dest='admin_password')
    args, remaining = parser.parse_known_args()

    if remaining:
        sys.argv = [sys.argv[0], *remaining]

    if args.admin_password:
        os.environ[ADMIN_PASSWORD_ENV_KEY] = args.admin_password
        return args.admin_password

    env_password = os.environ.get(ADMIN_PASSWORD_ENV_KEY)
    if env_password:
        return env_password

    return DEFAULT_ADMIN_PASSWORD

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = 'evaluation_system_secret_key_2024'
app.config['ADMIN_USERNAME'] = 'super'
app.config['ADMIN_PASSWORD'] = resolve_admin_password()

# 启用CORS
CORS(app, origins="*")

# 初始化SocketIO
socketio = SocketIO(app, cors_allowed_origins="*")

# 注册蓝图
app.register_blueprint(evaluation_bp, url_prefix='/api')

# 数据库配置
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)
with app.app_context():
    db.create_all()

# WebSocket事件处理
@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'message': '连接成功'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('join_group')
def handle_join_group(data):
    """加入小组房间，用于接收该小组的实时更新"""
    group_id = data.get('group_id')
    if group_id:
        from flask_socketio import join_room
        join_room(f'group_{group_id}')
        emit('joined_group', {'group_id': group_id})

@socketio.on('vote_update')
def handle_vote_update(data):
    """广播投票更新"""
    group_id = data.get('group_id')
    if group_id:
        socketio.emit('vote_updated', data, room=f'group_{group_id}')

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    static_folder_path = app.static_folder
    if static_folder_path is None:
            return "Static folder not configured", 404

    # 特殊处理手机端路由
    if path == 'mobile':
        mobile_path = os.path.join(static_folder_path, 'mobile.html')
        if os.path.exists(mobile_path):
            return send_from_directory(static_folder_path, 'mobile.html')
        else:
            return "mobile.html not found", 404

    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    else:
        index_path = os.path.join(static_folder_path, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(static_folder_path, 'index.html')
        else:
            return "index.html not found", 404


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
