import re
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]*$")


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: EmailStr


class HoldingCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=25)
    quantity: float = Field(gt=0)
    avg_buy_price: float = Field(gt=0)
    asset_type: str = Field(default="stock", min_length=1, max_length=20)

    @field_validator("symbol")
    @classmethod
    def symbol_ok(cls, v: str) -> str:
        s = v.strip().upper()
        if not s:
            raise ValueError("Symbol is required")
        if not _SYMBOL_RE.match(s):
            raise ValueError(
                "Symbol may only contain letters, digits, dots, and hyphens (e.g. AAPL, BRK.B)",
            )
        return s

    @field_validator("asset_type")
    @classmethod
    def asset_type_ok(cls, v: str) -> str:
        t = v.strip().lower()
        if not t:
            raise ValueError("Asset type cannot be empty")
        return t


class HoldingUpdate(BaseModel):
    quantity: float = Field(gt=0)
    avg_buy_price: float = Field(gt=0)


class HoldingResponse(BaseModel):
    id: int
    symbol: str
    asset_type: str
    quantity: float
    avg_buy_price: float
    current_price: float | None
    total_value: float | None
    profit_loss: float | None
    updated_at: datetime


class PortfolioSummary(BaseModel):
    total_cost: float
    total_value: float
    unrealized_pl: float
    unrealized_pl_percent: float | None = None
    holdings_count: int
    unpriced_symbols: list[str] = Field(default_factory=list)


class PriceRefreshResponse(BaseModel):
    updated: int
    failed: list[str]
