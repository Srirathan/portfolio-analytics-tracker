"""Compatibility re-exports; prefer ``app.services.quotes`` for new imports."""

from app.services.quotes import PriceQuote, fetch_latest_price

__all__ = ["PriceQuote", "fetch_latest_price"]
