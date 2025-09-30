from flask import Blueprint, request, jsonify, send_file, current_app
from flask_socketio import SocketIO, emit, join_room, leave_room
from src.models.evaluation import db, Course, Group, Role, Member, Voter, Vote, GroupPhoto
import os
from werkzeug.utils import secure_filename
import uuid
import pandas as pd
import openpyxl
from io import BytesIO
from datetime import datetime
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from functools import wraps
from urllib.parse import urljoin, urlparse

import qrcode
from sqlalchemy.exc import IntegrityError

evaluation_bp = Blueprint('evaluation', __name__)

TOKEN_SALT = 'evaluation-admin-token'
TOKEN_MAX_AGE = 12 * 60 * 60


class CourseResolutionError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@evaluation_bp.errorhandler(CourseResolutionError)
def handle_course_resolution_error(error):
    return jsonify({'error': error.message}), error.status_code


def ensure_active_course():
    """确保存在一个活动课程，没有则创建默认课程"""
    course = Course.query.filter_by(is_active=True).first()
    if course:
        return course

    course = Course.query.first()
    if course:
        if not course.is_active:
            course.is_active = True
            db.session.commit()
        return course

    default_course = Course(name='默认课程', is_active=True)
    db.session.add(default_course)
    db.session.commit()
    return default_course


def resolve_course_from_request(data=None, allow_default=True):
    """从请求参数或数据中解析课程信息"""
    course_id = (request.args.get('course_id') or '').strip()

    if not course_id and request.form:
        course_id = (request.form.get('course_id') or '').strip()

    if not course_id and data:
        course_id = str(data.get('course_id') or '').strip()

    if course_id:
        try:
            course_id = int(course_id)
        except (TypeError, ValueError):
            raise CourseResolutionError('无效的课程ID', 400)

        course = Course.query.get(course_id)
        if not course:
            raise CourseResolutionError('课程不存在', 404)
        return course

    if allow_default:
        return ensure_active_course()

    raise CourseResolutionError('未指定课程', 400)


def set_active_course(course):
    """将指定课程设置为当前课程"""
    if not course:
        raise CourseResolutionError('课程不存在', 404)

    Course.query.filter(Course.id != course.id).update({'is_active': False})
    course.is_active = True
    db.session.commit()
    return course


def get_token_serializer():
    secret_key = current_app.config.get('SECRET_KEY', 'evaluation_system_secret_key_2024')
    return URLSafeTimedSerializer(secret_key, salt=TOKEN_SALT)


def generate_admin_token(username):
    serializer = get_token_serializer()
    return serializer.dumps({'username': username})


def verify_admin_token(token):
    serializer = get_token_serializer()
    try:
        data = serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None

    if data.get('username') != current_app.config.get('ADMIN_USERNAME', 'super'):
        return None

    return data


def admin_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '') or ''
        token = ''

        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        elif auth_header:
            token = auth_header.strip()

        if not token:
            token = (request.args.get('token') or '').strip()

        if not token or not verify_admin_token(token):
            return jsonify({'error': '未授权访问'}), 401

        return func(*args, **kwargs)

    return wrapper


# ==================== 课程管理API ====================

@evaluation_bp.route('/courses', methods=['GET'])
def list_courses():
    """获取课程列表"""
    if Course.query.count() == 0:
        ensure_active_course()

    courses = Course.query.order_by(Course.created_at.asc()).all()
    return jsonify([course.to_dict() for course in courses])


@evaluation_bp.route('/courses/active', methods=['GET'])
def get_active_course_info():
    """获取当前激活的课程信息"""
    course = ensure_active_course()
    return jsonify(course.to_dict())


@evaluation_bp.route('/courses', methods=['POST'])
@admin_required
def create_course():
    """创建课程"""
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()

    if not name:
        return jsonify({'error': '课程名称不能为空'}), 400

    description = (data.get('description') or '').strip() or None
    is_active = bool(data.get('is_active', False))

    if Course.query.count() == 0:
        is_active = True

    course = Course(name=name, description=description or None)
    course.is_active = is_active

    db.session.add(course)

    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '课程名称已存在'}), 400

    if is_active:
        Course.query.filter(Course.id != course.id).update({'is_active': False})

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '课程名称已存在'}), 400

    return jsonify(course.to_dict()), 201


