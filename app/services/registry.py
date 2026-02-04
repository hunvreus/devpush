import copy
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, TypeAdapter, ValidationError

logger = logging.getLogger(__name__)


class PresetVariantConfigSetting(BaseModel):
    runner: str | None = None
    build_command: str | None = None
    pre_deploy_command: str | None = None
    start_command: str | None = None
    root_directory: str | None = None
    logo: str | None = None
    beta: bool | None = None

    model_config = {"extra": "ignore"}


class DetectionVariantSetting(BaseModel):
    priority: int = 0
    any_files: list[str] = []
    all_files: list[str] = []
    any_paths: list[str] = []
    none_files: list[str] = []
    package_check: str | None = None
    config: PresetVariantConfigSetting | None = None

    model_config = {"extra": "ignore"}


class DetectionSetting(BaseModel):
    priority: int = 0
    any_files: list[str] = []
    all_files: list[str] = []
    any_paths: list[str] = []
    none_files: list[str] = []
    package_check: str | None = None
    variants: list[DetectionVariantSetting] = []

    model_config = {"extra": "ignore"}


class RunnerSetting(BaseModel):
    slug: str
    name: str
    category: str | None = None
    image: str
    enabled: bool | None = None

    model_config = {"extra": "ignore"}


class PresetConfigSetting(BaseModel):
    runner: str
    build_command: str
    pre_deploy_command: str
    start_command: str
    logo: str
    root_directory: str | None = None
    beta: bool | None = None
    detection: DetectionSetting | None = None

    model_config = {"extra": "ignore"}


class PresetSetting(BaseModel):
    slug: str
    name: str
    category: str | None = None
    config: PresetConfigSetting
    enabled: bool | None = None

    model_config = {"extra": "ignore"}


class CatalogMetaSetting(BaseModel):
    version: str
    source: str | None = None

    model_config = {"extra": "ignore"}


class CatalogSetting(BaseModel):
    meta: CatalogMetaSetting
    runners: list[RunnerSetting]
    presets: list[PresetSetting]

    model_config = {"extra": "ignore"}


@dataclass
class RegistryState:
    catalog: CatalogSetting | None
    overrides: dict
    runners: list[dict]
    presets: list[dict]


