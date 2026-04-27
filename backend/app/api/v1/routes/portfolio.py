from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.models import User
from app.schemas.schemas import PortfolioSummary
from app.services.portfolio_service import portfolio_summary

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("/summary", response_model=PortfolioSummary)
def summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> PortfolioSummary:
    return portfolio_summary(db, current_user.id)
