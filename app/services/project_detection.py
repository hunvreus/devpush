import base64
import json
import logging
import re
from dataclasses import dataclass

from app.services.github import GitHubService

logger = logging.getLogger(__name__)

JS_FRAMEWORKS = {
    "next": {
        "preset": "nodejs",
        "start_command": "npm start",
    },
    "nuxt": {
        "preset": "nodejs",
        "start_command": "node .output/server/index.mjs",
    },
    "@remix-run/dev": {
        "preset": "nodejs",
        "start_command": "npm start",
    },
    "astro": {
        "preset": "nodejs",
        "start_command": "node ./dist/server/entry.mjs",
    },
    "@sveltejs/kit": {
        "preset": "nodejs",
        "start_command": "node build",
    },
    "vite": {
        "preset": "nodejs",
        "start_command": None,
    },
}

PYTHON_FRAMEWORKS = {
    "django": {
        "preset": "django",
        "start_command": "gunicorn -w 3 -b 0.0.0.0:8000 {project}.wsgi:application",
        "pre_deploy_command": "python manage.py migrate",
    },
    "fastapi": {
        "preset": "fastapi",
        "start_command": "gunicorn -w 3 -b 0.0.0.0:8000 -k uvicorn.workers.UvicornWorker main:app",
    },
    "flask": {
        "preset": "flask",
        "start_command": "gunicorn -w 3 -b 0.0.0.0:8000 main:app",
    },
}


@dataclass
class DetectedSettings:
    preset: str | None = None
    image: str | None = None
    build_command: str | None = None
    start_command: str | None = None
    pre_deploy_command: str | None = None


