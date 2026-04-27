"""Market quotes: Yahoo Finance chart API first, Stooq CSV fallback (e.g. Yahoo 429)."""

from __future__ import annotations

import asyncio
import csv
import io
from typing import NamedTuple

import httpx

from app.core.config import settings

YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://finance.yahoo.com/",
}

STOOQ_HEADERS = {
    "User-Agent": YAHOO_HEADERS["User-Agent"],
    "Accept": "text/csv,*/*",
}


class PriceQuote(NamedTuple):
    price: float
    source: str


def _close_from_yahoo_chart(data: dict) -> float | None:
    result = data.get("chart", {}).get("result", [])
    if not result:
        return None
    closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
    valid = [p for p in closes if p is not None]
    if not valid:
        return None
    return float(valid[-1])


def _stooq_ticker_candidates(symbol: str) -> list[str]:
    s = symbol.strip().lower()
    if "." in s:
        return [s]
    return [f"{s}.us", f"{s}.to"]


async def _yahoo_price(client: httpx.AsyncClient, symbol: str) -> float | None:
    url = f"{settings.price_api_url}/{symbol.upper()}"
    params = {"interval": "1d", "range": "1d"}
    for attempt in range(2):
        try:
            response = await client.get(url, params=params, headers=YAHOO_HEADERS)
        except httpx.RequestError:
            return None
        if response.status_code == 429 and attempt == 0:
            await asyncio.sleep(2.0)
            continue
        if response.status_code != 200:
            return None
        try:
            data = response.json()
        except ValueError:
            return None
        return _close_from_yahoo_chart(data)
    return None


async def _yahoo_price_chain(client: httpx.AsyncClient, symbol: str) -> float | None:
    """Try Yahoo for the symbol as entered, then .TO (TSX) if there is no exchange suffix."""
    sym = symbol.upper().strip()
    candidates = [sym]
    if "." not in sym:
        candidates.append(f"{sym}.TO")
    for cand in candidates:
        price = await _yahoo_price(client, cand)
        if price is not None:
            return price
    return None


async def _stooq_price(client: httpx.AsyncClient, symbol: str) -> float | None:
    for stooq_sym in _stooq_ticker_candidates(symbol):
        url = f"https://stooq.com/q/l/?s={stooq_sym}&f=sd2t2ohlcv&h&e=csv"
        try:
            response = await client.get(url, headers=STOOQ_HEADERS)
        except httpx.RequestError:
            continue
        if response.status_code != 200:
            continue
        text = response.text.strip()
        if not text or "No data" in text:
            continue
        try:
            reader = csv.reader(io.StringIO(text))
            rows = list(reader)
        except csv.Error:
            continue
        if len(rows) < 2:
            continue
        last = rows[-1]
        if len(last) < 7:
            continue
        raw_close = last[6].strip()
        if raw_close in ("", "N/D", "N/D\n"):
            continue
        try:
            close = float(raw_close)
        except ValueError:
            continue
        if close > 0:
            return close
    return None


async def fetch_latest_price(symbol: str) -> PriceQuote | None:
    """Best-effort last close: Yahoo, then Stooq (different rate limits)."""
    sym = symbol.strip()
    if not sym:
        return None

    async with httpx.AsyncClient(timeout=15.0) as client:
        yahoo = await _yahoo_price_chain(client, sym)
        if yahoo is not None:
            return PriceQuote(yahoo, "yahoo")
        stooq = await _stooq_price(client, sym)
        if stooq is not None:
            return PriceQuote(stooq, "stooq")
    return None