@evaluation_bp.route('/courses/<int:course_id>', methods=['PUT'])
@admin_required
def update_course(course_id):
    """更新课程信息"""
    course = Course.query.get(course_id)
    if not course:
        return jsonify({'error': '课程不存在'}), 404

    data = request.get_json() or {}

    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': '课程名称不能为空'}), 400
        course.name = name

    if 'description' in data:
        description = data.get('description')
        course.description = description.strip() if isinstance(description, str) else description

    if 'is_active' in data and bool(data.get('is_active')):
        set_active_course(course)
        return jsonify(course.to_dict())

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '课程名称已存在'}), 400

    return jsonify(course.to_dict())


@evaluation_bp.route('/courses/<int:course_id>', methods=['DELETE'])
@admin_required
def delete_course(course_id):
    """删除课程"""
    course = Course.query.get(course_id)
    if not course:
        return jsonify({'error': '课程不存在'}), 404

    db.session.delete(course)
    db.session.commit()

    if Course.query.count() > 0:
        ensure_active_course()

    return '', 204


@evaluation_bp.route('/courses/<int:course_id>/activate', methods=['POST'])
@admin_required
def activate_course(course_id):
    """激活指定课程"""
    course = Course.query.get(course_id)
    if not course:
        return jsonify({'error': '课程不存在'}), 404

    activated_course = set_active_course(course)
    return jsonify(activated_course.to_dict())


def _extract_forwarded_header(header_name):
    """获取首个转发头信息，忽略额外的代理层信息"""
    header_value = (request.headers.get(header_name) or '').strip()
    if not header_value:
        return ''
    return header_value.split(',')[0].strip()


def _build_request_origin():
    """根据请求和转发头还原包含端口的请求源地址"""
    forwarded_proto = _extract_forwarded_header('X-Forwarded-Proto')
    forwarded_host = _extract_forwarded_header('X-Forwarded-Host')
    forwarded_port = _extract_forwarded_header('X-Forwarded-Port')

    scheme = forwarded_proto or request.scheme
    host = forwarded_host or request.host

    # 如果Host头没有包含端口，尝试从转发端口或服务器端口补全
    if ':' not in host:
        port = forwarded_port or (request.environ.get('SERVER_PORT') or '').strip()
        if port and not ((scheme == 'http' and port == '80') or (scheme == 'https' and port == '443')):
            host = f"{host}:{port}"
    elif forwarded_port:
        # 当代理重新指定了端口时，需要替换原Host中的端口
        hostname = host.split(':', 1)[0]
        if not ((scheme == 'http' and forwarded_port == '80') or (scheme == 'https' and forwarded_port == '443')):
            host = f"{hostname}:{forwarded_port}"
        else:
            host = hostname

    base_url = f"{scheme}://{host}/"
    parsed = urlparse(request.host_url)
    # 保留原始应用部署可能设置的路径前缀
    if parsed.path and parsed.path != '/':
        base_url = urljoin(base_url, parsed.path.lstrip('/'))

    return base_url


