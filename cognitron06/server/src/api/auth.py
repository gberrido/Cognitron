#!/usr/bin/env python3
"""
Authentication API endpoints for Cognitron06 Server
"""

import logging
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from ..models.auth_models import LoginRequest, LoginResponse, UserInfo, LogoutResponse
from ..services.session_manager import SessionManager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Authentication"])
security = HTTPBearer()


def get_session_manager() -> SessionManager:
    """Dependency to get session manager"""
    from ..main import app
    return app.state.session_manager


def get_settings():
    """Dependency to get settings"""
    from ..main import app
    return app.state.settings


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session_manager: SessionManager = Depends(get_session_manager),
    settings = Depends(get_settings)
) -> dict:
    """Get current authenticated user"""
    token = credentials.credentials
    session_info = session_manager.validate_session(token, settings.secret_key, settings.algorithm)
    
    if not session_info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return session_info


@router.post("/login", response_model=LoginResponse)
async def login(
    login_data: LoginRequest,
    session_manager: SessionManager = Depends(get_session_manager),
    settings = Depends(get_settings)
):
    """Authenticate user and create session"""
    logger.info(f"Login attempt for user: {login_data.username}")
    
    # Authenticate user
    user = session_manager.authenticate_user(login_data.username, login_data.password)
    if not user:
        logger.warning(f"Failed login attempt for user: {login_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create session
    session_data = session_manager.create_session(
        username=login_data.username,
        secret_key=settings.secret_key,
        algorithm=settings.algorithm,
        expire_minutes=settings.access_token_expire_minutes
    )
    
    logger.info(f"User {login_data.username} logged in successfully")
    return LoginResponse(**session_data)


@router.get("/me", response_model=UserInfo)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user)
):
    """Get current user information"""
    session = current_user["session"]
    
    return UserInfo(
        username=current_user["username"],
        session_id=current_user["session_id"],
        is_active=session["is_active"],
        created_at=session["created_at"],
        last_activity=session["last_activity"]
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    current_user: dict = Depends(get_current_user),
    session_manager: SessionManager = Depends(get_session_manager)
):
    """Logout user and end session"""
    session_id = current_user["session_id"]
    username = current_user["username"]
    
    session_manager.end_session(session_id)
    
    logger.info(f"User {username} logged out successfully")
    return LogoutResponse(
        message="Successfully logged out",
        session_id=session_id
    )


@router.post("/refresh")
async def refresh_token(
    current_user: dict = Depends(get_current_user),
    session_manager: SessionManager = Depends(get_session_manager),
    settings = Depends(get_settings)
):
    """Refresh authentication token"""
    username = current_user["username"]
    
    # End current session and create new one
    session_manager.end_session(current_user["session_id"])
    
    # Create new session
    session_data = session_manager.create_session(
        username=username,
        secret_key=settings.secret_key,
        algorithm=settings.algorithm,
        expire_minutes=settings.access_token_expire_minutes
    )
    
    logger.info(f"Token refreshed for user: {username}")
    return LoginResponse(**session_data)