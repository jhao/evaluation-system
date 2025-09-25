from flask import Blueprint, request, jsonify, send_file
from flask_socketio import SocketIO, emit, join_room, leave_room
from src.models.evaluation import db, Group, Role, Member, Voter, Vote, GroupPhoto
import os
from werkzeug.utils import secure_filename
import uuid
import pandas as pd
import openpyxl
from io import BytesIO
from datetime import datetime

evaluation_bp = Blueprint('evaluation', __name__)

# 文件上传配置
UPLOAD_FOLDER = 'src/static/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'xlsx', 'xls'}

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

# ==================== 小组成员管理API ====================

@evaluation_bp.route('/groups/<int:group_id>/members', methods=['GET'])
def get_group_members(group_id):
    """获取小组成员"""
    group = Group.query.get_or_404(group_id)
    members = Member.query.filter_by(group_id=group_id).all()
    return jsonify([member.to_dict() for member in members])

@evaluation_bp.route('/groups/<int:group_id>/members', methods=['POST'])
def add_group_member(group_id):
    """添加小组成员"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json()
    
    # 验证必填字段
    if not data.get('name'):
        return jsonify({'error': '成员姓名不能为空'}), 400
    if not data.get('role_id'):
        return jsonify({'error': '职务不能为空'}), 400
    
    # 验证职务是否存在
    role = Role.query.get(data['role_id'])
    if not role:
        return jsonify({'error': '职务不存在'}), 400
    
    member = Member(
        group_id=group_id,
        name=data['name'],
        company=data.get('company', ''),
        role_id=data['role_id']
    )
    
    db.session.add(member)
    db.session.commit()

    return jsonify(member.to_dict()), 201


def _parse_bulk_members_payload(payload):
    """解析批量成员数据"""
    if not payload:
        return []

    lines = [line.strip() for line in payload.replace('\r', '').split('\n') if line.strip()]
    members_data = []

    for index, line in enumerate(lines, start=1):
        normalized = line.replace('，', ',')
        parts = [part.strip() for part in normalized.split(',')]

        if len(parts) < 3:
            raise ValueError(f'第{index}行数据格式不正确，请使用“姓名, 公司, 职务”的格式')

        name = parts[0]
        role_name = parts[-1]
        company = ', '.join(parts[1:-1]).strip()

        if not name:
            raise ValueError(f'第{index}行姓名不能为空')
        if not role_name:
            raise ValueError(f'第{index}行职务不能为空')

        role = Role.query.filter_by(name=role_name).first()
        if not role:
            role = Role(name=role_name)
            db.session.add(role)
            db.session.flush()

        members_data.append({
            'name': name,
            'company': company,
            'role_id': role.id
        })

    return members_data


@evaluation_bp.route('/groups/<int:group_id>/members/bulk', methods=['POST'])
def bulk_add_group_members(group_id):
    """批量添加小组成员"""
    Group.query.get_or_404(group_id)
    data = request.get_json() or {}
    entries = data.get('entries', '')

    try:
        members_data = _parse_bulk_members_payload(entries)
        if not members_data:
            return jsonify({'error': '没有有效的成员数据'}), 400

        for member_data in members_data:
            member = Member(group_id=group_id, **member_data)
            db.session.add(member)

        db.session.commit()
        return jsonify({'message': f'成功导入 {len(members_data)} 名成员', 'count': len(members_data)})

    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'批量导入失败: {str(e)}'}), 500


@evaluation_bp.route('/groups/<int:group_id>/members/bulk', methods=['PUT'])
def bulk_replace_group_members(group_id):
    """批量覆盖小组成员"""
    Group.query.get_or_404(group_id)
    data = request.get_json() or {}
    entries = data.get('entries', '')

    try:
        members_data = _parse_bulk_members_payload(entries)

        # 清空现有成员
        Member.query.filter_by(group_id=group_id).delete(synchronize_session=False)

        # 添加新成员
        for member_data in members_data:
            member = Member(group_id=group_id, **member_data)
            db.session.add(member)

        db.session.commit()
        return jsonify({'message': f'成功保存 {len(members_data)} 名成员', 'count': len(members_data)})

    except ValueError as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'批量保存失败: {str(e)}'}), 500

@evaluation_bp.route('/groups/<int:group_id>/members/<int:member_id>', methods=['PUT'])
def update_group_member(group_id, member_id):
    """更新小组成员"""
    member = Member.query.filter_by(id=member_id, group_id=group_id).first_or_404()
    data = request.get_json()
    
    # 验证必填字段
    if 'name' in data and not data['name']:
        return jsonify({'error': '成员姓名不能为空'}), 400
    if 'role_id' in data and not data['role_id']:
        return jsonify({'error': '职务不能为空'}), 400
    
    # 验证职务是否存在
    if 'role_id' in data:
        role = Role.query.get(data['role_id'])
        if not role:
            return jsonify({'error': '职务不存在'}), 400
        member.role_id = data['role_id']
    
    # 更新字段
    if 'name' in data:
        member.name = data['name']
    if 'company' in data:
        member.company = data['company']
    
    db.session.commit()
    return jsonify(member.to_dict())

@evaluation_bp.route('/groups/<int:group_id>/members/<int:member_id>', methods=['DELETE'])
def delete_group_member(group_id, member_id):
    """删除小组成员"""
    member = Member.query.filter_by(id=member_id, group_id=group_id).first_or_404()
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

@evaluation_bp.route('/voters/import', methods=['POST'])
def import_voters():
    """批量导入评价人"""
    if 'file' not in request.files:
        return jsonify({'error': '没有上传文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    if not file or not allowed_file(file.filename):
        return jsonify({'error': '文件格式不支持，请上传Excel文件(.xlsx或.xls)'}), 400
    
    try:
        # 读取Excel文件
        df = pd.read_excel(file)
        
        # 验证必需的列
        required_columns = ['姓名', '手机号']
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            return jsonify({'error': f'Excel文件缺少必需的列: {", ".join(missing_columns)}'}), 400
        
        # 处理数据
        success_count = 0
        error_count = 0
        errors = []
        
        for index, row in df.iterrows():
            try:
                name = str(row['姓名']).strip()
                phone = str(row['手机号']).strip()
                weight = int(row.get('权重', 1))  # 默认权重为1
                
                if not name or not phone:
                    errors.append(f'第{index+2}行: 姓名或手机号为空')
                    error_count += 1
                    continue
                
                # 检查是否已存在
                existing_voter = Voter.query.filter_by(phone=phone).first()
                if existing_voter:
                    errors.append(f'第{index+2}行: 手机号{phone}已存在')
                    error_count += 1
                    continue
                
                # 创建新评价人
                voter = Voter(name=name, phone=phone, weight=weight)
                db.session.add(voter)
                success_count += 1
                
            except Exception as e:
                errors.append(f'第{index+2}行: {str(e)}')
                error_count += 1
        
        db.session.commit()
        
        result = {
            'success_count': success_count,
            'error_count': error_count,
            'errors': errors[:10]  # 只返回前10个错误
        }
        
        if error_count > 0:
            result['message'] = f'导入完成，成功{success_count}条，失败{error_count}条'
        else:
            result['message'] = f'导入成功，共{success_count}条记录'
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': f'文件处理失败: {str(e)}'}), 500

@evaluation_bp.route('/voters/template', methods=['GET'])
def download_voters_template():
    """下载评价人导入模板"""
    try:
        # 创建Excel模板
        data = {
            '姓名': ['张三', '李四', '王五'],
            '手机号': ['13800138001', '13800138002', '13800138003'],
            '权重': [10, 1, 1]
        }
        df = pd.DataFrame(data)
        
        # 创建BytesIO对象
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='评价人模板')
            
            # 添加说明
            workbook = writer.book
            worksheet = writer.sheets['评价人模板']
            
            # 添加说明行
            worksheet.insert_rows(1, 3)
            worksheet['A1'] = '评价人导入模板'
            worksheet['A2'] = '说明：姓名和手机号为必填项，权重默认为1（老师建议设为10）'
            worksheet['A3'] = ''
            
            # 设置样式
            from openpyxl.styles import Font, Alignment
            worksheet['A1'].font = Font(bold=True, size=14)
            worksheet['A2'].font = Font(size=10)
            worksheet['A1'].alignment = Alignment(horizontal='center')
        
        output.seek(0)
        
        return send_file(
            output,
            as_attachment=True,
            download_name='评价人导入模板.xlsx',
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        
    except Exception as e:
        return jsonify({'error': f'模板生成失败: {str(e)}'}), 500

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

# ==================== 投票数据管理API ====================

@evaluation_bp.route('/votes', methods=['GET'])
def get_votes():
    """获取投票数据"""
    group_id = request.args.get('group_id')
    
    query = Vote.query
    if group_id:
        query = query.filter_by(group_id=group_id)
    
    votes = query.order_by(Vote.created_at.desc()).all()
    return jsonify([vote.to_dict() for vote in votes])

@evaluation_bp.route('/votes/<int:vote_id>', methods=['PUT'])
def update_vote(vote_id):
    """更新投票数据"""
    vote = Vote.query.get_or_404(vote_id)
    data = request.get_json()
    
    # 更新投票类型和权重
    if 'vote_type' in data:
        vote.vote_type = data['vote_type']
    if 'vote_weight' in data:
        vote.vote_weight = data['vote_weight']
    
    db.session.commit()
    return jsonify(vote.to_dict())

@evaluation_bp.route('/votes/<int:vote_id>', methods=['DELETE'])
def delete_vote(vote_id):
    """删除投票数据"""
    vote = Vote.query.get_or_404(vote_id)
    db.session.delete(vote)
    db.session.commit()
    return '', 204

@evaluation_bp.route('/votes/batch-update', methods=['POST'])
def batch_update_votes():
    """批量更新投票数据"""
    data = request.get_json()
    updates = data.get('updates', [])
    
    try:
        for update in updates:
            vote_id = update.get('id')
            vote = Vote.query.get(vote_id)
            if vote:
                if 'vote_type' in update:
                    vote.vote_type = update['vote_type']
                if 'vote_weight' in update:
                    vote.vote_weight = update['vote_weight']
        
        db.session.commit()
        return jsonify({'message': f'成功更新 {len(updates)} 条投票数据'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

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

# ==================== 小组照片管理API ====================

@evaluation_bp.route('/groups/<int:group_id>/photos', methods=['POST'])
def upload_group_photos(group_id):
    """上传小组风采照片"""
    try:
        group = Group.query.get_or_404(group_id)
        
        if 'photos' not in request.files:
            return jsonify({'error': '没有选择文件'}), 400
        
        files = request.files.getlist('photos')
        if not files or all(file.filename == '' for file in files):
            return jsonify({'error': '没有选择文件'}), 400
        
        uploaded_photos = []
        upload_path = ensure_upload_dir()
        
        for file in files:
            if file and file.filename:
                # 检查文件类型
                if not allowed_file(file.filename):
                    continue
                
                # 生成安全的文件名
                filename = secure_filename(file.filename)
                timestamp = int(datetime.now().timestamp())
                filename = f"group_{group_id}_{timestamp}_{filename}"
                
                # 保存文件
                file_path = os.path.join(upload_path, filename)
                file.save(file_path)
                
                # 保存到数据库
                photo = GroupPhoto(
                    group_id=group_id,
                    filename=filename,
                    original_name=file.filename
                )
                db.session.add(photo)
                uploaded_photos.append({
                    'filename': filename,
                    'original_name': file.filename,
                    'url': f'/uploads/{filename}'
                })
        
        db.session.commit()
        
        return jsonify({
            'message': f'成功上传 {len(uploaded_photos)} 张照片',
            'photos': uploaded_photos
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@evaluation_bp.route('/groups/<int:group_id>/photos', methods=['GET'])
def get_group_photos(group_id):
    """获取小组风采照片"""
    try:
        photos = GroupPhoto.query.filter_by(group_id=group_id).all()
        return jsonify([photo.to_dict() for photo in photos])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@evaluation_bp.route('/groups/<int:group_id>/photos/<int:photo_id>', methods=['DELETE'])
def delete_group_photo(group_id, photo_id):
    """删除小组风采照片"""
    try:
        photo = GroupPhoto.query.filter_by(id=photo_id, group_id=group_id).first_or_404()
        
        # 删除文件
        upload_path = ensure_upload_dir()
        file_path = os.path.join(upload_path, photo.filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # 删除数据库记录
        db.session.delete(photo)
        db.session.commit()
        
        return jsonify({'message': '照片删除成功'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

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

