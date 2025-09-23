from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()

class Group(db.Model):
    """小组表"""
    __tablename__ = 'groups'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    logo = db.Column(db.String(255))  # logo图片路径
    status = db.Column(db.Integer, default=0)  # 0=进行中, 1=已锁定
    photos = db.Column(db.Text)  # JSON格式存储照片路径列表
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 关联关系
    members = db.relationship('Member', backref='group', lazy=True, cascade='all, delete-orphan')
    votes = db.relationship('Vote', backref='group', lazy=True, cascade='all, delete-orphan')
    group_photos = db.relationship('GroupPhoto', backref='group', lazy=True, cascade='all, delete-orphan')
    
    def get_photos(self):
        """获取照片列表"""
        if self.photos:
            try:
                return json.loads(self.photos)
            except:
                return []
        return []
    
    def set_photos(self, photo_list):
        """设置照片列表"""
        self.photos = json.dumps(photo_list)
    
    def get_vote_stats(self):
        """获取投票统计"""
        likes = sum([vote.vote_weight for vote in self.votes if vote.vote_type == 1])
        dislikes = sum([vote.vote_weight for vote in self.votes if vote.vote_type == -1])
        return {'likes': likes, 'dislikes': dislikes, 'total': likes - dislikes}
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'logo': self.logo,
            'status': self.status,
            'photos': self.get_photos(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'vote_stats': self.get_vote_stats()
        }

class Role(db.Model):
    """职务表"""
    __tablename__ = 'roles'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 关联关系
    members = db.relationship('Member', backref='role', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class Member(db.Model):
    """小组成员表"""
    __tablename__ = 'members'
    
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('groups.id'), nullable=False)
    name = db.Column(db.String(50), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('roles.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'group_id': self.group_id,
            'name': self.name,
            'role_id': self.role_id,
            'role_name': self.role.name if self.role else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class Voter(db.Model):
    """评价人表"""
    __tablename__ = 'voters'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    phone = db.Column(db.String(20), nullable=False, unique=True)
    weight = db.Column(db.Integer, default=1)  # 评价权重
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 关联关系
    votes = db.relationship('Vote', backref='voter', lazy=True)
    
    def has_voted_for_group(self, group_id):
        """检查是否已为某个小组投过票"""
        return Vote.query.filter_by(voter_id=self.id, group_id=group_id).first() is not None
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'weight': self.weight,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class Vote(db.Model):
    """评价记录表"""
    __tablename__ = 'votes'
    
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('groups.id'), nullable=False)
    voter_id = db.Column(db.Integer, db.ForeignKey('voters.id'), nullable=False)
    vote_type = db.Column(db.Integer, nullable=False)  # 1=赞, -1=踩
    vote_weight = db.Column(db.Integer, nullable=False)  # 投票时的权重
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 唯一约束：每个评价人对每个小组只能投一票
    __table_args__ = (db.UniqueConstraint('group_id', 'voter_id', name='unique_vote_per_group'),)
    
    def to_dict(self):
        return {
            'id': self.id,
            'group_id': self.group_id,
            'voter_id': self.voter_id,
            'voter_name': self.voter.name if self.voter else None,
            'vote_type': self.vote_type,
            'vote_weight': self.vote_weight,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class GroupPhoto(db.Model):
    """小组风采照片表"""
    __tablename__ = 'group_photos'
    
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('groups.id'), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    original_name = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'group_id': self.group_id,
            'filename': self.filename,
            'original_name': self.original_name,
            'url': f'/uploads/{self.filename}',
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

