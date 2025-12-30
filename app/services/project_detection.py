import base64
import json
import logging
from dataclasses import dataclass

from app.services.github import GitHubService

logger = logging.getLogger(__name__)


@dataclass
class DetectedSettings:
    """Settings detected from repository analysis."""

    preset: str | None = None
    image: str | None = None
    build_command: str | None = None
    start_command: str | None = None


async def detect_project_settings(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None = None,
) -> DetectedSettings:
    """Analyze repository files to detect project type and build settings.

    Args:
        github_service: GitHub service instance
        user_access_token: User's GitHub access token
        repo_id: Repository ID
        ref: Optional branch/tag/commit to analyze

    Returns:
        DetectedSettings with detected values (None for undetected fields)
    """
    result = DetectedSettings()

    try:
        # Check for package.json (Node.js/Bun projects)
        pkg_file = await github_service.get_repository_file(
            user_access_token, repo_id, "package.json", ref
        )

        if pkg_file and pkg_file.get("content"):
            await _detect_js_settings(
                result, pkg_file, github_service, user_access_token, repo_id, ref
            )
            return result

        # Check for requirements.txt (Python projects)
        requirements = await github_service.get_repository_file(
            user_access_token, repo_id, "requirements.txt", ref
        )
        if requirements:
            result.preset = "python"
            result.image = "python-3.12"
            result.build_command = "pip install -r requirements.txt"
            return result

        # Check for pyproject.toml (Python projects with modern tooling)
        pyproject = await github_service.get_repository_file(
            user_access_token, repo_id, "pyproject.toml", ref
        )
        if pyproject:
            result.preset = "python"
            result.image = "python-3.12"
            result.build_command = "pip install ."
            return result

        # Check for go.mod (Go projects)
        gomod = await github_service.get_repository_file(
            user_access_token, repo_id, "go.mod", ref
        )
        if gomod:
            result.preset = "go"
            result.image = "go-1.25"
            result.build_command = "go mod download && go build -o app ."
            result.start_command = "./app"
            return result

        # Check for composer.json (PHP projects)
        composer = await github_service.get_repository_file(
            user_access_token, repo_id, "composer.json", ref
        )
        if composer:
            result.preset = "php"
            result.image = "php-fpm-8.3"
            result.build_command = (
                "composer install --no-dev --optimize-autoloader "
                "--no-interaction --no-progress"
            )
            return result

    except Exception as e:
        logger.warning(f"Failed to detect project settings for repo {repo_id}: {e}")

    return result


async def _detect_js_settings(
    result: DetectedSettings,
    pkg_file: dict,
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
) -> None:
    """Detect settings for JavaScript/Node.js/Bun projects."""
    try:
        content = base64.b64decode(pkg_file["content"]).decode("utf-8")
        pkg_json = json.loads(content)
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.warning(f"Failed to parse package.json: {e}")
        return

    scripts = pkg_json.get("scripts", {})
    has_build = "build" in scripts
    has_start = "start" in scripts

    # Detect package manager by checking for lockfiles
    pm = await _detect_package_manager(github_service, user_access_token, repo_id, ref)

    # Set preset and image based on package manager
    if pm == "bun":
        result.preset = "bun"
        result.image = "bun-1.3"
        install_cmd = "bun install"
        run_cmd = "bun run"
    else:
        result.preset = "nodejs"
        result.image = "node-20"
        if pm == "yarn":
            install_cmd = "yarn install"
            run_cmd = "yarn"
        elif pm == "pnpm":
            install_cmd = "pnpm install"
            run_cmd = "pnpm"
        else:
            install_cmd = "npm install"
            run_cmd = "npm run"

    # Build command
    if has_build:
        result.build_command = f"{install_cmd} && {run_cmd} build"
    else:
        result.build_command = install_cmd

    # Start command
    if has_start:
        if pm == "bun":
            result.start_command = "bun run start"
        elif pm == "yarn":
            result.start_command = "yarn start"
        elif pm == "pnpm":
            result.start_command = "pnpm start"
        else:
            result.start_command = "npm start"


async def _detect_package_manager(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
) -> str:
    """Detect package manager from lockfiles.

    Returns: 'bun', 'yarn', 'pnpm', or 'npm' (default)
    """
    # Check for bun.lockb
    bun_lock = await github_service.get_repository_file(
        user_access_token, repo_id, "bun.lockb", ref
    )
    if bun_lock:
        return "bun"

    # Check for yarn.lock
    yarn_lock = await github_service.get_repository_file(
        user_access_token, repo_id, "yarn.lock", ref
    )
    if yarn_lock:
        return "yarn"

    # Check for pnpm-lock.yaml
    pnpm_lock = await github_service.get_repository_file(
        user_access_token, repo_id, "pnpm-lock.yaml", ref
    )
    if pnpm_lock:
        return "pnpm"

    # Default to npm
    return "npm"
