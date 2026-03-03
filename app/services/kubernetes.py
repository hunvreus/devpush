import logging
import re

from kubernetes_asyncio import client, config
from kubernetes_asyncio.client.exceptions import ApiException

from config import Settings

logger = logging.getLogger(__name__)


def _sanitize_name(value: str, max_length: int = 63) -> str:
    name = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    if not name:
        name = "deployment"
    if len(name) > max_length:
        name = name[:max_length].rstrip("-")
    return name


class KubernetesService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.namespace = settings.kubernetes_namespace
        self._api_client: client.ApiClient | None = None
        self._apps_api: client.AppsV1Api | None = None
        self._core_api: client.CoreV1Api | None = None
        self._networking_api: client.NetworkingV1Api | None = None
        self._custom_api: client.CustomObjectsApi | None = None

    async def _ensure_clients(self) -> None:
        if self._apps_api and self._core_api and self._networking_api:
            return

        config.load_incluster_config()

        self._api_client = client.ApiClient()
        self._apps_api = client.AppsV1Api(self._api_client)
        self._core_api = client.CoreV1Api(self._api_client)
        self._networking_api = client.NetworkingV1Api(self._api_client)
        self._custom_api = client.CustomObjectsApi(self._api_client)

    async def close(self) -> None:
        if self._api_client is not None:
            await self._api_client.close()
        self._api_client = None
        self._apps_api = None
        self._core_api = None
        self._networking_api = None
        self._custom_api = None

    def resource_names(self, deployment_id: str, project_id: str) -> dict[str, str]:
        base = _sanitize_name(f"devpush-{project_id[:8]}-{deployment_id[:8]}")
        return {
            "base": base,
            "deployment": base,
            "service": f"{base}-svc",
            "ingress": f"{base}-ing",
        }

    async def create_workload(
        self,
        *,
        deployment_id: str,
        project_id: str,
        environment_id: str,
        hostname: str,
        image: str,
        commands: list[str],
        env_vars: dict[str, str],
        mounts: list[str],
        cpus: float | None,
        memory_mb: int | None,
        labels: dict[str, str],
    ) -> str:
        await self._ensure_clients()
        assert (
            self._apps_api is not None
            and self._core_api is not None
            and self._networking_api is not None
        )

        names = self.resource_names(deployment_id, project_id)
        workload_labels = {
            "app.kubernetes.io/name": "devpush-runner",
            "devpush/project-id": project_id,
            "devpush/deployment-id": deployment_id,
            "devpush/environment-id": environment_id,
            **labels,
        }

        command_script = " && ".join(f"( {command} )" for command in commands)
        resources = None
        if cpus or memory_mb:
            requests: dict[str, str] = {}
            limits: dict[str, str] = {}
            if cpus:
                requests["cpu"] = str(cpus)
                limits["cpu"] = str(cpus)
            if memory_mb:
                requests["memory"] = f"{memory_mb}Mi"
                limits["memory"] = f"{memory_mb}Mi"
            resources = {"requests": requests, "limits": limits}

        volume_mounts: list[dict[str, str]] = []
        volumes: list[dict] = []
        for index, mount in enumerate(mounts):
            if ":" not in mount:
                continue
            host_path, container_path = mount.split(":", 1)
            volume_name = f"storage-{index}"
            volume_mounts.append({"name": volume_name, "mountPath": container_path})
            volumes.append({"name": volume_name, "hostPath": {"path": host_path}})

        deployment_manifest: dict = {
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": {"name": names["deployment"], "labels": workload_labels},
            "spec": {
                "replicas": 1,
                "selector": {"matchLabels": {"devpush/deployment-id": deployment_id}},
                "template": {
                    "metadata": {"labels": workload_labels},
                    "spec": {
                        "serviceAccountName": self.settings.kubernetes_workload_service_account,
                        "automountServiceAccountToken": False,
                        "containers": [
                            {
                                "name": "runner",
                                "image": image,
                                "args": ["sh", "-c", command_script],
                                "workingDir": "/app",
                                "env": [
                                    {"name": key, "value": value}
                                    for key, value in env_vars.items()
                                ],
                                "ports": [{"containerPort": 8000}],
                                **(
                                    {"resources": resources}
                                    if resources is not None
                                    else {}
                                ),
                                **(
                                    {"volumeMounts": volume_mounts}
                                    if volume_mounts
                                    else {}
                                ),
                            }
                        ],
                        **({"volumes": volumes} if volumes else {}),
                    },
                },
            },
        }

        service_manifest = {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {"name": names["service"], "labels": workload_labels},
            "spec": {
                "selector": {"devpush/deployment-id": deployment_id},
                "ports": [{"name": "http", "port": 80, "targetPort": 8000}],
                "type": "ClusterIP",
            },
        }

        ingress_manifest = {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "Ingress",
            "metadata": {
                "name": names["ingress"],
                "labels": workload_labels,
                "annotations": {},
            },
            "spec": {
                "rules": [
                    {
                        "host": hostname,
                        "http": {
                            "paths": [
                                {
                                    "path": "/",
                                    "pathType": "Prefix",
                                    "backend": {
                                        "service": {
                                            "name": names["service"],
                                            "port": {"number": 80},
                                        }
                                    },
                                }
                            ]
                        },
                    }
                ]
            },
        }
        if self.settings.kubernetes_ingress_class:
            ingress_manifest["spec"]["ingressClassName"] = (
                self.settings.kubernetes_ingress_class
            )
        if self.settings.url_scheme == "https":
            ingress_manifest["spec"]["tls"] = [{"hosts": [hostname]}]

        await self._apps_api.create_namespaced_deployment(
            namespace=self.namespace,
            body=deployment_manifest,
        )
        await self._core_api.create_namespaced_service(
            namespace=self.namespace,
            body=service_manifest,
        )
        await self._networking_api.create_namespaced_ingress(
            namespace=self.namespace,
            body=ingress_manifest,
        )

        return names["deployment"]

    async def kill_workload(self, workload_id: str) -> None:
        await self._ensure_clients()
        assert self._apps_api is not None
        try:
            await self._apps_api.delete_namespaced_deployment(
                name=workload_id,
                namespace=self.namespace,
                grace_period_seconds=0,
                propagation_policy="Foreground",
            )
        except ApiException as error:
            if error.status != 404:
                raise

    async def remove_workload(self, workload_id: str) -> None:
        await self._ensure_clients()
        assert (
            self._apps_api is not None
            and self._core_api is not None
            and self._networking_api is not None
        )
        deployment_name = workload_id
        service_name = f"{deployment_name}-svc"
        ingress_name = f"{deployment_name}-ing"

        try:
            await self._networking_api.delete_namespaced_ingress(
                name=ingress_name,
                namespace=self.namespace,
            )
        except ApiException as error:
            if error.status != 404:
                raise

        try:
            await self._core_api.delete_namespaced_service(
                name=service_name,
                namespace=self.namespace,
            )
        except ApiException as error:
            if error.status != 404:
                raise

        try:
            await self._apps_api.delete_namespaced_deployment(
                name=deployment_name,
                namespace=self.namespace,
                propagation_policy="Foreground",
            )
        except ApiException as error:
            if error.status != 404:
                raise

    async def get_workload_status(self, workload_id: str) -> dict[str, str]:
        await self._ensure_clients()
        assert self._apps_api is not None and self._core_api is not None

        try:
            deployment_status = await self._apps_api.read_namespaced_deployment_status(
                name=workload_id,
                namespace=self.namespace,
            )
        except ApiException as error:
            if error.status == 404:
                return {"status": "removed"}
            raise

        labels = deployment_status.metadata.labels or {}
        deployment_id = labels.get("devpush/deployment-id")
        if not deployment_id:
            available_replicas = deployment_status.status.available_replicas or 0
            if available_replicas > 0:
                return {"status": "running"}
            return {"status": "starting"}

        pods = await self._core_api.list_namespaced_pod(
            namespace=self.namespace,
            label_selector=f"devpush/deployment-id={deployment_id}",
        )
        for pod in pods.items:
            phase = (pod.status.phase or "").lower()
            if phase in {"failed", "unknown"}:
                reason = pod.status.reason or "Pod failed to start"
                return {"status": "failed", "reason": reason}
            if phase == "succeeded":
                return {"status": "exited", "reason": "Workload exited unexpectedly"}
            container_statuses = pod.status.container_statuses or []
            for container_status in container_statuses:
                waiting_state = (
                    container_status.state.waiting
                    if container_status.state
                    else None
                )
                terminated_state = (
                    container_status.state.terminated
                    if container_status.state
                    else None
                )

                if waiting_state:
                    waiting_reason = waiting_state.reason or ""
                    if waiting_reason == "CrashLoopBackOff":
                        return {
                            "status": "failed",
                            "reason": "App crashed on startup. Check deployment logs for error details.",
                        }
                    if waiting_reason in {
                        "CrashLoopBackOff",
                        "RunContainerError",
                        "CreateContainerConfigError",
                        "ErrImagePull",
                        "ImagePullBackOff",
                        "InvalidImageName",
                    }:
                        waiting_message = waiting_state.message or waiting_reason
                        if waiting_reason == "RunContainerError":
                            waiting_message = (
                                "App crashed on startup. Check deployment logs for error details."
                            )
                        return {
                            "status": "failed",
                            "reason": waiting_message,
                        }

                if terminated_state:
                    exit_code = terminated_state.exit_code
                    terminated_reason = terminated_state.reason or ""
                    terminated_message = terminated_state.message or ""

                    if exit_code == 0:
                        return {
                            "status": "exited",
                            "reason": "App exited unexpectedly. Ensure your app keeps running and doesn't exit on its own.",
                        }
                    if exit_code == 137 or terminated_reason == "OOMKilled":
                        return {
                            "status": "failed",
                            "reason": "App was killed (out of memory or manually stopped). Try increasing memory limits.",
                        }
                    if exit_code == 1:
                        return {
                            "status": "failed",
                            "reason": "App crashed on startup. Check deployment logs for error details.",
                        }

                    if terminated_message and terminated_reason not in {
                        "",
                        "Error",
                    }:
                        return {"status": "failed", "reason": terminated_message}

                    return {
                        "status": "failed",
                        "reason": f"App exited with code {exit_code}. Check deployment logs for error details.",
                    }
            if phase == "running":
                conditions = pod.status.conditions or []
                is_ready = any(
                    condition.type == "Ready" and condition.status == "True"
                    for condition in conditions
                )
                if is_ready:
                    return {
                        "status": "running",
                        "pod_ip": (pod.status.pod_ip or ""),
                    }

        available_replicas = deployment_status.status.available_replicas or 0
        if available_replicas > 0:
            return {"status": "running"}
        return {"status": "starting"}

    def _build_ingress_body(
        self,
        *,
        ingress_name: str,
        host: str,
        target_service: str,
        labels: dict[str, str],
        annotations: dict[str, str] | None = None,
    ) -> dict:
        body = {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "Ingress",
            "metadata": {
                "name": ingress_name,
                "labels": labels,
                "annotations": annotations or {},
            },
            "spec": {
                "rules": [
                    {
                        "host": host,
                        "http": {
                            "paths": [
                                {
                                    "path": "/",
                                    "pathType": "Prefix",
                                    "backend": {
                                        "service": {
                                            "name": target_service,
                                            "port": {"number": 80},
                                        }
                                    },
                                }
                            ]
                        },
                    }
                ]
            },
        }
        if self.settings.kubernetes_ingress_class:
            body["spec"]["ingressClassName"] = self.settings.kubernetes_ingress_class
        if self.settings.url_scheme == "https":
            body["spec"]["tls"] = [{"hosts": [host]}]
        return body

    async def _upsert_ingress(self, *, name: str, body: dict) -> None:
        await self._ensure_clients()
        assert self._networking_api is not None
        try:
            await self._networking_api.read_namespaced_ingress(
                name=name,
                namespace=self.namespace,
            )
            await self._networking_api.replace_namespaced_ingress(
                name=name,
                namespace=self.namespace,
                body=body,
            )
        except ApiException as error:
            if error.status != 404:
                raise
            await self._networking_api.create_namespaced_ingress(
                namespace=self.namespace,
                body=body,
            )

    async def _upsert_traefik_middleware(
        self,
        *,
        middleware_name: str,
        labels: dict[str, str],
        source_host: str,
        target_host: str,
        redirect_code: str,
    ) -> str:
        await self._ensure_clients()
        assert self._custom_api is not None

        if redirect_code in {"307", "308"}:
            logger.warning(
                "Traefik redirectRegex supports permanent bool only; '%s' will be approximated.",
                redirect_code,
            )
        permanent = redirect_code in {"301", "308"}
        target_base_url = self.settings.url_for_host(target_host)

        group_versions = [("traefik.io", "v1alpha1"), ("traefik.containo.us", "v1alpha1")]
        for group, version in group_versions:
            body = {
                "apiVersion": f"{group}/{version}",
                "kind": "Middleware",
                "metadata": {"name": middleware_name, "labels": labels},
                "spec": {
                    "redirectRegex": {
                        "regex": f"^https?://{source_host}/(.*)",
                        "replacement": f"{target_base_url}/$1",
                        "permanent": permanent,
                    }
                },
            }
            try:
                await self._custom_api.get_namespaced_custom_object(
                    group=group,
                    version=version,
                    namespace=self.namespace,
                    plural="middlewares",
                    name=middleware_name,
                )
                await self._custom_api.replace_namespaced_custom_object(
                    group=group,
                    version=version,
                    namespace=self.namespace,
                    plural="middlewares",
                    name=middleware_name,
                    body=body,
                )
                return f"{self.namespace}-{middleware_name}@kubernetescrd"
            except ApiException as error:
                if error.status != 404:
                    raise
                try:
                    await self._custom_api.create_namespaced_custom_object(
                        group=group,
                        version=version,
                        namespace=self.namespace,
                        plural="middlewares",
                        body=body,
                    )
                    return f"{self.namespace}-{middleware_name}@kubernetescrd"
                except ApiException as create_error:
                    if create_error.status != 404:
                        raise
        raise RuntimeError("Traefik Middleware CRD not available in cluster")

    async def _delete_traefik_middleware(self, middleware_name: str) -> None:
        await self._ensure_clients()
        assert self._custom_api is not None
        for group in ("traefik.io", "traefik.containo.us"):
            try:
                await self._custom_api.delete_namespaced_custom_object(
                    group=group,
                    version="v1alpha1",
                    namespace=self.namespace,
                    plural="middlewares",
                    name=middleware_name,
                )
            except ApiException as error:
                if error.status != 404:
                    raise

    async def _list_traefik_middlewares(self, project_id: str) -> list[str]:
        await self._ensure_clients()
        assert self._custom_api is not None
        label_selector = f"devpush/project-id={project_id},devpush/managed-by=devpush-routing"
        for group in ("traefik.io", "traefik.containo.us"):
            try:
                response = await self._custom_api.list_namespaced_custom_object(
                    group=group,
                    version="v1alpha1",
                    namespace=self.namespace,
                    plural="middlewares",
                    label_selector=label_selector,
                )
                items = response.get("items", [])
                return [item.get("metadata", {}).get("name", "") for item in items if item.get("metadata", {}).get("name")]
            except ApiException as error:
                if error.status != 404:
                    raise
        return []

    async def sync_project_routes(
        self,
        *,
        project_id: str,
        routes: list[dict[str, str]],
    ) -> None:
        await self._ensure_clients()
        assert self._networking_api is not None

        controller = self.settings.kubernetes_ingress_controller.lower().strip()
        desired_ingresses: set[str] = set()
        desired_middlewares: set[str] = set()

        for route in routes:
            host = route["host"]
            route_id = route["route_id"]
            deployment_id = route["deployment_id"]
            route_type = route.get("route_type", "route")
            ingress_name = _sanitize_name(f"devpush-route-{project_id}-{route_id}")
            desired_ingresses.add(ingress_name)
            target_service = self.resource_names(deployment_id, project_id)["service"]
            labels = {
                "devpush/project-id": project_id,
                "devpush/managed-by": "devpush-routing",
            }
            annotations: dict[str, str] = {}

            if route_type == "redirect":
                if controller != "traefik":
                    raise ValueError(
                        "Redirect domains require Traefik controller support"
                    )
                middleware_name = _sanitize_name(f"devpush-redir-{project_id}-{route_id}")
                try:
                    middleware_ref = await self._upsert_traefik_middleware(
                        middleware_name=middleware_name,
                        labels=labels,
                        source_host=host,
                        target_host=route["redirect_target_host"],
                        redirect_code=route.get("redirect_code", "302"),
                    )
                    desired_middlewares.add(middleware_name)
                    annotations["traefik.ingress.kubernetes.io/router.middlewares"] = (
                        middleware_ref
                    )
                except RuntimeError:
                    logger.warning(
                        "Traefik Middleware CRD unavailable; domain '%s' will use route behavior instead of redirect.",
                        host,
                    )

            body = self._build_ingress_body(
                ingress_name=ingress_name,
                host=host,
                target_service=target_service,
                labels=labels,
                annotations=annotations,
            )
            await self._upsert_ingress(name=ingress_name, body=body)

        existing = await self._networking_api.list_namespaced_ingress(
            namespace=self.namespace,
            label_selector=(
                f"devpush/project-id={project_id},devpush/managed-by=devpush-routing"
            ),
        )
        for item in existing.items:
            name = item.metadata.name
            if name not in desired_ingresses:
                try:
                    await self._networking_api.delete_namespaced_ingress(
                        name=name,
                        namespace=self.namespace,
                    )
                except ApiException as error:
                    if error.status != 404:
                        raise

        existing_middlewares = await self._list_traefik_middlewares(project_id)
        for middleware_name in existing_middlewares:
            if middleware_name not in desired_middlewares:
                await self._delete_traefik_middleware(middleware_name)
