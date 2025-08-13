#!/usr/bin/env python3
"""
Session/user storage backends for SessionManager.
Provides a simple file-backed JSON storage for persistence across restarts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any, Optional


class SessionStorage:
    """Abstract storage interface."""

    def load(self) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    def save(self, users: Dict[str, Any], sessions: Dict[str, Any]) -> None:
        raise NotImplementedError


class FileSessionStorage(SessionStorage):
    """File-backed storage using a single JSON file under a directory."""

    def __init__(self, directory: str | Path, filename: str = "session_store.json") -> None:
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / filename

    def load(self) -> Optional[Dict[str, Any]]:
        if not self.path.exists():
            return None
        try:
            with self.path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            # Expect keys: users, sessions
            if not isinstance(data, dict):
                return None
            return data
        except Exception:
            # Corrupt or unreadable store; ignore and start fresh
            return None

    def save(self, users: Dict[str, Any], sessions: Dict[str, Any]) -> None:
        payload = {
            "users": users,
            "sessions": sessions,
        }
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        tmp.replace(self.path)

