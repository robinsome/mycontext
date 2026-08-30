"""http_llm：本机/局域网 URL 不得走系统代理（否则 macOS 代理口回空 503）。"""

from __future__ import annotations

from kl_graph.utils.http_llm import (
    _httpx_client,
    _is_loopback_api_base,
    _is_private_or_loopback_host,
    _should_bypass_system_proxy,
)


def test_loopback_detection() -> None:
    assert _is_loopback_api_base("http://127.0.0.1:8020/v1") is True
    assert _is_loopback_api_base("http://localhost:8020/v1") is True
    assert _is_loopback_api_base("https://api.example.com/v1") is False


def test_lan_private_hosts_bypass_proxy() -> None:
    """局域网向量网关也必须直连 —— 实测 Clash 代理 192.168 回空 503。"""
    assert _is_private_or_loopback_host("192.168.2.44") is True
    assert _is_private_or_loopback_host("10.0.0.1") is True
    assert _is_private_or_loopback_host("172.16.5.1") is True
    assert _is_private_or_loopback_host("172.31.255.255") is True
    assert _is_private_or_loopback_host("172.15.0.1") is False
    assert _is_private_or_loopback_host("8.8.8.8") is False
    assert _should_bypass_system_proxy("http://192.168.2.44:8020/v1") is True
    assert _should_bypass_system_proxy("http://10.1.2.3:8100") is True


def test_loopback_client_disables_trust_env() -> None:
    with _httpx_client("http://127.0.0.1:8020/v1", 30.0) as client:
        assert client._trust_env is False  # noqa: SLF001 — 契约：本机禁用代理


def test_lan_client_disables_trust_env() -> None:
    with _httpx_client("http://192.168.2.44:8020/v1", 30.0) as client:
        assert client._trust_env is False  # noqa: SLF001 — 契约：局域网禁用代理


def test_remote_client_keeps_trust_env_default() -> None:
    with _httpx_client("https://api.example.com/v1", 30.0) as client:
        assert client._trust_env is True  # noqa: SLF001
