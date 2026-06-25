"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the Grid POS API."""

    app_name: str = "Grid POS API"
    environment: str = "development"
    database_url: str = Field(
        default="postgresql+asyncpg://grid_pos:grid_pos@localhost:5432/grid_pos",
        alias="DATABASE_URL",
    )
    jwt_secret: str = Field(default="change-me-in-local-dev", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=60, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    plotholders_api_url: str = Field(
        default="https://plotholders-api-production.up.railway.app",
        alias="PLOT_HOLDERS_API_URL",
    )
    kpay_daemon_token: str = Field(
        default="",
        alias="KPAY_DAEMON_TOKEN",
        description="Shared token for Go daemon WebSocket authentication",
    )
    # KPay query payResult enum (confirmed against the KPOS LAN spec):
    #   -1 timeout, 1 pending, 2 successful, 3 failed, 4 returned,
    #   5 canceled, 6 transaction canceled.
    # Success is 2. Kept env-overridable as a safety valve only.
    kpay_payresult_success: int = Field(
        default=2,
        alias="KPAY_PAYRESULT_SUCCESS",
        description="KPay query payResult value that indicates an approved sale (spec: 2)",
    )
    kpay_sale_timeout_seconds: float = Field(
        default=80.0,
        alias="KPAY_SALE_TIMEOUT_SECONDS",
        description="How long the backend waits for the daemon's sale_result",
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        """Normalize common PostgreSQL URLs to SQLAlchemy's async driver form."""
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()


settings = get_settings()
