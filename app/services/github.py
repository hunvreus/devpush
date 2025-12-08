import httpx
import jwt
import time
from typing import Any
from email.utils import parsedate_to_datetime


class GitHubService:
    def __init__(
        self, client_id: str, client_secret: str, app_id: str, private_key: str
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.app_id = app_id
        self.private_key = private_key
        self._jwt_token = None
        self._jwt_expires_at = None
        self._time_offset = None
        self._time_offset_checked_at = None

    def _check_time_offset(self) -> int:
        """Check time offset between server and GitHub. Returns offset in seconds."""
        now = int(time.time())

        if (
            self._time_offset is not None
            and self._time_offset_checked_at is not None
            and now - self._time_offset_checked_at < 3600
        ):
            return self._time_offset

        try:
            response = httpx.get("https://api.github.com", timeout=5.0)
            if "Date" in response.headers:
                github_time = parsedate_to_datetime(response.headers["Date"])
                github_timestamp = int(github_time.timestamp())
                self._time_offset = github_timestamp - now
                self._time_offset_checked_at = now
                return self._time_offset
        except Exception:
            pass

        return self._time_offset or 0

    @property
    def jwt_token(self) -> str:
        """Get a valid JWT token, generating a new one if needed."""
        now = int(time.time())

        # Generate new token if none exists or current one is expiring soon
        if (
            not self._jwt_token
            or not self._jwt_expires_at
            or self._jwt_expires_at - now < 60
        ):
            offset = self._check_time_offset()
            adjusted_now = now + offset
            adjusted_exp = adjusted_now + (10 * 60)

            self._jwt_expires_at = now + (10 * 60)
            self._jwt_token = jwt.encode(
                {"iat": adjusted_now, "exp": adjusted_exp, "iss": self.app_id},
                self.private_key,
                algorithm="RS256",
            )

        return self._jwt_token

    async def get_user_access_token(self, code: str) -> str | None:
        """Exchange OAuth code for access token."""
        response = httpx.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
            },
        )
        response.raise_for_status()
        return response.json().get("access_token")

    async def get_user_info(
        self, user_access_token: str
    ) -> tuple[str, str, str | None]:
        """Get user ID and username from GitHub."""
        response = httpx.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {user_access_token}"},
        )
        response.raise_for_status()
        user_info = response.json()
        return (user_info.get("id"), user_info.get("login"), user_info.get("name"))

    async def get_user_primary_email(self, user_access_token: str) -> str | None:
        """Get user's primary verified email."""
        response = httpx.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {user_access_token}"},
        )
        response.raise_for_status()
        email_data = response.json()
        primary_email = next(
            (e for e in email_data if e["primary"] and e["verified"]), None
        )
        return primary_email.get("email") if primary_email else None

    async def get_user_installations(self, user_access_token: str) -> list:
        """Get all installations the authenticated user has access to."""
        response = httpx.get(
            "https://api.github.com/user/installations",
            headers={"Authorization": f"Bearer {user_access_token}"},
        )
        response.raise_for_status()
        return response.json()["installations"]

    async def search_user_repositories(
        self, user_access_token: str, owner: str, keywords: str = "", per_page: int = 5
    ) -> list[dict]:
        """Search repositories for a specific owner."""
        response = httpx.get(
            "https://api.github.com/search/repositories",
            params={
                "q": f"{keywords} in:name org:{owner} fork:true".strip(),
                "per_page": per_page,
                "sort": "updated",
                "order": "desc",
            },
            headers={"Authorization": f"Bearer {user_access_token}"},
        )
        response.raise_for_status()
        return response.json()["items"]

    async def get_repository(self, user_access_token: str, repo_id: int) -> dict:
        """Get a repository by its ID."""
        response = httpx.get(
            f"https://api.github.com/repositories/{repo_id}",
            headers={"Authorization": f"Bearer {user_access_token}"},
        )
        response.raise_for_status()
        return response.json()

    async def get_repository_branches(
        self, user_access_token: str, repo_id: int
    ) -> list:
        """Get branches for a repository."""
        response = httpx.get(
            f"https://api.github.com/repositories/{repo_id}/branches",
            headers={"Authorization": f"Bearer {user_access_token}"},
        )
        response.raise_for_status()
        return response.json()

    async def get_repository_commits(
        self,
        user_access_token: str,
        repo_id: int,
        branch: str | None = None,
        search: str | None = None,
        per_page: int = 30,
        page: int = 1,
    ) -> list:
        """Get commits for a repository.

        Args:
            user_access_token: GitHub access token
            repo_id: Repository ID
            branch: Optional branch name to filter commits
            search: Optional search query for commit messages
            per_page: Number of results per page
            page: Page number
        """
        params = {"page": str(page), "per_page": str(per_page)}
        if branch:
            params["sha"] = branch
        if search:
            params["q"] = search

        response = httpx.get(
            f"https://api.github.com/repositories/{repo_id}/commits",
            headers={"Authorization": f"Bearer {user_access_token}"},
            params=params,
        )
        response.raise_for_status()
        return response.json()

    async def get_repository_commit(
        self,
        user_access_token: str,
        repo_id: int,
        commit_sha: str,
        branch: str | None = None,
    ) -> dict:
        """
        Get details for a specific commit by its SHA.
        If branch is specified, it's used for validation but not in the URL.
        """
        url = f"https://api.github.com/repositories/{repo_id}/commits/{commit_sha}"

        params = {}
        if branch:
            params["ref"] = branch

        response = httpx.get(
            url, headers={"Authorization": f"Bearer {user_access_token}"}, params=params
        )
        response.raise_for_status()
        return response.json()

    async def get_installation(self, installation_id: str) -> dict:
        """Get installation details from GitHub."""
        response = httpx.get(
            f"https://api.github.com/app/installations/{installation_id}",
            headers={"Authorization": f"Bearer {self.jwt_token}"},
        )
        response.raise_for_status()
        return response.json()

    async def get_installation_access_token(
        self, installation_id: str
    ) -> dict[str, Any]:
        """Get an installation access token."""
        response = httpx.post(
            f"https://api.github.com/app/installations/{installation_id}/access_tokens",
            headers={"Authorization": f"Bearer {self.jwt_token}"},
        )
        response.raise_for_status()
        return response.json()

    async def get_installation_repositories(
        self, installation_access_token: str
    ) -> list[dict]:
        """Get repositories for a specific installation."""
        response = httpx.get(
            "https://api.github.com/installation/repositories",
            headers={"Authorization": f"Bearer {installation_access_token}"},
        )
        response.raise_for_status()
        return response.json()["repositories"]  # Note: returns paginated response

    async def get_repository_installation(self, repo_full_name: str) -> dict:
        """Retrieve the GitHub App installation details for a given repository."""
        response = httpx.get(
            f"https://api.github.com/repos/{repo_full_name}/installation",
            headers={"Authorization": f"Bearer {self.jwt_token}"},
        )
        response.raise_for_status()
        return response.json()
