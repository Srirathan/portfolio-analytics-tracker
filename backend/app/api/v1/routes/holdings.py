import csv
import io
import logging
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import Asset, Holding, PriceSnapshot, User
from app.schemas.schemas import HoldingCreate, HoldingResponse, HoldingUpdate
from app.services.portfolio_service import (
    csv_row_for_holding,
    holding_to_response,
    latest_price_for_asset,
    list_holdings_responses,
)
from app.services.quotes import fetch_latest_price

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/holdings", tags=["holdings"])


@router.get("", response_model=list[HoldingResponse])
def list_holdings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[HoldingResponse]:
    return list_holdings_responses(db, current_user.id)


@router.get("/export.csv")
def export_holdings_csv(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    holdings = db.query(Holding).filter(Holding.user_id == current_user.id).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "symbol",
            "asset_type",
            "quantity",
            "avg_buy_price",
            "current_price",
            "total_value",
            "profit_loss",
            "cost_basis",
        ],
    )
    for holding in holdings:
        price = latest_price_for_asset(db, holding.asset_id)
        writer.writerow(csv_row_for_holding(holding, price))

    buffer.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"portfolio_holdings_{stamp}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=HoldingResponse)
async def create_holding(
    payload: HoldingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HoldingResponse:
    symbol = payload.symbol
    asset = db.query(Asset).filter(Asset.symbol == symbol, Asset.asset_type == payload.asset_type).first()
    if not asset:
        asset = Asset(symbol=symbol, asset_type=payload.asset_type)
        db.add(asset)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            asset = db.query(Asset).filter(Asset.symbol == symbol, Asset.asset_type == payload.asset_type).first()
            if not asset:
                logger.exception("Asset insert race for %s %s", symbol, payload.asset_type)
                raise HTTPException(status_code=500, detail="Could not create asset; try again.") from None

    existing = db.query(Holding).filter(Holding.user_id == current_user.id, Holding.asset_id == asset.id).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="You already hold this symbol and asset type. Edit the existing row instead.",
        )

    holding = Holding(
        user_id=current_user.id,
        asset_id=asset.id,
        quantity=Decimal(str(payload.quantity)),
        avg_buy_price=Decimal(str(payload.avg_buy_price)),
    )
    db.add(holding)

    quote = await fetch_latest_price(symbol)
    if quote is not None:
        db.add(
            PriceSnapshot(
                asset_id=asset.id,
                price=Decimal(str(quote.price)),
                source=quote.source,
            )
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.info("Holding create integrity error: %s", exc)
        raise HTTPException(
            status_code=400,
            detail="You already hold this symbol and asset type. Edit the existing row instead.",
        ) from None

    db.refresh(holding)
    current = latest_price_for_asset(db, holding.asset_id)
    return holding_to_response(holding, current)


@router.patch("/{holding_id}", response_model=HoldingResponse)
def update_holding(
    holding_id: int,
    payload: HoldingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HoldingResponse:
    holding = db.query(Holding).filter(Holding.id == holding_id, Holding.user_id == current_user.id).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    holding.quantity = Decimal(str(payload.quantity))
    holding.avg_buy_price = Decimal(str(payload.avg_buy_price))
    db.commit()
    db.refresh(holding)

    current = latest_price_for_asset(db, holding.asset_id)
    return holding_to_response(holding, current)


@router.delete("/{holding_id}", status_code=204)
def delete_holding(
    holding_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    holding = db.query(Holding).filter(Holding.id == holding_id, Holding.user_id == current_user.id).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()