@evaluation_bp.route('/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    admin_username = current_app.config.get('ADMIN_USERNAME', 'super')
    admin_password = current_app.config.get('ADMIN_PASSWORD', 'tiandatiankai2025')

    if username != admin_username or password != admin_password:
        return jsonify({'error': '账号或密码错误'}), 401

    token = generate_admin_token(username)
    return jsonify({'token': token, 'username': username})


@evaluation_bp.route('/admin/logout', methods=['POST'])
@admin_required
def admin_logout():
    """管理员退出登录"""
    return jsonify({'message': '退出登录成功'})

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
    course = resolve_course_from_request()
    groups = Group.query.filter_by(course_id=course.id).all() if course else []
    return jsonify([group.to_dict() for group in groups])

@evaluation_bp.route('/groups/<int:group_id>/qrcode', methods=['GET'])
def get_group_qrcode(group_id):
    """生成指定小组的手机端访问二维码"""
    Group.query.get_or_404(group_id)

    requested_url = (request.args.get('url') or '').strip()
    if requested_url:
        target_url = requested_url
    else:
        mobile_path = f"m?g={group_id}"
        base_origin = _build_request_origin()
        target_url = urljoin(base_origin, mobile_path)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(target_url)
    qr.make(fit=True)

    qr_image = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    qr_image.save(buffer, format='PNG')
    buffer.seek(0)

    response = send_file(buffer, mimetype='image/png')
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@evaluation_bp.route('/groups', methods=['POST'])
@admin_required
def create_group():
    """创建小组"""
    data = request.get_json() or {}
    course = resolve_course_from_request(data)

    group = Group(
        course_id=course.id,
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
@admin_required
def update_group(group_id):
    """更新小组"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json() or {}

    # 忽略课程变更
    data.pop('course_id', None)
    
    group.name = data.get('name', group.name)
    group.logo = data.get('logo', group.logo)
    group.status = data.get('status', group.status)
    if 'photos' in data:
        group.set_photos(data['photos'])
    
    db.session.commit()
    return jsonify(group.to_dict())

@evaluation_bp.route('/groups/<int:group_id>', methods=['DELETE'])
@admin_required
def delete_group(group_id):
    """删除小组"""
    group = Group.query.get_or_404(group_id)
    db.session.delete(group)
    db.session.commit()
    return '', 204

@evaluation_bp.route('/groups/<int:group_id>/lock', methods=['POST'])
@admin_required
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
    course = resolve_course_from_request()
    roles = Role.query.filter_by(course_id=course.id).all() if course else []
    return jsonify([role.to_dict() for role in roles])

@evaluation_bp.route('/roles', methods=['POST'])
@admin_required
def create_role():
    """创建职务"""
    data = request.get_json() or {}
    course = resolve_course_from_request(data)

    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '职务名称不能为空'}), 400

    role = Role(course_id=course.id, name=name)
    db.session.add(role)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '同名职务已存在'}), 400

    return jsonify(role.to_dict()), 201

@evaluation_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@admin_required
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
@admin_required
def add_group_member(group_id):
    """添加小组成员"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json() or {}

    # 验证必填字段
    if not data.get('name'):
        return jsonify({'error': '成员姓名不能为空'}), 400
    if not data.get('role_id'):
        return jsonify({'error': '职务不能为空'}), 400

    # 验证职务是否存在
    role = Role.query.filter_by(id=data['role_id'], course_id=group.course_id).first()
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


def _parse_bulk_members_payload(payload, course_id):
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

        role = Role.query.filter_by(name=role_name, course_id=course_id).first()
        if not role:
            role = Role(name=role_name, course_id=course_id)
            db.session.add(role)
            db.session.flush()

        members_data.append({
            'name': name,
            'company': company,
            'role_id': role.id
        })

    return members_data


@evaluation_bp.route('/groups/<int:group_id>/members/bulk', methods=['POST'])
@admin_required
def bulk_add_group_members(group_id):
    """批量添加小组成员"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json() or {}
    entries = data.get('entries', '')

    try:
        members_data = _parse_bulk_members_payload(entries, group.course_id)
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
@admin_required
def bulk_replace_group_members(group_id):
    """批量覆盖小组成员"""
    group = Group.query.get_or_404(group_id)
    data = request.get_json() or {}
    entries = data.get('entries', '')

    try:
        members_data = _parse_bulk_members_payload(entries, group.course_id)

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
@admin_required
def update_group_member(group_id, member_id):
    """更新小组成员"""
    member = Member.query.filter_by(id=member_id, group_id=group_id).first_or_404()
    data = request.get_json() or {}
    
    # 验证必填字段
    if 'name' in data and not data['name']:
        return jsonify({'error': '成员姓名不能为空'}), 400
    if 'role_id' in data and not data['role_id']:
        return jsonify({'error': '职务不能为空'}), 400
    
    # 验证职务是否存在
    if 'role_id' in data:
        role = Role.query.filter_by(id=data['role_id'], course_id=member.group.course_id).first()
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
@admin_required
def delete_group_member(group_id, member_id):
    """删除小组成员"""
    member = Member.query.filter_by(id=member_id, group_id=group_id).first_or_404()
    db.session.delete(member)
    db.session.commit()
    return '', 204

# ==================== 评价人管理API ====================

@evaluation_bp.route('/voters', methods=['GET'])
@admin_required
def get_voters():
    """获取所有评价人"""
    course = resolve_course_from_request()
    voters = Voter.query.filter_by(course_id=course.id).all() if course else []
    return jsonify([voter.to_dict() for voter in voters])

@evaluation_bp.route('/voters', methods=['POST'])
@admin_required
def create_voter():
    """创建评价人"""
    data = request.get_json() or {}
    course = resolve_course_from_request(data)

    name = (data.get('name') or '').strip()
    phone = (data.get('phone') or '').strip()
    weight = data.get('weight', 1)

    if not name or not phone:
        return jsonify({'error': '姓名和手机号不能为空'}), 400

    try:
        weight = int(weight)
    except (TypeError, ValueError):
        weight = 1

    voter = Voter(
        course_id=course.id,
        name=name,
        phone=phone,
        weight=weight
    )
    db.session.add(voter)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '该手机号已存在'}), 400

    return jsonify(voter.to_dict()), 201

@evaluation_bp.route('/voters/<int:voter_id>', methods=['PUT'])
@admin_required
def update_voter(voter_id):
    """更新评价人"""
    voter = Voter.query.get_or_404(voter_id)
    data = request.get_json() or {}

    data.pop('course_id', None)

    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': '姓名不能为空'}), 400
        voter.name = name

    if 'phone' in data:
        phone = (data.get('phone') or '').strip()
        if not phone:
            return jsonify({'error': '手机号不能为空'}), 400
        voter.phone = phone

    if 'weight' in data:
        try:
            voter.weight = int(data.get('weight'))
        except (TypeError, ValueError):
            voter.weight = voter.weight

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '该手机号已存在'}), 400

    return jsonify(voter.to_dict())

@evaluation_bp.route('/voters/<int:voter_id>', methods=['DELETE'])
@admin_required
def delete_voter(voter_id):
    """删除评价人"""
    voter = Voter.query.get_or_404(voter_id)
    db.session.delete(voter)
    db.session.commit()
    return '', 204

@evaluation_bp.route('/voters/import', methods=['POST'])
@admin_required
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
        form_data = request.form.to_dict()
        course = resolve_course_from_request(form_data)

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
                existing_voter = Voter.query.filter_by(phone=phone, course_id=course.id).first()
                if existing_voter:
                    errors.append(f'第{index+2}行: 手机号{phone}已存在')
                    error_count += 1
                    continue

                # 创建新评价人
                voter = Voter(course_id=course.id, name=name, phone=phone, weight=weight)
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
@admin_required
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
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    phone = (data.get('phone') or '').strip()
    group_id = data.get('group_id')

    group = Group.query.get(group_id)
    if not group:
        return jsonify({'error': '小组不存在'}), 404

    voter = Voter.query.filter_by(name=name, phone=phone, course_id=group.course_id).first()
    if not voter:
        return jsonify({'error': '用户信息验证失败'}), 400

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
    data = request.get_json() or {}
    voter_id = data.get('voter_id')
    group_id = data.get('group_id')
    vote_type = data.get('vote_type')  # 1=赞, -1=踩

    voter = Voter.query.get(voter_id)
    group = Group.query.get(group_id)

    if not voter or not group:
        return jsonify({'error': '数据不存在'}), 404

    if voter.course_id != group.course_id:
        return jsonify({'error': '评价人与小组不在同一课程中'}), 400

    if group.status == 1:
        return jsonify({'error': '该小组评价已结束'}), 400

    if voter.has_voted_for_group(group_id):
        return jsonify({'error': '您已经投过票了'}), 400

    # 创建投票记录
    vote = Vote(
        course_id=group.course_id,
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
@admin_required
def get_votes():
    """获取投票数据"""
    group_id = request.args.get('group_id')

    course = resolve_course_from_request()

    query = Vote.query.filter_by(course_id=course.id)
    if group_id:
        query = query.filter_by(group_id=group_id)

    votes = query.order_by(Vote.created_at.desc()).all()
    return jsonify([vote.to_dict() for vote in votes])

@evaluation_bp.route('/votes/<int:vote_id>', methods=['PUT'])
@admin_required
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
@admin_required
def delete_vote(vote_id):
    """删除投票数据"""
    vote = Vote.query.get_or_404(vote_id)
    db.session.delete(vote)
    db.session.commit()
    return '', 204

@evaluation_bp.route('/votes/batch-update', methods=['POST'])
@admin_required
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
    course = resolve_course_from_request()
    groups = Group.query.filter_by(course_id=course.id).all() if course else []
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
@admin_required
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
@admin_required
def get_group_photos(group_id):
    """获取小组风采照片"""
    try:
        photos = GroupPhoto.query.filter_by(group_id=group_id).all()
        return jsonify([photo.to_dict() for photo in photos])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@evaluation_bp.route('/groups/<int:group_id>/photos/<int:photo_id>', methods=['DELETE'])
@admin_required
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
@admin_required
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
@admin_required
def init_data():
    """初始化示例数据"""
    data = request.get_json() or {}
    course = resolve_course_from_request(data)

    # 创建默认职务
    roles_data = ['组长', '副组长', '组员', '技术负责人', '产品经理']
    for role_name in roles_data:
        if not Role.query.filter_by(name=role_name, course_id=course.id).first():
            role = Role(name=role_name, course_id=course.id)
            db.session.add(role)

    # 创建示例小组
    for i in range(1, 7):
        if not Group.query.filter_by(name=f'第{i}小组', course_id=course.id).first():
            group = Group(name=f'第{i}小组', course_id=course.id)
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
        if not Voter.query.filter_by(phone=voter_data['phone'], course_id=course.id).first():
            voter = Voter(course_id=course.id, **voter_data)
            db.session.add(voter)

    db.session.commit()
    return jsonify({'message': '初始化数据成功'})

