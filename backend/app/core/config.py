from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Values that must never sign production tokens (matches dev default and .env.example placeholder).
_INSECURE_JWT_SECRETS = frozenset(
    {
        "dev-only-set-JWT_SECRET_KEY-in-production",
        "replace-with-a-long-random-string",
    },
)


class Settings(BaseSettings):
    app_name: str = "Portfolio Analytics Tracker API"
    api_v1_prefix: str = "/api/v1"
    secret_key: str = Field(
        default="dev-only-set-JWT_SECRET_KEY-in-production",
        validation_alias=AliasChoices("JWT_SECRET_KEY", "SECRET_KEY"),
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = Field(
        default="sqlite:///./portfolio_tracker.db",
        validation_alias=AliasChoices("DATABASE_URL"),
    )
    price_api_url: str = Field(
        default="https://query1.finance.yahoo.com/v8/finance/chart",
        validation_alias=AliasChoices("PRICE_API_URL"),
    )
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        validation_alias=AliasChoices("ALLOWED_ORIGINS", "CORS_ORIGINS"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @model_validator(mode="after")
    def jwt_secret_strong_when_not_sqlite(self) -> "Settings":
        """SQLite + default secret is fine for local dev; anything else needs a real signing key."""
        url = self.database_url.strip().lower()
        if url.startswith("sqlite"):
            return self
        key = self.secret_key.strip()
        if key in _INSECURE_JWT_SECRETS or len(key) < 32:
            raise ValueError(
                "Non-SQLite DATABASE_URL requires JWT_SECRET_KEY (or SECRET_KEY): "
                "use a random string of at least 32 characters, not the dev default or .env.example placeholder.",
            )
        return self


settings = Settings()
