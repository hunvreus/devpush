import logging
import aiodocker

logger = logging.getLogger(__name__)


async def get_service_container_id(
    docker_client: aiodocker.Docker, service_name: str
) -> str | None:
    try:
        containers = await docker_client.containers.list(all=True)
    except Exception:
        return None

    fallback_ids = []
    for container in containers:
        if isinstance(container, dict):
            labels = container.get("Labels") or {}
            container_id = container.get("Id")
            names = container.get("Names") or []
        else:
            labels = getattr(container, "labels", {}) or {}
            container_id = getattr(container, "id", None)
            names = getattr(container, "names", []) or []

        if labels.get("com.docker.compose.service") == service_name:
            return container_id
        if any(service_name in name for name in names):
            return container_id
        if container_id:
            fallback_ids.append(container_id)

    for container_id in fallback_ids:
        try:
            container = await docker_client.containers.get(container_id)
            info = await container.show()
        except Exception:
            continue

        labels = info.get("Config", {}).get("Labels", {}) or {}
        name = (info.get("Name") or "").lstrip("/")
        if labels.get("com.docker.compose.service") == service_name:
            return container_id
        if service_name in name:
            return container_id

    return None


async def ensure_network(
    docker_client: aiodocker.Docker, name: str, labels: dict[str, str]
) -> None:
    try:
        await docker_client.networks.get(name)
        return
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise

    await docker_client.networks.create(
        {"Name": name, "CheckDuplicate": True, "Labels": labels}
    )


async def connect_container_to_network(
    docker_client: aiodocker.Docker, container_id: str | None, network_name: str | None
) -> None:
    if not container_id or not network_name:
        return

    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise
        return

    try:
        await network.connect({"Container": container_id})
    except aiodocker.DockerError as error:
        if error.status == 403 and "endpoint with name" in str(error).lower():
            return
        if error.status != 409:
            raise


async def disconnect_container_from_network(
    docker_client: aiodocker.Docker, container_id: str | None, network_name: str | None
) -> None:
    if not container_id or not network_name:
        return

    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise
        return

    try:
        await network.disconnect({"Container": container_id, "Force": True})
    except aiodocker.DockerError as error:
        if error.status not in (404, 409):
            logger.warning(
                "Failed to detach %s from %s: %s", container_id, network_name, error
            )


async def network_has_deployments(
    docker_client: aiodocker.Docker, network_name: str
) -> bool:
    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise
        return False

    info = await network.show()
    containers = info.get("Containers") or {}
    for container_id in containers.keys():
        try:
            container = await docker_client.containers.get(container_id)
            container_info = await container.show()
        except Exception:
            continue

        labels = container_info.get("Config", {}).get("Labels", {}) or {}
        if labels.get("devpush.deployment_id"):
            return True

    return False


async def remove_network_if_empty(
    docker_client: aiodocker.Docker, network_name: str
) -> bool:
    try:
        network = await docker_client.networks.get(network_name)
    except aiodocker.DockerError as error:
        if error.status != 404:
            raise
        return False

    info = await network.show()
    containers = info.get("Containers") or {}
    if containers:
        return False

    try:
        await network.delete()
        return True
    except aiodocker.DockerError:
        return False
