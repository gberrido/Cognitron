#!/usr/bin/env python3
"""
Pydantic models for authentication endpoints
"""

from typing import Optional
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Login request model"""
    username: str = Field(..., description="Username")
    password: str = Field(..., description="Password")


class LoginResponse(BaseModel):
    """Login response model"""
    access_token: str = Field(..., description="JWT access token")
    token_type: str = Field(default="bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiration time in seconds")
    session_id: str = Field(..., description="Session ID")


class UserInfo(BaseModel):
    """User information model"""
    username: str = Field(..., description="Username")
    session_id: str = Field(..., description="Current session ID")
    is_active: bool = Field(..., description="Whether session is active")
    created_at: str = Field(..., description="Session creation time")
    last_activity: str = Field(..., description="Last activity time")


class LogoutResponse(BaseModel):
    """Logout response model"""
    message: str = Field(..., description="Logout confirmation message")
    session_id: str = Field(..., description="Ended session ID")