import asyncio
import logging
import os
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import select, delete

from config import get_settings
from db import AsyncSessionLocal
from models import Storage, StorageProject, utc_now

logger = logging.getLogger(__name__)


async def provision_storage(ctx, resource_id: str):
    log_prefix = f"[ProvisionStorage:{resource_id}]"
    logger.info(f"{log_prefix} Starting storage provisioning")
    settings = get_settings()

    async with AsyncSessionLocal() as db:
        storage = (
            await db.execute(select(Storage).where(Storage.id == resource_id))
        ).scalar_one_or_none()
        if not storage:
            logger.error(f"{log_prefix} Storage not found")
            return

        try:
            if storage.type == "database":
                await asyncio.to_thread(_ensure_database_path, settings, storage)
            elif storage.type == "volume":
                await asyncio.to_thread(_ensure_volume_path, settings, storage)
            else:
                logger.error(f"{log_prefix} Unsupported storage type: {storage.type}")
                return

            storage.status = "active"
            storage.error = None
            storage.updated_at = utc_now()
            await db.commit()
            logger.info(f"{log_prefix} Storage provisioned")
        except Exception as exc:
            storage.error = {
                "stage": f"provision_{storage.type}",
                "message": str(exc),
                "last_attempt_at": utc_now().isoformat(),
            }
            storage.updated_at = utc_now()
            await db.commit()
            logger.error(f"{log_prefix} Provisioning failed: {exc}", exc_info=True)
            raise


async def deprovision_storage(ctx, resource_id: str):
    log_prefix = f"[DeprovisionStorage:{resource_id}]"
    logger.info(f"{log_prefix} Starting storage deprovisioning")
    settings = get_settings()

    async with AsyncSessionLocal() as db:
        storage = (
            await db.execute(select(Storage).where(Storage.id == resource_id))
        ).scalar_one_or_none()
        if not storage:
            logger.error(f"{log_prefix} Storage not found")
            return

        try:
            if storage.type == "database":
                await asyncio.to_thread(_remove_database_path, settings, storage)
            elif storage.type == "volume":
                await asyncio.to_thread(_remove_volume_path, settings, storage)
            else:
                logger.error(f"{log_prefix} Unsupported storage type: {storage.type}")
                return

            await db.execute(
                delete(StorageProject).where(StorageProject.storage_id == storage.id)
            )
            await db.execute(delete(Storage).where(Storage.id == storage.id))
            await db.commit()
            logger.info(f"{log_prefix} Storage deprovisioned")
        except Exception as exc:
            storage.error = {
                "stage": f"deprovision_{storage.type}",
                "message": str(exc),
                "last_attempt_at": utc_now().isoformat(),
            }
            storage.updated_at = utc_now()
            await db.commit()
            logger.error(f"{log_prefix} Deprovisioning failed: {exc}", exc_info=True)
            raise


async def reset_storage(ctx, resource_id: str):
    log_prefix = f"[ResetStorage:{resource_id}]"
    logger.info(f"{log_prefix} Starting storage reset")
    settings = get_settings()

    async with AsyncSessionLocal() as db:
        storage = (
            await db.execute(select(Storage).where(Storage.id == resource_id))
        ).scalar_one_or_none()
        if not storage:
            logger.error(f"{log_prefix} Storage not found")
            return

        try:
            storage.status = "resetting"
            storage.error = None
            storage.updated_at = utc_now()
            await db.commit()
            if storage.type == "database":
                await asyncio.to_thread(_reset_database_path, settings, storage)
            elif storage.type == "volume":
                await asyncio.to_thread(_reset_volume_path, settings, storage)
            else:
                logger.error(f"{log_prefix} Unsupported storage type: {storage.type}")
                return

            storage.status = "active"
            storage.error = None
            storage.updated_at = utc_now()
            await db.commit()
            logger.info(f"{log_prefix} Storage reset")
        except Exception as exc:
            storage.status = "active"
            storage.error = {
                "stage": f"reset_{storage.type}",
                "message": str(exc),
                "last_attempt_at": utc_now().isoformat(),
            }
            storage.updated_at = utc_now()
            await db.commit()
            logger.error(f"{log_prefix} Reset failed: {exc}", exc_info=True)
            raise


def _ensure_database_path(settings, storage: Storage) -> None:
    base_dir = (
        Path(settings.data_dir)
        / "storage"
        / storage.team_id
        / "database"
        / storage.name
    )
    db_path = base_dir / "db.sqlite"

    base_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    finally:
        conn.close()
    _apply_storage_permissions(settings, base_dir, db_path)


def _ensure_volume_path(settings, storage: Storage) -> None:
    base_dir = (
        Path(settings.data_dir) / "storage" / storage.team_id / "volume" / storage.name
    )
    base_dir.mkdir(parents=True, exist_ok=True)
    _apply_storage_permissions(settings, base_dir)


def _remove_database_path(settings, storage: Storage) -> None:
    base_dir = (
        Path(settings.data_dir)
        / "storage"
        / storage.team_id
        / "database"
        / storage.name
    )
    if base_dir.exists():
        shutil.rmtree(base_dir)


def _remove_volume_path(settings, storage: Storage) -> None:
    base_dir = (
        Path(settings.data_dir) / "storage" / storage.team_id / "volume" / storage.name
    )
    if base_dir.exists():
        shutil.rmtree(base_dir)


def _reset_database_path(settings, storage: Storage) -> None:
    base_dir = (
        Path(settings.data_dir)
        / "storage"
        / storage.team_id
        / "database"
        / storage.name
    )
    if base_dir.exists():
        shutil.rmtree(base_dir)
    _ensure_database_path(settings, storage)


def _reset_volume_path(settings, storage: Storage) -> None:
    base_dir = (
        Path(settings.data_dir) / "storage" / storage.team_id / "volume" / storage.name
    )
    base_dir.mkdir(parents=True, exist_ok=True)
    for entry in base_dir.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    _apply_storage_permissions(settings, base_dir)


def _apply_storage_permissions(
    settings, base_dir: Path, db_path: Path | None = None
) -> None:
    uid = int(settings.service_uid)
    gid = int(settings.service_gid)
    try:
        os.chown(base_dir, uid, gid)
        os.chmod(base_dir, 0o775)
        if db_path and db_path.exists():
            os.chown(db_path, uid, gid)
            os.chmod(db_path, 0o664)
    except Exception as exc:
        logger.warning("Failed to set storage permissions: %s", exc)
