"""Portfolio valuation: latest quotes, per-holding metrics, summary totals."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.models import Holding, PriceSnapshot
from app.schemas.schemas import HoldingResponse, PortfolioSummary


def _num(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def latest_price_for_asset(db: Session, asset_id: int) -> Decimal | None:
    latest = (
        db.query(PriceSnapshot)
        .filter(PriceSnapshot.asset_id == asset_id)
        .order_by(PriceSnapshot.captured_at.desc())
        .first()
    )
    if not latest:
        return None
    return _num(latest.price)


def holding_to_response(holding: Holding, current_price: Decimal | None) -> HoldingResponse:
    qty = _num(holding.quantity)
    avg = _num(holding.avg_buy_price)
    cost = qty * avg
    if current_price is None:
        return HoldingResponse(
            id=holding.id,
            symbol=holding.asset.symbol,
            asset_type=holding.asset.asset_type,
            quantity=float(qty),
            avg_buy_price=float(avg),
            current_price=None,
            total_value=None,
            profit_loss=None,
            updated_at=holding.updated_at,
        )
    total_value = qty * current_price
    pl = total_value - cost
    return HoldingResponse(
        id=holding.id,
        symbol=holding.asset.symbol,
        asset_type=holding.asset.asset_type,
        quantity=float(qty),
        avg_buy_price=float(avg),
        current_price=float(current_price),
        total_value=float(total_value),
        profit_loss=float(pl),
        updated_at=holding.updated_at,
    )


def list_holdings_responses(db: Session, user_id: int) -> list[HoldingResponse]:
    holdings = db.query(Holding).filter(Holding.user_id == user_id).all()
    out: list[HoldingResponse] = []
    for holding in holdings:
        price = latest_price_for_asset(db, holding.asset_id)
        out.append(holding_to_response(holding, price))
    return out


def portfolio_summary(db: Session, user_id: int) -> PortfolioSummary:
    holdings = db.query(Holding).filter(Holding.user_id == user_id).all()
    total_cost = Decimal("0")
    total_value = Decimal("0")
    unrealized_on_priced = Decimal("0")
    priced_cost_basis = Decimal("0")
    unpriced: set[str] = set()

    for holding in holdings:
        qty = _num(holding.quantity)
        avg = _num(holding.avg_buy_price)
        row_cost = qty * avg
        total_cost += row_cost
        price = latest_price_for_asset(db, holding.asset_id)
        if price is not None:
            total_value += qty * price
            priced_cost_basis += row_cost
            unrealized_on_priced += (qty * price) - row_cost
        else:
            unpriced.add(holding.asset.symbol)

    unrealized_pl_pct: float | None = None
    if priced_cost_basis > 0:
        unrealized_pl_pct = float(
            round((unrealized_on_priced / priced_cost_basis) * Decimal("100"), 2),
        )

    return PortfolioSummary(
        total_cost=float(round(total_cost, 2)),
        total_value=float(round(total_value, 2)),
        unrealized_pl=float(round(unrealized_on_priced, 2)),
        unrealized_pl_percent=unrealized_pl_pct,
        holdings_count=len(holdings),
        unpriced_symbols=sorted(unpriced),
    )


def csv_row_for_holding(
    holding: Holding,
    current_price: Decimal | None,
) -> tuple[Any, ...]:
    qty = _num(holding.quantity)
    avg = _num(holding.avg_buy_price)
    cost = qty * avg
    if current_price is None:
        return (
            holding.asset.symbol,
            holding.asset.asset_type,
            float(qty),
            float(avg),
            "",
            "",
            "",
            float(round(cost, 2)),
        )
    total_value = qty * current_price
    pl = total_value - cost
    return (
        holding.asset.symbol,
        holding.asset.asset_type,
        float(qty),
        float(avg),
        round(float(current_price), 6),
        round(float(total_value), 2),
        round(float(pl), 2),
        float(round(cost, 2)),
    )
