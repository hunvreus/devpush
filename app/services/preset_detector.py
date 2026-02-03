"""Preset detection service for automatically identifying project types."""

import fnmatch
import json
import logging
from typing import Optional

from services.github import GitHubService

logger = logging.getLogger(__name__)


class PresetDetector:
    """Detect preset from repository files.

    Uses GitHub's git trees API for fast detection (<3 seconds).
    Patterns are loaded from presets configuration.
    """

    def __init__(self, presets: list[dict]):
        """Initialize detector with a presets list.

        Args:
            presets: List of preset dictionaries
        """
        self.patterns = []
        self.presets_by_slug = {
            preset.get("slug"): preset for preset in presets if preset.get("slug")
        }
        for preset in presets:
            if preset.get("enabled") is not True:
                continue
            config = preset.get("config", {})
            detection = config.get("detection")
            if detection:
                base_pattern = {
                    "preset": preset["slug"],
                    "priority": detection.get("priority", 0),
                    "any_files": detection.get("any_files", []),
                    "all_files": detection.get("all_files", []),
                    "any_paths": detection.get("any_paths", []),
                    "none_files": detection.get("none_files", []),
                    "package_check": detection.get("package_check"),
                    "config_overrides": {},
                }
                self.patterns.append(base_pattern)

                variants = detection.get("variants", []) or []
                for variant in variants:
                    if not isinstance(variant, dict):
                        continue
                    self.patterns.append(
                        {
                            "preset": preset["slug"],
                            "priority": variant.get(
                                "priority", detection.get("priority", 0)
                            ),
                            "any_files": variant.get("any_files", []),
                            "all_files": variant.get("all_files", []),
                            "any_paths": variant.get("any_paths", []),
                            "none_files": variant.get("none_files", []),
                            "package_check": variant.get("package_check"),
                            "config_overrides": variant.get("config") or {},
                        }
                    )

    async def detect(
        self,
        github_service: GitHubService,
        user_access_token: str,
        repo_id: int,
        default_branch: str,
    ) -> Optional[dict]:
        """Detect preset from repository and return merged config.

        Args:
            github_service: GitHubService instance
            user_access_token: User's GitHub OAuth token
            repo_id: Repository ID
            default_branch: Default branch name

        Returns:
            Dict with preset slug + merged config, or None if no match
        """
        if not self.patterns:
            logger.warning("No detection patterns configured")
            return None

        try:
            logger.info(f"Fetching git tree for repo {repo_id}")
            tree = await github_service.get_git_tree(
                user_access_token, repo_id, sha=default_branch, recursive=True
            )

            paths = {
                item["path"] for item in tree.get("tree", []) if item["type"] == "blob"
            }
            logger.debug(f"Found {len(paths)} files in repository")

            if not paths:
                logger.warning("No files found in repository")
                return None

            matches = []
            for pattern in self.patterns:
                if await self._matches_pattern(
                    paths,
                    pattern,
                    github_service,
                    user_access_token,
                    repo_id,
                    default_branch,
                ):
                    matches.append(pattern)
                    logger.debug(f"Pattern matched: {pattern['preset']}")

            if not matches:
                logger.info("No preset patterns matched")
                return None

            matches.sort(key=lambda p: p["priority"], reverse=True)
            best_match = matches[0]
            preset_slug = best_match["preset"]
            preset = self.presets_by_slug.get(preset_slug, {})
            base_config = dict(preset.get("config", {}))
            base_config.pop("detection", None)
            merged_config = self._merge_config(
                base_config, best_match.get("config_overrides") or {}
            )

            logger.info(f"Detected preset: {preset_slug}")
            return {"preset": preset_slug, "config": merged_config}

        except Exception as e:
            logger.exception(f"Preset detection failed: {e}")
            return None

    async def _matches_pattern(
        self,
        paths: set[str],
        pattern: dict,
        github_service: GitHubService,
        user_access_token: str,
        repo_id: int,
        default_branch: str,
    ) -> bool:
        """Check if paths match a detection pattern."""
        if pattern.get("any_files"):
            if not any(self._path_matches(paths, p) for p in pattern["any_files"]):
                return False

        if pattern.get("all_files"):
            if not all(self._path_matches(paths, p) for p in pattern["all_files"]):
                return False

        if pattern.get("any_paths"):
            if not any(self._path_matches(paths, p) for p in pattern["any_paths"]):
                return False

        if pattern.get("none_files"):
            if any(self._path_matches(paths, p) for p in pattern["none_files"]):
                return False

        pkg_check = pattern.get("package_check")
        if pkg_check:
            found = False

            py_files = [
                p for p in paths if p.endswith(("requirements.txt", "pyproject.toml"))
            ]
            for py_file in py_files:
                try:
                    content = await github_service.get_file_content(
                        user_access_token, repo_id, py_file, ref=default_branch
                    )
                    if content and pkg_check.lower() in content.lower():
                        found = True
                        break
                except Exception as e:
                    logger.debug(f"Failed to check {py_file}: {e}")

            if not found and "package.json" in paths:
                try:
                    content = await github_service.get_file_content(
                        user_access_token, repo_id, "package.json", ref=default_branch
                    )
                    if content and pkg_check.lower() in content.lower():
                        found = True
                except Exception as e:
                    logger.debug(f"Failed to check package.json: {e}")

            if not found:
                return False

        return True

    def _path_matches(self, paths: set[str], pattern: str) -> bool:
        """Check if pattern matches any path (supports globs)."""
        if "*" in pattern or "?" in pattern:
            return any(fnmatch.fnmatch(p, pattern) for p in paths)
        return pattern in paths

    async def detect_with_commands(
        self,
        github_service: GitHubService,
        user_access_token: str,
        repo_id: int,
        default_branch: str,
    ) -> dict:
        """Detect preset and extract build/start commands from package.json.

        Returns:
            Dictionary with preset + merged config fields
        """
        result = {
            "preset": None,
            "runner": None,
            "build_command": None,
            "pre_deploy_command": None,
            "start_command": None,
            "root_directory": None,
        }

        detection = await self.detect(
            github_service, user_access_token, repo_id, default_branch
        )
        if not detection:
            return result

        preset = detection.get("preset")
        config = detection.get("config") or {}
        result["preset"] = preset
        result["runner"] = config.get("runner")
        result["build_command"] = config.get("build_command")
        result["pre_deploy_command"] = config.get("pre_deploy_command")
        result["start_command"] = config.get("start_command")
        result["root_directory"] = config.get("root_directory")

        if preset in ("nodejs", "bun"):
            try:
                content = await github_service.get_file_content(
                    user_access_token, repo_id, "package.json", ref=default_branch
                )

                if content:
                    data = json.loads(content)
                    scripts = data.get("scripts", {})

                    for build_key in ("build", "compile", "bundle"):
                        if build_key in scripts:
                            result["build_command"] = f"npm run {build_key}"
                            break

                    if "start" in scripts:
                        result["start_command"] = "npm start"
                    elif "serve" in scripts:
                        result["start_command"] = "npm run serve"
                    elif "dev" in scripts and not result["start_command"]:
                        result["start_command"] = "npm run dev"

            except Exception as e:
                logger.debug(f"Failed to extract commands from package.json: {e}")

        return result

    def _merge_config(self, base: dict, overrides: dict) -> dict:
        merged = dict(base)
        for key, value in overrides.items():
            if value is None:
                continue
            merged[key] = value
        return merged
