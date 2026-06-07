"""Health check response schemas."""

from pydantic import BaseModel


class HealthRead(BaseModel):
    """Health check response payload."""

    status: str
    database: str
