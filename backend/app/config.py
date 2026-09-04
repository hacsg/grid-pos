"""Application configuration loaded from environment variables."""

from functools import lru_cache
import logging
from uuid import UUID

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

DEFAULT_JWT_SECRET = "change-me-in-local-dev"
_DEVELOPMENT_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}


class Settings(BaseSettings):
    """Runtime settings for the Grid POS API."""

    app_name: str = "Grid POS API"
    environment: str = "development"
    database_url: str = Field(
        default="postgresql+asyncpg://grid_pos:grid_pos@localhost:5432/grid_pos",
        alias="DATABASE_URL",
    )
    cors_allow_origins: str = Field(
        default="http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000",
        alias="CORS_ALLOW_ORIGINS",
        description="Comma-separated browser origins allowed to call the API with credentials",
    )
    jwt_secret: str = Field(default=DEFAULT_JWT_SECRET, alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=60, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    admin_access_token_expire_minutes: int = Field(
        default=30 * 24 * 60,
        alias="ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES",
        description="Back-office session lifetime; kept separate from till sessions",
    )
    plotholders_api_url: str = Field(
        default="https://plotholders-api-production.up.railway.app",
        alias="PLOT_HOLDERS_API_URL",
    )
    plotholders_internal_key: str = Field(
        default="",
        alias="PLOT_HOLDERS_INTERNAL_KEY",
        description="Shared key sent as X-Internal-Key to authenticate to Plotholders",
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

    # --- Landlord/mall GTO file feed --------------------------------------
    gto_machine_id: str = Field(default="", alias="GTO_MACHINE_ID", description="Tenant Machine ID assigned by mall management")
    gto_outlet_id: UUID | None = Field(default=None, alias="GTO_OUTLET_ID")
    gto_gst_registered: bool = Field(default=False, alias="GTO_GST_REGISTERED")
    gto_gst_rate: float = Field(default=0.09, alias="GTO_GST_RATE")
    gto_cron_secret: str = Field(default="", alias="GTO_CRON_SECRET", description="Shared secret for the day-close cron trigger")
    gto_transfer_protocol: str = Field(default="sftp", alias="GTO_TRANSFER_PROTOCOL")
    gto_sftp_host: str = Field(default="", alias="GTO_SFTP_HOST")
    gto_sftp_port: int = Field(default=22, alias="GTO_SFTP_PORT")
    gto_sftp_username: str = Field(default="", alias="GTO_SFTP_USERNAME")
    gto_sftp_password: str = Field(default="", alias="GTO_SFTP_PASSWORD")
    gto_sftp_remote_dir: str = Field(default=".", alias="GTO_SFTP_REMOTE_DIR")

    # --- Daily sales email ------------------------------------------------
    daily_sales_cron_secret: str = Field(
        default="",
        alias="DAILY_SALES_CRON_SECRET",
        description="Shared secret for the daily sales email cron trigger",
    )
    daily_sales_report_to: str = Field(
        default="hello@hundredacre.sg",
        alias="DAILY_SALES_REPORT_TO",
        description="Comma-separated recipients for the daily sales report",
    )
    daily_sales_report_from: str = Field(
        default="hello@hundredacre.sg",
        alias="DAILY_SALES_REPORT_FROM",
        description="Gmail account used as the report sender",
    )
    gmail_api_client_id: str = Field(default="", alias="GMAIL_API_CLIENT_ID")
    gmail_api_client_secret: str = Field(default="", alias="GMAIL_API_CLIENT_SECRET")
    gmail_api_refresh_token: str = Field(default="", alias="GMAIL_API_REFRESH_TOKEN")
    gmail_oauth_token_url: str = Field(
        default="https://oauth2.googleapis.com/token", alias="GMAIL_OAUTH_TOKEN_URL"
    )
    gmail_api_url: str = Field(
        default="https://gmail.googleapis.com/gmail/v1", alias="GMAIL_API_URL"
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

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        """Fail fast on unsafe production secrets and invalid credentialed CORS."""
        env = self.environment.strip().lower()
        if "*" in self.cors_origins:
            raise ValueError("CORS_ALLOW_ORIGINS must be an explicit comma-separated origin list")
        if env not in _DEVELOPMENT_ENVIRONMENTS:
            if not self.jwt_secret.strip() or self.jwt_secret == DEFAULT_JWT_SECRET:
                raise ValueError("JWT_SECRET must be set to a non-default value outside development")
            if not self.kpay_daemon_token.strip():
                raise ValueError("KPAY_DAEMON_TOKEN must be set outside development")
        elif self.jwt_secret == DEFAULT_JWT_SECRET:
            logger.warning("Using default JWT_SECRET; this is only acceptable for local development")
        return self

    @property
    def cors_origins(self) -> list[str]:
        """Return the configured CORS allow-list as explicit origins."""
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()


settings = get_settings()
