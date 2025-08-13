#!/usr/bin/env python3
"""
Session Management for Cognitron06 Server
Handles user authentication and session persistence
"""

import uuid
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from pathlib import Path
from jose import JWTError, jwt
from passlib.context import CryptContext
from .storage import SessionStorage

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages user sessions and authentication"""
    
    def __init__(self, storage: SessionStorage | None = None):
        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        self.active_sessions: Dict[str, Dict[str, Any]] = {}
        self.users_db = {}  # Simple in-memory user store for demo
        self.storage = storage
        self.failed_attempts: Dict[str, Dict[str, Any]] = {}

        # Attempt to load persisted state
        if self.storage:
            data = self.storage.load()
            if data:
                self.users_db = data.get("users", {}) or {}
                self.active_sessions = data.get("sessions", {}) or {}
        
        # Ensure demo user exists
        if "demo" not in self.users_db:
            self.users_db["demo"] = {
                "username": "demo",
                "hashed_password": self.get_password_hash("demo123"),
                "created_at": datetime.now().isoformat(),
                "is_active": True
            }
            self._persist()
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a plain password against its hash"""
        return self.pwd_context.verify(plain_password, hashed_password)
    
    def get_password_hash(self, password: str) -> str:
        """Generate password hash"""
        return self.pwd_context.hash(password)
    
    def is_user_blocked(self, username: str) -> bool:
        """Check if a user is temporarily blocked due to failed attempts"""
        info = self.failed_attempts.get(username)
        if not info:
            return False
        blocked_until = info.get("blocked_until")
        if blocked_until and datetime.utcnow() < blocked_until:
            return True
        return False

    def _record_failed_attempt(self, username: str, threshold: int = 5, window_sec: int = 60, block_sec: int = 60):
        """Record a failed login attempt and set block when threshold is exceeded"""
        now = datetime.utcnow()
        info = self.failed_attempts.get(username, {"count": 0, "first": now, "blocked_until": None})

        # Reset window if expired
        first = info.get("first", now)
        if (now - first).total_seconds() > window_sec:
            info = {"count": 0, "first": now, "blocked_until": None}

        info["count"] = info.get("count", 0) + 1

        if info["count"] >= threshold:
            info["blocked_until"] = now + timedelta(seconds=block_sec)
            info["count"] = 0
            info["first"] = now

        self.failed_attempts[username] = info

    def _reset_failed_attempts(self, username: str):
        """Clear failure tracking on successful login"""
        if username in self.failed_attempts:
            del self.failed_attempts[username]

    def authenticate_user(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate user credentials"""
        # Rate limit check
        if self.is_user_blocked(username):
            return None

        user = self.users_db.get(username)
        if not user:
            self._record_failed_attempt(username)
            return None
        
        if not self.verify_password(password, user["hashed_password"]):
            self._record_failed_attempt(username)
            return None
        # Successful login resets failures
        self._reset_failed_attempts(username)
        self._persist()
        return user
    
    def create_session(self, username: str, secret_key: str, algorithm: str = "HS256", 
                      expire_minutes: int = 30) -> Dict[str, Any]:
        """Create a new session with JWT token"""
        session_id = str(uuid.uuid4())
        expire = datetime.utcnow() + timedelta(minutes=expire_minutes)
        
        # Create JWT token
        to_encode = {
            "sub": username,
            "session_id": session_id,
            "exp": expire
        }
        access_token = jwt.encode(to_encode, secret_key, algorithm=algorithm)
        
        # Store session
        self.active_sessions[session_id] = {
            "session_id": session_id,
            "username": username,
            "created_at": datetime.now().isoformat(),
            "expires_at": expire.isoformat(),
            "last_activity": datetime.now().isoformat(),
            "is_active": True
        }
        self._persist()
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": expire_minutes * 60,
            "session_id": session_id
        }
    
    def validate_session(self, token: str, secret_key: str, algorithm: str = "HS256") -> Optional[Dict[str, Any]]:
        """Validate JWT token and return session info"""
        try:
            payload = jwt.decode(token, secret_key, algorithms=[algorithm])
            username = payload.get("sub")
            session_id = payload.get("session_id")
            
            if not username or not session_id:
                return None
            
            # Check if session exists and is active
            session = self.active_sessions.get(session_id)
            if not session or not session["is_active"]:
                return None
            
            # Update last activity
            session["last_activity"] = datetime.now().isoformat()
            
            return {
                "username": username,
                "session_id": session_id,
                "session": session
            }
        
        except JWTError:
            return None
    
    def get_user_id(self, username: str) -> str:
        """Get user ID (for now, same as username)"""
        return username
    
    def end_session(self, session_id: str) -> bool:
        """End a session"""
        if session_id in self.active_sessions:
            self.active_sessions[session_id]["is_active"] = False
            self._persist()
            return True
        return False
    
    def cleanup_expired_sessions(self):
        """Remove expired sessions"""
        current_time = datetime.now()
        expired_sessions = []
        
        for session_id, session in self.active_sessions.items():
            try:
                expires_at = datetime.fromisoformat(session["expires_at"])
                if current_time > expires_at:
                    expired_sessions.append(session_id)
            except:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            del self.active_sessions[session_id]
        
        if expired_sessions:
            self._persist()
            logger.info(f"Cleaned up {len(expired_sessions)} expired sessions")
    
    def get_active_sessions_count(self) -> int:
        """Get count of active sessions"""
        return sum(1 for session in self.active_sessions.values() if session["is_active"])
    
    def get_session_info(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session information"""
        return self.active_sessions.get(session_id)

    # User management helpers for persistence-aware updates
    def add_user(self, username: str, hashed_password: str, is_active: bool = True, **extra):
        self.users_db[username] = {
            "username": username,
            "hashed_password": hashed_password,
            "is_active": is_active,
            **extra,
        }
        self._persist()

    def _persist(self):
        if self.storage:
            try:
                self.storage.save(self.users_db, self.active_sessions)
            except Exception:
                # Persistence failures should not crash runtime
                pass
