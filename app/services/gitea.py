import httpx
import base64
import logging
from urllib.parse import urljoin

logger = logging.getLogger(__name__)


class GiteaService:
    """Gitea API client using Personal Access Token authentication."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.api_url = f"{self.base_url}/api/v1"
        self.token = token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"token {self.token}"}

    async def get_current_user(self) -> dict:
        response = httpx.get(
            f"{self.api_url}/user",
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    async def list_repos(
        self, query: str | None = None, page: int = 1, limit: int = 50
    ) -> list[dict]:
        repos: list[dict] = []
        params: dict = {"page": page, "limit": limit, "sort": "updated", "order": "desc"}
        if query:
            params["q"] = query

        response = httpx.get(
            f"{self.api_url}/user/repos",
            headers=self._headers(),
            params=params,
            timeout=10.0,
        )
        response.raise_for_status()
        repos = response.json()
        return repos

    async def get_repo(self, owner: str, repo: str) -> dict:
        response = httpx.get(
            f"{self.api_url}/repos/{owner}/{repo}",
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    async def list_branches(self, owner: str, repo: str) -> list[dict]:
        branches: list[dict] = []
        page = 1
        limit = 50

        while True:
            response = httpx.get(
                f"{self.api_url}/repos/{owner}/{repo}/branches",
                headers=self._headers(),
                params={"page": page, "limit": limit},
                timeout=10.0,
            )
            response.raise_for_status()
            batch = response.json()
            branches.extend(batch)
            if len(batch) < limit:
                break
            page += 1

        return branches

    async def list_commits(
        self,
        owner: str,
        repo: str,
        sha: str | None = None,
        page: int = 1,
        limit: int = 30,
    ) -> list[dict]:
        params: dict = {"page": page, "limit": limit}
        if sha:
            params["sha"] = sha

        response = httpx.get(
            f"{self.api_url}/repos/{owner}/{repo}/commits",
            headers=self._headers(),
            params=params,
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    async def get_commit(self, owner: str, repo: str, sha: str) -> dict:
        response = httpx.get(
            f"{self.api_url}/repos/{owner}/{repo}/git/commits/{sha}",
            headers=self._headers(),
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    async def get_git_tree(
        self, owner: str, repo: str, sha: str = "HEAD", recursive: bool = True
    ) -> dict:
        params = {}
        if recursive:
            params["recursive"] = "true"

        response = httpx.get(
            f"{self.api_url}/repos/{owner}/{repo}/git/trees/{sha}",
            headers=self._headers(),
            params=params,
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    async def get_file_content(
        self, owner: str, repo: str, path: str, ref: str = "HEAD"
    ) -> str | None:
        try:
            response = httpx.get(
                f"{self.api_url}/repos/{owner}/{repo}/contents/{path}",
                headers=self._headers(),
                params={"ref": ref},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            return base64.b64decode(data["content"]).decode("utf-8")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def normalize_commit(self, commit: dict) -> dict:
        """Normalize a Gitea commit into the shape GitHub commits have,
        so callers (DeploymentService, etc.) can work with both."""
        c = commit.get("commit", commit)
        author_info = c.get("author", {})
        committer_info = commit.get("author") or commit.get("committer") or {}
        return {
            "sha": commit.get("sha", c.get("sha", "")),
            "commit": {
                "message": c.get("message", ""),
                "author": {
                    "name": author_info.get("name", ""),
                    "email": author_info.get("email", ""),
                    "date": author_info.get("date", ""),
                },
            },
            "author": {
                "login": committer_info.get("login", author_info.get("name", "")),
                "avatar_url": committer_info.get("avatar_url", ""),
            },
        }
