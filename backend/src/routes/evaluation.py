from flask import Blueprint, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from src.models.evaluation import db, Group, Role, Member, Voter, Vote
import os
from werkzeug.utils import secure_filename
import uuid

evaluation_bp = Blueprint('evaluation', __name__)

# 文件上传配置
UPLOAD_FOLDER = 'src/static/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def ensure_upload_dir():
    """确保上传目录存在"""
    upload_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static', 'uploads')
    if not os.path.exists(upload_path):
        os.makedirs(upload_path)
    return upload_path

# ==================== 后台管理API ====================

@evaluation_bp.route('/groups', methods=['GET'])
def get_groups():
    """获取所有小组"""
    groups = Group.query.all()
    return jsonify([group.to_dict() for group in groups])

@evaluation_bp.route('/groups', methods=['POST'])
def create_group():
    """创建小组"""
    data = request.get_json()
    group = Group(
        name=data.get('name'),
        logo=data.get('logo', ''),
        status=data.get('status', 0)
    )
    if data.get('photos'):
        group.set_photos(data['photos'])
    
    db.session.add(group)
    db.session.commit()
    return jsonify(group.to_dict()), 201

@evaluation_bp.route('/groups/<int:group_id>', methods=['PUT'])
def update_group(group_id):
    """更新小组"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json()
    
    group.name = data.get('name', group.name)
    group.logo = data.get('logo', group.logo)
    group.status = data.get('status', group.status)
    if 'photos' in data:
        group.set_photos(data['photos'])
    
    db.session.commit()
    return jsonify(group.to_dict())

@evaluation_bp.route('/groups/<int:group_id>', methods=['DELETE'])
def delete_group(group_id):
    """删除小组"""
    group = Group.query.get_or_404(group_id)
    db.session.delete(group)
    db.session.commit()
    return '', 204

@evaluation_bp.route('/groups/<int:group_id>/lock', methods=['POST'])
def lock_group(group_id):
    """锁定/解锁小组评价"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json()
    group.status = 1 if data.get('lock', True) else 0
    db.session.commit()
    return jsonify(group.to_dict())

# ==================== 职务管理API ====================

@evaluation_bp.route('/roles', methods=['GET'])
def get_roles():
    """获取所有职务"""
    roles = Role.query.all()
    return jsonify([role.to_dict() for role in roles])

@evaluation_bp.route('/roles', methods=['POST'])
def create_role():
    """创建职务"""
    data = request.get_json()
    role = Role(name=data.get('name'))
    db.session.add(role)
    db.session.commit()
    return jsonify(role.to_dict()), 201

@evaluation_bp.route('/roles/<int:role_id>', methods=['DELETE'])
def delete_role(role_id):
    """删除职务"""
    role = Role.query.get_or_404(role_id)
    db.session.delete(role)
    db.session.commit()
    return '', 204

# ==================== 成员管理API ====================

@evaluation_bp.route('/groups/<int:group_id>/members', methods=['GET'])
def get_group_members(group_id):
    """获取小组成员"""
    members = Member.query.filter_by(group_id=group_id).all()
    return jsonify([member.to_dict() for member in members])

@evaluation_bp.route('/groups/<int:group_id>/members', methods=['POST'])
def add_group_member(group_id):
    """添加小组成员"""
    data = request.get_json()
    member = Member(
        group_id=group_id,
        name=data.get('name'),
        role_id=data.get('role_id')
    )
    db.session.add(member)
    db.session.commit()
    return jsonify(member.to_dict()), 201

@evaluation_bp.route('/members/<int:member_id>', methods=['DELETE'])
def delete_member(member_id):
    """删除成员"""
    member = Member.query.get_or_404(member_id)
    db.session.delete(member)
    db.session.commit()
    return '', 204

# ==================== 评价人管理API ====================

@evaluation_bp.route('/voters', methods=['GET'])
def get_voters():
    """获取所有评价人"""
    voters = Voter.query.all()
    return jsonify([voter.to_dict() for voter in voters])

@evaluation_bp.route('/voters', methods=['POST'])
def create_voter():
    """创建评价人"""
    data = request.get_json()
    voter = Voter(
        name=data.get('name'),
        phone=data.get('phone'),
        weight=data.get('weight', 1)
    )
    db.session.add(voter)
    db.session.commit()
    return jsonify(voter.to_dict()), 201

@evaluation_bp.route('/voters/<int:voter_id>', methods=['PUT'])
def update_voter(voter_id):
    """更新评价人"""
    voter = Voter.query.get_or_404(voter_id)
    data = request.get_json()
    
    voter.name = data.get('name', voter.name)
    voter.phone = data.get('phone', voter.phone)
    voter.weight = data.get('weight', voter.weight)
    
    db.session.commit()
    return jsonify(voter.to_dict())

@evaluation_bp.route('/voters/<int:voter_id>', methods=['DELETE'])
def delete_voter(voter_id):
    """删除评价人"""
    voter = Voter.query.get_or_404(voter_id)
    db.session.delete(voter)
    db.session.commit()
    return '', 204

