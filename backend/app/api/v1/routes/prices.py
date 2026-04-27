import logging
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import Holding, PriceSnapshot, User
from app.schemas.schemas import PriceRefreshResponse
from app.services.quotes import fetch_latest_price

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prices", tags=["prices"])


@router.post("/refresh", response_model=PriceRefreshResponse)
async def refresh_prices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PriceRefreshResponse:
    holdings = db.query(Holding).filter(Holding.user_id == current_user.id).all()
    updated = 0
    failed: list[str] = []

    for holding in holdings:
        symbol = holding.asset.symbol
        try:
            quote = await fetch_latest_price(symbol)
            if quote is None:
                failed.append(symbol)
                continue
            db.add(
                PriceSnapshot(
                    asset_id=holding.asset_id,
                    price=Decimal(str(quote.price)),
                    source=quote.source,
                    captured_at=datetime.utcnow(),
                )
            )
            updated += 1
        except Exception as exc:
            logger.warning("Quote refresh failed for %s: %s", symbol, exc)
            failed.append(symbol)

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Commit failed after price refresh")
        raise

    return PriceRefreshResponse(updated=updated, failed=failed)
