import logging
import aiodocker
from pathlib import Path

from config import get_settings
from services.registry import RegistryService

logger = logging.getLogger(__name__)


async def pull_runner_image(ctx, runner_slug: str):
    settings = get_settings()
    registry_service = RegistryService(Path(settings.data_dir) / "registry")
    registry_state = registry_service.state
    runner_image = next(
        (
            runner.get("image")
            for runner in registry_state.runners
            if runner.get("slug") == runner_slug
        ),
        None,
    )
    if not runner_image:
        logger.error("Runner '%s' not found in settings.", runner_slug)
        return

    async with aiodocker.Docker(url=settings.docker_host) as docker_client:
        try:
            await docker_client.images.pull(runner_image)
            logger.info("Pulled runner image: %s", runner_image)
        except Exception as exc:
            logger.error("Failed to pull runner image %s: %s", runner_image, exc)


async def pull_all_runner_images(ctx):
    settings = get_settings()
    registry_state = RegistryService(Path(settings.data_dir) / "registry").state
    runner_images = [
        runner.get("image")
        for runner in registry_state.runners
        if runner.get("enabled") is True and runner.get("image")
    ]
    if not runner_images:
        logger.info("No enabled runner images to pull.")
        return

    async with aiodocker.Docker(url=settings.docker_host) as docker_client:
        for image in runner_images:
            try:
                await docker_client.images.pull(image)
                logger.info("Pulled runner image: %s", image)
            except Exception as exc:
                logger.error("Failed to pull runner image %s: %s", image, exc)


async def clear_runner_image(ctx, runner_slug: str):
    settings = get_settings()
    registry_service = RegistryService(Path(settings.data_dir) / "registry")
    registry_state = registry_service.state
    runner_image = next(
        (
            runner.get("image")
            for runner in registry_state.runners
            if runner.get("slug") == runner_slug
        ),
        None,
    )
    if not runner_image:
        logger.error("Runner '%s' not found in settings.", runner_slug)
        return

    async with aiodocker.Docker(url=settings.docker_host) as docker_client:
        try:
            await docker_client.images.delete(runner_image, force=False)
            logger.info("Removed runner image: %s", runner_image)
        except Exception as exc:
            logger.error("Failed to remove runner image %s: %s", runner_image, exc)


async def clear_all_runner_images(ctx):
    settings = get_settings()
    registry_state = RegistryService(Path(settings.data_dir) / "registry").state
    runner_images = [
        runner.get("image") for runner in registry_state.runners if runner.get("image")
    ]
    if not runner_images:
        logger.info("No runner images to remove.")
        return

    async with aiodocker.Docker(url=settings.docker_host) as docker_client:
        for image in runner_images:
            try:
                await docker_client.images.delete(image, force=False)
                logger.info("Removed runner image: %s", image)
            except Exception as exc:
                logger.error("Failed to remove runner image %s: %s", image, exc)
