"""Best-effort SQLite column adds for local dev DBs created before newer models."""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def apply_sqlite_patches(engine: Engine) -> None:
    if not str(engine.url).startswith("sqlite"):
        return
    insp = inspect(engine)
    if not insp.has_table("users"):
        return

    with engine.begin() as conn:
        user_cols = {c["name"] for c in insp.get_columns("users")}
        if "updated_at" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN updated_at DATETIME"))
            conn.execute(text("UPDATE users SET updated_at = created_at WHERE updated_at IS NULL"))

        asset_cols = {c["name"] for c in insp.get_columns("assets")}
        if "created_at" not in asset_cols:
            conn.execute(text("ALTER TABLE assets ADD COLUMN created_at DATETIME"))
            conn.execute(text("ALTER TABLE assets ADD COLUMN updated_at DATETIME"))
            conn.execute(text("UPDATE assets SET created_at = datetime('now') WHERE created_at IS NULL"))
            conn.execute(text("UPDATE assets SET updated_at = created_at WHERE updated_at IS NULL"))

        holding_cols = {c["name"] for c in insp.get_columns("holdings")}
        if "created_at" not in holding_cols:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN created_at DATETIME"))
            conn.execute(text("UPDATE holdings SET created_at = updated_at WHERE created_at IS NULL"))
