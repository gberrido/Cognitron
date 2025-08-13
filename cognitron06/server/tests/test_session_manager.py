#!/usr/bin/env python3
"""
Unit tests for Session Manager and Authentication
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

from src.services.session_manager import SessionManager


class TestSessionManager:
    """Test cases for Session Manager"""

    @pytest.fixture
    def session_manager(self):
        """Create a fresh session manager for each test"""
        return SessionManager()

    def test_initialization(self, session_manager):
        """Test session manager initialization"""
        assert hasattr(session_manager, 'pwd_context')
        assert hasattr(session_manager, 'active_sessions')
        assert hasattr(session_manager, 'users_db')
        
        # Should have demo user
        assert 'demo' in session_manager.users_db
        assert session_manager.users_db['demo']['username'] == 'demo'

    def test_password_hashing(self, session_manager):
        """Test password hashing and verification"""
        password = "test_password_123"
        
        # Test hashing
        hashed = session_manager.get_password_hash(password)
        assert hashed != password
        assert len(hashed) > 50  # Bcrypt hashes are long
        
        # Test verification
        assert session_manager.verify_password(password, hashed) is True
        assert session_manager.verify_password("wrong_password", hashed) is False

    def test_authenticate_user_success(self, session_manager):
        """Test successful user authentication"""
        # Test with demo user
        user = session_manager.authenticate_user("demo", "demo123")
        
        assert user is not None
        assert user["username"] == "demo"
        assert user["is_active"] is True

    def test_authenticate_user_invalid_username(self, session_manager):
        """Test authentication with invalid username"""
        user = session_manager.authenticate_user("nonexistent", "password")
        assert user is None

    def test_authenticate_user_invalid_password(self, session_manager):
        """Test authentication with invalid password"""
        user = session_manager.authenticate_user("demo", "wrong_password")
        assert user is None

    def test_create_session(self, session_manager):
        """Test session creation"""
        username = "demo"
        secret_key = "test-secret-key-for-sessions"
        
        session_data = session_manager.create_session(username, secret_key)
        
        assert "access_token" in session_data
        assert "token_type" in session_data
        assert "expires_in" in session_data
        assert "session_id" in session_data
        
        assert session_data["token_type"] == "bearer"
        assert session_data["expires_in"] == 30 * 60  # 30 minutes in seconds
        
        # Check session is stored
        session_id = session_data["session_id"]
        assert session_id in session_manager.active_sessions
        
        session = session_manager.active_sessions[session_id]
        assert session["username"] == username
        assert session["is_active"] is True

    def test_create_session_with_custom_expiry(self, session_manager):
        """Test session creation with custom expiry time"""
        username = "demo"
        secret_key = "test-secret-key"
        expire_minutes = 60
        
        session_data = session_manager.create_session(
            username, secret_key, expire_minutes=expire_minutes
        )
        
        assert session_data["expires_in"] == expire_minutes * 60

    def test_validate_session_success(self, session_manager):
        """Test successful session validation"""
        username = "demo"
        secret_key = "test-secret-key-for-validation"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        token = session_data["access_token"]
        
        # Validate session
        validation_result = session_manager.validate_session(token, secret_key)
        
        assert validation_result is not None
        assert validation_result["username"] == username
        assert validation_result["session_id"] == session_data["session_id"]
        assert "session" in validation_result

    def test_validate_session_invalid_token(self, session_manager):
        """Test session validation with invalid token"""
        secret_key = "test-secret-key"
        
        result = session_manager.validate_session("invalid.token.here", secret_key)
        assert result is None

    def test_validate_session_wrong_secret(self, session_manager):
        """Test session validation with wrong secret key"""
        username = "demo"
        secret_key = "correct-secret"
        wrong_secret = "wrong-secret"
        
        # Create session with correct secret
        session_data = session_manager.create_session(username, secret_key)
        token = session_data["access_token"]
        
        # Try to validate with wrong secret
        result = session_manager.validate_session(token, wrong_secret)
        assert result is None

    def test_validate_session_inactive(self, session_manager):
        """Test validation of inactive session"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        token = session_data["access_token"]
        session_id = session_data["session_id"]
        
        # Deactivate session
        session_manager.active_sessions[session_id]["is_active"] = False
        
        # Try to validate
        result = session_manager.validate_session(token, secret_key)
        assert result is None

    def test_validate_session_updates_activity(self, session_manager):
        """Test that session validation updates last activity"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        token = session_data["access_token"]
        session_id = session_data["session_id"]
        
        # Get initial activity time
        initial_activity = session_manager.active_sessions[session_id]["last_activity"]
        
        # Wait a tiny bit and validate
        import time
        time.sleep(0.01)
        
        session_manager.validate_session(token, secret_key)
        
        # Activity should be updated
        new_activity = session_manager.active_sessions[session_id]["last_activity"]
        assert new_activity != initial_activity

    def test_get_user_id(self, session_manager):
        """Test user ID retrieval"""
        username = "demo"
        user_id = session_manager.get_user_id(username)
        
        # Currently returns username as user ID
        assert user_id == username

    def test_end_session(self, session_manager):
        """Test session termination"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        session_id = session_data["session_id"]
        
        # Verify session is active
        assert session_manager.active_sessions[session_id]["is_active"] is True
        
        # End session
        result = session_manager.end_session(session_id)
        assert result is True
        
        # Verify session is inactive
        assert session_manager.active_sessions[session_id]["is_active"] is False

    def test_end_nonexistent_session(self, session_manager):
        """Test ending non-existent session"""
        result = session_manager.end_session("nonexistent-session-id")
        assert result is False

    def test_cleanup_expired_sessions(self, session_manager):
        """Test cleanup of expired sessions"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        session_id = session_data["session_id"]
        
        # Manually set expiration to past
        past_time = datetime.now() - timedelta(hours=1)
        session_manager.active_sessions[session_id]["expires_at"] = past_time.isoformat()
        
        # Verify session exists
        assert session_id in session_manager.active_sessions
        
        # Cleanup expired sessions
        session_manager.cleanup_expired_sessions()
        
        # Session should be removed
        assert session_id not in session_manager.active_sessions

    def test_cleanup_expired_sessions_with_invalid_format(self, session_manager):
        """Test cleanup with invalid timestamp format"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        session_id = session_data["session_id"]
        
        # Set invalid timestamp
        session_manager.active_sessions[session_id]["expires_at"] = "invalid-timestamp"
        
        # Cleanup should handle gracefully
        session_manager.cleanup_expired_sessions()
        
        # Session with invalid timestamp should be removed
        assert session_id not in session_manager.active_sessions

    def test_get_active_sessions_count(self, session_manager):
        """Test getting count of active sessions"""
        secret_key = "test-secret-key"
        
        # Initially should have no active sessions
        initial_count = session_manager.get_active_sessions_count()
        
        # Create some sessions
        session1 = session_manager.create_session("user1", secret_key)
        session2 = session_manager.create_session("user2", secret_key)
        
        # Count should increase
        assert session_manager.get_active_sessions_count() == initial_count + 2
        
        # End one session
        session_manager.end_session(session1["session_id"])
        
        # Count should decrease
        assert session_manager.get_active_sessions_count() == initial_count + 1

    def test_get_session_info(self, session_manager):
        """Test getting session information"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        session_id = session_data["session_id"]
        
        # Get session info
        info = session_manager.get_session_info(session_id)
        
        assert info is not None
        assert info["session_id"] == session_id
        assert info["username"] == username
        assert info["is_active"] is True
        assert "created_at" in info
        assert "last_activity" in info

    def test_get_nonexistent_session_info(self, session_manager):
        """Test getting info for non-existent session"""
        info = session_manager.get_session_info("nonexistent-id")
        assert info is None

    def test_demo_user_setup(self, session_manager):
        """Test that demo user is properly set up"""
        # Demo user should exist
        assert "demo" in session_manager.users_db
        
        demo_user = session_manager.users_db["demo"]
        assert demo_user["username"] == "demo"
        assert demo_user["is_active"] is True
        assert "hashed_password" in demo_user
        assert "created_at" in demo_user
        
        # Should be able to authenticate
        user = session_manager.authenticate_user("demo", "demo123")
        assert user is not None

    def test_concurrent_session_creation(self, session_manager):
        """Test creating multiple concurrent sessions for same user"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create multiple sessions for same user
        session1 = session_manager.create_session(username, secret_key)
        session2 = session_manager.create_session(username, secret_key)
        
        # Should create different sessions
        assert session1["session_id"] != session2["session_id"]
        
        # Both should be active
        assert session_manager.get_session_info(session1["session_id"])["is_active"] is True
        assert session_manager.get_session_info(session2["session_id"])["is_active"] is True

    def test_session_data_integrity(self, session_manager):
        """Test that session data maintains integrity"""
        username = "demo"
        secret_key = "test-secret-key"
        
        # Create session
        session_data = session_manager.create_session(username, secret_key)
        session_id = session_data["session_id"]
        
        # Get stored session
        stored_session = session_manager.active_sessions[session_id]
        
        # Verify all required fields
        required_fields = ["session_id", "username", "created_at", "expires_at", 
                          "last_activity", "is_active"]
        
        for field in required_fields:
            assert field in stored_session
        
        # Verify data types
        assert isinstance(stored_session["is_active"], bool)
        assert isinstance(stored_session["session_id"], str)
        assert isinstance(stored_session["username"], str)

    @patch('src.services.session_manager.jwt')
    def test_jwt_decode_error_handling(self, mock_jwt, session_manager):
        """Test JWT decode error handling"""
        # Mock JWT decode to raise an exception
        from jose import JWTError
        mock_jwt.decode.side_effect = JWTError("Invalid token")
        
        result = session_manager.validate_session("invalid-token", "secret")
        assert result is None

    def test_password_security(self, session_manager):
        """Test password security measures"""
        password = "test_password"
        
        # Hash same password multiple times
        hash1 = session_manager.get_password_hash(password)
        hash2 = session_manager.get_password_hash(password)
        
        # Hashes should be different (salt makes them unique)
        assert hash1 != hash2
        
        # Both should verify correctly
        assert session_manager.verify_password(password, hash1) is True
        assert session_manager.verify_password(password, hash2) is True