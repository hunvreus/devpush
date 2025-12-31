import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass

from services.github import GitHubService

logger = logging.getLogger(__name__)

JS_FRAMEWORKS = {
    "next": {
        "preset": "nodejs",
        "start_command": "next start -H 0.0.0.0 -p 8000",
    },
    "nuxt": {
        "preset": "nodejs",
        "start_command": "NITRO_HOST=0.0.0.0 NITRO_PORT=8000 node .output/server/index.mjs",
    },
    "@remix-run/dev": {
        "preset": "nodejs",
        "start_command": "PORT=8000 remix-serve ./build/server/index.js",
    },
    "astro": {
        "preset": "nodejs",
        "start_command": "HOST=0.0.0.0 PORT=8000 node ./dist/server/entry.mjs",
    },
    "@sveltejs/kit": {
        "preset": "nodejs",
        "start_command": "HOST=0.0.0.0 PORT=8000 node build",
    },
    "vite": {
        "preset": "nodejs",
        "start_command": "vite preview --host 0.0.0.0 --port 8000",
    },
}

PYTHON_FRAMEWORKS = {
    "django": {
        "preset": "django",
        "start_command": "gunicorn -w 3 -b 0.0.0.0:8000 config.wsgi:application",
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

NODE_IMAGES = {
    "22": "node-22",
    "21": "node-22",
    "20": "node-20",
    "19": "node-20",
    "18": "node-20",
}

PYTHON_IMAGES = {
    "3.13": "python-3.13",
    "3.12": "python-3.12",
    "3.11": "python-3.12",
    "3.10": "python-3.12",
}

BUN_IMAGES = {
    "1": "bun-1.3",
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

    pm = await _detect_package_manager(
        github_service, user_access_token, repo_id, ref, pkg_json
    )

    if pm == "bun":
        result.preset = "bun"
        pm_version = _extract_pm_version(pkg_json.get("packageManager", ""))
        major = pm_version.split(".")[0] if pm_version else "1"
        result.image = BUN_IMAGES.get(major, "bun-1.3")
        install_cmd = "bun install"
        run_cmd = "bun run"
        start_prefix = "bun run"
    else:
        result.preset = "nodejs"
        node_version = await _detect_node_version(
            github_service, user_access_token, repo_id, ref, pkg_json
        )
        major = node_version.split(".")[0] if node_version else "20"
        result.image = NODE_IMAGES.get(major, "node-20")

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
            framework_start = config.get("start_command")
            break

    if has_build:
        result.build_command = f"{install_cmd} && {run_cmd} build"
    else:
        result.build_command = install_cmd

    start_script = scripts.get("start", "")
    if has_start and _has_port_config(start_script):
        result.start_command = f"{start_prefix} start"
    elif framework_start:
        result.start_command = framework_start
    elif has_start:
        result.start_command = f"PORT=8000 {start_prefix} start"
    else:
        result.start_command = "PORT=8000 node index.js"


def _has_port_config(script: str) -> bool:
    patterns = [
        r"-p\s*\d+",
        r"--port[=\s]\d+",
        r"-H\s+[\d\.]",
        r"--host[=\s]",
        r":\d{4,5}\b",
        r"PORT=",
        r"0\.0\.0\.0",
    ]
    return any(re.search(p, script) for p in patterns)


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

    python_version = await _detect_python_version(
        github_service, user_access_token, repo_id, ref, pyproject
    )
    major_minor = ".".join(python_version.split(".")[:2]) if python_version else "3.12"
    result.image = PYTHON_IMAGES.get(major_minor, "python-3.12")

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

    if not result.start_command:
        result.start_command = "gunicorn -w 3 -b 0.0.0.0:8000 main:app"


async def _detect_go_settings(
    result: DetectedSettings,
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
) -> None:
    result.preset = "go"
    result.image = "go-1.25"
    result.start_command = "PORT=8000 ./app"

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
    result.image = "frankenphp-8.3"
    result.start_command = (
        "frankenphp run --config /etc/caddy/Caddyfile --adapter caddyfile"
    )

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

    php_version = require.get("php", "")
    if "8.4" in php_version:
        result.image = "frankenphp-8.4"
    elif "8.3" in php_version:
        result.image = "frankenphp-8.3"
    elif "8.2" in php_version:
        result.image = "frankenphp-8.3"

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


def _extract_pm_version(package_manager: str) -> str:
    if not package_manager or "@" not in package_manager:
        return ""
    parts = package_manager.split("@")
    return parts[1] if len(parts) > 1 else ""


async def _detect_package_manager(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
    pkg_json: dict,
) -> str:
    package_manager = pkg_json.get("packageManager", "")
    if package_manager:
        if package_manager.startswith("bun"):
            return "bun"
        elif package_manager.startswith("yarn"):
            return "yarn"
        elif package_manager.startswith("pnpm"):
            return "pnpm"
        elif package_manager.startswith("npm"):
            return "npm"

    lockfiles = ["bun.lockb", "bun.lock", "yarn.lock", "pnpm-lock.yaml"]

    async def check_file(filename: str) -> tuple[str, bool]:
        result = await github_service.get_repository_file(
            user_access_token, repo_id, filename, ref
        )
        return (filename, result is not None)

    results = await asyncio.gather(*[check_file(f) for f in lockfiles])

    for filename, exists in results:
        if exists:
            if filename in ("bun.lockb", "bun.lock"):
                return "bun"
            elif filename == "yarn.lock":
                return "yarn"
            elif filename == "pnpm-lock.yaml":
                return "pnpm"

    return "npm"


async def _detect_node_version(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
    pkg_json: dict,
) -> str:
    engines = pkg_json.get("engines", {})
    node_constraint = engines.get("node", "")
    if node_constraint:
        match = re.search(r"(\d+)", node_constraint)
        if match:
            return match.group(1)

    version_files = [".node-version", ".nvmrc", ".tool-versions"]

    for filename in version_files:
        file_data = await github_service.get_repository_file(
            user_access_token, repo_id, filename, ref
        )
        if file_data and file_data.get("content"):
            try:
                content = base64.b64decode(file_data["content"]).decode("utf-8").strip()
                if filename == ".tool-versions":
                    match = re.search(r"nodejs\s+(\d+)", content)
                    if match:
                        return match.group(1)
                else:
                    match = re.search(r"(\d+)", content)
                    if match:
                        return match.group(1)
            except (KeyError, UnicodeDecodeError):
                pass

    return "20"


async def _detect_python_version(
    github_service: GitHubService,
    user_access_token: str,
    repo_id: int,
    ref: str | None,
    pyproject: dict | None,
) -> str:
    if pyproject and pyproject.get("content"):
        try:
            content = base64.b64decode(pyproject["content"]).decode("utf-8")
            match = re.search(r'python\s*[><=]+\s*["\']?(\d+\.\d+)', content)
            if match:
                return match.group(1)
            match = re.search(r'requires-python\s*=\s*["\'][><=]*(\d+\.\d+)', content)
            if match:
                return match.group(1)
        except (KeyError, UnicodeDecodeError):
            pass

    version_files = [".python-version", ".tool-versions"]

    for filename in version_files:
        file_data = await github_service.get_repository_file(
            user_access_token, repo_id, filename, ref
        )
        if file_data and file_data.get("content"):
            try:
                content = base64.b64decode(file_data["content"]).decode("utf-8").strip()
                if filename == ".tool-versions":
                    match = re.search(r"python\s+(\d+\.\d+)", content)
                    if match:
                        return match.group(1)
                else:
                    match = re.search(r"(\d+\.\d+)", content)
                    if match:
                        return match.group(1)
            except (KeyError, UnicodeDecodeError):
                pass

    return "3.12"
