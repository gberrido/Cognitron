import os
from src.core.config import Settings


def test_settings_parses_cors_from_env(monkeypatch):
    monkeypatch.setenv("COGNITRON_CORS_ORIGINS", "http://a.com, http://b.com ,http://c.com")
    s = Settings(groq_api_key="test-key", secret_key="x")
    assert s.cors_origins == ["http://a.com", "http://b.com", "http://c.com"]