async def detect_project_settings(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None = None,
) -> DetectedSettings:
    result = DetectedSettings()

    try:
        pkg_file = await github_service.get_repository_file(
            user_access_token, repo_id, "package.json", ref
        )
        if pkg_file and pkg_file.get("content"):
            await _detect_js_settings(
                result, pkg_file, github_service, user_access_token, repo_id, ref
            )
            return result

        pyproject = await github_service.get_repository_file(
            user_access_token, repo_id, "pyproject.toml", ref
        )
        requirements = await github_service.get_repository_file(
            user_access_token, repo_id, "requirements.txt", ref
        )
        if pyproject or requirements:
            await _detect_python_settings(
                result,
                github_service,
                user_access_token,
                repo_id,
                ref,
                pyproject,
                requirements,
            )
            return result

        gomod = await github_service.get_repository_file(
            user_access_token, repo_id, "go.mod", ref
        )
        if gomod:
            await _detect_go_settings(
                result, github_service, user_access_token, repo_id, ref
            )
            return result

        composer = await github_service.get_repository_file(
            user_access_token, repo_id, "composer.json", ref
        )
        if composer and composer.get("content"):
            await _detect_php_settings(
                result, composer, github_service, user_access_token, repo_id, ref
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
    try:
        content = base64.b64decode(pkg_file["content"]).decode("utf-8")
        pkg_json = json.loads(content)
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.warning(f"Failed to parse package.json: {e}")
        return

    scripts = pkg_json.get("scripts", {})
    has_build = "build" in scripts
    has_start = "start" in scripts
    deps = {**pkg_json.get("dependencies", {}), **pkg_json.get("devDependencies", {})}

    pm = await _detect_package_manager(github_service, user_access_token, repo_id, ref)

    if pm == "bun":
        result.preset = "bun"
        result.image = "bun-1.3"
        install_cmd = "bun install"
        run_cmd = "bun run"
        start_prefix = "bun run"
    else:
        result.preset = "nodejs"
        result.image = "node-20"
        if pm == "yarn":
            install_cmd = "yarn install"
            run_cmd = "yarn"
            start_prefix = "yarn"
        elif pm == "pnpm":
            install_cmd = "pnpm install"
            run_cmd = "pnpm"
            start_prefix = "pnpm"
        else:
            install_cmd = "npm install"
            run_cmd = "npm run"
            start_prefix = "npm"

    framework_start = None
    for pkg, config in JS_FRAMEWORKS.items():
        if pkg in deps:
            if config.get("start_command"):
                framework_start = config["start_command"]
                if pm == "yarn":
                    framework_start = framework_start.replace("npm start", "yarn start")
                elif pm == "pnpm":
                    framework_start = framework_start.replace("npm start", "pnpm start")
                elif pm == "bun":
                    framework_start = framework_start.replace(
                        "npm start", "bun run start"
                    )
            break

    if has_build:
        result.build_command = f"{install_cmd} && {run_cmd} build"
    else:
        result.build_command = install_cmd

    if framework_start:
        result.start_command = framework_start
    elif has_start:
        result.start_command = f"{start_prefix} start"


async def _detect_python_settings(
    result: DetectedSettings,
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
    pyproject: dict | None,
    requirements: dict | None,
) -> None:
    result.preset = "python"
    result.image = "python-3.12"

    deps_content = ""
    build_cmd = "pip install -r requirements.txt"

    if pyproject and pyproject.get("content"):
        try:
            content = base64.b64decode(pyproject["content"]).decode("utf-8")
            deps_content = content.lower()

            if "[tool.poetry]" in content.lower():
                build_cmd = "pip install poetry && poetry install --only main"
            elif (
                "[tool.hatch]" in content.lower()
                or "[tool.hatchling]" in content.lower()
            ):
                build_cmd = "pip install ."
            elif "[tool.pdm]" in content.lower():
                build_cmd = "pip install pdm && pdm install --prod"
            elif "[project]" in content.lower() or "[build-system]" in content.lower():
                build_cmd = "pip install ."
        except (KeyError, UnicodeDecodeError) as e:
            logger.warning(f"Failed to parse pyproject.toml: {e}")

    if requirements and requirements.get("content"):
        try:
            req_content = (
                base64.b64decode(requirements["content"]).decode("utf-8").lower()
            )
            if not deps_content:
                deps_content = req_content
        except (KeyError, UnicodeDecodeError):
            pass

    result.build_command = build_cmd

    for framework, config in PYTHON_FRAMEWORKS.items():
        if framework in deps_content:
            result.preset = config["preset"]
            result.start_command = config["start_command"]
            if "pre_deploy_command" in config:
                result.pre_deploy_command = config["pre_deploy_command"]
            break


async def _detect_go_settings(
    result: DetectedSettings,
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
) -> None:
    result.preset = "go"
    result.image = "go-1.25"
    result.start_command = "./app"

    makefile = await github_service.get_repository_file(
        user_access_token, repo_id, "Makefile", ref
    )

    if makefile and makefile.get("content"):
        try:
            content = base64.b64decode(makefile["content"]).decode("utf-8")
            if re.search(r"^build\s*:", content, re.MULTILINE):
                result.build_command = "make build"
                return
        except (KeyError, UnicodeDecodeError):
            pass

    result.build_command = "go mod download && go build -o app ."


async def _detect_php_settings(
    result: DetectedSettings,
    composer_file: dict,
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
) -> None:
    result.preset = "php"
    result.image = "php-fpm-8.3"

    composer_install = (
        "composer install --no-dev --optimize-autoloader --no-interaction --no-progress"
    )

    try:
        content = base64.b64decode(composer_file["content"]).decode("utf-8")
        composer_json = json.loads(content)
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.warning(f"Failed to parse composer.json: {e}")
        result.build_command = composer_install
        return

    require = composer_json.get("require", {})
    scripts = composer_json.get("scripts", {})

    if "laravel/framework" in require:
        result.preset = "laravel"
        result.image = "frankenphp-node-8.3"
        result.pre_deploy_command = (
            "php artisan config:cache && php artisan route:cache && "
            "php artisan view:cache"
        )
        result.start_command = (
            "frankenphp run --config /etc/caddy/Caddyfile --adapter caddyfile"
        )

        has_npm_build = False
        pkg_file = await github_service.get_repository_file(
            user_access_token, repo_id, "package.json", ref
        )
        if pkg_file and pkg_file.get("content"):
            try:
                pkg_content = base64.b64decode(pkg_file["content"]).decode("utf-8")
                pkg_json = json.loads(pkg_content)
                has_npm_build = "build" in pkg_json.get("scripts", {})
            except (KeyError, json.JSONDecodeError, UnicodeDecodeError):
                pass

        if has_npm_build:
            result.build_command = f"{composer_install} && npm install && npm run build"
        elif "build" in scripts:
            result.build_command = f"{composer_install} && composer run build"
        else:
            result.build_command = composer_install
        return

    if "build" in scripts:
        result.build_command = f"{composer_install} && composer run build"
    else:
        result.build_command = composer_install


async def _detect_package_manager(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
) -> str:
    bun_lock = await github_service.get_repository_file(
        user_access_token, repo_id, "bun.lockb", ref
    )
    if bun_lock:
        return "bun"

    yarn_lock = await github_service.get_repository_file(
        user_access_token, repo_id, "yarn.lock", ref
    )
    if yarn_lock:
        return "yarn"

    pnpm_lock = await github_service.get_repository_file(
        user_access_token, repo_id, "pnpm-lock.yaml", ref
    )
    if pnpm_lock:
        return "pnpm"

    return "npm"