# ==================== 投票相关API ====================

@evaluation_bp.route('/verify-voter', methods=['POST'])
def verify_voter():
    """验证评价人身份"""
    data = request.get_json()
    name = data.get('name')
    phone = data.get('phone')
    group_id = data.get('group_id')
    
    voter = Voter.query.filter_by(name=name, phone=phone).first()
    if not voter:
        return jsonify({'error': '用户信息验证失败'}), 400
    
    # 检查小组是否已锁定
    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '小组不存在'}), 404
    
    if group.status == 1:
        return jsonify({'error': '该小组评价已结束'}), 400
    
    # 检查是否已投票
    if voter.has_voted_for_group(group_id):
        return jsonify({'error': '您已经为该小组投过票了'}), 400
    
    return jsonify({
        'voter_id': voter.id,
        'name': voter.name,
        'weight': voter.weight
    })

@evaluation_bp.route('/vote', methods=['POST'])
def submit_vote():
    """提交投票"""
    data = request.get_json()
    voter_id = data.get('voter_id')
    group_id = data.get('group_id')
    vote_type = data.get('vote_type')  # 1=赞, -1=踩
    
    voter = Voter.query.get(voter_id)
    group = Group.query.get(group_id)
    
    if not voter or not group:
        return jsonify({'error': '数据不存在'}), 404
    
    if group.status == 1:
        return jsonify({'error': '该小组评价已结束'}), 400
    
    if voter.has_voted_for_group(group_id):
        return jsonify({'error': '您已经投过票了'}), 400
    
    # 创建投票记录
    vote = Vote(
        group_id=group_id,
        voter_id=voter_id,
        vote_type=vote_type,
        vote_weight=voter.weight
    )
    
    db.session.add(vote)
    db.session.commit()
    
    # 获取更新后的统计数据
    stats = group.get_vote_stats()
    
    return jsonify({
        'message': '投票成功',
        'stats': stats
    })

@evaluation_bp.route('/groups/<int:group_id>/stats', methods=['GET'])
def get_group_stats(group_id):
    """获取小组投票统计"""
    group = Group.query.get_or_404(group_id)
    return jsonify(group.get_vote_stats())

# ==================== 排名API ====================

@evaluation_bp.route('/ranking', methods=['GET'])
def get_ranking():
    """获取排名"""
    groups = Group.query.all()
    ranking_data = []
    
    for group in groups:
        stats = group.get_vote_stats()
        ranking_data.append({
            'id': group.id,
            'name': group.name,
            'logo': group.logo,
            'likes': stats['likes'],
            'dislikes': stats['dislikes'],
            'total_score': stats['total']
        })
    
    # 按总分排序
    ranking_data.sort(key=lambda x: x['total_score'], reverse=True)
    
    # 添加排名
    for i, item in enumerate(ranking_data):
        item['rank'] = i + 1
    
    return jsonify(ranking_data)

# ==================== 文件上传API ====================

@evaluation_bp.route('/upload', methods=['POST'])
def upload_file():
    """文件上传"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    if file and allowed_file(file.filename):
        upload_path = ensure_upload_dir()
        filename = secure_filename(file.filename)
        # 添加UUID前缀避免文件名冲突
        filename = f"{uuid.uuid4().hex[:8]}_{filename}"
        file_path = os.path.join(upload_path, filename)
        file.save(file_path)
        
        # 返回相对路径
        return jsonify({'file_path': f'/uploads/{filename}'})
    
    return jsonify({'error': '文件类型不支持'}), 400

# ==================== 初始化数据API ====================

@evaluation_bp.route('/init-data', methods=['POST'])
def init_data():
    """初始化示例数据"""
    # 创建默认职务
    roles_data = ['组长', '副组长', '组员', '技术负责人', '产品经理']
    for role_name in roles_data:
        if not Role.query.filter_by(name=role_name).first():
            role = Role(name=role_name)
            db.session.add(role)
    
    # 创建示例小组
    for i in range(1, 7):
        if not Group.query.filter_by(name=f'第{i}小组').first():
            group = Group(name=f'第{i}小组')
            db.session.add(group)
    
    # 创建示例评价人
    voters_data = [
        {'name': '张老师', 'phone': '13800000001', 'weight': 10},
        {'name': '李老师', 'phone': '13800000002', 'weight': 10},
        {'name': '王同学', 'phone': '13800000003', 'weight': 1},
        {'name': '刘同学', 'phone': '13800000004', 'weight': 1},
        {'name': '陈同学', 'phone': '13800000005', 'weight': 1},
    ]
    
    for voter_data in voters_data:
        if not Voter.query.filter_by(phone=voter_data['phone']).first():
            voter = Voter(**voter_data)
            db.session.add(voter)
    
    db.session.commit()
    return jsonify({'message': '初始化数据成功'})

