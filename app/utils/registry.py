import json
import logging
from pathlib import Path

from pydantic import BaseModel, TypeAdapter, ValidationError

logger = logging.getLogger(__name__)

class DetectionSetting(BaseModel):
    priority: int = 0
    any_files: list[str] = []
    all_files: list[str] = []
    any_paths: list[str] = []
    none_files: list[str] = []
    package_check: str | None = None

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


def _load_registry_file(path: Path, adapter: TypeAdapter, label: str):
    if not path.exists():
        raise FileNotFoundError(f"Missing registry {label} at {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Failed to load {label} from {path}: {exc}") from exc
    try:
        return adapter.validate_python(raw)
    except ValidationError as exc:
        raise ValueError(f"Invalid {label} format in {path}: {exc}") from exc


def _load_registry_json(path: Path, label: str):
    if not path.exists():
        raise FileNotFoundError(f"Missing registry {label} at {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Failed to load {label} from {path}: {exc}") from exc


def load_catalog(path: Path) -> CatalogSetting:
    adapter = TypeAdapter(CatalogSetting)
    return _load_registry_file(path, adapter, "catalog")


def load_overrides(path: Path) -> dict:
    overrides = _load_registry_json(path, "overrides")
    if not isinstance(overrides, dict):
        raise ValueError("Invalid overrides format: expected JSON object")
    return overrides


def save_overrides(path: Path, overrides: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(overrides, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def normalize_overrides(overrides: dict) -> dict:
    if not isinstance(overrides, dict):
        raise ValueError("Invalid overrides format: expected JSON object")
    runners = overrides.get("runners") or {}
    presets = overrides.get("presets") or {}
    if not isinstance(runners, dict):
        raise ValueError("Invalid overrides format: runners must be an object")
    if not isinstance(presets, dict):
        raise ValueError("Invalid overrides format: presets must be an object")
    return {"runners": runners, "presets": presets}


def _deep_merge_dicts(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def _merge_by_slug(base_items: list[dict], overrides: dict) -> list[dict]:
    merged_items: list[dict] = []
    seen: set[str] = set()

    for item in base_items:
        slug = item.get("slug")
        if isinstance(slug, str):
            seen.add(slug)
        override = overrides.get(slug) if isinstance(slug, str) else None
        if isinstance(override, dict):
            merged_items.append(_deep_merge_dicts(item, override))
        else:
            merged_items.append(item)

    for slug, override in overrides.items():
        if slug in seen:
            continue
        if not isinstance(override, dict):
            continue
        if "slug" not in override:
            merged_items.append({"slug": slug, **override})
        else:
            merged_items.append(override)

    return merged_items


def load_registry_settings(
    catalog_path: Path, overrides_path: Path
) -> tuple[list[dict], list[dict]]:
    catalog = load_catalog(catalog_path)
    overrides = normalize_overrides(load_overrides(overrides_path))
    runner_overrides = overrides["runners"]
    preset_overrides = overrides["presets"]

    catalog_data = catalog.model_dump()
    merged = {
        "meta": catalog_data.get("meta"),
        "runners": _merge_by_slug(catalog_data.get("runners", []), runner_overrides),
        "presets": _merge_by_slug(catalog_data.get("presets", []), preset_overrides),
    }

    merged_catalog = CatalogSetting.model_validate(merged)

    enabled_runners = {
        runner.slug: runner for runner in merged_catalog.runners if runner.enabled is True
    }
    enabled_runners_by_category: dict[str, list[RunnerSetting]] = {}
    for runner in enabled_runners.values():
        if runner.category:
            enabled_runners_by_category.setdefault(runner.category, []).append(runner)

    for preset in merged_catalog.presets:
        if preset.enabled is not True:
            continue
        runner = enabled_runners.get(preset.config.runner)
        if not runner:
            if preset.category and enabled_runners_by_category.get(preset.category):
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

    runners = [runner.model_dump() for runner in merged_catalog.runners]
    presets = [preset.model_dump() for preset in merged_catalog.presets]

    return runners, presets


def build_registry_sources(
    catalog: CatalogSetting, overrides: dict
) -> dict[str, dict[str, str]]:
    overrides = normalize_overrides(overrides)
    runner_overrides = overrides["runners"]
    preset_overrides = overrides["presets"]

    catalog_runner_slugs = {runner.slug for runner in catalog.runners}
    catalog_preset_slugs = {preset.slug for preset in catalog.presets}

    runner_sources: dict[str, str] = {}
    preset_sources: dict[str, str] = {}

    for slug in catalog_runner_slugs:
        runner_sources[slug] = "overridden" if slug in runner_overrides else "default"
    for slug in runner_overrides.keys():
        if slug not in catalog_runner_slugs:
            runner_sources[slug] = "custom"

    for slug in catalog_preset_slugs:
        preset_sources[slug] = "overridden" if slug in preset_overrides else "default"
    for slug in preset_overrides.keys():
        if slug not in catalog_preset_slugs:
            preset_sources[slug] = "custom"

    return {"runners": runner_sources, "presets": preset_sources}
