#!/usr/bin/env python3
"""
Cognitron06 Server - Main FastAPI Application
Client-server architecture for the MemGPT-inspired AI assistant
"""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from .core.config import Settings
from .core.memory_system import MemGPTMemorySystem
from .core.chat_agent import ChatAgent
from .api import auth, chat, memory, health, models, websocket
from .services.session_manager import SessionManager

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global instances
settings = Settings()
session_manager = SessionManager()
memory_system = None
chat_agent = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown"""
    # Startup
    logger.info("Starting Cognitron06 Server...")
    
    global memory_system, chat_agent
    
    try:
        # Initialize MemGPT Memory System
        memory_system = MemGPTMemorySystem(settings.memory_config)
        await memory_system.initialize()
        
        # Initialize Chat Agent
        chat_agent = ChatAgent(
            api_key=settings.groq_api_key,
            model=settings.model,
            memory_system=memory_system
        )
        
        # Store in app state for access by routes
        app.state.memory_system = memory_system
        app.state.chat_agent = chat_agent
        app.state.session_manager = session_manager
        app.state.settings = settings
        
        logger.info("✅ Cognitron06 Server started successfully")
        logger.info(f"Server running on {settings.host}:{settings.port}")
        logger.info(f"API Documentation: http://{settings.host}:{settings.port}/docs")
        
    except Exception as e:
        logger.error(f"❌ Failed to start server: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("Shutting down Cognitron06 Server...")
    if memory_system:
        await memory_system.cleanup()
    logger.info("✅ Server shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="Cognitron06 API",
    description="MemGPT-inspired AI Assistant with Client-Server Architecture",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=settings.cors_methods,
    allow_headers=settings.cors_headers,
)

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Global exception: {exc}")
    # Avoid leaking internals in production
    if settings.debug:
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "detail": str(exc)}
        )
    else:
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error"}
        )

# Include routers
app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1/auth")
app.include_router(chat.router, prefix="/api/v1/chat")
app.include_router(memory.router, prefix="/api/v1/memory")
app.include_router(models.router, prefix="/api/v1/models")
app.include_router(websocket.router, prefix="/api/v1/ws")

@app.get("/")
async def root():
    """Root endpoint with server information"""
    return {
        "name": "Cognitron06 Server",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "redoc": "/redoc"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="info"
    )
