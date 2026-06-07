"""Shared Pydantic schema helpers."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Money = Annotated[Decimal, Field(max_digits=10, decimal_places=2)]


class ORMModel(BaseModel):
    """Base schema that can serialize SQLAlchemy model instances."""

    model_config = ConfigDict(from_attributes=True)


class UUIDSchema(ORMModel):
    """Base schema containing a UUID identifier."""

    id: UUID


class TimestampSchema(UUIDSchema):
    """Base schema containing UUID and audit timestamps."""

    created_at: datetime
    updated_at: datetime

