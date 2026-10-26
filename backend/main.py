"""Root entrypoint for running the Plant Technocrat backend with Uvicorn.

Allows running either:
    uvicorn main:app --reload        (from the backend/ directory)
    uvicorn app.main:app --reload    (from the backend/ directory)
"""
from app.main import app

__all__ = ["app"]
