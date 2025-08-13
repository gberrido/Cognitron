#!/usr/bin/env python3
"""
Configuration management for Cognitron06 Server
"""

import os
import sys
from typing import Dict, Any
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings with environment variable support"""
    
    # Server Configuration
    host: str = Field(default="0.0.0.0", env="COGNITRON_HOST")
    port: int = Field(default=8000, env="COGNITRON_PORT")
    debug: bool = Field(default=False, env="COGNITRON_DEBUG")
    
    # API Configuration
    api_prefix: str = "/api/v1"
    docs_url: str = "/docs"
    redoc_url: str = "/redoc"
    
    # Authentication
    secret_key: str = Field(default="", env="COGNITRON_SECRET_KEY")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    
    # Groq API Configuration
    groq_api_key: str = Field(default="", env="GROQ_API_KEY")
    model: str = Field(default="openai/gpt-oss-120b", env="COGNITRON_MODEL")
    max_tokens: int = Field(default=2048, env="COGNITRON_MAX_TOKENS")
    temperature: float = Field(default=0.7, env="COGNITRON_TEMPERATURE")
    
    # Memory System Configuration
    @property
    def memory_config(self) -> Dict[str, Any]:
        return {
            "data_dir": os.getenv("COGNITRON_DATA_DIR", "./cognitron06-data"),
            "max_working_context_size": int(os.getenv("COGNITRON_MAX_WORKING_CONTEXT", "2000")),
            "max_fifo_queue_size": int(os.getenv("COGNITRON_MAX_FIFO_QUEUE", "20")),
            "memory_pressure_threshold": float(os.getenv("COGNITRON_MEMORY_PRESSURE", "0.8")),
            "context_window_size": int(os.getenv("COGNITRON_CONTEXT_WINDOW", "8192")),
        }
    
    # CORS Configuration
    cors_origins: list = ["*"]  # Configure for production
    cors_methods: list = ["*"]
    cors_headers: list = ["*"]
    cors_origins_env: str = Field(default="", env="COGNITRON_CORS_ORIGINS")
    
    # Logging
    log_level: str = Field(default="INFO", env="COGNITRON_LOG_LEVEL")
    
    class Config:
        env_file = ".env"
        case_sensitive = False

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        # Generate secret key if not provided
        if not self.secret_key:
            import secrets
            self.secret_key = secrets.token_urlsafe(32)
            print("⚠️  Generated temporary secret key. Set COGNITRON_SECRET_KEY for production!")
        
        # Parse CORS origins from env if provided (CSV)
        if self.cors_origins_env:
            parsed = [o.strip() for o in self.cors_origins_env.split(',') if o.strip()]
            if parsed:
                self.cors_origins = parsed
        
        # Validate required fields (skip in test mode or when GROQ_API_KEY is "test")
        is_test_mode = (os.getenv("PYTEST_CURRENT_TEST") or 
                       "test" in os.getenv("GROQ_API_KEY", "").lower() or
                       "test" in sys.argv[0] if len(sys.argv) > 0 else False or
                       "pytest" in " ".join(sys.argv))
        
        if not self.groq_api_key and not is_test_mode:
            raise ValueError("GROQ_API_KEY environment variable is required")


# Global settings instance
settings = Settings()
