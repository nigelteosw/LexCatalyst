"""Shared Birdie conversations, turns and approved personal preferences."""
from alembic import op
import sqlalchemy as sa

revision = 'z4f5a6b7c8d9'
down_revision = 'z3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('birdie_conversations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('matter_id', sa.String(36), sa.ForeignKey('matters.id', ondelete='CASCADE')),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('archived', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_birdie_conversations_user_id', 'birdie_conversations', ['user_id'])
    op.create_index('ix_birdie_conversations_matter_id', 'birdie_conversations', ['matter_id'])
    op.create_table('birdie_turns',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('conversation_id', sa.String(36), sa.ForeignKey('birdie_conversations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('request_id', sa.String(80), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('message', sa.Text(), nullable=False), sa.Column('answer', sa.Text(), nullable=False),
        sa.Column('mode', sa.String(20), nullable=False), sa.Column('model', sa.String(200)),
        sa.Column('status', sa.String(20), nullable=False), sa.Column('error', sa.Text()),
        sa.Column('context', sa.JSON(), nullable=False), sa.Column('instructions', sa.Text(), nullable=False),
        sa.Column('attempt', sa.String(36), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('conversation_id', 'request_id', name='uq_birdie_turn_request'))
    op.create_index('ix_birdie_turns_conversation_id', 'birdie_turns', ['conversation_id'])
    op.create_table('birdie_preferences',
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('instructions', sa.Text(), nullable=False),
        sa.Column('disabled_memory_ids', sa.JSON(), nullable=False), sa.Column('lesson_overrides', sa.JSON(), nullable=False))


def downgrade():
    op.drop_table('birdie_preferences')
    op.drop_table('birdie_turns')
    op.drop_table('birdie_conversations')
