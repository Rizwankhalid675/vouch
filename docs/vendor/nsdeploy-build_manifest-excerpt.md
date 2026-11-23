<!-- Source: https://github.com/cognizant-ai-lab/nsdeploy/blob/main/nsdeploy/generate.py lines 440-512 (build_manifest), fetched 2026-11-23 -->
```python
def build_manifest(plan: DeploymentPlan, network_config: Dict[str, Any],
                   mock_router: str, byok_router: str, site_base: str, theme: ThemeSpec,
                   mcp_host: str = "127.0.0.1", static_bundle: bool = False,  # pylint: disable=unused-argument
                   mock_llm: bool = False) -> Dict[str, Any]:
    """
    Build the agent-manifest.json document that the browser runtime and peer sites read.

    :param plan: The resolved deployment plan.
    :param network_config: The rewritten network config (unused; kept for caller compatibility).
    :param mock_router: URL of the mock LLM router.
    :param byok_router: URL of the BYOK LLM proxy.
    :param site_base: Public base URL of the site.
    :param theme: The site theme.
    :param mcp_host: Host for local MCP servers (unused; kept for caller compatibility).
    :param static_bundle: Whether the output is a static bundle without Python services.
    :param mock_llm: Whether the site defaults to the mock LLM router.
    :return: The manifest document.
    """
    meta: Dict[str, Any] = plan.config.get("metadata", {}) or {}
    front_fn: Dict[str, Any] = next((a.get("function", {}) for a in plan.agents if a.get("name") == plan.front_man), {})
    description: str
    description = theme.tagline or (front_fn.get("description") or meta.get("description") or plan.network_name).strip()
    allowed_peers: List[str] = []
    if site_base and (plan.hostable_tools or plan.external_mcps):  # legacy compatibility for older runtimes
        allowed_peers.append(site_base)
    allowed_peers.extend(origin for origin in (_origin(url) for url in plan.links.values()) if origin)
    # Modern runtimes use peer_policy.mode=open, but publish direct URL-tool origins
    # for compatibility with older allow-list runtimes.
    allowed_peers.extend(origin for origin in (_origin(url) for url in plan.external_networks) if origin)
    allowed_peers = list(dict.fromkeys(allowed_peers))
    manifest: Dict[str, Any] = {
        "brand": _brand_display(plan, theme),
        "networks": [
            {
                "name": plan.network_name,
                "front_man": plan.front_man,
                "hocon": (f"./{plan.network_name}.network.json" if static_bundle
                          else f"/{plan.network_name}.network.json"),
                "description": description,
                "tags": ["deployed", "nsdeploy"],
                "sample_queries": meta.get("sample_queries", []) or [],
            }
        ],
        # Real BYOK is the safe production default. The deterministic mock remains
        # available only when the developer explicitly enables it for this build.
        "llm_router": {
            "base_url": mock_router if mock_llm else byok_router,
            "mock": mock_llm,
            "byok_router": byok_router,
            **({"mock_router": mock_router} if mock_llm else {}),
        },
        "allowed_peers": allowed_peers,
        "peer_policy": {
            "mode": "open",
            "deny_origins": [],
            "note": "Public agent sites are reachable like web pages; credentials and capabilities do not transfer.",
        },
        "agent_mcp": build_agent_mcp_metadata(plan, site_base, available=not static_bundle),
        "theme": {"primary": theme.colors["primary"]},
        "linking": build_linking_metadata(plan, site_base, static_bundle=static_bundle),
    }
    if static_bundle:
        manifest["deployment"] = {
            "mode": "static",
            "self_contained_runtime": True,
            "browser_mock": mock_llm,
            "direct_byok": True,
            "direct_mcp_requires_cors": True,
            "public_mcp_facade": False,
        }
    if theme.welcome:  # LLM-proposed branded landing form (greeting + intake widget)
        welcome: Dict[str, Any] = dict(theme.welcome)
        welcome.setdefault("message", theme.hero or "")
```
