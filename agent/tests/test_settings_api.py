"""Regression tests for local settings API endpoints."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api_server
from src.api.auth_routes import get_auth_service
from src.api.settings_routes import _ensure_user_data_source_table, _ensure_user_llm_settings_table
from src.security.secret_policy import scrub_server_shared_secrets


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    env_example = tmp_path / ".env.example"
    env_path = tmp_path / ".env"
    env_example.write_text(
        "\n".join(
            [
                "LANGCHAIN_PROVIDER=openrouter",
                "LANGCHAIN_MODEL_NAME=deepseek/deepseek-v4-pro",
                "OPENROUTER_BASE_URL=https://openrouter.ai/api/v1",
                "OPENROUTER_API_KEY=your-openrouter-api-key",
                "LANGCHAIN_TEMPERATURE=0.2",
                "TIMEOUT_SECONDS=90",
                "MAX_RETRIES=3",
                "LANGCHAIN_REASONING_EFFORT=max",
                "TUSHARE_TOKEN=your-tushare-token",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(api_server, "ENV_PATH", env_path)
    monkeypatch.setattr(api_server, "ENV_EXAMPLE_PATH", env_example)
    monkeypatch.setattr(api_server, "_baostock_supported", lambda: False)
    monkeypatch.setattr(api_server, "_baostock_installed", lambda: False)
    monkeypatch.delenv("API_AUTH_KEY", raising=False)
    return TestClient(api_server.app, client=("127.0.0.1", 50000))


def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "access_code": "change-me-access-code"},
    )
    assert response.status_code == 200
    user_id = response.json()["user"]["id"]
    _ensure_user_llm_settings_table()
    _ensure_user_data_source_table()
    with get_auth_service().connect() as conn:
        conn.execute("DELETE FROM user_llm_settings WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_data_source_credentials WHERE user_id = ?", (user_id,))
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_get_llm_settings_is_side_effect_free_and_hides_placeholders(
    client: TestClient, tmp_path: Path,
) -> None:
    response = client.get("/settings/llm", headers=auth_headers(client))

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "openrouter"
    assert body["model_name"] == "deepseek/deepseek-v4-pro"
    assert body["api_key_configured"] is False
    assert body["api_key_hint"] is None
    assert body["scope"] == "user"
    assert body["owner_user_id"]
    assert not Path(body["env_path"]).is_absolute()
    assert body["env_path"].endswith(".env")
    assert body["reasoning_effort"] == "max"
    assert not (tmp_path / ".env").exists()


@pytest.mark.parametrize("placeholder", ["sk-xxx", "xxx", "gsk_xxx"])
def test_llm_settings_treat_documented_key_placeholders_as_unconfigured(
    client: TestClient, tmp_path: Path, placeholder: str,
) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "LANGCHAIN_PROVIDER=deepseek",
                "LANGCHAIN_MODEL_NAME=deepseek-v4-pro",
                f"DEEPSEEK_API_KEY={placeholder}",
                "DEEPSEEK_BASE_URL=https://api.deepseek.com/v1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    response = client.get("/settings/llm", headers=auth_headers(client))

    assert response.status_code == 200
    body = response.json()
    assert body["api_key_configured"] is False
    assert body["api_key_hint"] is None
    assert placeholder not in response.text


def test_update_llm_settings_persists_user_settings(
    client: TestClient, tmp_path: Path,
) -> None:
    headers = auth_headers(client)
    response = client.put(
        "/settings/llm",
        headers=headers,
        json={
            "provider": "openrouter",
            "model_name": "deepseek/deepseek-v4-pro",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "or-secret-value",
            "temperature": 0.1,
            "timeout_seconds": 45,
            "max_retries": 1,
            "reasoning_effort": "max",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "openrouter"
    assert body["api_key_configured"] is True
    assert body["api_key_hint"] is None
    assert body["scope"] == "user"
    assert body["owner_user_id"]
    assert "or-secret-value" not in response.text
    assert "or-s...alue" not in response.text

    assert not (tmp_path / ".env").exists()
    second_response = client.get("/settings/llm", headers=headers)
    assert second_response.status_code == 200
    assert second_response.json()["api_key_configured"] is True
    assert "or-secret-value" not in second_response.text


def test_get_data_source_settings_treats_placeholder_as_unconfigured(
    client: TestClient, tmp_path: Path,
) -> None:
    response = client.get("/settings/data-sources", headers=auth_headers(client))

    assert response.status_code == 200
    body = response.json()
    assert body["tushare_token_configured"] is False
    assert body["tushare_token_hint"] is None
    assert body["scope"] == "user"
    assert body["owner_user_id"]
    assert body["baostock_supported"] is False
    assert body["baostock_installed"] is False
    assert not Path(body["env_path"]).is_absolute()
    assert body["env_path"].endswith(".env")
    assert not (tmp_path / ".env").exists()


def test_settings_response_never_exposes_configured_secret_hints(
    client: TestClient, tmp_path: Path,
) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "LANGCHAIN_PROVIDER=openrouter",
                "OPENROUTER_API_KEY=or-secret-private-value",
                "TUSHARE_TOKEN=ts-secret-private-token",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    headers = auth_headers(client)
    llm_update = client.put(
        "/settings/llm",
        headers=headers,
        json={
            "provider": "openrouter",
            "model_name": "deepseek/deepseek-v4-pro",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "or-secret-private-value",
            "temperature": 0.1,
            "timeout_seconds": 45,
            "max_retries": 1,
            "reasoning_effort": "max",
        },
    )
    data_update = client.put(
        "/settings/data-sources",
        headers=headers,
        json={"tushare_token": "ts-secret-private-token"},
    )
    assert llm_update.status_code == 200
    assert data_update.status_code == 200

    llm_response = client.get("/settings/llm", headers=headers)
    data_response = client.get("/settings/data-sources", headers=headers)

    assert llm_response.status_code == 200
    assert data_response.status_code == 200
    llm_body = llm_response.json()
    data_body = data_response.json()
    assert llm_body["api_key_configured"] is True
    assert llm_body["api_key_hint"] is None
    assert data_body["tushare_token_configured"] is True
    assert data_body["tushare_token_hint"] is None
    assert "or-secret-private-value" not in llm_response.text
    assert "or-s...alue" not in llm_response.text
    assert "ts-secret-private-token" not in data_response.text
    assert "ts-s...oken" not in data_response.text


def test_settings_reads_reject_remote_dev_mode_clients(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_path = tmp_path / ".env"
    env_example = tmp_path / ".env.example"
    env_path.write_text(
        "\n".join(
            [
                "LANGCHAIN_PROVIDER=openrouter",
                "OPENROUTER_API_KEY=or-secret-value",
                "TUSHARE_TOKEN=ts-secret-token",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    env_example.write_text("LANGCHAIN_PROVIDER=openai\n", encoding="utf-8")
    monkeypatch.setattr(api_server, "ENV_PATH", env_path)
    monkeypatch.setattr(api_server, "ENV_EXAMPLE_PATH", env_example)
    monkeypatch.delenv("API_AUTH_KEY", raising=False)
    remote_client = TestClient(api_server.app, client=("203.0.113.10", 50000))

    llm_response = remote_client.get("/settings/llm")
    data_source_response = remote_client.get("/settings/data-sources")

    assert llm_response.status_code == 401
    assert data_source_response.status_code == 401
    assert "or-s...alue" not in llm_response.text
    assert "ts-s...oken" not in data_source_response.text


def test_settings_reads_allow_loopback_without_bearer_even_when_api_auth_key_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_path = tmp_path / ".env"
    env_example = tmp_path / ".env.example"
    env_path.write_text(
        "\n".join(
            [
                "LANGCHAIN_PROVIDER=openrouter",
                "OPENROUTER_API_KEY=or-secret-value",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    env_example.write_text("LANGCHAIN_PROVIDER=openai\n", encoding="utf-8")
    monkeypatch.setattr(api_server, "ENV_PATH", env_path)
    monkeypatch.setattr(api_server, "ENV_EXAMPLE_PATH", env_example)
    monkeypatch.setenv("API_AUTH_KEY", "settings-secret")
    local_client = TestClient(api_server.app, client=("127.0.0.1", 50000))
    headers = auth_headers(local_client)

    unauthenticated_response = local_client.get("/settings/llm")
    authenticated_response = local_client.get(
        "/settings/llm",
        headers=headers,
    )

    assert unauthenticated_response.status_code == 401
    assert authenticated_response.status_code == 200
    assert authenticated_response.json()["api_key_configured"] is False
    assert authenticated_response.json()["api_key_hint"] is None
    assert "or-secret-value" not in authenticated_response.text
    assert "or-s...alue" not in authenticated_response.text


def test_update_data_source_settings_persists_tushare_token(
    client: TestClient, tmp_path: Path,
) -> None:
    headers = auth_headers(client)
    response = client.put(
        "/settings/data-sources",
        headers=headers,
        json={"tushare_token": "ts-secret-token"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["tushare_token_configured"] is True
    assert body["tushare_token_hint"] is None
    assert body["scope"] == "user"
    assert body["owner_user_id"]
    assert "ts-secret-token" not in response.text
    assert "ts-s...oken" not in response.text

    assert not (tmp_path / ".env").exists()
    second_response = client.get("/settings/data-sources", headers=headers)
    assert second_response.status_code == 200
    assert second_response.json()["tushare_token_configured"] is True


def test_settings_writes_require_product_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_example = tmp_path / ".env.example"
    env_path = tmp_path / ".env"
    env_example.write_text("LANGCHAIN_PROVIDER=openai\n", encoding="utf-8")
    monkeypatch.setattr(api_server, "ENV_PATH", env_path)
    monkeypatch.setattr(api_server, "ENV_EXAMPLE_PATH", env_example)
    monkeypatch.delenv("API_AUTH_KEY", raising=False)
    remote_client = TestClient(api_server.app, client=("203.0.113.10", 50000))

    response = remote_client.put(
        "/settings/data-sources",
        json={"tushare_token": "ts-secret-token"},
    )

    assert response.status_code == 401
    assert not env_path.exists()


def test_public_api_startup_scrubs_server_shared_paid_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "server-paid-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "server-paid-openrouter-key")
    monkeypatch.setenv("TUSHARE_TOKEN", "server-paid-data-token")

    removed = scrub_server_shared_secrets()

    assert "OPENAI_API_KEY" in removed
    assert "OPENROUTER_API_KEY" in removed
    assert "TUSHARE_TOKEN" in removed
    assert "OPENAI_API_KEY" not in os.environ
    assert "OPENROUTER_API_KEY" not in os.environ
    assert "TUSHARE_TOKEN" not in os.environ


def test_private_deployments_can_explicitly_allow_server_shared_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "server-paid-key")

    removed = scrub_server_shared_secrets()

    assert removed == []
    assert os.environ["OPENAI_API_KEY"] == "server-paid-key"