class RegistryService:
    def __init__(self, registry_dir: Path):
        self.registry_dir = registry_dir
        self.catalog_path = self.registry_dir / "catalog.json"
        self.overrides_path = self.registry_dir / "overrides.json"
        self._catalog_adapter = TypeAdapter(CatalogSetting)
        self.state = self._load_state()

    def set_runner(self, slug: str, enabled: bool) -> RegistryState:
        overrides = copy.deepcopy(self.state.overrides)
        current = overrides["runners"].get(slug)
        if isinstance(current, dict):
            current["enabled"] = enabled
            overrides["runners"][slug] = current
        else:
            overrides["runners"][slug] = {"enabled": enabled}
        return self._write_overrides(overrides)

    def set_preset(self, slug: str, enabled: bool) -> RegistryState:
        overrides = copy.deepcopy(self.state.overrides)
        current = overrides["presets"].get(slug)
        if isinstance(current, dict):
            current["enabled"] = enabled
            overrides["presets"][slug] = current
        else:
            overrides["presets"][slug] = {"enabled": enabled}
        return self._write_overrides(overrides)

    async def update_catalog(self, url: str) -> RegistryState:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            raw = response.json()
        catalog = CatalogSetting.model_validate(raw)
        if not catalog.meta.source:
            catalog.meta.source = "registry"
        self.registry_dir.mkdir(parents=True, exist_ok=True)
        self.catalog_path.write_text(
            json.dumps(catalog.model_dump(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self.state = self._load_state()
        return self.state

    async def resolve_catalog_url(self, url: str) -> str:
        parsed = self._parse_raw_github_url(url)
        if not parsed:
            return url
        owner, repo, ref, rest = parsed
        if not rest:
            return url
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                tag = await self._get_latest_github_tag(client, owner, repo)
        except Exception:
            return url
        if not tag or tag == ref:
            return url
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{tag}/{rest}"

    def _load_state(self) -> RegistryState:
        catalog = self._load_catalog()
        overrides = self._load_overrides(catalog)
        if not catalog:
            return RegistryState(
                catalog=None,
                overrides=overrides,
                runners=[],
                presets=[],
            )
        runners, presets = self._merge(catalog, overrides)
        return RegistryState(
            catalog=catalog,
            overrides=overrides,
            runners=runners,
            presets=presets,
        )

    @staticmethod
    def _parse_raw_github_url(url: str) -> tuple[str, str, str, str] | None:
        parsed = urlparse(url)
        if parsed.netloc != "raw.githubusercontent.com":
            return None
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) < 4:
            return None
        owner, repo, ref = parts[0], parts[1], parts[2]
        rest = "/".join(parts[3:])
        return owner, repo, ref, rest

    @staticmethod
    async def _get_latest_github_tag(
        client: httpx.AsyncClient, owner: str, repo: str
    ) -> str | None:
        response = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/tags",
            params={"per_page": 1},
        )
        response.raise_for_status()
        tags = response.json()
        if isinstance(tags, list) and tags:
            tag = tags[0].get("name")
            if isinstance(tag, str) and tag.strip():
                return tag.strip()
        return None

    def _write_overrides(self, overrides: dict) -> RegistryState:
        catalog = self.state.catalog
        cleaned = self._prune_overrides(catalog, overrides) if catalog else overrides
        self.overrides_path.parent.mkdir(parents=True, exist_ok=True)
        self.overrides_path.write_text(
            json.dumps(cleaned, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        self.state = self._load_state()
        return self.state

    def _load_catalog(self) -> CatalogSetting | None:
        if not self.catalog_path.exists():
            raise FileNotFoundError(f"Missing registry catalog at {self.catalog_path}")
        raw = self._read_json(self.catalog_path, "catalog")
        return self._validate_catalog(raw, self.catalog_path)

    def _load_overrides(self, catalog: CatalogSetting | None) -> dict:
        overrides = (
            self._read_json(self.overrides_path, "overrides")
            if self.overrides_path.exists()
            else {"runners": {}, "presets": {}}
        )
        overrides = self._normalize_overrides(overrides)
        return self._prune_overrides(catalog, overrides) if catalog else overrides

    def _read_json(self, path: Path, label: str) -> dict:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise ValueError(f"Failed to load {label} from {path}: {exc}") from exc

    def _validate_catalog(self, raw: dict, path: Path) -> CatalogSetting:
        try:
            return self._catalog_adapter.validate_python(raw)
        except ValidationError as exc:
            raise ValueError(f"Invalid catalog format in {path}: {exc}") from exc

    def _normalize_overrides(self, overrides: dict) -> dict:
        if not isinstance(overrides, dict):
            raise ValueError("Invalid overrides format: expected JSON object")
        runners = overrides.get("runners") or {}
        presets = overrides.get("presets") or {}
        if not isinstance(runners, dict):
            raise ValueError("Invalid overrides format: runners must be an object")
        if not isinstance(presets, dict):
            raise ValueError("Invalid overrides format: presets must be an object")
        return {"runners": runners, "presets": presets}

    def _prune_overrides(self, catalog: CatalogSetting, overrides: dict) -> dict:
        overrides = self._normalize_overrides(overrides)
        base_runners = {runner.slug: runner.model_dump() for runner in catalog.runners}
        base_presets = {preset.slug: preset.model_dump() for preset in catalog.presets}
        cleaned = {"runners": {}, "presets": {}}

        for slug, override in overrides["runners"].items():
            if not isinstance(override, dict):
                continue
            base = base_runners.get(slug)
            if not base:
                required = {"name", "image", "category"}
                merged = {"slug": slug, **override}
                if not required.issubset(set(merged.keys())):
                    continue
            explicit_disable = (
                "enabled" in override and override.get("enabled") is False
            )
            entry = {k: v for k, v in override.items() if k != "slug"}
            if entry.get("enabled") is False:
                entry.pop("enabled", None)
            if base:
                for key in ("name", "category", "image", "enabled"):
                    if key in entry and entry[key] == base.get(key):
                        entry.pop(key, None)
            if not entry:
                if explicit_disable and base and base.get("enabled") is True:
                    cleaned["runners"][slug] = {}
                continue
            cleaned["runners"][slug] = entry

        for slug, override in overrides["presets"].items():
            if not isinstance(override, dict):
                continue
            base = base_presets.get(slug)
            if not base:
                merged = {"slug": slug, **override}
                config = (
                    merged.get("config")
                    if isinstance(merged.get("config"), dict)
                    else None
                )
                required_config = {
                    "runner",
                    "build_command",
                    "pre_deploy_command",
                    "start_command",
                    "logo",
                }
                if not config or not required_config.issubset(set(config.keys())):
                    continue
            explicit_disable = (
                "enabled" in override and override.get("enabled") is False
            )
            entry = {k: v for k, v in override.items() if k != "slug"}
            if entry.get("enabled") is False:
                entry.pop("enabled", None)
            if base:
                for key in ("name", "category", "enabled"):
                    if key in entry and entry[key] == base.get(key):
                        entry.pop(key, None)
                if isinstance(entry.get("config"), dict):
                    base_config = base.get("config") or {}
                    entry["config"] = self._prune_config_overrides(
                        base_config, entry["config"]
                    )
                    if not entry["config"]:
                        entry.pop("config", None)
            if not entry:
                if explicit_disable and base and base.get("enabled") is True:
                    cleaned["presets"][slug] = {}
                continue
            cleaned["presets"][slug] = entry

        return cleaned

    def _prune_config_overrides(self, base: dict, override: dict) -> dict:
        cleaned = dict(override)
        for key in list(cleaned.keys()):
            if key in base and cleaned[key] == base[key]:
                cleaned.pop(key, None)
        return cleaned

    def _merge(
        self, catalog: CatalogSetting, overrides: dict
    ) -> tuple[list[dict], list[dict]]:
        overrides = self._normalize_overrides(overrides)
        catalog_data = catalog.model_dump()
        merged = {
            "meta": catalog_data.get("meta"),
            "runners": self._merge_by_slug(
                catalog_data.get("runners", []), overrides["runners"]
            ),
            "presets": self._merge_by_slug(
                catalog_data.get("presets", []), overrides["presets"]
            ),
        }
        merged_catalog = CatalogSetting.model_validate(merged)
        base_runner_slugs = {runner.slug for runner in catalog.runners}
        base_preset_slugs = {preset.slug for preset in catalog.presets}

        enabled_runners = {
            runner.slug: runner
            for runner in merged_catalog.runners
            if runner.enabled is True
        }
        enabled_by_category: dict[str, list[RunnerSetting]] = {}
        for runner in enabled_runners.values():
            if runner.category:
                enabled_by_category.setdefault(runner.category, []).append(runner)

        for preset in merged_catalog.presets:
            if preset.enabled is not True:
                continue
            runner = enabled_runners.get(preset.config.runner)
            if not runner:
                if preset.category and enabled_by_category.get(preset.category):
                    logger.warning(
                        "Preset '%s' runner '%s' missing/disabled; keeping enabled due to category fallback.",
                        preset.slug,
                        preset.config.runner,
                    )
                    continue
                logger.warning(
                    "Disabling preset '%s': runner '%s' is missing or disabled.",
                    preset.slug,
                    preset.config.runner,
                )
                preset.enabled = False
                continue
            if preset.category and runner.category != preset.category:
                logger.warning(
                    "Disabling preset '%s': runner '%s' category mismatch (%s).",
                    preset.slug,
                    runner.slug,
                    runner.category,
                )
                preset.enabled = False

        runners = [
            self._apply_override_meta(
                runner.model_dump(),
                slug=runner.slug,
                base_slugs=base_runner_slugs,
                override=overrides["runners"].get(runner.slug),
            )
            for runner in merged_catalog.runners
        ]
        presets = [
            self._apply_override_meta(
                preset.model_dump(),
                slug=preset.slug,
                base_slugs=base_preset_slugs,
                override=overrides["presets"].get(preset.slug),
            )
            for preset in merged_catalog.presets
        ]
        return runners, presets

    def _merge_by_slug(self, base_items: list[dict], overrides: dict) -> list[dict]:
        merged_items: list[dict] = []
        seen: set[str] = set()

        for item in base_items:
            slug = item.get("slug")
            if isinstance(slug, str):
                seen.add(slug)
            override = overrides.get(slug) if isinstance(slug, str) else None
            if isinstance(override, dict):
                merged = self._deep_merge_dicts(item, override)
                if "enabled" not in merged or merged.get("enabled") is None:
                    merged["enabled"] = False
                merged_items.append(merged)
            else:
                merged = dict(item)
                if "enabled" not in merged or merged.get("enabled") is None:
                    merged["enabled"] = False
                merged_items.append(merged)

        for slug, override in overrides.items():
            if slug in seen or not isinstance(override, dict):
                continue
            merged = (
                {"slug": slug, **override} if "slug" not in override else dict(override)
            )
            if "enabled" not in merged or merged.get("enabled") is None:
                merged["enabled"] = False
            merged_items.append(merged)

        return merged_items

    def _apply_override_meta(
        self,
        item: dict,
        *,
        slug: str,
        base_slugs: set[str],
        override: dict | None,
    ) -> dict:
        source = "catalog"
        has_non_enabled_override = False
        if slug not in base_slugs:
            source = "custom"
        elif isinstance(override, dict):
            source = "override"

        if isinstance(override, dict):
            for key, value in override.items():
                if key in {"enabled", "slug"}:
                    continue
                if key == "config" and isinstance(value, dict) and not value:
                    continue
                has_non_enabled_override = True
                break

        item["source"] = source
        item["has_non_enabled_override"] = has_non_enabled_override
        return item

    def _deep_merge_dicts(self, base: dict, override: dict) -> dict:
        merged = dict(base)
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._deep_merge_dicts(merged[key], value)
            else:
                merged[key] = value
        return merged
